// scripts/trazabilidad-usuario.mjs
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Cargar .env.local
dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
if (!serviceKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");

const supabase = createClient(url, serviceKey);

// Configuración
const TARGET_EMAIL = "autorizadosestudiohif@gmail.com";

// Función auxiliar para formatear tiempo
function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "N/A";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

// Función auxiliar para calcular diferencia en minutos
function minutesBetween(date1, date2) {
  if (!date1 || !date2) return null;
  return (new Date(date2) - new Date(date1)) / (1000 * 60);
}

async function main() {
  console.log("🔍 Iniciando análisis de trazabilidad...\n");

  // 1. Buscar usuario
  console.log(`📧 Buscando usuario: ${TARGET_EMAIL}`);
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  
  if (userError) {
    console.error("❌ Error al buscar usuarios:", userError);
    process.exit(1);
  }

  const targetUser = users.users.find(u => u.email === TARGET_EMAIL);
  
  if (!targetUser) {
    console.error(`❌ Usuario no encontrado: ${TARGET_EMAIL}`);
    process.exit(1);
  }

  console.log(`✅ Usuario encontrado: ${targetUser.id}`);
  console.log(`   Nombre: ${targetUser.user_metadata?.full_name || "N/A"}\n`);

  // Obtener perfil
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", targetUser.id)
    .single();

  const userName = profile?.full_name || targetUser.user_metadata?.full_name || TARGET_EMAIL;

  // 2. Obtener conversaciones de chat
  console.log("💬 Analizando conversaciones de chat...");
  const { data: conversations, error: convError } = await supabase
    .from("conversation_participants")
    .select(`
      conversation_id,
      last_read_at,
      conversations (
        id,
        type,
        created_at,
        updated_at
      )
    `)
    .eq("user_id", targetUser.id);

  if (convError) {
    console.error("❌ Error al obtener conversaciones:", convError);
  }

  const conversationIds = conversations?.map(c => c.conversation_id) || [];
  console.log(`   Encontradas ${conversationIds.length} conversaciones`);

  // 3. Obtener todos los mensajes de esas conversaciones
  let allMessages = [];
  if (conversationIds.length > 0) {
    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        created_at
      `)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("❌ Error al obtener mensajes:", msgError);
    } else {
      allMessages = messages || [];
      console.log(`   Encontrados ${allMessages.length} mensajes`);
    }
  }

  // 4. Obtener participantes de las conversaciones
  const participantMap = new Map();
  if (conversationIds.length > 0) {
    const { data: participants, error: partError } = await supabase
      .from("conversation_participants")
      .select(`
        conversation_id,
        user_id,
        profiles!inner (
          id,
          email,
          full_name
        )
      `)
      .in("conversation_id", conversationIds);

    if (!partError && participants) {
      for (const p of participants) {
        const convId = p.conversation_id;
        if (!participantMap.has(convId)) {
          participantMap.set(convId, []);
        }
        if (p.user_id !== targetUser.id && p.profiles) {
          participantMap.get(convId).push({
            id: p.user_id,
            email: p.profiles.email,
            name: p.profiles.full_name
          });
        }
      }
    }
  }

  // 5. Analizar mensajes de chat
  const chatAnalysis = {
    total_conversaciones: conversationIds.length,
    total_mensajes_enviados: 0,
    total_mensajes_recibidos: 0,
    conversaciones: [],
    mensajes_detalle: []
  };

  for (const convId of conversationIds) {
    const convMessages = allMessages.filter(m => m.conversation_id === convId);
    const sentMessages = convMessages.filter(m => m.sender_id === targetUser.id);
    const receivedMessages = convMessages.filter(m => m.sender_id !== targetUser.id);
    
    chatAnalysis.total_mensajes_enviados += sentMessages.length;
    chatAnalysis.total_mensajes_recibidos += receivedMessages.length;

    const otherParticipants = participantMap.get(convId) || [];
    
    // Calcular tiempos de respuesta
    const responseTimes = [];
    for (let i = 0; i < receivedMessages.length; i++) {
      const receivedMsg = receivedMessages[i];
      // Buscar siguiente mensaje enviado por el usuario
      const nextSent = sentMessages.find(m => 
        new Date(m.created_at) > new Date(receivedMsg.created_at)
      );
      
      if (nextSent) {
        const minutes = minutesBetween(receivedMsg.created_at, nextSent.created_at);
        responseTimes.push(minutes);
        
        chatAnalysis.mensajes_detalle.push({
          tipo: "RECIBIDO",
          conversation_id: convId,
          otro_participante: otherParticipants[0]?.email || "N/A",
          otro_participante_nombre: otherParticipants[0]?.name || "N/A",
          mensaje_preview: receivedMsg.content.substring(0, 100),
          fecha: receivedMsg.created_at,
          minutos_hasta_respuesta: minutes
        });
      } else {
        chatAnalysis.mensajes_detalle.push({
          tipo: "RECIBIDO",
          conversation_id: convId,
          otro_participante: otherParticipants[0]?.email || "N/A",
          otro_participante_nombre: otherParticipants[0]?.name || "N/A",
          mensaje_preview: receivedMsg.content.substring(0, 100),
          fecha: receivedMsg.created_at,
          minutos_hasta_respuesta: null
        });
      }
    }

    // Agregar mensajes enviados
    for (const sentMsg of sentMessages) {
      chatAnalysis.mensajes_detalle.push({
        tipo: "ENVIADO",
        conversation_id: convId,
        otro_participante: otherParticipants[0]?.email || "N/A",
        otro_participante_nombre: otherParticipants[0]?.name || "N/A",
        mensaje_preview: sentMsg.content.substring(0, 100),
        fecha: sentMsg.created_at,
        minutos_hasta_respuesta: null
      });
    }

    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    chatAnalysis.conversaciones.push({
      conversation_id: convId,
      participantes: otherParticipants.map(p => `${p.name} (${p.email})`),
      mensajes_enviados: sentMessages.length,
      mensajes_recibidos: receivedMessages.length,
      tiempo_promedio_respuesta_minutos: avgResponseTime
    });
  }

  // Ordenar mensajes por fecha
  chatAnalysis.mensajes_detalle.sort((a, b) => 
    new Date(b.fecha) - new Date(a.fecha)
  );

  // 6. Analizar notificaciones recibidas
  console.log("📬 Analizando notificaciones recibidas...");
  const { data: notificationsReceived, error: notifError } = await supabase
    .from("notifications")
    .select(`
      id,
      title,
      body,
      is_read,
      created_at,
      parent_id,
      thread_id,
      metadata
    `)
    .eq("user_id", targetUser.id)
    .order("created_at", { ascending: false });

  if (notifError) {
    console.error("❌ Error al obtener notificaciones:", notifError);
  }

  const notificationsAnalysis = {
    total_recibidas: notificationsReceived?.length || 0,
    total_leidas: notificationsReceived?.filter(n => n.is_read).length || 0,
    total_no_leidas: notificationsReceived?.filter(n => !n.is_read).length || 0,
    notificaciones: []
  };

  // Para cada notificación, buscar si hay respuesta
  for (const notif of notificationsReceived || []) {
    // Buscar respuestas (notificaciones con parent_id = esta notificación)
    const { data: replies } = await supabase
      .from("notifications")
      .select("id, created_at, body")
      .eq("parent_id", notif.id)
      .neq("user_id", targetUser.id)
      .order("created_at", { ascending: true })
      .limit(1);

    const reply = replies?.[0];
    const minutosHastaRespuesta = reply 
      ? minutesBetween(notif.created_at, reply.created_at)
      : null;

    // Obtener remitente desde metadata
    let remitenteEmail = null;
    if (notif.metadata && typeof notif.metadata === 'object') {
      const senderId = notif.metadata.sender_id;
      if (senderId) {
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("email, full_name")
          .eq("id", senderId)
          .single();
        remitenteEmail = senderProfile?.email || null;
      }
    }

    notificationsAnalysis.notificaciones.push({
      id: notif.id,
      title: notif.title,
      body_preview: notif.body?.substring(0, 100) || "",
      is_read: notif.is_read,
      fecha: notif.created_at,
      remitente_email: remitenteEmail,
      fue_respondida: !!reply,
      minutos_hasta_respuesta: minutosHastaRespuesta,
      fecha_respuesta: reply?.created_at || null
    });
  }

  // 7. Analizar notificaciones enviadas (menciones)
  console.log("📤 Analizando notificaciones enviadas (menciones)...");
  const { data: allNotifications, error: allNotifError } = await supabase
    .from("notifications")
    .select(`
      id,
      title,
      body,
      created_at,
      user_id,
      parent_id,
      metadata
    `)
    .order("created_at", { ascending: false });

  if (allNotifError) {
    console.error("❌ Error al obtener todas las notificaciones:", allNotifError);
  }

  const notificationsSent = [];
  for (const notif of allNotifications || []) {
    if (notif.metadata && typeof notif.metadata === 'object') {
      const senderId = notif.metadata.sender_id;
      if (senderId === targetUser.id) {
        // Esta es una notificación enviada por el usuario
        const { data: recipientProfile } = await supabase
          .from("profiles")
          .select("email, full_name")
          .eq("id", notif.user_id)
          .single();

        // Buscar si hubo respuesta
        const { data: replies } = await supabase
          .from("notifications")
          .select("id, created_at")
          .eq("parent_id", notif.id)
          .eq("user_id", notif.user_id)
          .order("created_at", { ascending: true })
          .limit(1);

        const reply = replies?.[0];
        const minutosHastaRespuesta = reply
          ? minutesBetween(notif.created_at, reply.created_at)
          : null;

        notificationsSent.push({
          id: notif.id,
          title: notif.title,
          body_preview: notif.body?.substring(0, 100) || "",
          fecha: notif.created_at,
          destinatario_email: recipientProfile?.email || "N/A",
          destinatario_nombre: recipientProfile?.full_name || "N/A",
          fue_respondida: !!reply,
          minutos_hasta_respuesta_del_destinatario: minutosHastaRespuesta
        });
      }
    }
  }

  notificationsSent.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  // 8. Generar reporte
  const report = {
    usuario: {
      id: targetUser.id,
      email: TARGET_EMAIL,
      nombre: userName
    },
    fecha_analisis: new Date().toISOString(),
    chat: chatAnalysis,
    notificaciones: {
      recibidas: notificationsAnalysis,
      enviadas: {
        total: notificationsSent.length,
        notificaciones: notificationsSent
      }
    }
  };

  // 9. Guardar reporte en archivo
  const reportPath = path.join(process.cwd(), `trazabilidad-${TARGET_EMAIL.replace('@', '_at_')}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  // 10. Mostrar resumen en consola
  console.log("\n" + "=".repeat(60));
  console.log("📊 REPORTE DE TRAZABILIDAD");
  console.log("=".repeat(60));
  console.log(`\n👤 Usuario: ${userName} (${TARGET_EMAIL})`);
  console.log(`\n💬 CHAT:`);
  console.log(`   - Conversaciones: ${chatAnalysis.total_conversaciones}`);
  console.log(`   - Mensajes enviados: ${chatAnalysis.total_mensajes_enviados}`);
  console.log(`   - Mensajes recibidos: ${chatAnalysis.total_mensajes_recibidos}`);
  
  const avgResponseChat = chatAnalysis.conversaciones
    .map(c => c.tiempo_promedio_respuesta_minutos)
    .filter(t => t !== null);
  if (avgResponseChat.length > 0) {
    const totalAvg = avgResponseChat.reduce((a, b) => a + b, 0) / avgResponseChat.length;
    console.log(`   - Tiempo promedio de respuesta: ${formatMinutes(totalAvg)}`);
  }

  console.log(`\n📬 NOTIFICACIONES:`);
  console.log(`   - Recibidas: ${notificationsAnalysis.total_recibidas}`);
  console.log(`   - Leídas: ${notificationsAnalysis.total_leidas}`);
  console.log(`   - No leídas: ${notificationsAnalysis.total_no_leidas}`);
  
  const respondedNotifications = notificationsAnalysis.notificaciones.filter(n => n.fue_respondida);
  const avgResponseNotif = respondedNotifications
    .map(n => n.minutos_hasta_respuesta)
    .filter(t => t !== null);
  if (avgResponseNotif.length > 0) {
    const totalAvg = avgResponseNotif.reduce((a, b) => a + b, 0) / avgResponseNotif.length;
    console.log(`   - Tiempo promedio de respuesta: ${formatMinutes(totalAvg)}`);
  }

  console.log(`   - Enviadas (menciones): ${notificationsSent.length}`);
  const respondedSent = notificationsSent.filter(n => n.fue_respondida);
  const avgResponseSent = respondedSent
    .map(n => n.minutos_hasta_respuesta_del_destinatario)
    .filter(t => t !== null);
  if (avgResponseSent.length > 0) {
    const totalAvg = avgResponseSent.reduce((a, b) => a + b, 0) / avgResponseSent.length;
    console.log(`   - Tiempo promedio de respuesta del destinatario: ${formatMinutes(totalAvg)}`);
  }

  console.log(`\n💾 Reporte completo guardado en: ${reportPath}`);
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("❌ ERROR:", e);
  process.exit(1);
});