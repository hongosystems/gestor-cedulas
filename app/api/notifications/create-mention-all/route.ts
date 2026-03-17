import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

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

    const { createClient } = await import("@supabase/supabase-js");
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

export async function POST(req: NextRequest) {
  try {
    const sender = await getUserFromRequest(req);
    if (!sender) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      title,
      body,
      link,
      expediente_id,
      is_pjn_favorito,
      nota_context,
      metadata,
    } = await req.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: "title y body son requeridos" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

    let metadataObj: Record<string, unknown> = { sender_id: sender.id };
    if (metadata && typeof metadata === "object") {
      metadataObj = { ...metadata, sender_id: sender.id };
    } else if (metadata && typeof metadata === "string") {
      try {
        metadataObj = { ...JSON.parse(metadata), sender_id: sender.id };
      } catch {
        metadataObj = { sender_id: sender.id };
      }
    }

    // Obtener todos los usuarios del sistema (mismo criterio que /api/users/list)
    const { data: profiles } = await svc
      .from("profiles")
      .select("id");

    let allUserIds: string[] = [];
    if (profiles && profiles.length > 0) {
      allUserIds = profiles.map((p: any) => p.id);
    } else {
      let page = 1;
      const perPage = 1000;
      while (true) {
        const response = await svc.auth.admin.listUsers({ page, perPage });
        if (response.error || !response.data?.users?.length) break;
        allUserIds = [...allUserIds, ...response.data.users.map((u: any) => u.id)];
        if (response.data.users.length < perPage) break;
        page++;
      }
    }

    // Excluir al remitente para no notificarse a sí mismo
    const recipientIds = allUserIds.filter((id) => id !== sender.id);
    if (recipientIds.length === 0) {
      return NextResponse.json({ ok: true, data: { count: 0 }, message: "No hay otros usuarios" });
    }

    const insertData = recipientIds.map((user_id) => ({
      user_id,
      title,
      body,
      link: link || null,
      expediente_id: expediente_id || null,
      is_pjn_favorito: is_pjn_favorito ?? false,
      nota_context: nota_context || null,
      metadata: metadataObj,
    }));

    const { data: inserted, error } = await svc
      .from("notifications")
      .insert(insertData)
      .select("id");

    if (error) {
      console.error("[API create-mention-all] Error al insertar notificaciones:", error);
      return NextResponse.json(
        { error: error.message || "Error al notificar a todos" },
        { status: 500 }
      );
    }

    const count = inserted?.length ?? 0;
    console.log("[API create-mention-all] Notificaciones creadas:", count, "para @todos");
    return NextResponse.json({ ok: true, data: { count } });
  } catch (e: any) {
    console.error("Error en create-mention-all:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
