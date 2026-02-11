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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> | { conversationId: string } }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Next.js 15+ puede pasar params como Promise
    const resolvedParams = params instanceof Promise ? await params : params;
    const conversationId = resolvedParams?.conversationId;
    
    if (!conversationId) {
      console.error("[API Messages] conversationId no proporcionado:", resolvedParams);
      return NextResponse.json(
        { error: "conversationId es requerido" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

    // Verificar que el usuario participa en la conversación
    const { data: participant, error: participantError } = await svc
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "No tienes acceso a esta conversación" },
        { status: 403 }
      );
    }

    // Obtener parámetros de paginación
    const searchParams = req.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Obtener mensajes
    const { data: messages, error: messagesError } = await svc
      .from("messages")
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        created_at,
        updated_at
      `)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (messagesError) {
      console.error("Error al obtener mensajes:", messagesError);
      return NextResponse.json(
        { error: messagesError.message || "Error al obtener mensajes" },
        { status: 500 }
      );
    }

    // Obtener perfiles de los senders
    const senderIds = [...new Set((messages || []).map((m: any) => m.sender_id))];
    let senderProfiles: Record<string, any> = {};
    
    if (senderIds.length > 0) {
      const { data: profiles, error: profilesError } = await svc
        .from("profiles")
        .select("id, full_name, email")
        .in("id", senderIds);
      
      if (!profilesError && profiles) {
        profiles.forEach((profile: any) => {
          senderProfiles[profile.id] = profile;
        });
      }
    }

    // Combinar mensajes con perfiles
    const messagesWithSenders = (messages || []).map((msg: any) => ({
      ...msg,
      sender: senderProfiles[msg.sender_id] || null,
    }));

    // Invertir el orden para mostrar los más antiguos primero
    const orderedMessages = messagesWithSenders.reverse();

    console.log(`[API Messages] Retornando ${orderedMessages.length} mensajes para conversación ${conversationId}`);
    return NextResponse.json({ ok: true, data: orderedMessages });
  } catch (e: any) {
    console.error("Error en get messages:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
