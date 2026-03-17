import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { getUserFromRequest, getMediacionesRole } from "@/lib/auth-api";

export const runtime = "nodejs";

async function requireAdmin(
  userId: string,
  svc: ReturnType<typeof supabaseService>
) {
  const { isAdminMediaciones, isSuperadmin } = await getMediacionesRole(userId, svc);
  return isAdminMediaciones || isSuperadmin;
}

/**
 * TODO: Integrar con Resend (o otro servicio SMTP/transaccional) para envío real.
 * Requiere: npm install resend y RESEND_API_KEY en .env.
 * Si no hay servicio configurado, se registra en consola lo que se enviaría y el lote se marca como enviado igual.
 */
async function sendLoteMail(payload: {
  to: string[];
  subject: string;
  body: string;
  attachments: { filename: string; content: Buffer }[];
}): Promise<{ ok: boolean; id?: string; skipped?: boolean }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(resendKey);
      const attachmentsForResend = payload.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      }));
      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM || "Mediaciones <onboarding@resend.dev>",
        to: payload.to,
        subject: payload.subject,
        html: payload.body.replace(/\n/g, "<br>"),
        attachments: attachmentsForResend,
      });
      if (error) {
        console.error("[mediaciones/lotes/send] Resend error:", error);
        throw new Error(error.message);
      }
      return { ok: true, id: data?.id };
    } catch (e: any) {
      console.error("[mediaciones/lotes/send] Resend (¿está instalado 'resend'?)", e);
      throw e;
    }
  }

  console.log("[mediaciones/lotes/send] Sin servicio de mail configurado (RESEND_API_KEY). Payload que se enviaría:");
  console.log(JSON.stringify({
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    attachmentsCount: payload.attachments.length,
    attachmentNames: payload.attachments.map((a) => a.filename),
  }, null, 2));
  return { ok: true, skipped: true };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();
    if (!(await requireAdmin(user.id, svc))) {
      return NextResponse.json({ error: "Solo administradores de mediaciones" }, { status: 403 });
    }

    const reqBody = await req.json().catch(() => ({}));
    const loteId = reqBody.lote_id || reqBody.loteId;

    let lote: { id: string; numero_lote: number; destinatarios: string[]; texto_mail: string } | null = null;

    if (loteId) {
      const { data, error } = await svc
        .from("mediacion_lotes")
        .select("id, numero_lote, estado, destinatarios, texto_mail")
        .eq("id", loteId)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
      }
      if (data.estado === "enviado") {
        return NextResponse.json({ ok: true, data: data, message: "Lote ya estaba enviado" });
      }
      lote = data;
    } else {
      const { data } = await svc
        .from("mediacion_lotes")
        .select("id, numero_lote, estado, destinatarios, texto_mail")
        .eq("estado", "abierto")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) {
        return NextResponse.json({ error: "No hay lote abierto para enviar" }, { status: 404 });
      }
      lote = data;
    }

    const { data: items, error: itemsErr } = await svc
      .from("mediacion_lote_items")
      .select("id, mediacion_id, documento_id")
      .eq("lote_id", lote!.id);

    if (itemsErr || !items?.length) {
      await svc
        .from("mediacion_lotes")
        .update({ estado: "enviado", fecha_envio: new Date().toISOString() })
        .eq("id", lote!.id);
      return NextResponse.json({
        ok: true,
        data: { lote_id: lote!.id, message: "Lote marcado como enviado sin adjuntos." },
      });
    }

    const documentoIds = items.map((i: any) => i.documento_id).filter(Boolean);
    const mediacionIds = [...new Set(items.map((i: any) => i.mediacion_id).filter(Boolean))];

    let documentos: { id: string; mediacion_id: string; storage_path: string }[] = [];
    if (documentoIds.length > 0) {
      const { data: docs } = await svc
        .from("mediacion_documentos")
        .select("id, mediacion_id, storage_path")
        .in("id", documentoIds);
      documentos = docs || [];
    }
    if (documentos.length === 0 && mediacionIds.length > 0) {
      const { data: docs } = await svc
        .from("mediacion_documentos")
        .select("id, mediacion_id, storage_path")
        .in("mediacion_id", mediacionIds)
        .order("created_at", { ascending: false });
      const byMediacion = new Map<string, any>();
      (docs || []).forEach((d: any) => {
        if (!byMediacion.has(d.mediacion_id)) byMediacion.set(d.mediacion_id, d);
      });
      documentos = Array.from(byMediacion.values());
    }

    const attachments: { filename: string; content: Buffer }[] = [];
    const bucket = svc.storage.from("mediaciones");
    for (const doc of documentos) {
      if (!doc.storage_path) continue;
      const { data: blob, error: downErr } = await bucket.download(doc.storage_path);
      if (downErr || !blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      const baseName = doc.storage_path.split("/").pop() || `documento-${doc.id}.pdf`;
      attachments.push({ filename: baseName, content: buf });
    }

    const to = Array.isArray(lote!.destinatarios) && lote!.destinatarios.length > 0
      ? lote!.destinatarios
      : ["oliverarodrigo86@gmail.com", "gfhisi@gmail.com"];
    const subject = "SOLICITA FECHAS DE MEDIACION";
    const DEFAULT_BODY = `¿Como estan? Solicito fecha de mediacion . 

Tratar con Magaly Flores (mf.magaliflores@gmail.com) que es quien asiste a las audiencias.  

Adjunto los seis formularios.

Saludos Cordiales.`;
    const emailBody = lote!.texto_mail || DEFAULT_BODY;

    await sendLoteMail({ to, subject, body: emailBody, attachments });

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await svc
      .from("mediacion_lotes")
      .update({ estado: "enviado", fecha_envio: now })
      .eq("id", lote!.id)
      .select("*")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Pasar cada mediación del lote a estado "enviado" y registrar en historial
    if (mediacionIds.length > 0) {
      const { data: mediacionesParaHistorial } = await svc
        .from("mediaciones")
        .select("id, estado")
        .in("id", mediacionIds);
      const estadoAnteriorPorId = new Map<string, string>();
      (mediacionesParaHistorial || []).forEach((m: { id: string; estado: string }) => {
        estadoAnteriorPorId.set(m.id, m.estado || "doc_generado");
      });
      await svc
        .from("mediaciones")
        .update({ estado: "enviado" })
        .in("id", mediacionIds);
      const historialRows = mediacionIds.map((mid) => ({
        mediacion_id: mid,
        estado_anterior: estadoAnteriorPorId.get(mid) || "doc_generado",
        estado_nuevo: "enviado",
        actor_id: user.id,
        comentario: `Enviado en lote #${lote!.numero_lote}`,
      }));
      if (historialRows.length > 0) {
        await svc.from("mediacion_historial").insert(historialRows);
      }
    }

    return NextResponse.json({
      ok: true,
      data: updated,
      message: "Lote enviado correctamente.",
    });
  } catch (e: any) {
    console.error("[mediaciones/lotes/send]", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
