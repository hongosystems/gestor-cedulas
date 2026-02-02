import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseFromAuthHeader(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const sbAuth = supabaseFromAuthHeader(req);
    if (!sbAuth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: sess } = await sbAuth.auth.getUser();
    const user = sess?.user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const recipient_user_id = String(form.get("recipient_user_id") || "");
    const doc_type = String(form.get("doc_type") || "");
    const title = String(form.get("title") || "").trim();
    const file = form.get("file");

    if (!recipient_user_id) {
      return NextResponse.json({ error: "Falta recipient_user_id" }, { status: 400 });
    }
    if (doc_type !== "CEDULA" && doc_type !== "OFICIO") {
      return NextResponse.json({ error: "doc_type inválido" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo (file)" }, { status: 400 });
    }

    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".docx")) {
      return NextResponse.json({ error: "Solo se permite .docx" }, { status: 400 });
    }

    const svc = supabaseService();

    // 1) Crear transfer
    const { data: t, error: tErr } = await svc
      .from("file_transfers")
      .insert({
        sender_user_id: user.id,
        recipient_user_id,
        doc_type,
        title: title || null,
      })
      .select("id")
      .single();

    if (tErr || !t?.id) {
      return NextResponse.json({ error: tErr?.message || "No se pudo crear el envío" }, { status: 500 });
    }

    const transferId = t.id as string;
    const version = 1;

    // 2) Subir a storage (bucket privado)
    const buf = Buffer.from(await file.arrayBuffer());
    const storage_path = `transfers/${transferId}/v${version}.docx`;

    const { error: upErr } = await svc.storage
      .from("transfers")
      .upload(storage_path, buf, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (upErr) {
      return NextResponse.json({ error: `No se pudo subir el DOCX: ${upErr.message}` }, { status: 500 });
    }

    // 3) Insertar versión
    const { error: vErr } = await svc
      .from("file_transfer_versions")
      .insert({
        transfer_id: transferId,
        version,
        storage_path,
        created_by: user.id,
      });

    if (vErr) {
      return NextResponse.json({ error: vErr.message }, { status: 500 });
    }

    // 4) Armar nombres para notificación
    const { data: senderProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const senderName =
      (senderProfile?.full_name || "").trim() ||
      (senderProfile?.email || "").trim() ||
      "Usuario";

    const tipoTxt = doc_type === "CEDULA" ? "Cédula" : "Oficio";

    // 5) Crear notificación para el destinatario
    await svc.from("notifications").insert({
      user_id: recipient_user_id,
      title: `${tipoTxt} nueva`,
      body: `${tipoTxt} enviada por ${senderName}.`,
      link: `/app/recibidos`,
    });

    return NextResponse.json({ ok: true, transferId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 });
  }
}
