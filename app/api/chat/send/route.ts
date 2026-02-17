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

    const { conversation_id, content } = await req.json();

    if (!conversation_id || !content || content.trim() === "") {
      return NextResponse.json(
        { error: "conversation_id y content son requeridos" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

        // Verificar que el usuario participa en la conversación
        // NOTA: Para habilitar soft delete, ejecutar la migración: migrations/add_soft_delete_to_conversations.sql
        let { data: participant, error: participantError } = await svc
          .from("conversation_participants")
          .select("id, deleted_at")
          .eq("conversation_id", conversation_id)
          .eq("user_id", user.id)
          .single();

        // Si hay error por columna inexistente, intentar sin deleted_at
        if (participantError && participantError.message?.includes("deleted_at")) {
          console.warn("[API Send] Columna deleted_at no existe, continuando sin ella. Ejecutar migración: migrations/add_soft_delete_to_conversations.sql");
          const retryResult = await svc
            .from("conversation_participants")
            .select("id")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user.id)
            .single();
          participant = retryResult.data;
          participantError = retryResult.error;
        }

        if (participantError || !participant) {
          return NextResponse.json(
            { error: "No tienes acceso a esta conversación" },
            { status: 403 }
          );
        }

        // Si la columna deleted_at existe y la conversación estaba borrada, restaurarla
        if (participant && 'deleted_at' in participant && participant.deleted_at) {
          await svc
            .from("conversation_participants")
            .update({ deleted_at: null })
            .eq("conversation_id", conversation_id)
            .eq("user_id", user.id);
        }

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "No tienes acceso a esta conversación" },
        { status: 403 }
      );
    }

    // Crear el mensaje
    const { data: message, error: messageError } = await svc
      .from("messages")
      .insert({
        conversation_id,
        sender_id: user.id,
        content: content.trim(),
      })
      .select()
      .single();

    if (messageError) {
      console.error("Error al crear mensaje:", messageError);
      return NextResponse.json(
        { error: messageError.message || "Error al enviar mensaje" },
        { status: 500 }
      );
    }

    // Obtener información del mensaje con datos del sender
    const { data: senderProfile, error: profileError } = await svc
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", user.id)
      .single();

    const messageWithSender = {
      ...message,
      sender: profileError ? null : senderProfile,
    };

    return NextResponse.json({ ok: true, data: messageWithSender });
  } catch (e: any) {
    console.error("Error en send message:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
