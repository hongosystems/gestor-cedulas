import { NextRequest, NextResponse } from "next/server";
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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return NextResponse.json(
        { error: "conversation_id es requerido" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

    // Verificar que el usuario participa en la conversación
    const { data: participant, error: participantError } = await svc
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversation_id)
      .eq("user_id", user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "No tienes acceso a esta conversación" },
        { status: 403 }
      );
    }

    // Marcar como leído usando la función RPC
    const { error: rpcError } = await svc.rpc("mark_conversation_read", {
      p_conversation_id: conversation_id,
    });

    if (rpcError) {
      console.error("Error al marcar como leído:", rpcError);
      // Intentar actualizar directamente si la función RPC no existe
      const { error: updateError } = await svc
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversation_id)
        .eq("user_id", user.id);

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message || "Error al marcar como leído" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Error en mark read:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
