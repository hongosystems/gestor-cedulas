import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";

export const runtime = "nodejs";

/** Tiempo máximo para que Railway ejecute Playwright (subida PJN). */
export const maxDuration = 300;

const RAILWAY_FETCH_MS = 240_000;

async function requireAbogado(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_abogado, is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_abogado === true || data?.is_superadmin === true;
}

function railwayBaseUrl(): string | null {
  // RAILWAY_CARGAR_PJN_URL tiene prioridad: permite dejar RAILWAY_OCR_URL apuntando
  // al servicio solo-OCR (nube) y probar cargar-pjn en localhost.
  const raw =
    process.env.RAILWAY_CARGAR_PJN_URL?.trim() ||
    process.env.RAILWAY_OCR_URL?.trim();
  if (!raw) return null;
  // Solo la base (origen), sin /cargar-pjn: si no, fetch hace .../cargar-pjn/cargar-pjn → 404
  let u = raw.replace(/\/$/, "");
  u = u.replace(/\/cargar-pjn\/?$/i, "");
  return u;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireAbogado(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo abogados pueden cargar en PJN" },
      { status: 403 }
    );
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID de cédula requerido" }, { status: 400 });
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, estado_ocr, juzgado, ocr_exp_nro, ocr_caratula, pdf_acredita_url")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
  }

  if (cedula.estado_ocr !== "listo") {
    return NextResponse.json(
      { error: "La cédula no está lista para diligenciamiento" },
      { status: 400 }
    );
  }

  const { data: juzgadosData } = await svc
    .from("user_juzgados")
    .select("juzgado")
    .eq("user_id", user.id);

  const juzgadosAsignados = (juzgadosData || []).map((j) =>
    (j.juzgado || "").trim().replace(/\s+/g, " ").toUpperCase()
  );
  const juzgadoCedula = (cedula.juzgado || "").trim().replace(/\s+/g, " ").toUpperCase();

  const { data: roleData } = await svc
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", user.id)
    .maybeSingle();

  const isSuperadmin = roleData?.is_superadmin === true;
  const tieneAcceso =
    isSuperadmin ||
    (juzgadosAsignados.length > 0 &&
      juzgadoCedula &&
      juzgadosAsignados.some(
        (j) =>
          j === juzgadoCedula ||
          (j.includes("JUZGADO") &&
            juzgadoCedula.includes("JUZGADO") &&
            j.match(/\d+/)?.[0] === juzgadoCedula.match(/\d+/)?.[0])
      ));

  if (!tieneAcceso) {
    return NextResponse.json(
      { error: "No tienes acceso al juzgado de esta cédula" },
      { status: 403 }
    );
  }

  // Parsear número y año desde ocr_exp_nro (formato "34904/2025")
  const [expNumero, expAnioStr] = (cedula.ocr_exp_nro ?? "").split("/");
  const expAnio = expAnioStr ? parseInt(expAnioStr, 10) : null;

  // Buscar en pjn_favoritos por número y año — más confiable que por carátula
  let favoritoData: { jurisdiccion: string; numero: string; anio: number } | null = null;
  if (expNumero && expAnio) {
    const { data } = await svc
      .from("pjn_favoritos")
      .select("jurisdiccion, numero, anio")
      .eq("numero", expNumero)
      .eq("anio", expAnio)
      .maybeSingle();
    favoritoData = data ?? null;
  }

  const expData = {
    jurisdiccion: favoritoData?.jurisdiccion ?? "CIV",
    exp_numero: expNumero ?? "",
    exp_anio: expAnioStr ?? "",
  };

  const base = railwayBaseUrl();
  if (!base) {
    // Descargar el PDF y pasarlo como base64 para evitar CORS en la extensión
    let pdfBase64: string | null = null;
    try {
      const storagePath = `acredita/${cedulaId}.pdf`;
      const { data: fileData } = await svc.storage
        .from("cedulas")
        .download(storagePath);
      if (fileData) {
        const buffer = Buffer.from(await fileData.arrayBuffer());
        pdfBase64 = buffer.toString("base64");
      }
    } catch (_) {
      // Si falla la descarga, la extensión intentará con pdfUrl como fallback
    }

    return NextResponse.json({
      ok: true,
      extensionMode: true,
      cedulaId,
      expNro: cedula.ocr_exp_nro ?? "",
      pdfUrl: cedula.pdf_acredita_url ?? "",
      pdfBase64,
      pdfNombre: `acredita-${cedulaId}.pdf`,
      jurisdiccion: expData.jurisdiccion,
      exp_numero: expData.exp_numero,
      exp_anio: expData.exp_anio,
    });
  }

  const storagePath = `acredita/${cedulaId}.pdf`;
  const { data: fileData, error: downloadErr } = await svc.storage
    .from("cedulas")
    .download(storagePath);

  if (downloadErr || !fileData) {
    return NextResponse.json(
      {
        error:
          downloadErr?.message ||
          "No se pudo descargar el PDF de acredita desde el almacenamiento",
      },
      { status: 400 }
    );
  }

  const pdfBuffer = Buffer.from(await fileData.arrayBuffer());

  const formData = new FormData();
  formData.append(
    "pdf",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    `acredita-${cedulaId}.pdf`
  );
  formData.append("cedula_id", cedulaId);
  formData.append("ocr_exp_nro", cedula.ocr_exp_nro ?? "");
  formData.append("ocr_caratula", cedula.ocr_caratula ?? "");
  if (cedula.pdf_acredita_url) {
    formData.append("pdf_acredita_url", cedula.pdf_acredita_url);
  }
  formData.append("jurisdiccion", expData.jurisdiccion);
  formData.append("exp_numero", expData.exp_numero);
  formData.append("exp_anio", expData.exp_anio);

  const internalSecret = process.env.RAILWAY_INTERNAL_SECRET;
  const headers: Record<string, string> = {};
  if (internalSecret) {
    headers["X-Internal-Secret"] = internalSecret;
  }

  let railwayRes: Response;
  try {
    railwayRes = await fetch(`${base}/cargar-pjn`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(RAILWAY_FETCH_MS),
      headers,
    });
  } catch (e: any) {
    console.error("[cargar-pjn] fetch Railway:", e?.message || e);
    return NextResponse.json(
      { error: e?.message || "No se pudo contactar al servicio de carga PJN" },
      { status: 502 }
    );
  }

  const text = await railwayRes.text();
  let payload: { ok?: boolean; error?: string; pruebaSinEnvio?: boolean } = {};
  try {
    payload = JSON.parse(text) as {
      ok?: boolean;
      error?: string;
      pruebaSinEnvio?: boolean;
    };
  } catch {
    if (!railwayRes.ok) {
      const hint =
        text.includes("Cannot POST /cargar-pjn") || text.includes("/cargar-pjn")
          ? ` El host configurado (RAILWAY_CARGAR_PJN_URL o RAILWAY_OCR_URL) no expone POST /cargar-pjn. Si el OCR está en otro servidor, definí RAILWAY_CARGAR_PJN_URL=http://localhost:PUERTO apuntando a railway-service/cargar-pjn (node server.mjs).`
          : "";
      return NextResponse.json(
        {
          error: `Respuesta no JSON del servicio PJN (${railwayRes.status}).${hint}`,
        },
        { status: 502 }
      );
    }
  }

  if (!railwayRes.ok || payload.ok !== true) {
    let errMsg = payload.error || text || railwayRes.statusText || "Error al cargar en PJN";
    if (
      typeof errMsg === "string" &&
      (errMsg.includes("Cannot POST /cargar-pjn") || errMsg.includes("<!DOCTYPE html>"))
    ) {
      errMsg =
        "El microservicio configurado no tiene la ruta POST /cargar-pjn. " +
        "Levantá railway-service/cargar-pjn (node server.mjs) y usá RAILWAY_CARGAR_PJN_URL si el OCR usa otra URL.";
    }
    return NextResponse.json(
      { error: errMsg },
      { status: railwayRes.status === 200 ? 502 : railwayRes.status >= 500 ? railwayRes.status : 502 }
    );
  }

  if (payload.pruebaSinEnvio === true) {
    return NextResponse.json({
      ok: true,
      pruebaSinEnvio: true,
    });
  }

  const pjn_cargado_at = new Date().toISOString();
  const { error: updateErr } = await svc
    .from("cedulas")
    .update({ pjn_cargado_at })
    .eq("id", cedulaId);

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message || "PJN OK pero falló actualizar la base de datos" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, pjn_cargado_at });
}
