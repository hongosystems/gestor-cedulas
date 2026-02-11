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

    const { other_user_id } = await req.json();

    if (!other_user_id) {
      return NextResponse.json(
        { error: "other_user_id es requerido" },
        { status: 400 }
      );
    }

    if (other_user_id === user.id) {
      return NextResponse.json(
        { error: "No puedes crear una conversación contigo mismo" },
        { status: 400 }
      );
    }

    const svc = supabaseService();

    // Verificar que el otro usuario existe
    const { data: otherUser, error: userError } = await svc
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", other_user_id)
      .single();

    if (userError || !otherUser) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    // Usar la función RPC para obtener o crear la conversación
    const { data: conversationId, error: rpcError } = await svc.rpc(
      "get_or_create_direct_conversation",
      { other_user_id }
    );

    if (rpcError) {
      console.error("Error al obtener/crear conversación:", rpcError);
      
      // Fallback: buscar manualmente conversación existente
      // Primero obtener todas las conversaciones del usuario actual
      const { data: userConvs } = await svc
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", user.id);

      if (userConvs && userConvs.length > 0) {
        const convIds = userConvs.map((c: any) => c.conversation_id);
        
        // Buscar si alguna de esas conversaciones tiene al otro usuario
        const { data: otherUserConvs } = await svc
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", other_user_id)
          .in("conversation_id", convIds);

        if (otherUserConvs && otherUserConvs.length > 0) {
          // Verificar que sea una conversación directa
          const foundConvId = otherUserConvs[0].conversation_id;
          const { data: conv } = await svc
            .from("conversations")
            .select("id, type")
            .eq("id", foundConvId)
            .eq("type", "direct")
            .single();

          if (conv) {
            return NextResponse.json({ 
              ok: true, 
              data: { conversation_id: conv.id } 
            });
          }
        }
      }

      // Crear nueva conversación
      const { data: newConv, error: createError } = await svc
        .from("conversations")
        .insert({ type: "direct" })
        .select()
        .single();

      if (createError || !newConv) {
        return NextResponse.json(
          { error: createError?.message || "Error al crear conversación" },
          { status: 500 }
        );
      }

      // Agregar participantes
      const { error: participantsError } = await svc
        .from("conversation_participants")
        .insert([
          { conversation_id: newConv.id, user_id: user.id },
          { conversation_id: newConv.id, user_id: other_user_id },
        ]);

      if (participantsError) {
        console.error("Error al agregar participantes:", participantsError);
        return NextResponse.json(
          { error: "Error al agregar participantes a la conversación" },
          { status: 500 }
        );
      }

      return NextResponse.json({ 
        ok: true, 
        data: { conversation_id: newConv.id } 
      });
    }

    return NextResponse.json({ 
      ok: true, 
      data: { conversation_id: conversationId } 
    });
  } catch (e: any) {
    console.error("Error en get/create conversation:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
