import { supabaseService } from "@/lib/supabase-server";

export const STORAGE_BUCKET = "cedulas";
export const MOTIVO_BUG_SLUG = "bug_historico_oficios_presentados_como_cedulas";
export const RAILWAY_OCR_FETCH_MS = 600_000;

export type CedulaOficioHistorico = {
  id: string;
  pdf_path: string | null;
  ocr_exp_nro: string | null;
  juzgado: string | null;
  caratula: string | null;
  ocr_caratula: string | null;
  pjn_cargado_at: string | null;
  ocr_destinatario: string | null;
};

type AuditRow = {
  cedula_id: string;
  motivo: string;
  tipo_documento_nuevo: string;
  aplicado_at: string | null;
  revertido_at: string | null;
};

export function matchesBugHistoricoMotivo(motivo: string | null): boolean {
  if (!motivo?.trim()) return false;
  const normalized = motivo.trim().toLowerCase();
  if (normalized.includes(MOTIVO_BUG_SLUG)) return true;
  if (normalized.includes("bug histórico") || normalized.includes("bug historico")) {
    return true;
  }
  return (
    normalized.includes("bug") &&
    normalized.includes("hist") &&
    (normalized.includes("cedula") || normalized.includes("cédula")) &&
    normalized.includes("oficio")
  );
}

export function isOcrDestinatarioVacio(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export function isOcrCampoVacio(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export async function requireSuperadmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_superadmin === true;
}

export type FetchCandidatosResult =
  | { ok: true; candidatos: CedulaOficioHistorico[] }
  | { ok: false; error: string; details?: string; missingAuditTable?: boolean };

export async function fetchCandidatosOcrOficioHistorico(
  svc: ReturnType<typeof supabaseService>
): Promise<FetchCandidatosResult> {
  const { data: auditData, error: auditErr } = await svc
    .from("cedulas_tipo_documento_audit")
    .select("cedula_id, motivo, tipo_documento_nuevo, aplicado_at, revertido_at")
    .eq("tipo_documento_nuevo", "OFICIO")
    .not("aplicado_at", "is", null)
    .is("revertido_at", null);

  if (auditErr) {
    const missingTable =
      auditErr.message?.includes("does not exist") ||
      auditErr.code === "PGRST116" ||
      auditErr.message?.includes("cedulas_tipo_documento_audit");

    return {
      ok: false,
      error: missingTable
        ? "Tabla cedulas_tipo_documento_audit no existe. Ejecutar migrations/audit_reclasificar_tipo_documento_oficio.sql"
        : "Error al leer auditoría de reclasificación",
      details: auditErr.message,
      missingAuditTable: missingTable,
    };
  }

  const auditRows = (auditData ?? []) as AuditRow[];
  const auditPorCedula = new Map<string, AuditRow>();

  for (const row of auditRows) {
    if (!matchesBugHistoricoMotivo(row.motivo)) continue;
    const prev = auditPorCedula.get(row.cedula_id);
    if (!prev || (row.aplicado_at && prev.aplicado_at && row.aplicado_at > prev.aplicado_at)) {
      auditPorCedula.set(row.cedula_id, row);
    }
  }

  const cedulaIdsAudit = Array.from(auditPorCedula.keys());
  if (cedulaIdsAudit.length === 0) {
    return { ok: true, candidatos: [] };
  }

  const { data: cedulasData, error: cedulasErr } = await svc
    .from("cedulas")
    .select(
      "id, pdf_path, ocr_exp_nro, juzgado, caratula, ocr_caratula, pjn_cargado_at, ocr_destinatario, tipo_documento, estado_ocr"
    )
    .in("id", cedulaIdsAudit)
    .eq("tipo_documento", "OFICIO")
    .eq("estado_ocr", "listo")
    .not("pjn_cargado_at", "is", null);

  if (cedulasErr) {
    return {
      ok: false,
      error: "Error al leer cédulas candidatas",
      details: cedulasErr.message,
    };
  }

  const candidatos = ((cedulasData ?? []) as CedulaOficioHistorico[])
    .filter((c) => isOcrDestinatarioVacio(c.ocr_destinatario) && auditPorCedula.has(c.id))
    .sort((a, b) => {
      const ta = a.pjn_cargado_at ? new Date(a.pjn_cargado_at).getTime() : 0;
      const tb = b.pjn_cargado_at ? new Date(b.pjn_cargado_at).getTime() : 0;
      return ta - tb;
    });

  return { ok: true, candidatos };
}

export function decodeHeaderValue(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

export type OcrOficioHeaders = {
  destinatario: string | null;
  expNro: string | null;
  caratula: string | null;
};

export async function invocarProcesarOficio(
  pdfBuffer: Buffer,
  railwayUrl: string
): Promise<
  | { ok: true; headers: OcrOficioHeaders }
  | { ok: false; error: string; status?: number }
> {
  const base = railwayUrl.replace(/\/$/, "");
  const formData = new FormData();
  formData.append("pdf", new Blob([pdfBuffer], { type: "application/pdf" }), "oficio.pdf");

  let railwayRes: Response;
  try {
    railwayRes = await fetch(`${base}/procesar-oficio`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(RAILWAY_OCR_FETCH_MS),
    });
  } catch (fetchErr: unknown) {
    const name = fetchErr instanceof Error ? fetchErr.name : "";
    const isTimeout = name === "AbortError" || name === "TimeoutError";
    const msg = isTimeout
      ? `Tiempo de espera (${RAILWAY_OCR_FETCH_MS / 60_000} min) agotado al llamar al OCR en Railway.`
      : fetchErr instanceof Error
        ? fetchErr.message
        : String(fetchErr);
    return { ok: false, error: msg };
  }

  if (!railwayRes.ok) {
    const errorBody = await railwayRes.text();
    const errorMsg =
      errorBody || railwayRes.statusText || `Error OCR (${railwayRes.status})`;
    return { ok: false, error: errorMsg, status: railwayRes.status };
  }

  // Consumir cuerpo sin subir a storage (no tocar pdf_acredita_url)
  await railwayRes.arrayBuffer();

  const headers: OcrOficioHeaders = {
    destinatario: decodeHeaderValue(
      railwayRes.headers.get("X-Destinatario") || railwayRes.headers.get("x-destinatario")
    ),
    expNro: decodeHeaderValue(
      railwayRes.headers.get("X-Exp-Nro") || railwayRes.headers.get("x-exp-nro")
    ),
    caratula: decodeHeaderValue(
      railwayRes.headers.get("X-Caratula") || railwayRes.headers.get("x-caratula")
    ),
  };

  return { ok: true, headers };
}

export function buildPatchOcrOficioHistorico(
  cedula: CedulaOficioHistorico,
  headers: OcrOficioHeaders
): { patch: Record<string, string | null>; campos: string[] } | { error: string } {
  const destinatario = headers.destinatario?.trim();
  if (!destinatario) {
    return { error: "OCR respondió OK pero sin X-Destinatario" };
  }

  const patch: Record<string, string | null> = { ocr_error: null };
  const campos: string[] = ["ocr_error"];

  patch.ocr_destinatario = destinatario;
  campos.push("ocr_destinatario");

  if (isOcrCampoVacio(cedula.ocr_exp_nro) && headers.expNro?.trim()) {
    patch.ocr_exp_nro = headers.expNro.trim();
    campos.push("ocr_exp_nro");
  }

  if (isOcrCampoVacio(cedula.ocr_caratula) && headers.caratula?.trim()) {
    patch.ocr_caratula = headers.caratula.trim();
    campos.push("ocr_caratula");
  }

  return { patch, campos };
}
