import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    if (!url || !anon) {
      console.error("Missing Supabase env vars");
      return null;
    }

    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    
    if (error || !user) {
      console.error("Auth error:", error?.message);
      return null;
    }

    return user;
  } catch (e: any) {
    console.error("Error getting user:", e?.message);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const transferId = String(form.get("transferId") || "");
    const file = form.get("file");

    if (!transferId) return NextResponse.json({ error: "Falta transferId" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "Falta file" }, { status: 400 });

    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".docx")) return NextResponse.json({ error: "Solo .docx" }, { status: 400 });

    const svc = supabaseService();

    // Check permiso: sender o recipient
    const { data: t } = await svc
      .from("file_transfers")
      .select("id, sender_user_id, recipient_user_id, doc_type")
      .eq("id", transferId)
      .single();

    if (!t || (t.sender_user_id !== user.id && t.recipient_user_id !== user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Calcular próxima versión
    const { data: last } = await svc
      .from("file_transfer_versions")
      .select("version")
      .eq("transfer_id", transferId)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (last?.version ?? 0) + 1;

    const buf = Buffer.from(await file.arrayBuffer());
    const storage_path = `transfers/${transferId}/v${nextVersion}.docx`;

    const { error: upErr } = await svc.storage
      .from("transfers")
      .upload(storage_path, buf, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { error: vErr } = await svc
      .from("file_transfer_versions")
      .insert({
        transfer_id: transferId,
        version: nextVersion,
        storage_path,
        created_by: user.id,
      });

    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

    // Notificar a la otra parte (si sube recipient notifica sender, y viceversa)
    const otherUserId = user.id === t.sender_user_id ? t.recipient_user_id : t.sender_user_id;

    const { data: actorProfile } = await svc
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const actor =
      (actorProfile?.full_name || "").trim() ||
      (actorProfile?.email || "").trim() ||
      "Usuario";

    const tipoTxt = t.doc_type === "CEDULA" ? "Cédula" : "Oficio";

    await svc.from("notifications").insert({
      user_id: otherUserId,
      title: `${tipoTxt} actualizada`,
      body: `${actor} subió una nueva versión (${nextVersion}).`,
      link: `/app/recibidos`,
    });

    return NextResponse.json({ ok: true, version: nextVersion });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 });
  }
}
