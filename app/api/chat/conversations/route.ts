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

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();

        // Obtener todas las conversaciones del usuario con información adicional
        // NOTA: Para habilitar soft delete, ejecutar la migración: migrations/add_soft_delete_to_conversations.sql
        // Por ahora, si la columna deleted_at no existe, la query funcionará sin el filtro
        let { data: conversations, error: conversationsError } = await svc
          .from("conversation_participants")
          .select(`
            conversation_id,
            last_read_at,
            conversation:conversations!inner(
              id,
              type,
              name,
              created_at,
              updated_at
            )
          `)
          .eq("user_id", user.id);
        
        // Si hay error por columna inexistente, intentar sin el filtro deleted_at
        if (conversationsError && conversationsError.message?.includes("deleted_at")) {
          console.warn("[API Conversations] Columna deleted_at no existe, continuando sin filtro. Ejecutar migración: migrations/add_soft_delete_to_conversations.sql");
          const retryResult = await svc
            .from("conversation_participants")
            .select(`
              conversation_id,
              last_read_at,
              conversation:conversations!inner(
                id,
                type,
                name,
                created_at,
                updated_at
              )
            `)
            .eq("user_id", user.id);
          conversations = retryResult.data;
          conversationsError = retryResult.error;
        }

    if (conversationsError) {
      console.error("Error al obtener conversaciones:", conversationsError);
      return NextResponse.json(
        { error: conversationsError.message || "Error al obtener conversaciones" },
        { status: 500 }
      );
    }

    // Para cada conversación, obtener:
    // 1. El último mensaje
    // 2. Los participantes (para conversaciones directas, mostrar el otro usuario)
    // 3. Contar mensajes no leídos

    const enrichedConversations = await Promise.all(
      (conversations || []).map(async (cp: any) => {
        const conv = cp.conversation;
        const lastReadAt = cp.last_read_at;

        // Obtener último mensaje
        const { data: lastMessages } = await svc
          .from("messages")
          .select(`
            id,
            content,
            created_at,
            sender_id
          `)
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(1);
        
        let lastMessage = null;
        if (lastMessages && lastMessages.length > 0) {
          const msg = lastMessages[0];
          // Obtener perfil del sender
          if (msg.sender_id) {
            const { data: senderProfile } = await svc
              .from("profiles")
              .select("id, full_name, email")
              .eq("id", msg.sender_id)
              .single();
            
            lastMessage = {
              ...msg,
              sender: senderProfile || null,
            };
          } else {
            lastMessage = msg;
          }
        }

        // Obtener participantes
        const { data: participantsData, error: participantsError } = await svc
          .from("conversation_participants")
          .select("user_id")
          .eq("conversation_id", conv.id);
        
        if (participantsError) {
          console.error(`[API Conversations] Error al obtener participantes para conversación ${conv.id}:`, participantsError);
        }
        
        // Obtener perfiles de los participantes
        let participants: any[] = [];
        if (participantsData && participantsData.length > 0) {
          const userIds = participantsData.map((p: any) => p.user_id);
          const { data: profilesData } = await svc
            .from("profiles")
            .select("id, full_name, email")
            .in("id", userIds);
          
          // Combinar participantes con sus perfiles
          participants = participantsData.map((p: any) => {
            const profile = profilesData?.find((prof: any) => prof.id === p.user_id);
            return {
              user_id: p.user_id,
              profile: profile || null,
            };
          });
        }
        
        console.log(`[API Conversations] Participantes para conversación ${conv.id}:`, participants.map((p: any) => ({
          user_id: p.user_id,
          has_profile: !!p.profile,
          profile_name: p.profile?.full_name || p.profile?.email
        })));

        // Contar mensajes no leídos
        let unreadCount = 0;
        if (lastReadAt) {
          const { count } = await svc
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", conv.id)
            .gt("created_at", lastReadAt);
          unreadCount = count || 0;
        } else {
          // Si nunca ha leído, contar todos los mensajes excepto los propios
          const { count } = await svc
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", conv.id)
            .neq("sender_id", user.id);
          unreadCount = count || 0;
        }

        // Para conversaciones directas, obtener el otro usuario
        let otherUser = null;
        if (conv.type === "direct" && participants) {
          const otherParticipant = participants.find((p: any) => p.user_id !== user.id);
          if (otherParticipant) {
            otherUser = otherParticipant.profile;
          }
        }

        // Determinar el nombre a mostrar
        let displayName: string;
        if (conv.type === "direct") {
          // Para conversaciones directas, SIEMPRE usar el nombre del otro usuario (ignorar conv.name)
          if (otherUser) {
            displayName = otherUser.full_name || otherUser.email || "Usuario";
          } else {
            // Si no encontramos el otro usuario, intentar obtenerlo de los participantes
            const otherPart = participants?.find((p: any) => p.user_id !== user.id);
            if (otherPart?.profile) {
              displayName = otherPart.profile.full_name || otherPart.profile.email || "Usuario";
            } else {
              console.warn(`[API Conversations] No se encontró el otro usuario para conversación directa ${conv.id}`);
              displayName = "Usuario";
            }
          }
        } else {
          // Para conversaciones grupales, usar el nombre de la conversación o un nombre genérico
          displayName = conv.name || "Conversación grupal";
        }
        
        console.log(`[API Conversations] Conversación ${conv.id} (${conv.type}): displayName="${displayName}", otherUser=${otherUser ? (otherUser.full_name || otherUser.email) : "null"}`);

        return {
          id: conv.id,
          type: conv.type,
          name: displayName,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          last_message: lastMessage,
          participants: participants?.map((p: any) => ({
            user_id: p.user_id,
            full_name: p.profile?.full_name,
            email: p.profile?.email,
          })) || [],
          other_user: otherUser,
          unread_count: unreadCount,
          last_read_at: lastReadAt,
        };
      })
    );

    // Ordenar por updated_at descendente
    enrichedConversations.sort((a, b) => {
      const dateA = new Date(a.updated_at).getTime();
      const dateB = new Date(b.updated_at).getTime();
      return dateB - dateA; // Descendente (más recientes primero)
    });

    console.log(`[API Conversations] Retornando ${enrichedConversations.length} conversaciones para usuario ${user.id}`);
    return NextResponse.json({ ok: true, data: enrichedConversations });
  } catch (e: any) {
    console.error("Error en get conversations:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
