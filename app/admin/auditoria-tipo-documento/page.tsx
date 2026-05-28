"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  normalizarTipoDocumento,
  resolverDatoConPrioridad,
  type ResolucionDato,
  type RevisionEstado,
  type RollbackDataPdfAudit,
} from "@/lib/auditoria-tipo-documento-pdf";

// =============================================================================
// Tipos
// =============================================================================

type Razon = {
  patron: string;
  /** null indica una razón "meta" (ej: fuente, chars), sin peso en scoring. */
  clasificacion: "CEDULA" | "OFICIO" | null;
  peso: number;
  pagina: number | null;
};

type FuenteTexto = "local" | "ocr" | "gpt_vision" | "sin_texto";

type Clasif = "CEDULA" | "OFICIO" | "INDETERMINADO";

/** Metadatos contextuales detectados por GPT Vision (todos opcionales). */
type ContextoDetectado = {
  expediente: string | null;
  caratula: string | null;
  juzgado: string | null;
  destinatario: string | null;
};

/** Item de respuesta de /run. Incluye contexto del expediente. */
type RunItemResult = {
  cedula_id: string;
  ok: boolean;
  tipo_documento_actual: string | null;
  clasificacion_pdf: Clasif | null;
  confianza: number | null;
  razones_count: number;
  audit_id: string | null;
  mismatch: boolean;
  fuente_texto: FuenteTexto;
  texto_chars: number;
  paginas_enviadas?: number | null;
  max_pages?: number | null;
  error: string | null;
  // contexto del expediente (datos existentes en cedulas)
  ocr_exp_nro: string | null;
  caratula: string | null;
  ocr_caratula: string | null;
  juzgado: string | null;
  ocr_destinatario: string | null;
  pdf_path: string | null;
  // contexto detectado por GPT Vision (siempre presente; sub-campos pueden ser null)
  contexto_detectado: ContextoDetectado;
  // solo en dry_run+debug_text
  debug_text?: string;
  debug_text_chars_originales?: number;
};

type RunResponse = {
  ok: boolean;
  dry_run: boolean;
  use_ocr: boolean;
  debug_text: boolean;
  max_pages: number;
  include_already_audited: boolean;
  generated_at: string;
  nota: string;
  parametros: {
    limit: number;
    dry_run: boolean;
    only_mismatches: boolean;
    use_ocr: boolean;
    debug_text: boolean;
    max_pages: number;
    max_pages_max: number;
    max_pages_default: number;
    limit_max: number;
    include_already_audited: boolean;
  };
  universo_con_pdf: number;
  /** Cuántas cédulas con PDF ya tenían auditoría (excluidas por filtro). */
  ya_auditadas_excluidas: number;
  /** Cuántas cédulas quedan pendientes tras aplicar el filtro de ya-auditadas. */
  pendientes_reales: number;
  procesados_en_esta_llamada: number;
  pendientes_restantes: number;
  exitosos: number;
  fallidos: number;
  inconsistencias: number;
  por_fuente_texto: {
    local: number;
    gpt_vision: number;
    ocr: number;
    sin_texto: number;
  };
  resultados: RunItemResult[];
};

type AuditRow = {
  id: string;
  cedula_id: string;
  tipo_documento_actual: string | null;
  tipo_documento_actual_cedulas: string | null;
  clasificacion_pdf: Clasif;
  confianza: number | null;
  razones: Razon[] | null;
  archivo_origen: string | null;
  aplicado: boolean;
  aplicado_at: string | null;
  rollback_data: unknown;
  revisado: boolean;
  revisado_at: string | null;
  revisado_by: string | null;
  revision_estado: RevisionEstado | null;
  revision_nota: string | null;
  aplicable: boolean;
  aplicable_motivo: string | null;
  created_at: string;
  caratula: string | null;
  ocr_caratula: string | null;
  juzgado: string | null;
  ocr_exp_nro: string | null;
  ocr_destinatario: string | null;
  pdf_path: string | null;
  estado_ocr: string | null;
  pjn_cargado_at: string | null;
  mismatch: boolean;
  fuente_texto: FuenteTexto | null;
  texto_chars: number | null;
  contexto_detectado: ContextoDetectado;
};

type PreviewBreakdown = {
  total: number;
  con_pdf: number;
  sin_pdf: number;
  por_tipo_actual: { CEDULA: number; OFICIO: number; NULL: number; OTROS: number };
};

// =============================================================================
// Helpers de display
// -----------------------------------------------------------------------------
// Cada helper devuelve { value, fromGpt }:
//   - value: string mostrable (puede ser null si no hay nada).
//   - fromGpt: true si el dato proviene de `contexto_detectado` (GPT Vision)
//     porque las columnas de `cedulas` estaban vacías. Si vino de cedulas,
//     false. Si no hay nada, false.
//
// Prioridad (orden):
//   A) datos existentes en cedulas (ocr_* o columna directa)
//   B) datos detectados por GPT (contexto_detectado.*)
//   C) null  → la UI muestra "—"
// =============================================================================

type Meta = ResolucionDato;

function expedienteOf(r: {
  ocr_exp_nro: string | null;
  contexto_detectado?: ContextoDetectado | null;
}): Meta {
  return resolverDatoConPrioridad(
    r.ocr_exp_nro,
    r.contexto_detectado?.expediente ?? null
  );
}

function caratulaOf(r: {
  ocr_caratula: string | null;
  caratula: string | null;
  contexto_detectado?: ContextoDetectado | null;
}): Meta {
  // Para carátula la fuente "propia" tiene dos candidatos (ocr_caratula es el
  // OCR confiable; caratula es la columna histórica). Si ambos vacíos, cae a GPT.
  const propio = (r.ocr_caratula?.trim() || r.caratula?.trim()) ?? null;
  return resolverDatoConPrioridad(
    propio,
    r.contexto_detectado?.caratula ?? null
  );
}

function destinatarioOf(r: {
  ocr_destinatario: string | null;
  contexto_detectado?: ContextoDetectado | null;
}): Meta {
  return resolverDatoConPrioridad(
    r.ocr_destinatario,
    r.contexto_detectado?.destinatario ?? null
  );
}

function juzgadoOf(r: {
  juzgado: string | null;
  contexto_detectado?: ContextoDetectado | null;
}): Meta {
  return resolverDatoConPrioridad(
    r.juzgado,
    r.contexto_detectado?.juzgado ?? null
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function tipoBadge(tipo: string | null | undefined) {
  const t = (tipo || "").toUpperCase();
  if (t === "OFICIO")
    return { label: "OFICIO", bg: "rgba(168,85,247,.18)", border: "rgba(168,85,247,.45)", color: "rgba(243,232,255,.96)" };
  if (t === "CEDULA")
    return { label: "CEDULA", bg: "rgba(59,130,246,.18)", border: "rgba(59,130,246,.45)", color: "rgba(219,234,254,.96)" };
  if (t === "INDETERMINADO")
    return { label: "INDETERMINADO", bg: "rgba(234,179,8,.18)", border: "rgba(234,179,8,.45)", color: "rgba(254,243,199,.96)" };
  return { label: tipo ? String(tipo) : "—", bg: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.18)", color: "rgba(234,243,255,.85)" };
}

function fuenteBadge(fuente: FuenteTexto | null | undefined) {
  if (fuente === "local")
    return { label: "local", bg: "rgba(34,197,94,.18)", border: "rgba(34,197,94,.45)", color: "rgba(220,252,231,.96)" };
  if (fuente === "ocr")
    return { label: "OCR", bg: "rgba(14,165,233,.18)", border: "rgba(14,165,233,.45)", color: "rgba(224,242,254,.96)" };
  if (fuente === "gpt_vision")
    return { label: "GPT Vision", bg: "rgba(217,70,239,.18)", border: "rgba(217,70,239,.45)", color: "rgba(245,208,254,.96)" };
  if (fuente === "sin_texto")
    return { label: "sin texto", bg: "rgba(234,179,8,.18)", border: "rgba(234,179,8,.45)", color: "rgba(254,243,199,.96)" };
  return { label: "—", bg: "rgba(255,255,255,.06)", border: "rgba(255,255,255,.18)", color: "rgba(234,243,255,.65)" };
}

/**
 * Lee meta-razones de fuente GPT Vision desde el JSONB razones (registros
 * persistidos) — fallback cuando el item no trae paginas_enviadas/max_pages
 * inline (no es el caso en /run pero sí en /list para registros con razones
 * meta serializadas).
 */
function leerMetadataGptDeRazones(razones: Razon[] | null | undefined): {
  paginasEnviadas: number | null;
  maxPages: number | null;
} {
  const out = { paginasEnviadas: null as number | null, maxPages: null as number | null };
  if (!razones || razones.length === 0) return out;
  for (const r of razones) {
    if (typeof r.patron !== "string") continue;
    const m1 = r.patron.match(/^Páginas enviadas:\s*(\d+)/i);
    if (m1) out.paginasEnviadas = parseInt(m1[1], 10);
    const m2 = r.patron.match(/^Max pages:\s*(\d+)/i);
    if (m2) out.maxPages = parseInt(m2[1], 10);
  }
  return out;
}

// =============================================================================
// Componente
// =============================================================================

const LIMIT_OPTIONS = [2, 5, 10];
const MAX_PAGES_OPTIONS = [1, 2, 3, 4, 5];

export default function AuditoriaTipoDocumentoPage() {
  // ── auth ────────────────────────────────────────────────────────────────
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [missingToken, setMissingToken] = useState(false);

  // ── loading inicial ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  // ── panel ejecutar ──────────────────────────────────────────────────────
  const [runLimit, setRunLimit] = useState<number>(5);
  const [runMaxPages, setRunMaxPages] = useState<number>(5);
  const [runUseOcr, setRunUseOcr] = useState<boolean>(true);
  const [runDryRun, setRunDryRun] = useState<boolean>(true);
  const [runDebugText, setRunDebugText] = useState<boolean>(false);
  // Default OFF: por defecto se ignoran las cédulas ya auditadas para no
  // re-procesarlas. ON sólo cuando el operador quiere reauditar
  // explícitamente.
  const [runIncludeAlreadyAudited, setRunIncludeAlreadyAudited] =
    useState<boolean>(false);
  const [running, setRunning] = useState<boolean>(false);

  // ── último run ──────────────────────────────────────────────────────────
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);

  // ── preview + persistidos ───────────────────────────────────────────────
  const [preview, setPreview] = useState<PreviewBreakdown | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [reloadingList, setReloadingList] = useState<boolean>(false);

  // ── filtros lista persistida ────────────────────────────────────────────
  const [filterOnlyMismatches, setFilterOnlyMismatches] = useState<boolean>(false);
  const [filterClasif, setFilterClasif] = useState<"todos" | Clasif>("todos");
  const [filterFuente, setFilterFuente] = useState<"todas" | FuenteTexto>("todas");
  const [filterRevision, setFilterRevision] = useState<
    "todos" | "sin_revisar" | "confirmado" | "rechazado" | "duda"
  >("todos");
  const [filterAplicado, setFilterAplicado] = useState<
    "todos" | "aplicado" | "no_aplicado"
  >("todos");
  const [filterTipoActual, setFilterTipoActual] = useState<
    "todos" | "CEDULA" | "OFICIO" | "NULL" | "OTROS"
  >("todos");
  // Default OFF: la lista muestra una sola fila por cédula (la última
  // auditoría). ON expone todo el historial sin borrar nada.
  const [mostrarHistorialCompleto, setMostrarHistorialCompleto] =
    useState<boolean>(false);

  // ── apply selección ─────────────────────────────────────────────────────
  const [selectedAuditIds, setSelectedAuditIds] = useState<string[]>([]);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(
    null
  );

  // ── notas de revisión por fila ──────────────────────────────────────────
  const [notasRevision, setNotasRevision] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // ── mensajes ────────────────────────────────────────────────────────────
  const [msg, setMsg] = useState<string>("");
  const [msgOk, setMsgOk] = useState<boolean>(false);

  // ────────────────────────────────────────────────────────────────────────
  // Helpers Auth/HTTP
  // ────────────────────────────────────────────────────────────────────────

  const authHeaders = useCallback((): HeadersInit | null => {
    if (!token) return null;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const cargarPersistidos = useCallback(
    async (opts?: { historialCompleto?: boolean }) => {
      const headers = authHeaders();
      if (!headers) return;
      // Permitimos override puntual del toggle para los cambios on-toggle
      // (donde el estado React aún no se actualizó). Si no se pasa, usamos el
      // estado actual.
      const historialCompleto =
        opts?.historialCompleto ?? mostrarHistorialCompleto;
      setReloadingList(true);
      try {
        const qs = new URLSearchParams();
        qs.set(
          "mostrar_historial_completo",
          historialCompleto ? "true" : "false"
        );
        const res = await fetch(
          `/api/admin/auditoria-tipo-documento-pdf/list?${qs.toString()}`,
          { headers }
        );
        if (res.ok) {
          const j = await res.json();
          setRows((j.rows ?? []) as AuditRow[]);
        } else {
          const j = await res.json().catch(() => ({} as { error?: string }));
          setMsgOk(false);
          setMsg(j?.error || "Error al cargar lista persistida");
        }
      } catch (e: unknown) {
        setMsgOk(false);
        const m = e instanceof Error ? e.message : String(e);
        setMsg(`Error de red al cargar lista: ${m}`);
      } finally {
        setReloadingList(false);
      }
    },
    [authHeaders, mostrarHistorialCompleto]
  );

  const onToggleHistorialCompleto = useCallback(
    (v: boolean) => {
      setMostrarHistorialCompleto(v);
      // Refresca con el valor nuevo sin esperar al re-render del estado.
      void cargarPersistidos({ historialCompleto: v });
    },
    [cargarPersistidos]
  );

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 9000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ────────────────────────────────────────────────────────────────────────
  // Bootstrap: sesión + rol + carga inicial.
  // Se ejecuta una sola vez (sin deps). Las cargas iniciales usan el token
  // recién obtenido inline para no depender del re-render con `token` ya
  // seteado.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }
      const accessToken = sess.session.access_token;
      if (!accessToken) {
        setMissingToken(true);
        setAuthChecked(true);
        setLoading(false);
        return;
      }
      setToken(accessToken);
      const uid = sess.session.user.id;
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_superadmin")
        .eq("user_id", uid)
        .maybeSingle();
      const isSuperadmin = roleData?.is_superadmin === true;
      setAllowed(isSuperadmin);
      setAuthChecked(true);

      if (!isSuperadmin) {
        setLoading(false);
        return;
      }

      // Llamadas iniciales con el token recién obtenido (no esperamos al
      // re-render con setToken para evitar carrera con las versiones
      // memoizadas de cargarPreview/cargarPersistidos). `list` se pide con
      // mostrar_historial_completo=false (default UI) para que la grilla
      // arranque mostrando solo la última auditoría por cédula.
      const headers: HeadersInit = { Authorization: `Bearer ${accessToken}` };
      try {
        const [previewRes, listRes] = await Promise.all([
          fetch("/api/admin/auditoria-tipo-documento-pdf/preview", { headers }),
          fetch(
            "/api/admin/auditoria-tipo-documento-pdf/list?mostrar_historial_completo=false",
            { headers }
          ),
        ]);
        if (previewRes.ok) {
          const j = await previewRes.json();
          setPreview({
            total: j.total ?? 0,
            con_pdf: j.con_pdf ?? 0,
            sin_pdf: j.sin_pdf ?? 0,
            por_tipo_actual: j.por_tipo_actual ?? { CEDULA: 0, OFICIO: 0, NULL: 0, OTROS: 0 },
          });
        }
        if (listRes.ok) {
          const j = await listRes.json();
          setRows((j.rows ?? []) as AuditRow[]);
        } else {
          const j = await listRes.json().catch(() => ({} as { error?: string }));
          setMsgOk(false);
          setMsg(j?.error || "Error al cargar lista persistida");
        }
      } catch (e: unknown) {
        setMsgOk(false);
        const m = e instanceof Error ? e.message : String(e);
        setMsg(`Error de red en carga inicial: ${m}`);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ────────────────────────────────────────────────────────────────────────
  // Ejecutar /run
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Guards UX antes de POST /run:
   *  - persistir (dry_run=false) requiere confirm.
   *  - use_ocr=false requiere confirm adicional.
   *  - persistir con debug_text=true → bloqueado (no debería pasar porque el
   *    botón "Guardar" está deshabilitado mientras debug_text=true).
   */
  async function ejecutarRun(dryRun: boolean) {
    if (running) return;
    const headers = authHeaders();
    if (!headers) {
      setMsgOk(false);
      setMsg("No se encontró token de sesión. Cerrá sesión y volvé a entrar.");
      return;
    }

    // Guard 1: bloqueo duro guardar+debug_text
    if (!dryRun && runDebugText) {
      setMsgOk(false);
      setMsg("No se puede guardar la auditoría con debug_text=true. Desactivá debug_text antes de guardar.");
      return;
    }

    // Guard 2: confirm guardar
    if (!dryRun) {
      const confirmar = window.confirm(
        "Esto guardará resultados en la tabla de auditoría, pero NO modificará cédulas, PDFs, PJN ni datos productivos. ¿Continuar?"
      );
      if (!confirmar) return;
    }

    // Guard 3: confirm use_ocr=false
    if (!runUseOcr) {
      const confirmar = window.confirm(
        "Se ejecutará sin OCR/GPT Vision. Puede producir resultados pobres. ¿Continuar?"
      );
      if (!confirmar) return;
    }

    setRunning(true);
    setMsg("");
    try {
      const body = {
        limit: runLimit,
        dry_run: dryRun,
        use_ocr: runUseOcr,
        debug_text: dryRun ? runDebugText : false,
        max_pages: runMaxPages,
        include_already_audited: runIncludeAlreadyAudited,
      };
      const res = await fetch("/api/admin/auditoria-tipo-documento-pdf/run", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string; details?: string }));
        setMsgOk(false);
        setMsg(j?.error ? `${j.error}${j.details ? `: ${j.details}` : ""}` : `HTTP ${res.status}`);
        return;
      }

      const data = (await res.json()) as RunResponse;
      setLastRun(data);
      setMsgOk(true);
      if (dryRun) {
        const yaAuditadasMsg = data.ya_auditadas_excluidas > 0
          ? `, ${data.ya_auditadas_excluidas} ya auditadas excluidas`
          : "";
        setMsg(
          `Prueba ejecutada (${data.procesados_en_esta_llamada} procesados, ${data.inconsistencias} inconsistencias, ${data.por_fuente_texto.gpt_vision} via GPT Vision${yaAuditadasMsg}). No se guardó nada.`
        );
      } else {
        const conAuditId = data.resultados.filter((r) => r.audit_id).length;
        const yaAuditadasMsg = data.ya_auditadas_excluidas > 0
          ? ` (${data.ya_auditadas_excluidas} ya auditadas excluidas)`
          : "";
        setMsg(
          `Auditoría guardada: ${conAuditId} registros persistidos en cedulas_tipo_documento_pdf_audit${yaAuditadasMsg}. No se modificaron cédulas, Storage, PJN ni flujos productivos.`
        );
        await cargarPersistidos();
      }
    } catch (e: unknown) {
      setMsgOk(false);
      const m = e instanceof Error ? e.message : String(e);
      setMsg(`Error de red al ejecutar /run: ${m}`);
    } finally {
      setRunning(false);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Acciones de fila
  // ────────────────────────────────────────────────────────────────────────

  function verPdf(cedulaId: string) {
    if (!token) return;
    const url = `/api/admin/auditoria-tipo-documento-pdf/${cedulaId}/pdf?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }

  async function enviarRevision(
    auditId: string,
    estado: RevisionEstado
  ) {
    const headers = authHeaders();
    if (!headers) return;
    setReviewingId(auditId);
    setMsg("");
    try {
      const nota = (notasRevision[auditId] || "").trim();
      const res = await fetch("/api/admin/auditoria-tipo-documento-pdf/review", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          audit_id: auditId,
          estado,
          nota: nota || undefined,
        }),
      });
      const j = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setMsgOk(false);
        setMsg(j?.error || `Error al revisar (HTTP ${res.status})`);
        return;
      }
      setMsgOk(true);
      setMsg(`Revisión guardada: ${estado}`);
      setSelectedAuditIds((prev) => prev.filter((id) => id !== auditId));
      await cargarPersistidos();
    } catch (e: unknown) {
      setMsgOk(false);
      const m = e instanceof Error ? e.message : String(e);
      setMsg(`Error de red al revisar: ${m}`);
    } finally {
      setReviewingId(null);
    }
  }

  function toggleSelectApply(auditId: string, seleccionable: boolean) {
    if (!seleccionable) return;
    setSelectedAuditIds((prev) =>
      prev.includes(auditId)
        ? prev.filter((id) => id !== auditId)
        : [...prev, auditId]
    );
  }

  function limpiarSeleccion() {
    setSelectedAuditIds([]);
  }

  const selectedApplyRows = useMemo(
    () => rows.filter((r) => selectedAuditIds.includes(r.id)),
    [rows, selectedAuditIds]
  );

  async function confirmarApply() {
    if (applying || selectedAuditIds.length === 0) return;
    const headers = authHeaders();
    if (!headers) return;
    setApplying(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/auditoria-tipo-documento-pdf/apply", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          audit_ids: selectedAuditIds,
          confirm: true,
        }),
      });
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setMsgOk(false);
        const errMsg = String(j?.error || `Error al aplicar (HTTP ${res.status})`);
        setMsg(errMsg);
        setToast({ message: errMsg, ok: false });
        return;
      }
      const aplicadas = Number(j.aplicadas ?? 0);
      const omitidas = Number(j.rechazadas ?? 0);
      const errores = Number(j.errores ?? 0);
      const detalle = (
        (j.resultados as Array<{ audit_id: string; status: string; motivo?: string }>) ??
        []
      )
        .filter((x) => x.status !== "applied")
        .slice(0, 5)
        .map((x) => `${x.audit_id.slice(0, 8)}…: ${x.motivo || x.status}`)
        .join("; ");
      const toastMsg =
        `Aplicadas: ${aplicadas} · Omitidas: ${omitidas} · Errores: ${errores}` +
        (detalle ? ` (${detalle})` : "");
      setMsgOk(errores === 0);
      setMsg(toastMsg);
      setToast({ message: toastMsg, ok: errores === 0 && omitidas === 0 });
      setApplyModalOpen(false);
      setSelectedAuditIds([]);
      setFilterAplicado("no_aplicado");
      await cargarPersistidos();
    } catch (e: unknown) {
      setMsgOk(false);
      const m = e instanceof Error ? e.message : String(e);
      setMsg(`Error de red al aplicar: ${m}`);
      setToast({ message: `Error de red al aplicar: ${m}`, ok: false });
    } finally {
      setApplying(false);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Filtros lista persistida
  // ────────────────────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let r = rows;
    if (filterOnlyMismatches) r = r.filter((x) => x.mismatch);
    if (filterClasif !== "todos") r = r.filter((x) => x.clasificacion_pdf === filterClasif);
    if (filterFuente !== "todas") r = r.filter((x) => x.fuente_texto === filterFuente);
    if (filterRevision === "sin_revisar") r = r.filter((x) => !x.revisado);
    if (filterRevision === "confirmado")
      r = r.filter((x) => x.revision_estado === "CONFIRMADO");
    if (filterRevision === "rechazado")
      r = r.filter((x) => x.revision_estado === "RECHAZADO");
    if (filterRevision === "duda") r = r.filter((x) => x.revision_estado === "DUDA");
    if (filterAplicado === "aplicado") r = r.filter((x) => x.aplicado);
    if (filterAplicado === "no_aplicado") r = r.filter((x) => !x.aplicado);
    if (filterTipoActual !== "todos") {
      r = r.filter((x) => {
        const raw = x.tipo_documento_actual_cedulas ?? x.tipo_documento_actual;
        const norm = normalizarTipoDocumento(raw);
        if (filterTipoActual === "NULL") return norm === null && !(raw ?? "").trim();
        if (filterTipoActual === "OTROS")
          return (raw ?? "").trim() !== "" && norm === null;
        return norm === filterTipoActual;
      });
    }
    return r;
  }, [
    rows,
    filterOnlyMismatches,
    filterClasif,
    filterFuente,
    filterRevision,
    filterAplicado,
    filterTipoActual,
  ]);

  const seleccionablesVisibles = useMemo(
    () => filteredRows.filter((r) => r.aplicable),
    [filteredRows]
  );

  const todasVisiblesSeleccionadas =
    seleccionablesVisibles.length > 0 &&
    seleccionablesVisibles.every((r) => selectedAuditIds.includes(r.id));

  function seleccionarTodasVisibles() {
    const ids = seleccionablesVisibles.map((r) => r.id);
    setSelectedAuditIds(ids);
  }

  function toggleSeleccionarTodasVisibles() {
    if (todasVisiblesSeleccionadas) limpiarSeleccion();
    else seleccionarTodasVisibles();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render gates
  // ────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Cargando…</p>
          </div>
        </section>
      </main>
    );
  }

  if (authChecked && missingToken) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <div className="error">
              No se encontró token de sesión. Cerrá sesión y volvé a entrar.
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (authChecked && !allowed) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <div className="error">
              Acceso restringido. Solo superadmin puede ver esta sección.
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // UI
  // ────────────────────────────────────────────────────────────────────────

  const guardarDisabled = running || runDebugText;

  return (
    <main className="container">
      <section className="card" style={{ overflow: "visible" }}>
        <header
          style={{
            background: "linear-gradient(135deg, rgba(0,82,156,.25), rgba(0,82,156,.08))",
            borderBottom: "1px solid rgba(255,255,255,.12)",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              Auditoría de tipo de documento (PDF)
            </h1>
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "rgba(234,243,255,.65)" }}>
              Solo superadmin. Apply modifica únicamente <code>cedulas.tipo_documento</code> (con
              rollback en auditoría). No toca PDFs, Storage, PJN ni OCR.
            </p>
          </div>
        </header>

        <div className="page">
          {toast && (
            <ApplyToast message={toast.message} ok={toast.ok} onClose={() => setToast(null)} />
          )}
          {msg && (
            <div className={msgOk ? "success" : "error"} style={{ marginBottom: 12 }}>
              {msg}
            </div>
          )}

          {/* ═══════════════════════════ PANEL EJECUTAR ═══════════════════════════ */}
          <section
            style={{
              marginBottom: 20,
              padding: 16,
              background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.10)",
              borderRadius: 10,
            }}
          >
            <h2 style={{ margin: "0 0 12px 0", fontSize: 14, letterSpacing: 0.4, color: "rgba(234,243,255,.85)" }}>
              EJECUTAR AUDITORÍA
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                gap: 14,
                alignItems: "end",
              }}
            >
              {/* limit */}
              <Field label="Cantidad (limit)">
                <select
                  value={runLimit}
                  onChange={(e) => setRunLimit(parseInt(e.target.value, 10))}
                  disabled={running}
                  style={selectStyle}
                >
                  {LIMIT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>

              {/* max_pages */}
              <Field label="Páginas (max_pages)">
                <select
                  value={runMaxPages}
                  onChange={(e) => setRunMaxPages(parseInt(e.target.value, 10))}
                  disabled={running}
                  style={selectStyle}
                >
                  {MAX_PAGES_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>

              {/* use_ocr */}
              <Field label="use_ocr (GPT Vision)">
                <Checkbox
                  checked={runUseOcr}
                  onChange={setRunUseOcr}
                  disabled={running}
                  label={runUseOcr ? "ON" : "OFF — clasifica solo con texto local"}
                />
              </Field>

              {/* dry_run */}
              <Field label="dry_run">
                <Checkbox
                  checked={runDryRun}
                  onChange={setRunDryRun}
                  disabled={running}
                  label={runDryRun ? "ON — no persiste" : "OFF — persistirá si guardás"}
                />
              </Field>

              {/* debug_text */}
              <Field label="debug_text (solo dry_run)">
                <Checkbox
                  checked={runDebugText}
                  onChange={setRunDebugText}
                  disabled={running}
                  label={runDebugText ? "ON" : "OFF"}
                />
              </Field>

              {/* include_already_audited */}
              <Field label="Incluir ya auditadas">
                <Checkbox
                  checked={runIncludeAlreadyAudited}
                  onChange={setRunIncludeAlreadyAudited}
                  disabled={running}
                  label={
                    runIncludeAlreadyAudited
                      ? "ON — reauditará cédulas ya con audit"
                      : "OFF — saltea ya auditadas"
                  }
                />
              </Field>
            </div>

            {/* Botones */}
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => ejecutarRun(true)}
                disabled={running}
                style={{ fontWeight: 600 }}
              >
                {running ? "Ejecutando…" : "Probar sin guardar"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => ejecutarRun(false)}
                disabled={guardarDisabled}
                title={runDebugText ? "Desactivá debug_text para poder guardar" : undefined}
                style={{
                  fontWeight: 600,
                  background: guardarDisabled ? undefined : "rgba(168,85,247,.18)",
                  borderColor: guardarDisabled ? undefined : "rgba(168,85,247,.45)",
                  color: guardarDisabled ? undefined : "rgba(243,232,255,.96)",
                }}
              >
                {running ? "Guardando…" : "Guardar auditoría"}
              </button>
            </div>

            {runDebugText && (
              <p
                className="muted"
                style={{ marginTop: 10, fontSize: 11, color: "rgba(254,243,199,.85)" }}
              >
                debug_text está activo: solo se muestra en la respuesta del run; nunca se persiste.
                Para poder guardar, desactivá debug_text.
              </p>
            )}
          </section>

          {/* ═══════════════════════════ RESUMEN DEL UNIVERSO ═══════════════════════════ */}
          {preview && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <StatBox label="Total cédulas" value={preview.total} />
              <StatBox label="Con PDF" value={preview.con_pdf} />
              <StatBox label="Sin PDF" value={preview.sin_pdf} />
              <StatBox label="tipo=CEDULA" value={preview.por_tipo_actual.CEDULA} />
              <StatBox label="tipo=OFICIO" value={preview.por_tipo_actual.OFICIO} />
              <StatBox label="tipo=NULL" value={preview.por_tipo_actual.NULL} />
            </div>
          )}

          {/* ═══════════════════════════ ÚLTIMO RUN ═══════════════════════════ */}
          {lastRun && (
            <section style={{ marginBottom: 18 }}>
              <h2 style={subHeader}>
                ÚLTIMO RUN ({lastRun.dry_run ? "DRY-RUN" : "PERSISTIDO"})
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <StatBox label="Procesados" value={lastRun.procesados_en_esta_llamada} />
                <StatBox label="Exitosos" value={lastRun.exitosos} />
                <StatBox label="Fallidos" value={lastRun.fallidos} />
                <StatBox label="Inconsistencias" value={lastRun.inconsistencias} />
                <StatBox
                  label="Pendientes reales"
                  value={lastRun.pendientes_reales}
                />
                <StatBox
                  label="Ya auditadas excluidas"
                  value={lastRun.ya_auditadas_excluidas}
                />
                <StatBox label="Pendientes restantes" value={lastRun.pendientes_restantes} />
                <StatBox label="Universo c/PDF" value={lastRun.universo_con_pdf} />
                <StatBox label="GPT Vision" value={lastRun.por_fuente_texto.gpt_vision} />
                <StatBox label="Local" value={lastRun.por_fuente_texto.local} />
                <StatBox label="Sin texto" value={lastRun.por_fuente_texto.sin_texto} />
              </div>

              <div className="tableWrap">
                <table className="table" style={{ minWidth: 1400 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Tipo actual</th>
                      <th style={{ width: 140 }}>Detectado</th>
                      <th style={{ width: 80 }}>Confianza</th>
                      <th style={{ width: 130 }}>Fuente</th>
                      <th style={{ width: 110 }}>Expediente</th>
                      <th style={{ minWidth: 220 }}>Carátula</th>
                      <th style={{ minWidth: 160 }}>Juzgado</th>
                      <th style={{ minWidth: 180 }}>Destinatario</th>
                      <th style={{ minWidth: 220 }}>debug_text / error / audit_id</th>
                      <th style={{ width: 130 }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastRun.resultados.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="muted" style={{ textAlign: "center", padding: 16 }}>
                          Sin resultados.
                        </td>
                      </tr>
                    ) : (
                      lastRun.resultados.map((r) => {
                        const ta = tipoBadge(r.tipo_documento_actual);
                        const td = tipoBadge(r.clasificacion_pdf);
                        const fb = fuenteBadge(r.fuente_texto);
                        return (
                          <tr key={r.cedula_id}>
                            <td>
                              <Badge {...ta} />
                            </td>
                            <td>
                              <Badge {...td} />
                              {r.mismatch && <MismatchTag />}
                            </td>
                            <td style={tabNum}>
                              {r.confianza != null ? r.confianza.toFixed(2) : "—"}
                            </td>
                            <td>
                              <Badge {...fb} />
                              {r.fuente_texto === "gpt_vision" &&
                                r.paginas_enviadas != null &&
                                r.max_pages != null && (
                                  <div
                                    className="muted"
                                    style={{ fontSize: 10, marginTop: 2, color: "rgba(245,208,254,.75)" }}
                                    title={`Páginas enviadas: ${r.paginas_enviadas} (max_pages=${r.max_pages})`}
                                  >
                                    {r.paginas_enviadas}/{r.max_pages} pág · {r.texto_chars} chars
                                  </div>
                                )}
                              {r.fuente_texto !== "gpt_vision" && (
                                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                                  {r.texto_chars} chars
                                </div>
                              )}
                            </td>
                            <td style={tabNum}>
                              <MetaValue meta={expedienteOf(r)} />
                            </td>
                            <td style={{ fontWeight: 600, fontSize: 12 }}>
                              <MetaValue meta={caratulaOf(r)} />
                            </td>
                            <td style={{ fontSize: 12 }}>
                              <MetaValue meta={juzgadoOf(r)} />
                            </td>
                            <td style={{ fontSize: 12 }}>
                              <MetaValue meta={destinatarioOf(r)} />
                            </td>
                            <td style={{ fontSize: 11, maxWidth: 320 }}>
                              {r.error && (
                                <div style={{ color: "rgba(252,165,165,.95)" }} title={r.error}>
                                  ✘ {r.error.slice(0, 200)}
                                </div>
                              )}
                              {r.audit_id && (
                                <div className="muted" title={`audit_id ${r.audit_id}`}>
                                  audit_id: <code style={{ fontSize: 10 }}>{r.audit_id.slice(0, 8)}…</code>
                                </div>
                              )}
                              {r.debug_text && (
                                <details style={{ marginTop: 4 }}>
                                  <summary
                                    className="muted"
                                    style={{
                                      cursor: "pointer",
                                      fontSize: 11,
                                      color: "rgba(245,208,254,.85)",
                                    }}
                                  >
                                    debug_text ({r.debug_text_chars_originales ?? "?"} chars)
                                  </summary>
                                  <pre
                                    style={{
                                      whiteSpace: "pre-wrap",
                                      fontSize: 10,
                                      lineHeight: 1.35,
                                      maxHeight: 200,
                                      overflow: "auto",
                                      margin: "6px 0 0 0",
                                      padding: 8,
                                      background: "rgba(0,0,0,.25)",
                                      border: "1px solid rgba(255,255,255,.08)",
                                      borderRadius: 6,
                                    }}
                                  >
                                    {r.debug_text}
                                  </pre>
                                </details>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn primary"
                                onClick={() => verPdf(r.cedula_id)}
                                style={{ fontSize: 12, padding: "5px 10px" }}
                              >
                                Abrir PDF
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ═══════════════════════════ LISTA PERSISTIDA ═══════════════════════════ */}
          <section>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 style={subHeader}>AUDITORÍAS GUARDADAS</h2>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void cargarPersistidos();
                }}
                disabled={reloadingList}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                {reloadingList ? "Refrescando…" : "Refrescar lista"}
              </button>
              <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                {filteredRows.length} de {rows.length} registro(s)
              </span>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
              <label style={inlineLabel}>
                <input
                  type="checkbox"
                  checked={filterOnlyMismatches}
                  onChange={(e) => setFilterOnlyMismatches(e.target.checked)}
                />
                Solo inconsistencias
              </label>
              <label
                style={inlineLabel}
                title="OFF: una fila por cédula (la última auditoría). ON: historial completo, sin borrar nada."
              >
                <input
                  type="checkbox"
                  checked={mostrarHistorialCompleto}
                  onChange={(e) => onToggleHistorialCompleto(e.target.checked)}
                  disabled={reloadingList}
                />
                Mostrar historial completo
              </label>
              <label style={inlineLabel}>
                Tipo detectado:
                <select
                  value={filterClasif}
                  onChange={(e) => setFilterClasif(e.target.value as "todos" | Clasif)}
                  style={{ ...selectStyle, marginLeft: 6, padding: "3px 6px", fontSize: 12 }}
                >
                  <option value="todos">todos</option>
                  <option value="CEDULA">CEDULA</option>
                  <option value="OFICIO">OFICIO</option>
                  <option value="INDETERMINADO">INDETERMINADO</option>
                </select>
              </label>
              <label style={inlineLabel}>
                Fuente:
                <select
                  value={filterFuente}
                  onChange={(e) => setFilterFuente(e.target.value as "todas" | FuenteTexto)}
                  style={{ ...selectStyle, marginLeft: 6, padding: "3px 6px", fontSize: 12 }}
                >
                  <option value="todas">todas</option>
                  <option value="local">local</option>
                  <option value="gpt_vision">gpt_vision</option>
                  <option value="ocr">ocr (legacy)</option>
                  <option value="sin_texto">sin_texto</option>
                </select>
              </label>
              <label style={inlineLabel}>
                Revisión:
                <select
                  value={filterRevision}
                  onChange={(e) =>
                    setFilterRevision(
                      e.target.value as
                        | "todos"
                        | "sin_revisar"
                        | "confirmado"
                        | "rechazado"
                        | "duda"
                    )
                  }
                  style={{ ...selectStyle, marginLeft: 6, padding: "3px 6px", fontSize: 12 }}
                >
                  <option value="todos">todos</option>
                  <option value="sin_revisar">sin revisar</option>
                  <option value="confirmado">confirmado</option>
                  <option value="rechazado">rechazado</option>
                  <option value="duda">duda</option>
                </select>
              </label>
              <label style={inlineLabel}>
                Aplicado:
                <select
                  value={filterAplicado}
                  onChange={(e) =>
                    setFilterAplicado(e.target.value as "todos" | "aplicado" | "no_aplicado")
                  }
                  style={{ ...selectStyle, marginLeft: 6, padding: "3px 6px", fontSize: 12 }}
                >
                  <option value="todos">todos</option>
                  <option value="aplicado">aplicado</option>
                  <option value="no_aplicado">no aplicado</option>
                </select>
              </label>
              <label style={inlineLabel}>
                Tipo actual:
                <select
                  value={filterTipoActual}
                  onChange={(e) =>
                    setFilterTipoActual(
                      e.target.value as "todos" | "CEDULA" | "OFICIO" | "NULL" | "OTROS"
                    )
                  }
                  style={{ ...selectStyle, marginLeft: 6, padding: "3px 6px", fontSize: 12 }}
                >
                  <option value="todos">todos</option>
                  <option value="CEDULA">CEDULA</option>
                  <option value="OFICIO">OFICIO</option>
                  <option value="NULL">NULL</option>
                  <option value="OTROS">otros</option>
                </select>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                padding: "10px 12px",
                background:
                  selectedAuditIds.length > 0
                    ? "rgba(59,130,246,.12)"
                    : "rgba(255,255,255,.03)",
                border: `1px solid ${
                  selectedAuditIds.length > 0
                    ? "rgba(59,130,246,.35)"
                    : "rgba(255,255,255,.12)"
                }`,
                borderRadius: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {selectedAuditIds.length} seleccionada(s)
                {seleccionablesVisibles.length > 0 && (
                  <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                    · {seleccionablesVisibles.length} aplicable(s) en vista
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn primary"
                disabled={selectedAuditIds.length === 0 || applying}
                onClick={() => setApplyModalOpen(true)}
                style={{ fontSize: 12, padding: "6px 14px", fontWeight: 700 }}
              >
                Aplicar correcciones
              </button>
              <button
                type="button"
                className="btn"
                disabled={selectedAuditIds.length === 0}
                onClick={limpiarSeleccion}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                Limpiar selección
              </button>
              <button
                type="button"
                className="btn"
                disabled={seleccionablesVisibles.length === 0}
                onClick={toggleSeleccionarTodasVisibles}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                {todasVisiblesSeleccionadas
                  ? "Desmarcar todas visibles"
                  : "Seleccionar todas visibles"}
              </button>
            </div>

            {applyModalOpen && (
              <ApplyConfirmModal
                rows={selectedApplyRows}
                applying={applying}
                onCancel={() => setApplyModalOpen(false)}
                onConfirm={() => {
                  void confirmarApply();
                }}
              />
            )}

            {rows.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  border: "1px dashed rgba(255,255,255,.18)",
                  borderRadius: 10,
                  color: "rgba(234,243,255,.65)",
                }}
              >
                No hay auditorías guardadas todavía. Ejecutá una prueba o guardá un lote desde el
                panel superior.
              </div>
            ) : (
              <div className="tableWrap">
                <table className="table" style={{ minWidth: 1600 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }} title="Seleccionar filas aplicables">
                        <input
                          type="checkbox"
                          checked={todasVisiblesSeleccionadas}
                          disabled={seleccionablesVisibles.length === 0}
                          title={
                            todasVisiblesSeleccionadas
                              ? "Desmarcar todas las visibles aplicables"
                              : "Seleccionar todas las visibles aplicables"
                          }
                          onChange={toggleSeleccionarTodasVisibles}
                        />
                      </th>
                      <th style={{ width: 100 }}>Tipo actual</th>
                      <th style={{ width: 140 }}>Detectado</th>
                      <th style={{ width: 80 }}>Confianza</th>
                      <th style={{ width: 110 }}>Revisión</th>
                      <th style={{ width: 130 }}>Aplicación</th>
                      <th style={{ width: 130 }}>Fuente</th>
                      <th style={{ width: 110 }}>Expediente</th>
                      <th style={{ minWidth: 220 }}>Carátula</th>
                      <th style={{ minWidth: 160 }}>Juzgado</th>
                      <th style={{ minWidth: 180 }}>Destinatario</th>
                      <th style={{ minWidth: 240 }}>Razones</th>
                      <th style={{ width: 120 }}>Auditado</th>
                      <th style={{ width: 280 }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="muted" style={{ padding: 24, textAlign: "center" }}>
                          No hay registros que coincidan con los filtros activos.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r) => {
                        const ta = tipoBadge(r.tipo_documento_actual_cedulas ?? r.tipo_documento_actual);
                        const td = tipoBadge(r.clasificacion_pdf);
                        const fb = fuenteBadge(r.fuente_texto);
                        const meta = leerMetadataGptDeRazones(r.razones);
                        const rev = revisionBadge(r);
                        const app = aplicadoBadge(r);
                        const cambio = rollbackCambioLabel(r);
                        const busy = reviewingId === r.id;
                        const seleccionable = r.aplicable;
                        return (
                          <tr
                            key={r.id}
                            style={{
                              opacity: r.aplicado ? 0.5 : 1,
                              background: r.aplicado
                                ? "rgba(46,204,113,.06)"
                                : undefined,
                            }}
                          >
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedAuditIds.includes(r.id)}
                                disabled={!seleccionable}
                                title={
                                  seleccionable
                                    ? "Seleccionar para aplicar corrección"
                                    : r.aplicable_motivo || "No seleccionable"
                                }
                                onChange={() => toggleSelectApply(r.id, seleccionable)}
                              />
                            </td>
                            <td>
                              <Badge {...ta} />
                            </td>
                            <td>
                              <Badge {...td} />
                              {r.mismatch && <MismatchTag />}
                            </td>
                            <td style={tabNum}>
                              {r.confianza != null ? r.confianza.toFixed(2) : "—"}
                            </td>
                            <td>
                              <Badge {...rev} />
                              {r.revision_nota && (
                                <div
                                  className="muted"
                                  style={{ fontSize: 10, marginTop: 4, maxWidth: 120 }}
                                  title={r.revision_nota}
                                >
                                  {r.revision_nota.length > 40
                                    ? `${r.revision_nota.slice(0, 40)}…`
                                    : r.revision_nota}
                                </div>
                              )}
                            </td>
                            <td>
                              <Badge {...app} />
                              {cambio && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    marginTop: 4,
                                    fontWeight: 700,
                                    color: "rgba(220,252,231,.9)",
                                  }}
                                >
                                  {cambio}
                                </div>
                              )}
                              {r.aplicado && r.aplicado_at && (
                                <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>
                                  {fmtDate(r.aplicado_at)}
                                </div>
                              )}
                            </td>
                            <td>
                              <Badge {...fb} />
                              {r.texto_chars != null && (
                                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                                  {r.texto_chars} chars
                                </div>
                              )}
                              {r.fuente_texto === "gpt_vision" &&
                                meta.paginasEnviadas != null &&
                                meta.maxPages != null && (
                                  <div
                                    className="muted"
                                    style={{ fontSize: 10, marginTop: 2, color: "rgba(245,208,254,.75)" }}
                                    title={`Páginas enviadas: ${meta.paginasEnviadas} (max_pages=${meta.maxPages})`}
                                  >
                                    {meta.paginasEnviadas}/{meta.maxPages} pág
                                  </div>
                                )}
                            </td>
                            <td style={tabNum}>
                              <MetaValue meta={expedienteOf(r)} />
                            </td>
                            <td style={{ fontWeight: 600, fontSize: 12 }}>
                              <MetaValue meta={caratulaOf(r)} />
                            </td>
                            <td style={{ fontSize: 12 }}>
                              <MetaValue meta={juzgadoOf(r)} />
                            </td>
                            <td style={{ fontSize: 12 }}>
                              <MetaValue meta={destinatarioOf(r)} />
                            </td>
                            <td>
                              {r.razones && r.razones.length > 0 ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 4,
                                    maxWidth: 320,
                                  }}
                                >
                                  {r.razones.slice(0, 8).map((rz, i) => {
                                    const isMeta = rz.clasificacion == null;
                                    const bg = isMeta
                                      ? "rgba(234,179,8,.16)"
                                      : rz.clasificacion === "OFICIO"
                                        ? "rgba(168,85,247,.18)"
                                        : "rgba(59,130,246,.18)";
                                    const border = isMeta
                                      ? "1px solid rgba(234,179,8,.4)"
                                      : rz.clasificacion === "OFICIO"
                                        ? "1px solid rgba(168,85,247,.4)"
                                        : "1px solid rgba(59,130,246,.4)";
                                    const titulo = isMeta
                                      ? "nota (no contribuye al scoring)"
                                      : `peso ${rz.peso}${rz.pagina ? ` · pág ${rz.pagina}` : ""}`;
                                    return (
                                      <span
                                        key={`${r.id}-${i}`}
                                        title={titulo}
                                        style={{
                                          fontSize: 10,
                                          padding: "2px 6px",
                                          borderRadius: 4,
                                          background: bg,
                                          border,
                                          color: "rgba(234,243,255,.92)",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {rz.patron}
                                      </span>
                                    );
                                  })}
                                  {r.razones.length > 8 && (
                                    <span className="muted" style={{ fontSize: 10 }}>
                                      +{r.razones.length - 8}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td style={{ fontSize: 11, color: "rgba(234,243,255,.7)" }}>
                              {fmtDate(r.created_at)}
                              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>
                                <code>{r.id.slice(0, 8)}…</code>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <input
                                  type="text"
                                  placeholder="Nota (opcional)"
                                  value={notasRevision[r.id] ?? r.revision_nota ?? ""}
                                  disabled={r.aplicado || busy}
                                  onChange={(e) =>
                                    setNotasRevision((prev) => ({
                                      ...prev,
                                      [r.id]: e.target.value,
                                    }))
                                  }
                                  style={{
                                    fontSize: 11,
                                    padding: "4px 6px",
                                    width: "100%",
                                    maxWidth: 260,
                                    background: "rgba(0,0,0,.2)",
                                    border: "1px solid rgba(255,255,255,.12)",
                                    borderRadius: 4,
                                    color: "rgba(234,243,255,.9)",
                                  }}
                                />
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className="btn primary"
                                    onClick={() => verPdf(r.cedula_id)}
                                    style={{ fontSize: 11, padding: "4px 8px" }}
                                  >
                                    PDF
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={r.aplicado || busy}
                                    onClick={() => void enviarRevision(r.id, "CONFIRMADO")}
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderColor: "rgba(46,204,113,.45)",
                                      background: "rgba(46,204,113,.15)",
                                    }}
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={r.aplicado || busy}
                                    onClick={() => void enviarRevision(r.id, "RECHAZADO")}
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderColor: "rgba(248,113,113,.45)",
                                      background: "rgba(248,113,113,.12)",
                                    }}
                                  >
                                    Rechazar
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={r.aplicado || busy}
                                    onClick={() => void enviarRevision(r.id, "DUDA")}
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderColor: "rgba(234,179,8,.45)",
                                      background: "rgba(234,179,8,.12)",
                                    }}
                                  >
                                    Duda
                                  </button>
                                </div>
                                {!r.aplicable && !r.aplicado && r.aplicable_motivo && (
                                  <span className="muted" style={{ fontSize: 10 }}>
                                    {r.aplicable_motivo}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="muted" style={{ marginTop: 16, fontSize: 11, lineHeight: 1.6, maxWidth: 760 }}>
            Revisión humana se persiste en <code>cedulas_tipo_documento_pdf_audit</code>. Apply solo
            con estado CONFIRMADO, confianza ≥ 0.90 y transición permitida. Rollback manual: usar{" "}
            <code>rollback_data.tipo_documento_anterior</code> en la fila de auditoría.
          </p>
        </div>
      </section>
    </main>
  );
}

// =============================================================================
// Subcomponentes / estilos
// =============================================================================

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,.06)",
  border: "1px solid rgba(255,255,255,.18)",
  color: "rgba(234,243,255,.92)",
  borderRadius: 6,
  padding: "5px 8px",
  fontSize: 13,
  cursor: "pointer",
};

const subHeader: React.CSSProperties = {
  margin: "0 0 12px 0",
  fontSize: 14,
  letterSpacing: 0.4,
  color: "rgba(234,243,255,.85)",
};

const tabNum: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const inlineLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  cursor: "pointer",
  color: "rgba(234,243,255,.82)",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(234,243,255,.65)",
          letterSpacing: 0.4,
          marginBottom: 5,
        }}
      >
        {label.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        color: "rgba(234,243,255,.85)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(234,243,255,.65)", fontWeight: 600, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function Badge({
  label,
  bg,
  border,
  color,
}: {
  label: string;
  bg: string;
  border: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 9px",
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  );
}

function MismatchTag() {
  return (
    <div
      style={{
        fontSize: 10,
        color: "rgba(252,165,165,.95)",
        marginTop: 4,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}
    >
      ⚠ INCONSISTENCIA
    </div>
  );
}

function rollbackCambioLabel(r: AuditRow): string | null {
  if (!r.aplicado || !r.rollback_data) return null;
  const rb = r.rollback_data as RollbackDataPdfAudit;
  const ant = (rb.tipo_documento_anterior ?? "NULL").toString().toUpperCase() || "NULL";
  const nue = rb.tipo_documento_nuevo ?? r.clasificacion_pdf;
  return `${ant} → ${nue}`;
}

function aplicadoBadge(r: { aplicado: boolean }) {
  if (r.aplicado) {
    return {
      label: "Aplicado",
      bg: "rgba(46,204,113,.18)",
      border: "rgba(46,204,113,.45)",
      color: "rgba(220,252,231,.96)",
    };
  }
  return {
    label: "No aplicado",
    bg: "rgba(255,255,255,.06)",
    border: "rgba(255,255,255,.18)",
    color: "rgba(234,243,255,.7)",
  };
}

function revisionBadge(r: {
  revisado: boolean;
  revision_estado: RevisionEstado | null;
}) {
  if (!r.revisado) {
    return {
      label: "Sin revisar",
      bg: "rgba(255,255,255,.06)",
      border: "rgba(255,255,255,.22)",
      color: "rgba(234,243,255,.75)",
    };
  }
  if (r.revision_estado === "CONFIRMADO") {
    return {
      label: "Confirmado",
      bg: "rgba(46,204,113,.18)",
      border: "rgba(46,204,113,.45)",
      color: "rgba(220,252,231,.96)",
    };
  }
  if (r.revision_estado === "RECHAZADO") {
    return {
      label: "Rechazado",
      bg: "rgba(248,113,113,.18)",
      border: "rgba(248,113,113,.45)",
      color: "rgba(254,226,226,.96)",
    };
  }
  if (r.revision_estado === "DUDA") {
    return {
      label: "Duda",
      bg: "rgba(234,179,8,.18)",
      border: "rgba(234,179,8,.45)",
      color: "rgba(254,243,199,.96)",
    };
  }
  return {
    label: "Revisado",
    bg: "rgba(255,255,255,.06)",
    border: "rgba(255,255,255,.22)",
    color: "rgba(234,243,255,.85)",
  };
}

function ApplyToast({
  message,
  ok,
  onClose,
}: {
  message: string;
  ok: boolean;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1100,
        maxWidth: 420,
        padding: "14px 16px",
        borderRadius: 10,
        background: ok ? "rgba(22,101,52,.95)" : "rgba(127,29,29,.95)",
        border: `1px solid ${ok ? "rgba(74,222,128,.5)" : "rgba(248,113,113,.5)"}`,
        color: "rgba(255,255,255,.95)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span>{message}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function ApplyConfirmModal({
  rows,
  applying,
  onCancel,
  onConfirm,
}: {
  rows: AuditRow[];
  applying: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(255,255,255,.15)",
          borderRadius: 12,
          maxWidth: 960,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>
          Confirmar corrección de tipo documento
        </h3>
        <p style={{ fontSize: 13, color: "rgba(234,243,255,.8)", lineHeight: 1.5 }}>
          Esto modificará únicamente cedulas.tipo_documento.
          <br />
          No modifica PDFs, Storage, PJN ni OCR.
        </p>
        <div className="tableWrap" style={{ marginTop: 16, marginBottom: 16 }}>
          <table className="table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Expediente</th>
                <th>Carátula</th>
                <th>Tipo actual</th>
                <th>Tipo nuevo</th>
                <th>Confianza</th>
                <th>Revisión</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <MetaValue meta={expedienteOf(r)} />
                  </td>
                  <td>
                    <MetaValue meta={caratulaOf(r)} />
                  </td>
                  <td>
                    <Badge
                      {...tipoBadge(
                        r.tipo_documento_actual_cedulas ?? r.tipo_documento_actual
                      )}
                    />
                  </td>
                  <td>
                    <Badge {...tipoBadge(r.clasificacion_pdf)} />
                  </td>
                  <td style={tabNum}>
                    {r.confianza != null ? r.confianza.toFixed(2) : "—"}
                  </td>
                  <td>
                    <Badge {...revisionBadge(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onCancel} disabled={applying}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={onConfirm}
            disabled={applying || rows.length === 0}
          >
            {applying ? "Aplicando…" : "Confirmar aplicación"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pequeña marca visual "GPT" que se muestra al lado de un valor cuando éste
 * provino de `contexto_detectado` (GPT Vision) y no de las columnas de cedulas.
 * Sirve para que el revisor entienda de un vistazo que es un dato detectado
 * automáticamente, no validado humanamente ni almacenado en cedulas.
 */
function GptMark() {
  return (
    <span
      title="Detectado automáticamente por GPT Vision; no está en cedulas. Validar antes de confiar."
      style={{
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 6,
        padding: "1px 5px",
        borderRadius: 4,
        background: "rgba(217,70,239,.18)",
        border: "1px solid rgba(217,70,239,.45)",
        color: "rgba(245,208,254,.96)",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.5,
        verticalAlign: "middle",
      }}
    >
      GPT
    </span>
  );
}

/**
 * Renderiza un valor contextual (expediente/caratula/juzgado/destinatario)
 * aplicando el resultado de los helpers `*Of`. Si no hay valor → "—". Si vino
 * de GPT, agrega la marca visual.
 */
function MetaValue({ meta }: { meta: Meta }) {
  if (!meta.value) return <span className="muted">—</span>;
  return (
    <>
      <span>{meta.value}</span>
      {meta.fromGpt && <GptMark />}
    </>
  );
}
