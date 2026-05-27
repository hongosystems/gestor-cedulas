import { supabaseService } from "@/lib/supabase-server";
import {
  buildPjnDiligenciamientoPayload,
  logPjnPayload,
  pjnVpsBaseUrl,
} from "@/lib/pjn-payload";

const CARGAR_PJN_FETCH_MS = 300_000;
const RAILWAY_OCR_FETCH_MS = 600_000;

async function invocarCargarPjnTrasOcr(
  svc: ReturnType<typeof supabaseService>,
  cedulaId: string,
  expNro: string | null,
  tipo_documento: string | null | undefined
) {
  const base = pjnVpsBaseUrl();
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

  let pjnPayload;
  try {
    pjnPayload = buildPjnDiligenciamientoPayload({
      cedulaId,
      expNro: expNro.trim(),
      jurisdiccion,
      pdfUrl: signedData.signedUrl,
      tipo_documento,
    });
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "tipo_documento inválido para carga PJN";
    await svc.from("cedulas").update({ observaciones_pjn: msg }).eq("id", cedulaId);
    return;
  }

  logPjnPayload({ tipo_documento }, pjnPayload);

  const internalSecret = process.env.RAILWAY_INTERNAL_SECRET;

  let railwayRes: Response;
  try {
    railwayRes = await fetch(`${base}/cargar-pjn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
      body: JSON.stringify(pjnPayload),
      signal: AbortSignal.timeout(CARGAR_PJN_FETCH_MS),
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
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

export type ProcesarOcrOptions = {
  /** Si true, no vuelve a invocar cargar-pjn tras el OCR (p. ej. PJN ya cargado). */
  skipCargarPjn?: boolean;
};

export async function procesarOcrEnBackground(
  cedulaId: string,
  svc: ReturnType<typeof supabaseService>,
  opts?: ProcesarOcrOptions
) {
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

    const tipoValido = ["CEDULA", "OFICIO"].includes(
      String(cedula.tipo_documento || "").trim().toUpperCase()
    );
    if (!tipoValido) {
      console.warn("[tipo-doc-guard] bloqueo OCR por tipo_documento inválido", {
        cedulaId,
        tipo_documento: cedula.tipo_documento,
      });
      await svc
        .from("cedulas")
        .update({
          estado_ocr: "error",
          ocr_error: "tipo_documento inválido o vacío",
        })
        .eq("id", cedulaId);
      return;
    }

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
    const pdfFilename = cedula.tipo_documento === "OFICIO" ? "oficio.pdf" : "cedula.pdf";

    const formData = new FormData();
    formData.append("pdf", new Blob([pdfBuffer], { type: "application/pdf" }), pdfFilename);

    const ocrEndpoint = cedula.tipo_documento === "OFICIO" ? "/procesar-oficio" : "/procesar";

    let railwayRes: Response;
    try {
      railwayRes = await fetch(`${railwayUrl.replace(/\/$/, "")}${ocrEndpoint}`, {
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
      await svc
        .from("cedulas")
        .update({
          estado_ocr: "error",
          ocr_error: msg,
        })
        .eq("id", cedulaId);
      return;
    }

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

    const expNro = railwayRes.headers.get("X-Exp-Nro") || railwayRes.headers.get("x-exp-nro") || null;
    let caratulaOcr: string | null = railwayRes.headers.get("X-Caratula") || railwayRes.headers.get("x-caratula") || null;
    if (caratulaOcr) {
      try {
        caratulaOcr = decodeURIComponent(caratulaOcr);
      } catch {
        /* keep */
      }
    }
    let destinatarioOcr: string | null =
      railwayRes.headers.get("X-Destinatario") || railwayRes.headers.get("x-destinatario") || null;
    if (destinatarioOcr) {
      try {
        destinatarioOcr = decodeURIComponent(destinatarioOcr);
      } catch {
        /* keep */
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

    const { data: urlData } = svc.storage.from("cedulas").getPublicUrl(storagePath);

    await svc
      .from("cedulas")
      .update({
        estado_ocr: "listo",
        pdf_acredita_url: urlData.publicUrl,
        ocr_exp_nro: expNro,
        ocr_caratula: caratulaOcr,
        ocr_destinatario: destinatarioOcr,
        ocr_procesado_at: new Date().toISOString(),
        ocr_error: null,
      })
      .eq("id", cedulaId);

    if (!opts?.skipCargarPjn) {
      try {
        await invocarCargarPjnTrasOcr(svc, cedulaId, expNro, cedula.tipo_documento);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await svc.from("cedulas").update({ observaciones_pjn: errMsg }).eq("id", cedulaId);
      }
    }
  } catch (e: unknown) {
    const errMsg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Error inesperado en OCR";
    const errCause =
      e instanceof Error && e.cause != null ? ` (causa: ${String(e.cause)})` : "";
    console.error(
      "[procesar-ocr] Error:",
      errMsg,
      errCause,
      "cedulaId:",
      cedulaId,
      "railwayUrl:",
      railwayUrl ? `${railwayUrl.slice(0, 30)}...` : "NO_CONFIGURADA"
    );
    await svc
      .from("cedulas")
      .update({
        estado_ocr: "error",
        ocr_error: errMsg + errCause,
      })
      .eq("id", cedulaId);
  }
}
