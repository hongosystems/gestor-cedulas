import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";

export const runtime = "nodejs";

// Aumentar timeout para OCR (Vercel Hobby: 10s, Pro: 60s)
// La respuesta se envía de inmediato; el trabajo pesado corre en after()
export const maxDuration = 60;

async function requireAdminCedulas(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_admin_cedulas, is_superadmin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_admin_cedulas === true || data?.is_superadmin === true;
}

const CARGAR_PJN_FETCH_MS = 300_000;

function railwayCargarPjnBaseUrl(): string | null {
  const raw =
    process.env.PJN_LOCAL_URL?.trim() ||
    process.env.RAILWAY_CARGAR_PJN_URL?.trim() ||
    process.env.RAILWAY_OCR_URL?.trim();
  if (!raw) return null;
  let u = raw.replace(/\/$/, "");
  u = u.replace(/\/cargar-pjn\/?$/i, "");
  return u;
}

async function invocarCargarPjnTrasOcr(
  svc: ReturnType<typeof supabaseService>,
  cedulaId: string,
  expNro: string | null
) {
  const base = railwayCargarPjnBaseUrl();
  if (!base || !expNro?.trim()) {
    return;
  }

  const storagePath = `acredita/${cedulaId}.pdf`;
  const { data: signedData, error: signedError } = await svc.storage
    .from("cedulas")
    .createSignedUrl(storagePath, 300);

  if (signedError || !signedData?.signedUrl) {
    await svc
      .from("cedulas")
      .update({
        observaciones_pjn:
          signedError?.message || "No se pudo generar URL firmada del PDF para cargar-pjn",
      })
      .eq("id", cedulaId);
    return;
  }

  const [expNumero, expAnioStr] = expNro.split("/");
  const expAnio = expAnioStr ? parseInt(expAnioStr, 10) : NaN;

  let favoritoJurisdiccion: string | null = null;
  if (expNumero && !Number.isNaN(expAnio)) {
    const { data: fav } = await svc
      .from("pjn_favoritos")
      .select("jurisdiccion")
      .eq("numero", expNumero)
      .eq("anio", expAnio)
      .maybeSingle();
    favoritoJurisdiccion = fav?.jurisdiccion ?? null;
  }
  const jurisdiccion = favoritoJurisdiccion ?? "CIV";

  const internalSecret = process.env.RAILWAY_INTERNAL_SECRET;

  let railwayRes: Response;
  try {
    railwayRes = await fetch(`${base}/cargar-pjn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
      body: JSON.stringify({
        expNro: expNro.trim(),
        jurisdiccion,
        cedulaId,
        pdfUrl: signedData.signedUrl,
      }),
      signal: AbortSignal.timeout(CARGAR_PJN_FETCH_MS),
    });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    await svc.from("cedulas").update({ observaciones_pjn: errMsg }).eq("id", cedulaId);
    return;
  }

  const text = await railwayRes.text();
  let payload: { ok?: boolean; error?: string; pruebaSinEnvio?: boolean } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    await svc
      .from("cedulas")
      .update({
        observaciones_pjn: `Respuesta no JSON (${railwayRes.status}): ${text.slice(0, 500)}`,
      })
      .eq("id", cedulaId);
    return;
  }

  if (payload.ok === true && payload.pruebaSinEnvio !== true) {
    await svc
      .from("cedulas")
      .update({
        pjn_cargado_at: new Date().toISOString(),
        observaciones_pjn: null,
      })
      .eq("id", cedulaId);
    return;
  }

  if (payload.ok === true && payload.pruebaSinEnvio === true) {
    return;
  }

  const errMsg =
    payload.error ||
    text ||
    railwayRes.statusText ||
    `Error cargar-pjn (${railwayRes.status})`;
  await svc.from("cedulas").update({ observaciones_pjn: errMsg }).eq("id", cedulaId);
}

async function procesarOcrEnBackground(cedulaId: string, svc: ReturnType<typeof supabaseService>) {
  const railwayUrl = process.env.RAILWAY_OCR_URL;
  if (!railwayUrl) {
    await svc
      .from("cedulas")
      .update({
        estado_ocr: "error",
        ocr_error: "RAILWAY_OCR_URL no configurada",
      })
      .eq("id", cedulaId);
    return;
  }

  try {
    // 1. Obtener cédula y pdf_path
    const { data: cedula, error: cedulaErr } = await svc
      .from("cedulas")
      .select("id, pdf_path, tipo_documento")
      .eq("id", cedulaId)
      .single();

    if (cedulaErr || !cedula?.pdf_path) {
      await svc
        .from("cedulas")
        .update({
          estado_ocr: "error",
          ocr_error: cedulaErr?.message || "Cédula no encontrada o sin PDF",
        })
        .eq("id", cedulaId);
      return;
    }

    // 2. Descargar PDF desde Supabase Storage
    const { data: fileData, error: downloadErr } = await svc.storage
      .from("cedulas")
      .download(cedula.pdf_path);

    if (downloadErr || !fileData) {
      await svc
        .from("cedulas")
        .update({
          estado_ocr: "error",
          ocr_error: downloadErr?.message || "No se pudo descargar el PDF",
        })
        .eq("id", cedulaId);
      return;
    }

    const pdfBuffer = Buffer.from(await fileData.arrayBuffer());
    const pdfFilename =
      cedula.tipo_documento === "OFICIO" ? "oficio.pdf" : "cedula.pdf";

    // 3. Llamar al microservicio Railway
    const formData = new FormData();
    formData.append("pdf", new Blob([pdfBuffer], { type: "application/pdf" }), pdfFilename);

    const ocrEndpoint =
      cedula.tipo_documento === "OFICIO" ? "/procesar-oficio" : "/procesar";

    const railwayRes = await fetch(`${railwayUrl.replace(/\/$/, "")}${ocrEndpoint}`, {
      method: "POST",
      body: formData,
    });

    if (!railwayRes.ok) {
      const errorBody = await railwayRes.text();
      const errorMsg = errorBody || railwayRes.statusText || `Error ${railwayRes.status}`;
      await svc
        .from("cedulas")
        .update({
          estado_ocr: "error",
          ocr_error: errorMsg,
        })
        .eq("id", cedulaId);
      return;
    }

    // 4. Railway respondió OK: leer headers y subir PDF resultante
    const expNro = railwayRes.headers.get("X-Exp-Nro") || railwayRes.headers.get("x-exp-nro") || null;
    let caratulaOcr: string | null = railwayRes.headers.get("X-Caratula") || railwayRes.headers.get("x-caratula") || null;
    if (caratulaOcr) {
      try {
        caratulaOcr = decodeURIComponent(caratulaOcr);
      } catch {
        // Mantener valor original si falla decodificación
      }
    }

    const pdfResultado = await railwayRes.arrayBuffer();
    const storagePath = `acredita/${cedulaId}.pdf`;

    const { error: uploadErr } = await svc.storage
      .from("cedulas")
      .upload(storagePath, Buffer.from(pdfResultado), {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadErr) {
      await svc
        .from("cedulas")
        .update({
          estado_ocr: "error",
          ocr_error: `OCR OK pero falló subida: ${uploadErr.message}`,
        })
        .eq("id", cedulaId);
      return;
    }

    // 5. Obtener URL pública del PDF subido
    const { data: urlData } = svc.storage.from("cedulas").getPublicUrl(storagePath);

    // 6. Actualizar cédula con éxito
    await svc
      .from("cedulas")
      .update({
        estado_ocr: "listo",
        pdf_acredita_url: urlData.publicUrl,
        ocr_exp_nro: expNro,
        ocr_caratula: caratulaOcr,
        ocr_procesado_at: new Date().toISOString(),
        ocr_error: null,
      })
      .eq("id", cedulaId);

    try {
      await invocarCargarPjnTrasOcr(svc, cedulaId, expNro);
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      await svc.from("cedulas").update({ observaciones_pjn: errMsg }).eq("id", cedulaId);
    }
  } catch (e: any) {
    const errMsg = e?.message || "Error inesperado en OCR";
    const errCause = e?.cause ? ` (causa: ${String(e.cause)})` : "";
    console.error("[procesar-ocr] Error:", errMsg, errCause, "cedulaId:", cedulaId, "railwayUrl:", railwayUrl ? `${railwayUrl.slice(0, 30)}...` : "NO_CONFIGURADA");
    await svc
      .from("cedulas")
      .update({
        estado_ocr: "error",
        ocr_error: errMsg + errCause,
      })
      .eq("id", cedulaId);
  }
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
  const isAdmin = await requireAdminCedulas(user.id, svc);
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Solo usuarios con rol admin cédulas pueden procesar OCR" },
      { status: 403 }
    );
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID de cédula requerido" }, { status: 400 });
  }

  // Verificar que la cédula existe y tiene pdf_path
  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select("id, pdf_path, tipo_documento")
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json(
      { error: "Cédula no encontrada" },
      { status: 404 }
    );
  }

  if (!cedula.pdf_path) {
    return NextResponse.json(
      { error: "La cédula no tiene archivo PDF asociado" },
      { status: 400 }
    );
  }

  const { error: marcarProcesandoErr } = await svc
    .from("cedulas")
    .update({ estado_ocr: "procesando" })
    .eq("id", cedulaId);

  if (marcarProcesandoErr) {
    return NextResponse.json(
      { error: marcarProcesandoErr.message || "No se pudo marcar como procesando" },
      { status: 500 }
    );
  }

  // Fire and forget: responder de inmediato, procesar en background
  after(() => procesarOcrEnBackground(cedulaId, svc));

  return NextResponse.json({ ok: true, status: "procesando" });
}
