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
    if (!sbAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: sess } = await sbAuth.auth.getUser();
    const user = sess?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { transferId } = await req.json();
    if (!transferId) return NextResponse.json({ error: "Falta transferId" }, { status: 400 });

    const svc = supabaseService();

    // Check permiso: sender o recipient
    const { data: t } = await svc
      .from("file_transfers")
      .select("id, sender_user_id, recipient_user_id")
      .eq("id", transferId)
      .single();

    if (!t || (t.sender_user_id !== user.id && t.recipient_user_id !== user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Última versión
    const { data: v } = await svc
      .from("file_transfer_versions")
      .select("storage_path, version")
      .eq("transfer_id", transferId)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    if (!v?.storage_path) {
      return NextResponse.json({ error: "No hay archivo para descargar" }, { status: 404 });
    }

    const { data: signed, error: sErr } = await svc.storage
      .from("transfers")
      .createSignedUrl(v.storage_path, 60); // 60s

    if (sErr || !signed?.signedUrl) {
      return NextResponse.json({ error: sErr?.message || "No se pudo firmar URL" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl, version: v.version });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 });
  }
}
