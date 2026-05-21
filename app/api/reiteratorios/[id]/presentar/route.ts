import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest } from "@/lib/auth-api";
import {
  logPjnPayload,
  normalizeTipoDocumentoPjn,
  pjnLocalBaseUrl,
  type PjnCargarPayload,
} from "@/lib/pjn-payload";

export const runtime = "nodejs";

// Railway puede tardar varios minutos generando el PDF + el VPS resuelve la carga en PJN.
export const maxDuration = 300;

/** Tiempo máximo para que Railway genere el PDF del reiteratorio. */
const RAILWAY_FETCH_MS = 600_000;
/** Tiempo máximo para que el VPS ejecute Playwright cargando el reiteratorio en PJN. */
const PJN_FETCH_MS = 300_000;

async function requireSuperadmin(
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

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = supabaseService();
  if (!(await requireSuperadmin(user.id, svc))) {
    return NextResponse.json(
      { error: "Solo superadmin puede presentar reiteratorios" },
      { status: 403 }
    );
  }

  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID de cédula requerido" }, { status: 400 });
  }

  let soloPreview = false;
  try {
    const body = (await req.json()) as { soloPreview?: boolean } | null;
    soloPreview = body?.soloPreview === true;
  } catch {
    soloPreview = false;
  }

  const { data: cedula, error: fetchErr } = await svc
    .from("cedulas")
    .select(
      "id, ocr_exp_nro, ocr_caratula, ocr_destinatario, caratula, pjn_cargado_at, tipo_documento, juzgado"
    )
    .eq("id", cedulaId)
    .single();

  if (fetchErr || !cedula) {
    return NextResponse.json({ error: "Cédula no encontrada" }, { status: 404 });
  }

  if (cedula.tipo_documento !== "OFICIO") {
    return NextResponse.json(
      { error: "Solo se pueden presentar reiteratorios sobre oficios" },
      { status: 400 }
    );
  }

  const expNro = (cedula.ocr_exp_nro || "").trim();
  // Fallback: si el OCR no extrajo la carátula, usamos la carátula manual de la cédula.
  const caratula =
    (cedula.ocr_caratula || "").trim() || (cedula.caratula || "").trim();
  const destinatario = (cedula.ocr_destinatario || "").trim();

  const faltantes: string[] = [];
  if (!expNro) faltantes.push("expediente (ocr_exp_nro)");
  if (!caratula) faltantes.push("carátula (ocr_caratula/caratula)");
  if (!destinatario) faltantes.push("destinatario (ocr_destinatario)");

  if (faltantes.length > 0) {
    return NextResponse.json(
      {
        error: `Faltan datos para generar el reiteratorio: ${faltantes.join(
          ", "
        )}. Reprocesá el OCR de esta cédula.`,
      },
      { status: 400 }
    );
  }

  const railwayBase = process.env.RAILWAY_OCR_URL?.trim();
  if (!railwayBase) {
    return NextResponse.json(
      { error: "RAILWAY_OCR_URL no configurada" },
      { status: 503 }
    );
  }

  const internalSecret = process.env.RAILWAY_INTERNAL_SECRET;

  // 1. Pedir a Railway que genere el PDF del reiteratorio.
  let railwayRes: Response;
  try {
    railwayRes = await fetch(
      `${railwayBase.replace(/\/$/, "")}/procesar-reiteratorio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
        },
        body: JSON.stringify({ expNro, caratula, destinatario }),
        signal: AbortSignal.timeout(RAILWAY_FETCH_MS),
      }
    );
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "No se pudo contactar al servicio Railway";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!railwayRes.ok) {
    const errBody = await railwayRes.text().catch(() => "");
    return NextResponse.json(
      {
        error:
          errBody || railwayRes.statusText || `Error Railway (${railwayRes.status})`,
      },
      { status: 502 }
    );
  }

  const pdfBuffer = Buffer.from(await railwayRes.arrayBuffer());

  // Modo preview: devolver el PDF generado por Railway directamente,
  // sin subirlo a Supabase ni encolar la presentación en el VPS PJN.
  if (soloPreview) {
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="reiteratorio-${cedulaId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const storagePath = `reiteratorios/${cedulaId}.pdf`;

  // 2. Subir el PDF generado al bucket de Supabase.
  const { error: uploadErr } = await svc.storage
    .from("cedulas")
    .upload(storagePath, pdfBuffer, {
      upsert: true,
      contentType: "application/pdf",
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `No se pudo guardar el PDF del reiteratorio: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { data: signedData, error: signedError } = await svc.storage
    .from("cedulas")
    .createSignedUrl(storagePath, 300);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      {
        error:
          signedError?.message ||
          "No se pudo generar URL firmada del reiteratorio",
      },
      { status: 500 }
    );
  }

  // 3. Encolar la presentación del reiteratorio en el VPS PJN.
  const pjnBase = pjnLocalBaseUrl();
  if (!pjnBase) {
    return NextResponse.json(
      { error: "PJN_LOCAL_URL no configurada" },
      { status: 503 }
    );
  }

  let tipoDocumento: PjnCargarPayload["tipoDocumento"];
  try {
    tipoDocumento = normalizeTipoDocumentoPjn(cedula.tipo_documento);
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "tipo_documento inválido para presentación PJN";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const pjnPayload: PjnCargarPayload = {
    cedulaId,
    expNro,
    jurisdiccion: "CIV",
    pdfUrl: signedData.signedUrl,
    tipoDocumento,
    descripcion: "Solicita Oficio Reiteratorio",
  };
  logPjnPayload(cedula, pjnPayload);

  let pjnRes: Response;
  try {
    pjnRes = await fetch(`${pjnBase}/cargar-pjn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalSecret ? { "X-Internal-Secret": internalSecret } : {}),
      },
      body: JSON.stringify(pjnPayload),
      signal: AbortSignal.timeout(PJN_FETCH_MS),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "No se pudo contactar al VPS PJN";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const text = await pjnRes.text();
  let payload: { ok?: boolean; error?: string } = {};
  try {
    payload = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    return NextResponse.json(
      {
        error: `Respuesta no JSON del VPS (${pjnRes.status}): ${text.slice(0, 500)}`,
      },
      { status: 502 }
    );
  }

  if (!pjnRes.ok || payload.ok !== true) {
    return NextResponse.json(
      {
        error:
          payload.error ||
          pjnRes.statusText ||
          `Error VPS PJN (${pjnRes.status})`,
      },
      { status: 502 }
    );
  }

  const observaciones = `Reiteratorio presentado: ${new Date().toISOString()}`;
  const { error: updateErr } = await svc
    .from("cedulas")
    .update({ observaciones_pjn: observaciones })
    .eq("id", cedulaId);

  if (updateErr) {
    return NextResponse.json(
      {
        error: `Reiteratorio presentado pero no se pudo actualizar la base: ${updateErr.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
