"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import NotificationBell from "@/app/components/NotificationBell";

type Notif = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
  thread_id?: string | null;
  parent_id?: string | null;
  expediente_id?: string | null;
  is_pjn_favorito?: boolean;
  nota_context?: string | null;
  user_id?: string; // ID del usuario que recibe la notificación
  metadata?: {
    caratula?: string | null;
    juzgado?: string | null;
    numero?: string | null;
    expediente_id?: string;
    is_pjn_favorito?: boolean;
    cedula_id?: string;
    sender_id?: string;
    transfer_id?: string;
    orden_id?: string;
    expediente_ref?: string;
    doc_type?: "CEDULA" | "OFICIO" | "OTROS_ESCRITOS";
    title?: string | null;
  } | null;
};

type FilterType = "all" | "unread" | "read";

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function isUuidLike(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parsePjnCaseKey(raw: string | null | undefined): { jurisdiccion: string; numero: string; anio: number } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^([A-Z]{2,6})\s+0*([0-9]+)\/([0-9]{4})$/i);
  if (!match) return null;
  return {
    jurisdiccion: match[1].toUpperCase(),
    numero: String(Number(match[2])),
    anio: Number(match[3]),
  };
}

function stripLeadingZeros(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/^0+/, "") || "0";
}

function parseMetadataSafe(rawMetadata: unknown) {
  let metadata = rawMetadata;
  // Doble-parse: si después del primer parse sigue siendo string, parsear de nuevo.
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch {}
  }
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch {}
  }
  if (metadata && typeof metadata === "object") return metadata as Record<string, any>;
  return {};
}

export default function NotificacionesPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Notif[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [backUrl, setBackUrl] = useState<string>("/app");
  const [selectedNotif, setSelectedNotif] = useState<Notif | null>(null);
  const [replyText, setReplyText] = useState<string>("");
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [replying, setReplying] = useState(false);
  const [ordenPdfUrl, setOrdenPdfUrl] = useState<string | null>(null);
  const [expedienteInfo, setExpedienteInfo] = useState<{
    caratula?: string | null;
    juzgado?: string | null;
    numero?: string | null;
  } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string; suggestion?: string } | null>(null);
  const [threadMessages, setThreadMessages] = useState<Notif[]>([]);
  const [threadUserNames, setThreadUserNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        window.location.href = "/login";
        return;
      }
      setCurrentUserId(uid);

      // Obtener nombre del usuario
      if (sess.session) {
        const sessionFullName = (sess.session.user.user_metadata as any)?.full_name as string | undefined;
        const sessionEmail = (sess.session.user.email || "").trim();
        const baseName = (sessionFullName || "").trim() || sessionEmail;
        setCurrentUserName(baseName);
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", uid)
        .maybeSingle();

      if (profile) {
        const profileName = profile.full_name?.trim() || profile.email?.trim() || "";
        if (profileName) {
          setCurrentUserName(profileName);
        }
      }

      // Detectar rol del usuario para determinar la URL de retorno
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado, is_admin_mediaciones")
        .eq("user_id", uid)
        .maybeSingle();

      if (roleData) {
        const isSuperadmin = roleData.is_superadmin === true;
        const isAbogado = roleData.is_abogado === true;
        const isAdminCedulas = roleData.is_admin_cedulas === true;
        const isAdminExp = roleData.is_admin_expedientes === true;

        // Prioridad: Abogado y Superadmin van a /superadmin (que es la vista de abogados)
        if (isAbogado || isSuperadmin) {
          setBackUrl("/superadmin");
        } else if (isAdminCedulas || isAdminExp) {
          // Admins van a /app (mis cédulas/oficios)
          setBackUrl("/app");
        } else {
          // Por defecto
          setBackUrl("/app");
        }
      }

      const load = async () => {
        const { data } = await supabase
          .from("notifications")
          .select("id, title, body, link, is_read, created_at, thread_id, parent_id, expediente_id, is_pjn_favorito, nota_context, metadata")
          .eq("user_id", uid)
          .order("created_at", { ascending: false });
        if (mounted) {
          // Parsear metadata si viene como string JSON
          const parsedData = (data ?? []).map((item: any) => {
            const parsedMetadata = parseMetadataSafe(item.metadata);
            console.log("[Notificaciones] Item parseado:", {
              id: item.id,
              title: item.title,
              metadata: parsedMetadata,
              metadataType: typeof parsedMetadata,
              nota_context: item.nota_context,
              nota_context_length: item.nota_context?.length || 0
            });
            return {
              ...item,
              metadata: parsedMetadata || {},
              nota_context: item.nota_context || null // Asegurar que nota_context se preserve
            };
          });
          setItems(parsedData as Notif[]);
        }
      };

      await load();
      setLoading(false);

      // Realtime: suscripción a cambios
      channel = supabase
        .channel("notif-inbox")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => load()
        )
        .subscribe();
    })();

    return () => {
      mounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => !n.is_read);
    return items.filter((n) => n.is_read);
  }, [items, filter]);

  const unreadCount = items.filter((n) => !n.is_read).length;
  const selectedMeta = (() => {
    if (!selectedNotif?.metadata) return {};
    return parseMetadataSafe(selectedNotif.metadata);
  })();
  const isAutoPericia = (selectedMeta as any).source === "auto_pericia";

  async function markRead(id: string) {
    if (processingIds.has(id)) return;
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      await supabase.rpc("mark_notification_read", { p_id: id });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (err) {
      console.error("Error al marcar como leída:", err);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function markUnread(id: string) {
    if (processingIds.has(id)) return;
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: false })
        .eq("id", id);
      if (!error) {
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)));
      }
    } catch (err) {
      console.error("Error al marcar como no leída:", err);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function deleteNotification(id: string) {
    if (processingIds.has(id)) return;
    if (!confirm("¿Eliminar esta notificación?")) return;
    
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);
      if (!error) {
        setItems((prev) => prev.filter((n) => n.id !== id));
      }
    } catch (err) {
      console.error("Error al eliminar:", err);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setProcessingIds((prev) => new Set([...prev, ...unreadIds]));
    try {
      for (const id of unreadIds) {
        await supabase.rpc("mark_notification_read", { p_id: id });
      }
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error("Error al marcar todas como leídas:", err);
    } finally {
      setProcessingIds(new Set());
    }
  }

  async function deleteAllRead() {
    const readIds = items.filter((n) => n.is_read).map((n) => n.id);
    if (readIds.length === 0) return;
    if (!confirm(`¿Eliminar ${readIds.length} notificación(es) leída(s)?`)) return;

    setProcessingIds((prev) => new Set([...prev, ...readIds]));
    try {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .in("id", readIds);
      if (!error) {
        setItems((prev) => prev.filter((n) => !n.is_read));
      }
    } catch (err) {
      console.error("Error al eliminar leídas:", err);
    } finally {
      setProcessingIds(new Set());
    }
  }

  async function handleNotificationClick(notif: Notif) {
    if (!notif.is_read) {
      await markRead(notif.id);
    }
    setSelectedNotif(notif);
    setReplyText("");
    setReplyFile(null);
    setExpedienteInfo(null);
    setOrdenPdfUrl(null);
    // Resolución por case_ref para notificaciones automáticas de pericia
    const meta = parseMetadataSafe(notif.metadata);
    let expedienteInfoResolvedByCaseRef = false;
    
    if (meta.case_ref) {
      const parts = String(meta.case_ref).split("/");
      if (parts.length === 2) {
        const [numero, anio] = parts;
        try {
          const { data: favData } = await supabase
            .from("pjn_favoritos")
            .select("caratula, juzgado, numero, anio")
            .eq("numero", numero.trim())
            .eq("anio", anio.trim())
            .limit(1)
            .maybeSingle();
          
          if (favData) {
            setExpedienteInfo({
              caratula: favData.caratula || null,
              juzgado: favData.juzgado || null,
              numero: `${favData.numero}/${favData.anio}`,
            });
            expedienteInfoResolvedByCaseRef = true;
            // Si resolvió por case_ref, no necesita los demás fallbacks para expedienteInfo
            // pero sigue con la carga del hilo de mensajes normalmente
          }
        } catch (err) {
          console.warn("Error buscando pjn_favorito por case_ref:", err);
        }
      }
    }
    if ((meta as any).source === "auto_pericia" && (meta as any).orden_id) {
      try {
        const { data: orden } = await supabase
          .from("ordenes_medicas")
          .select("storage_path")
          .eq("id", (meta as any).orden_id)
          .maybeSingle();

        if (orden?.storage_path) {
          const { data: signedUrlData } = await supabase.storage
            .from("ordenes-medicas")
            .createSignedUrl(orden.storage_path, 3600);
          setOrdenPdfUrl(signedUrlData?.signedUrl || null);
        } else {
          setOrdenPdfUrl(null);
        }
      } catch (err) {
        console.warn("Error obteniendo PDF de orden:", err);
        setOrdenPdfUrl(null);
      }
    }
    // Usar un mensaje del hilo con mejor contexto de expediente/cédula si el seleccionado no lo trae.
    let contextNotif: Notif = notif;
    let resolutionThreadData: Notif[] = [notif];

    // Cargar todas las notificaciones del hilo (thread_id) para mostrar el historial completo
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    
    if (uid && notif.thread_id) {
      // Cargar todas las notificaciones del mismo thread_id (incluyendo las que el usuario envió)
      const { data: threadData } = await supabase
        .from("notifications")
        .select("id, title, body, link, is_read, created_at, thread_id, parent_id, expediente_id, is_pjn_favorito, nota_context, metadata, user_id")
        .eq("thread_id", notif.thread_id)
        .order("created_at", { ascending: true });
      
        if (threadData) {
        // Parsear metadata para cada mensaje del hilo
        const parsedThreadData = threadData.map((item: any) => {
          const parsedMetadata = parseMetadataSafe(item.metadata);
          return {
            ...item,
            metadata: parsedMetadata || {},
            nota_context: item.nota_context || null
          };
        });
        setThreadMessages(parsedThreadData as Notif[]);
        resolutionThreadData = parsedThreadData as Notif[];
        // Fallback fuerte: tomar datos de expediente desde cualquier metadata del hilo.
        const threadInfoCandidate = parsedThreadData.find((item: any) => {
          const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
          return Boolean(meta?.caratula || meta?.juzgado || meta?.numero);
        });
        if (threadInfoCandidate) {
          const threadMeta = (threadInfoCandidate.metadata || {}) as any;
          setExpedienteInfo({
            caratula: threadMeta.caratula || null,
            juzgado: threadMeta.juzgado || null,
            numero: threadMeta.numero || null,
          });
        }
        const notifWithContext = parsedThreadData.find((item: any) => {
          const meta = (item?.metadata && typeof item.metadata === "object") ? item.metadata : {};
          return Boolean(
            item?.expediente_id ||
            item?.link ||
            meta?.cedula_id ||
            meta?.caratula ||
            meta?.juzgado ||
            meta?.numero
          );
        });
        if (notifWithContext) {
          contextNotif = notifWithContext as Notif;
        }
        
        // Cargar nombres de usuario únicos del hilo usando sender_id de metadata
        const uniqueSenderIds = [
          ...new Set(
            parsedThreadData
              .map((t: any) => {
                const meta = t.metadata || {};
                const senderId =
                  typeof meta === "object" && meta
                    ? (meta as any).sender_id
                    : null;
                // Fallback a user_id para notificaciones antiguas sin sender_id
                return senderId || t.user_id;
              })
              .filter(Boolean)
          ),
        ];

        const namesMap: Record<string, string> = {};
        for (const senderId of uniqueSenderIds) {
          if (senderId === uid) {
            namesMap[senderId] = currentUserName || "Tú";
          } else {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name, email")
              .eq("id", senderId)
              .maybeSingle();
            namesMap[senderId] = profile?.full_name || profile?.email || "Usuario";
          }
        }
        setThreadUserNames(namesMap);
      } else {
        setThreadMessages([notif]);
        resolutionThreadData = [notif];
        setThreadUserNames({ [uid || ""]: currentUserName || "Tú" });
      }
    } else {
      // Si no hay thread_id, mostrar solo esta notificación
      setThreadMessages([notif]);
      resolutionThreadData = [notif];
      if (uid) {
        setThreadUserNames({ [uid]: currentUserName || "Tú" });
      }
    }

    if (expedienteInfoResolvedByCaseRef) {
      return;
    }

    // Fuente principal robusta: resolver contexto en backend con acceso consolidado.
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch("/api/notifications/context", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            notification_id: notif.id,
            thread_id: notif.thread_id || null,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.data) {
          setExpedienteInfo({
            caratula: json.data.caratula || null,
            juzgado: json.data.juzgado || null,
            numero: json.data.numero || null,
          });
          return;
        }
      }
    } catch (err) {
      console.error("Error resolviendo contexto de notificacion:", err);
    }

    // Intentar obtener información del expediente de varias formas
    let expedienteId = contextNotif.expediente_id;
    let isPjn = contextNotif.is_pjn_favorito;

    // Si no hay expediente_id, intentar extraerlo del link o body
    if (!expedienteId && contextNotif.link) {
      // El link puede tener formato:
      // - /superadmin/mis-juzgados#pjn_123 (PJN favorito)
      // - /superadmin/mis-juzgados#123 (expediente)
      // - /app#cedula_id (cédula/oficio)
      if (contextNotif.link.startsWith("/app#")) {
        // Es una cédula
        const hashMatch = contextNotif.link.match(/#([a-f0-9-]+)$/i);
        if (hashMatch) {
          expedienteId = hashMatch[1];
          isPjn = false;
        }
      } else if (contextNotif.link.startsWith("/prueba-pericia#")) {
        const hashMatch = contextNotif.link.match(/#(pjn_)?(.+)$/i);
        if (hashMatch) {
          expedienteId = hashMatch[1] ? `pjn_${hashMatch[2]}` : hashMatch[2];
          isPjn = !!hashMatch[1];
        }
      } else {
        // Es un expediente o PJN favorito
        const hashMatch = contextNotif.link.match(/#(pjn_)?([a-f0-9-]+)$/i);
        if (hashMatch) {
          expedienteId = hashMatch[1] ? hashMatch[0].substring(1) : hashMatch[2];
          isPjn = !!hashMatch[1];
        }
      }
    }

    // Si aún no hay expediente_id, intentar extraer del body (buscar carátula mencionada)
    if (!expedienteId && contextNotif.body) {
      // Buscar tanto en expedientes como en cédulas
      const caratulaMatch = contextNotif.body.match(/(?:expediente|cedula|oficio)\s+"([^"]+)"/i);
      if (caratulaMatch) {
        const caratulaBuscada = caratulaMatch[1];
        // Primero intentar buscar en cédulas (si el body menciona "cédula/oficio")
        if (contextNotif.body.toLowerCase().includes("cédula") || contextNotif.body.toLowerCase().includes("oficio")) {
          try {
            const { data: cedula } = await supabase
              .from("cedulas")
              .select("id, caratula, juzgado")
              .ilike("caratula", `%${caratulaBuscada}%`)
              .limit(1)
              .single();
            
            if (cedula) {
              expedienteId = cedula.id;
              isPjn = false;
              setExpedienteInfo({
                caratula: cedula.caratula,
                juzgado: cedula.juzgado,
                numero: null,
              });
              return; // Ya tenemos la info
            }
          } catch (err) {
            // Continuar con otros métodos
          }
        }
        
        // Si no es cédula, buscar en expedientes
        try {
          const { data: exp } = await supabase
            .from("expedientes")
            .select("id, caratula, juzgado, numero_expediente")
            .ilike("caratula", `%${caratulaBuscada}%`)
            .limit(1)
            .single();
          
          if (exp) {
            expedienteId = exp.id;
            isPjn = false;
            setExpedienteInfo({
              caratula: exp.caratula,
              juzgado: exp.juzgado,
              numero: exp.numero_expediente,
            });
            return; // Ya tenemos la info, no necesitamos buscar más
          }
        } catch (err) {
          // Continuar con otros métodos
        }
      }
    }

    // Verificar si es una cédula usando metadata PRIMERO (antes de buscar en expedientes)
    const metadata = contextNotif.metadata || {};
    if (!expedienteId && metadata.expediente_ref) {
      expedienteId = metadata.expediente_ref;
    }
    if (metadata.is_pjn_favorito !== undefined) {
      isPjn = !!metadata.is_pjn_favorito;
    }
    const isCedula = metadata.cedula_id || (contextNotif.link && contextNotif.link.startsWith("/app#"));

    // Notificaciones con link a órdenes médicas (legacy): /prueba-pericia?tab=ordenes&orden_id=...
    const ordenIdFromLinkMatch = contextNotif.link?.match(/[?&]orden_id=([^&#]+)/i);
    const ordenIdFromLink = ordenIdFromLinkMatch?.[1] || metadata.orden_id;
    if (ordenIdFromLink) {
      try {
        const { data: orden } = await supabase
          .from("ordenes_medicas")
          .select(`
            case_ref,
            expediente_id,
            expedientes:expediente_id (
              caratula,
              juzgado,
              numero_expediente
            )
          `)
          .eq("id", ordenIdFromLink)
          .maybeSingle();

        if (orden) {
          const expRel = (orden as any).expedientes;
          if (expRel) {
            setExpedienteInfo({
              caratula: expRel.caratula || orden.case_ref || null,
              juzgado: expRel.juzgado || null,
              numero: expRel.numero_expediente || orden.case_ref || null,
            });
            return;
          }
          if (orden.case_ref) {
            setExpedienteInfo({
              caratula: orden.case_ref,
              juzgado: null,
              numero: orden.case_ref,
            });
            return;
          }
        }
      } catch (err) {
        console.error("Error al resolver expediente desde orden_id del link:", err);
      }
    }

    // Notificaciones de órdenes médicas: resolver expediente desde orden_id
    if (metadata.orden_id && !metadata.caratula && !metadata.juzgado) {
      try {
        const { data: orden } = await supabase
          .from("ordenes_medicas")
          .select(`
            case_ref,
            expediente_id,
            expedientes:expediente_id (
              caratula,
              juzgado,
              numero_expediente
            )
          `)
          .eq("id", metadata.orden_id)
          .maybeSingle();

        if (orden) {
          const expRel = (orden as any).expedientes;
          if (expRel) {
            setExpedienteInfo({
              caratula: expRel.caratula || orden.case_ref || null,
              juzgado: expRel.juzgado || null,
              numero: expRel.numero_expediente || orden.case_ref || null,
            });
            return;
          }
          if (orden.case_ref) {
            setExpedienteInfo({
              caratula: orden.case_ref,
              juzgado: null,
              numero: orden.case_ref,
            });
            return;
          }
        }
      } catch (err) {
        console.error("Error al obtener datos de orden médica:", err);
      }
    }
    
    // Si tenemos expediente_id, obtener la información
    if (expedienteId) {
      try {
        if (isPjn) {
          const pjnRef = expedienteId.replace(/^pjn_/, "");
          let pjnFav: any = null;
          if (isUuidLike(pjnRef)) {
            const { data } = await supabase
              .from("pjn_favoritos")
              .select("caratula, juzgado, numero")
              .eq("id", pjnRef)
              .maybeSingle();
            pjnFav = data;
          } else {
            const parsed = parsePjnCaseKey(pjnRef);
            if (parsed) {
              // Intento 1: número sin ceros (normalizado)
              let { data } = await supabase
                .from("pjn_favoritos")
                .select("caratula, juzgado, numero")
                .eq("jurisdiccion", parsed.jurisdiccion)
                .eq("anio", parsed.anio)
                .eq("numero", parsed.numero)
                .maybeSingle();
              // Intento 2: número con padding a 6 (dataset histórico)
              if (!data) {
                const padded = parsed.numero.padStart(6, "0");
                const retry = await supabase
                  .from("pjn_favoritos")
                  .select("caratula, juzgado, numero")
                  .eq("jurisdiccion", parsed.jurisdiccion)
                  .eq("anio", parsed.anio)
                  .eq("numero", padded)
                  .maybeSingle();
                data = retry.data;
              }
              pjnFav = data;
            }
          }
          
          if (pjnFav) {
            setExpedienteInfo({
              caratula: pjnFav.caratula,
              juzgado: pjnFav.juzgado,
              numero: pjnFav.numero,
            });
            return; // Ya tenemos la info
          }
        } else if (isCedula || metadata.cedula_id) {
          // Es una cédula/oficio, buscar en la tabla cedulas
          const cedulaId = metadata.cedula_id || expedienteId;
          const { data: cedula } = await supabase
            .from("cedulas")
            .select("caratula, juzgado")
            .eq("id", cedulaId)
            .single();
          
          if (cedula) {
            setExpedienteInfo({
              caratula: cedula.caratula,
              juzgado: cedula.juzgado,
              numero: null, // Las cédulas no tienen número de expediente
            });
            return; // Ya tenemos la info
          }
        } else {
          // Es un expediente local - SOLO buscar aquí si NO es cédula
          let exp: any = null;
          if (isUuidLike(expedienteId)) {
            const { data } = await supabase
              .from("expedientes")
              .select("caratula, juzgado, numero_expediente")
              .eq("id", expedienteId)
              .maybeSingle();
            exp = data;
          } else {
            const numeroSinCeros = stripLeadingZeros(expedienteId);
            let { data } = await supabase
              .from("expedientes")
              .select("caratula, juzgado, numero_expediente")
              .eq("numero_expediente", expedienteId)
              .maybeSingle();
            if (!data && numeroSinCeros !== expedienteId) {
              const retry = await supabase
                .from("expedientes")
                .select("caratula, juzgado, numero_expediente")
                .eq("numero_expediente", numeroSinCeros)
                .maybeSingle();
              data = retry.data;
            }
            exp = data;
          }
          
          if (exp) {
            setExpedienteInfo({
              caratula: exp.caratula,
              juzgado: exp.juzgado,
              numero: exp.numero_expediente,
            });
            return; // Ya tenemos la info
          }
        }
      } catch (err) {
        console.error("Error al obtener información del expediente/cédula:", err);
        // Si falla la búsqueda, intentar usar metadata como fallback
        if (metadata.caratula || metadata.juzgado) {
          setExpedienteInfo({
            caratula: metadata.caratula || null,
            juzgado: metadata.juzgado || null,
            numero: metadata.numero || null,
          });
        }
      }
    } else if (metadata.caratula || metadata.juzgado) {
      // Si no hay expediente_id pero hay metadata, usar la metadata directamente
      setExpedienteInfo({
        caratula: metadata.caratula || null,
        juzgado: metadata.juzgado || null,
        numero: metadata.numero || null,
      });
      return;
    }

    // Último fallback: inferir número de expediente y resolver contra BD.
    const bodyText = contextNotif.body || "";
    const titleText = contextNotif.title || "";
    const combinedText = resolutionThreadData
      .map((msg) => `${msg.title || ""}\n${msg.body || ""}\n${msg.nota_context || ""}`)
      .join("\n")
      .trim() || `${titleText}\n${bodyText}`;
    const numeroMatch = combinedText.match(/\b(\d{1,7})\s*\/\s*(\d{4})\b/);
    if (numeroMatch) {
      const numeroRaw = numeroMatch[1];
      const anio = numeroMatch[2];
      const numeroNormalizado = `${stripLeadingZeros(numeroRaw)}/${anio}`;
      const numeroConCeros = `${numeroRaw.padStart(6, "0")}/${anio}`;
      try {
        let { data: exp } = await supabase
          .from("expedientes")
          .select("caratula, juzgado, numero_expediente")
          .ilike("numero_expediente", `%${numeroNormalizado}%`)
          .limit(1)
          .maybeSingle();

        if (!exp) {
          const retry = await supabase
            .from("expedientes")
            .select("caratula, juzgado, numero_expediente")
            .ilike("numero_expediente", `%${numeroConCeros}%`)
            .limit(1)
            .maybeSingle();
          exp = retry.data;
        }

        if (exp) {
          setExpedienteInfo({
            caratula: exp.caratula,
            juzgado: exp.juzgado,
            numero: exp.numero_expediente,
          });
          return;
        }
      } catch (err) {
        console.error("Error al buscar expediente por número inferido:", err);
      }
    }

    // Fallback textual controlado: solo si el body trae carátula explícita.
    const quotedCase =
      combinedText.match(/(?:expediente|cedula|cédula|oficio)\s+"([^"]+)"/i)?.[1] ||
      combinedText.match(/(?:del|de la)\s+(?:expediente|oficio|cédula|cedula)\s+([^.,\n]+)/i)?.[1] ||
      null;
    const inferredCaratula = quotedCase;

    if (inferredCaratula) {
      setExpedienteInfo({
        caratula: inferredCaratula,
        juzgado: metadata.juzgado || null,
        numero: metadata.numero || null,
      });
    }
  }

  async function handleReply() {
    if (!selectedNotif || !replyText.trim()) return;
    
    setReplying(true);
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (!session.session) {
        console.error("No hay sesión activa:", sessionError);
        setToast({
          type: "error",
          message: "No hay sesión activa. Por favor, recarga la página."
        });
        setReplying(false);
        return;
      }

      // Verificar si el token está expirado y refrescarlo si es necesario
      const now = Math.floor(Date.now() / 1000);
      if (session.session.expires_at && session.session.expires_at < now + 60) {
        // El token expira en menos de 1 minuto, refrescarlo
        const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshedSession.session) {
          console.error("Error al refrescar sesión:", refreshError);
          setToast({
            type: "error",
            message: "Error de autenticación. Por favor, recarga la página."
          });
          setReplying(false);
          return;
        }
        session.session = refreshedSession.session;
      }

      const messageTrimmed = replyText.trim();
      const token = session.session.access_token;
      const MAX_DOCX_BYTES = 10 * 1024 * 1024; // 10MB

      let res: Response;

      // Si hay un archivo adjunto: evitar multipart hacia Vercel.
      // En su lugar, hacemos:
      // 1) init_transfer (crea la transferencia y devuelve storage_path)
      // 2) upload directo a Supabase Storage desde el browser
      // 3) commit_reply (crea versión + notificaciones, sin recibir el archivo)
      if (replyFile) {
        const name = (replyFile.name || "").toLowerCase();
        if (!name.endsWith(".docx")) {
          setToast({ type: "error", message: "Solo se permite .docx como archivo adjunto" });
          setReplying(false);
          return;
        }
        if (replyFile.size > MAX_DOCX_BYTES) {
          setToast({ type: "error", message: "El archivo .docx excede el límite de 10MB" });
          setReplying(false);
          return;
        }

        const initRes = await fetch("/api/notifications/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            phase: "init_transfer",
            parent_notification_id: selectedNotif.id,
            message: messageTrimmed,
            expediente_id: selectedNotif.expediente_id,
            is_pjn_favorito: selectedNotif.is_pjn_favorito,
            has_file: true,
          }),
        });

        const initJson = await initRes.json().catch(() => ({}));
        if (!initRes.ok) {
          setToast({
            type: "error",
            message: initJson?.error || `Error ${initRes.status}: ${initRes.statusText}`,
            suggestion: initJson?.suggestion || "",
          });
          setReplying(false);
          return;
        }

        let transfer: { transferId: string; version: number; storage_path: string } | undefined;
        if (initJson?.transferNeeded) {
          if (!initJson?.storage_path || !initJson?.transferId) {
            setToast({ type: "error", message: "Respuesta inválida al inicializar transferencia" });
            setReplying(false);
            return;
          }

          const { error: uploadErr } = await supabase.storage
            .from("transfers")
            .upload(initJson.storage_path, replyFile, {
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              upsert: true,
            });

          if (uploadErr) {
            setToast({
              type: "error",
              message: uploadErr.message || "No se pudo subir el archivo adjunto",
            });
            setReplying(false);
            return;
          }

          transfer = {
            transferId: initJson.transferId,
            version: initJson.version || 1,
            storage_path: initJson.storage_path,
          };
        }

        res = await fetch("/api/notifications/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            phase: "commit_reply",
            parent_notification_id: selectedNotif.id,
            message: messageTrimmed,
            expediente_id: selectedNotif.expediente_id,
            is_pjn_favorito: selectedNotif.is_pjn_favorito,
            has_file: true,
            ...(transfer ? { transfer } : {}),
          }),
        });
      } else {
        res = await fetch("/api/notifications/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            parent_notification_id: selectedNotif.id,
            message: messageTrimmed,
            expediente_id: selectedNotif.expediente_id,
            is_pjn_favorito: selectedNotif.is_pjn_favorito,
          }),
        });
      }

        if (res.ok) {
          const result = await res.json();
          const messageText = messageTrimmed;
          setReplyText("");
          
          // Mostrar mensaje de éxito
          if (result.ok) {
            setToast({
              type: "success",
              message: replyFile 
                ? "Respuesta y archivo enviados correctamente. El remitente original recibirá una notificación."
                : "Respuesta enviada correctamente. El remitente original recibirá una notificación."
            });
            // Auto-ocultar después de 4 segundos
            setTimeout(() => setToast(null), 4000);
            setReplyFile(null); // Limpiar el archivo después de enviar
          }
          
          // Agregar la respuesta del usuario al hilo inmediatamente (antes de recargar)
          // Esto permite que el usuario vea su respuesta de inmediato
          if (selectedNotif && selectedNotif.thread_id && currentUserId) {
            const myReply: Notif = {
              id: `temp-${Date.now()}`,
              title: `Re: ${selectedNotif.title}`,
              body: replyFile 
                ? `${currentUserName} respondió con archivo adjunto: ${messageText}`
                : `${currentUserName} respondió: ${messageText}`,
              link: selectedNotif.link,
              is_read: true,
              created_at: new Date().toISOString(),
              thread_id: selectedNotif.thread_id,
              parent_id: selectedNotif.id,
              expediente_id: selectedNotif.expediente_id,
              is_pjn_favorito: selectedNotif.is_pjn_favorito,
              nota_context: messageText,
              metadata: selectedNotif.metadata || {},
            };
            setThreadMessages(prev => [...prev, myReply]);
            // Actualizar nombres si es necesario
            if (!threadUserNames[currentUserId]) {
              setThreadUserNames(prev => ({
                ...prev,
                [currentUserId]: currentUserName || "Tú"
              }));
            }
          }
          
          // Recargar notificaciones
          const { data: sess } = await supabase.auth.getSession();
          const uid = sess.session?.user.id;
          if (uid) {
            const { data } = await supabase
              .from("notifications")
              .select("id, title, body, link, is_read, created_at, thread_id, parent_id, expediente_id, is_pjn_favorito, nota_context, metadata")
              .eq("user_id", uid)
              .order("created_at", { ascending: false });
            if (data) {
              // Parsear metadata si viene como string JSON
              const parsedData = data.map((item: any) => {
                const parsedMetadata = parseMetadataSafe(item.metadata);
                console.log("[Notificaciones] Item recargado después de responder:", {
                  id: item.id,
                  title: item.title,
                  nota_context: item.nota_context,
                  nota_context_length: item.nota_context?.length || 0
                });
                return {
                  ...item,
                  metadata: parsedMetadata || {},
                  nota_context: item.nota_context || null // Asegurar que nota_context se preserve
                };
              });
              setItems(parsedData as Notif[]);
            }
            
            // Si hay una notificación seleccionada con thread_id, recargar el hilo completo
            // Esto reemplazará el mensaje temporal con el real de la base de datos
            if (selectedNotif && selectedNotif.thread_id) {
              // Esperar un momento para que la base de datos se actualice
              setTimeout(async () => {
                const { data: threadData } = await supabase
                  .from("notifications")
                  .select("id, title, body, link, is_read, created_at, thread_id, parent_id, expediente_id, is_pjn_favorito, nota_context, metadata, user_id")
                  .eq("thread_id", selectedNotif.thread_id)
                  .order("created_at", { ascending: true });
                
                if (threadData) {
                  const parsedThreadData = threadData.map((item: any) => {
                    const parsedMetadata = parseMetadataSafe(item.metadata);
                    return {
                      ...item,
                      metadata: parsedMetadata || {},
                      nota_context: item.nota_context || null
                    };
                  });
                  setThreadMessages(parsedThreadData as Notif[]);
                  
                  // Recargar nombres de usuario del hilo
                  const uniqueUserIds = [...new Set(threadData.map((t: any) => t.user_id))];
                  const namesMap: Record<string, string> = {};
                  for (const userId of uniqueUserIds) {
                    if (userId === uid) {
                      namesMap[userId] = currentUserName || "Tú";
                    } else {
                      const { data: profile } = await supabase
                        .from("profiles")
                        .select("full_name, email")
                        .eq("id", userId)
                        .maybeSingle();
                      namesMap[userId] = profile?.full_name || profile?.email || "Usuario";
                    }
                  }
                  setThreadUserNames(namesMap);
                }
              }, 1000); // Esperar 1 segundo para que la BD se actualice
            }
          }
          // No cerrar la vista, mantenerla abierta para ver la respuesta
          // setSelectedNotif(null);
        } else {
          let errorMsg = "Error desconocido";
          let suggestion = "";
          
          if (res.status === 401) {
            errorMsg = "Error de autenticación. Por favor, recarga la página e intenta nuevamente.";
            suggestion = "Si el problema persiste, cierra sesión y vuelve a iniciar sesión.";
          } else {
            try {
              const error = await res.json();
              errorMsg = error.error || `Error ${res.status}: ${res.statusText}`;
              suggestion = error.suggestion || "";
            } catch (e) {
              errorMsg = `Error ${res.status}: ${res.statusText}`;
            }
          }
          
          setToast({
            type: "error",
            message: errorMsg,
            suggestion: suggestion
          });
          // Auto-ocultar después de 6 segundos para errores
          setTimeout(() => setToast(null), 6000);
        }
    } catch (err) {
      console.error("Error al responder:", err);
      setToast({
        type: "error",
        message: "Error al enviar la respuesta. Por favor, intenta nuevamente."
      });
      setTimeout(() => setToast(null), 6000);
    } finally {
      setReplying(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Cargando…</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 10000,
            minWidth: 320,
            maxWidth: 500,
            padding: "16px 20px",
            background: toast.type === "success" 
              ? "linear-gradient(135deg, rgba(0,169,82,.95) 0%, rgba(0,169,82,.85) 100%)"
              : "linear-gradient(135deg, rgba(225,57,64,.95) 0%, rgba(225,57,64,.85) 100%)",
            border: `1px solid ${toast.type === "success" ? "rgba(0,169,82,.5)" : "rgba(225,57,64,.5)"}`,
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.1)",
            color: "var(--text)",
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.5,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            animation: "slideInRight 0.3s ease-out",
            cursor: "pointer",
          }}
          onClick={() => setToast(null)}
        >
          <div style={{
            fontSize: 20,
            flexShrink: 0,
            marginTop: 2,
          }}>
            {toast.type === "success" ? "✅" : "❌"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: toast.suggestion ? 8 : 0 }}>
              {toast.message}
            </div>
            {toast.suggestion && (
              <div style={{
                fontSize: 12,
                opacity: 0.9,
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,.2)",
              }}>
                💡 {toast.suggestion}
              </div>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setToast(null);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text)",
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              flexShrink: 0,
              opacity: 0.7,
              transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
            onMouseLeave={(e) => e.currentTarget.style.opacity = "0.7"}
          >
            ×
          </button>
        </div>
      )}
      <section className="card">
        <header className="nav">
          <img className="logoMini" src="/logo.png" alt="Logo" />
          <h1>Bandeja de Notificaciones</h1>
          <div className="spacer" />
          {currentUserName && (
            <div
              title={currentUserName}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                background: "rgba(96,141,186,.15)",
                border: "1px solid rgba(96,141,186,.35)",
                borderRadius: 10,
                color: "var(--brand-blue-2)",
                fontSize: 14,
                fontWeight: 600,
                height: 40,
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginRight: 8
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#4ade80",
                  flexShrink: 0,
                  boxShadow: "0 0 0 2px rgba(74, 222, 128, 0.2)"
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {currentUserName}
              </span>
            </div>
          )}
          <Link className="btn" href={backUrl}>
            Volver
          </Link>
          <NotificationBell />
        </header>

        <div className="page">
          {/* Filtros y acciones */}
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: 12, 
            marginBottom: 24,
            flexWrap: "wrap"
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
                Filtrar:
              </span>
              <button
                onClick={() => setFilter("all")}
                style={{
                  padding: "8px 16px",
                  background: filter === "all" ? "rgba(96,141,186,.2)" : "rgba(255,255,255,.05)",
                  border: `1px solid ${filter === "all" ? "rgba(96,141,186,.4)" : "rgba(255,255,255,.15)"}`,
                  borderRadius: 8,
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                Todas ({items.length})
              </button>
              <button
                onClick={() => setFilter("unread")}
                style={{
                  padding: "8px 16px",
                  background: filter === "unread" ? "rgba(96,141,186,.2)" : "rgba(255,255,255,.05)",
                  border: `1px solid ${filter === "unread" ? "rgba(96,141,186,.4)" : "rgba(255,255,255,.15)"}`,
                  borderRadius: 8,
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                No leídas ({unreadCount})
              </button>
              <button
                onClick={() => setFilter("read")}
                style={{
                  padding: "8px 16px",
                  background: filter === "read" ? "rgba(96,141,186,.2)" : "rgba(255,255,255,.05)",
                  border: `1px solid ${filter === "read" ? "rgba(96,141,186,.4)" : "rgba(255,255,255,.15)"}`,
                  borderRadius: 8,
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                Leídas ({items.length - unreadCount})
              </button>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="btn"
                  disabled={processingIds.size > 0}
                  style={{
                    fontSize: 13,
                    padding: "8px 16px",
                    opacity: processingIds.size > 0 ? 0.6 : 1
                  }}
                >
                  Marcar todas como leídas
                </button>
              )}
              {items.filter((n) => n.is_read).length > 0 && (
                <button
                  onClick={deleteAllRead}
                  className="btn danger"
                  disabled={processingIds.size > 0}
                  style={{
                    fontSize: 13,
                    padding: "8px 16px",
                    opacity: processingIds.size > 0 ? 0.6 : 1
                  }}
                >
                  Eliminar leídas
                </button>
              )}
            </div>
          </div>

          {/* Vista tipo email: Lista y detalle */}
          <div style={{ display: "grid", gridTemplateColumns: selectedNotif ? "1fr 2fr" : "1fr", gap: 16 }}>
            {/* Lista de notificaciones (inbox) */}
            <div style={{ display: "grid", gap: 12, maxHeight: "70vh", overflowY: "auto" }}>
              {filteredItems.map((n) => (
              <div
                key={n.id}
                style={{
                  border: n.is_read 
                    ? "1px solid rgba(255,255,255,.15)" 
                    : "1px solid rgba(96,141,186,.4)",
                  borderRadius: 12,
                  padding: 16,
                  background: n.is_read 
                    ? "rgba(255,255,255,.04)" 
                    : "rgba(96,141,186,.15)",
                  transition: "all 0.2s ease",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = n.is_read 
                    ? "rgba(255,255,255,.08)" 
                    : "rgba(96,141,186,.25)";
                  e.currentTarget.style.borderColor = n.is_read 
                    ? "rgba(255,255,255,.25)" 
                    : "rgba(96,141,186,.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = n.is_read 
                    ? "rgba(255,255,255,.04)" 
                    : "rgba(96,141,186,.15)";
                  e.currentTarget.style.borderColor = n.is_read 
                    ? "rgba(255,255,255,.15)" 
                    : "rgba(96,141,186,.4)";
                }}
              >
                {!n.is_read && (
                  <div
                    style={{
                      position: "absolute",
                      top: 16,
                      right: 16,
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "#0ea5e9",
                      boxShadow: "0 0 0 2px rgba(14, 165, 233, 0.3)",
                    }}
                  />
                )}

                <div 
                  style={{ 
                    display: "flex", 
                    gap: 12, 
                    alignItems: "flex-start",
                    cursor: "pointer"
                  }}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div 
                      style={{ 
                        fontWeight: selectedNotif?.id === n.id ? 700 : 600, 
                        fontSize: 14, 
                        color: selectedNotif?.id === n.id ? "var(--text)" : (n.is_read ? "rgba(234,243,255,.7)" : "var(--text)"), 
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {n.title}
                    </div>
                    <div 
                      style={{ 
                        fontSize: 12, 
                        color: "rgba(234,243,255,.6)", 
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {n.body}
                    </div>
                    <div style={{ 
                      fontSize: 11, 
                      color: "rgba(234,243,255,.5)"
                    }}>
                      {fmtTime(n.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}

              {filteredItems.length === 0 && (
                <div style={{ 
                  padding: 40, 
                  textAlign: "center", 
                  color: "rgba(234,243,255,.6)",
                  fontSize: 14 
                }}>
                  {filter === "all" 
                    ? "No hay notificaciones." 
                    : filter === "unread"
                    ? "No hay notificaciones no leídas."
                    : "No hay notificaciones leídas."}
                </div>
              )}
            </div>

            {/* Vista detalle tipo email */}
            {selectedNotif && (
              <div style={{
                border: "1px solid rgba(255,255,255,.2)",
                borderRadius: 12,
                padding: 20,
                background: "rgba(255,255,255,.05)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                maxHeight: "70vh",
                overflowY: "auto"
              }}>
                {/* Header del email */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
                        {selectedNotif.title}
                      </div>
                      {threadMessages.length > 1 && (
                        <div style={{ fontSize: 12, color: "rgba(234,243,255,.7)", marginBottom: 4 }}>
                          {threadMessages.length} mensaje{threadMessages.length > 1 ? 's' : ''} en esta conversación
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setSelectedNotif(null);
                        setThreadMessages([]);
                        setThreadUserNames({});
                      }}
                      className="btn"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Hilo de conversación - Mostrar todos los mensajes */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                  {threadMessages.map((msg, index) => {
                    // Determinar el sender real usando metadata.sender_id (fallback a user_id)
                    const rawMeta = msg.metadata || {};
                    const senderId =
                      (typeof rawMeta === "object" && rawMeta
                        ? (rawMeta as any).sender_id
                        : null) || msg.user_id;

                    const isMyMsg = senderId === currentUserId;
                    const userName =
                      (senderId ? threadUserNames[senderId] : null) ||
                      (isMyMsg ? "Tú" : "Usuario");
                    
                    return (
                      <div 
                        key={msg.id} 
                        style={{
                          padding: 16,
                          background: isMyMsg 
                            ? "rgba(96,141,186,.15)" 
                            : "rgba(255,255,255,.03)",
                          borderRadius: 8,
                          border: `1px solid ${isMyMsg ? "rgba(96,141,186,.3)" : "rgba(255,255,255,.1)"}`,
                          marginLeft: isMyMsg ? "auto" : 0,
                          marginRight: isMyMsg ? 0 : "auto",
                          maxWidth: "85%",
                          position: "relative"
                        }}
                      >
                        <div style={{ 
                          display: "flex", 
                          justifyContent: "space-between", 
                          alignItems: "center",
                          marginBottom: 8
                        }}>
                          <div style={{ 
                            fontSize: 12, 
                            fontWeight: 600, 
                            color: isMyMsg
                              ? "rgba(96,141,186,.9)"
                              : (isAutoPericia ? "rgba(241,196,15,.9)" : "rgba(234,243,255,.8)"),
                            fontSize: isAutoPericia && !isMyMsg ? 12 : 12,
                            fontWeight: isAutoPericia && !isMyMsg ? 600 : 600,
                          }}>
                            {isMyMsg
                              ? "Tú"
                              : (isAutoPericia ? "🤖 NO RESPONDER - PJN AUTOMÁTICO" : userName)}
                          </div>
                          <div style={{ 
                            fontSize: 11, 
                            color: "rgba(234,243,255,.6)" 
                          }}>
                            {fmtTime(msg.created_at)}
                          </div>
                        </div>
                        {msg.nota_context ? (
                          <div style={{ 
                            fontSize: 13, 
                            color: "rgba(234,243,255,.9)", 
                            lineHeight: 1.6, 
                            whiteSpace: "pre-wrap", 
                            wordBreak: "break-word" 
                          }}>
                            {msg.nota_context}
                          </div>
                        ) : msg.body ? (
                          <div style={{ 
                            fontSize: 13, 
                            color: "rgba(234,243,255,.9)", 
                            lineHeight: 1.6, 
                            whiteSpace: "pre-wrap", 
                            wordBreak: "break-word" 
                          }}>
                            {msg.body}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Cuerpo del email - Segunda parte: Metadata (Carátula, Juzgado, etc.) o Información de Transferencia */}
                {selectedNotif.link === "/app/recibidos" ? (
                  // Es una notificación de transferencia (Cédula/Oficio enviado)
                  <div style={{
                    padding: 16,
                    background: "rgba(96,141,186,.1)",
                    borderRadius: 8,
                    border: "1px solid rgba(96,141,186,.2)"
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(234,243,255,.8)", marginBottom: 8 }}>
                      Archivo adjunto:
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(234,243,255,.9)", lineHeight: 1.8 }}>
                      {selectedNotif.metadata?.transfer_id ? (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <strong>Tipo:</strong> {selectedNotif.metadata.doc_type === "OFICIO" ? "Oficio" : selectedNotif.metadata.doc_type === "OTROS_ESCRITOS" ? "Otros Escritos" : "Cédula"}
                          </div>
                          {selectedNotif.title && (
                            <div style={{ marginBottom: 8 }}>
                              <strong>Título:</strong> {selectedNotif.title}
                            </div>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const { data: sess } = await supabase.auth.getSession();
                                const token = sess.session?.access_token;
                                if (!token) {
                                  setToast({
                                    type: "error",
                                    message: "No hay sesión activa. Por favor, recarga la página."
                                  });
                                  return;
                                }

                                const res = await fetch("/api/transfers/sign-download", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    "Authorization": `Bearer ${token}`,
                                  },
                                  body: JSON.stringify({ transferId: selectedNotif.metadata?.transfer_id }),
                                });

                                const json = await res.json().catch(() => ({}));
                                if (!res.ok) {
                                  setToast({
                                    type: "error",
                                    message: json?.error || "No se pudo descargar el archivo."
                                  });
                                  return;
                                }

                                if (json.url) {
                                  window.open(json.url, "_blank");
                                  setToast({
                                    type: "success",
                                    message: "Descargando archivo..."
                                  });
                                  setTimeout(() => setToast(null), 3000);
                                }
                              } catch (err) {
                                console.error("Error al descargar:", err);
                                setToast({
                                  type: "error",
                                  message: "Error al descargar el archivo."
                                });
                              }
                            }}
                            className="btn"
                            style={{
                              padding: "8px 16px",
                              fontSize: 13,
                              marginTop: 8
                            }}
                          >
                            📥 Descargar archivo
                          </button>
                        </div>
                      ) : (
                        <div style={{ color: "rgba(234,243,255,.5)", fontStyle: "italic" }}>
                          No se encontró información del archivo adjunto.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // Es una notificación de expediente/cédula normal
                  // Solo mostrar si hay al menos un dato de expediente disponible
                  (() => {
                    const metadata = selectedNotif.metadata || {};
                    const info = {
                      caratula: metadata.caratula || expedienteInfo?.caratula || null,
                      juzgado: metadata.juzgado || expedienteInfo?.juzgado || null,
                      numero: metadata.numero || expedienteInfo?.numero || null,
                    };
                    const hasAnyInfo = info.caratula || info.juzgado || info.numero;
                    
                    if (!hasAnyInfo) return null;
                    
                    return (
                      <div style={{
                        padding: 16,
                        background: "rgba(96,141,186,.1)",
                        borderRadius: 8,
                        border: "1px solid rgba(96,141,186,.2)"
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(234,243,255,.8)", marginBottom: 8 }}>
                          Información del expediente:
                        </div>
                        <div style={{ fontSize: 13, color: "rgba(234,243,255,.9)", lineHeight: 1.8 }}>
                          {info.caratula && (
                            <div style={{ marginBottom: 6 }}><strong>Carátula:</strong> {info.caratula}</div>
                          )}
                          {info.juzgado && (
                            <div style={{ marginBottom: 6 }}><strong>Juzgado:</strong> {info.juzgado}</div>
                          )}
                          {info.numero && (
                            <div style={{ marginBottom: 6 }}><strong>Número:</strong> {info.numero}</div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}

                {isAutoPericia && ordenPdfUrl && (
                  <div style={{ marginBottom: 12, padding: "0 16px" }}>
                    <a href={ordenPdfUrl} target="_blank" rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        background: "rgba(96,141,186,.2)",
                        border: "1px solid rgba(96,141,186,.3)",
                        borderRadius: 8,
                        color: "rgba(234,243,255,.9)",
                        textDecoration: "none",
                        fontSize: 13,
                        fontWeight: 600,
                      }}>
                      📄 Ver Orden Médica (PDF)
                    </a>
                  </div>
                )}

                {/* Botón de responder */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 16 }}>
                  {isAutoPericia ? (
                    <div style={{
                      padding: 12, background: "rgba(241,196,15,.08)",
                      border: "1px solid rgba(241,196,15,.2)", borderRadius: 8,
                      fontSize: 12, color: "rgba(241,196,15,.8)", textAlign: "center",
                    }}>
                      Esta notificación fue generada automáticamente por el sistema PJN.
                    </div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Escribe tu respuesta..."
                          style={{
                            width: "100%",
                            minHeight: 100,
                            padding: 12,
                            background: "rgba(255,255,255,.05)",
                            border: "1px solid rgba(255,255,255,.15)",
                            borderRadius: 8,
                            color: "var(--text)",
                            fontSize: 13,
                            fontFamily: "inherit",
                            resize: "vertical",
                            lineHeight: 1.6,
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        {/* Campo para adjuntar archivo (solo para notificaciones de transferencia) */}
                        {selectedNotif.link === "/app/recibidos" && (
                          <div style={{ marginBottom: 12 }}>
                            <label style={{
                              display: "block",
                              fontSize: 12,
                              fontWeight: 600,
                              color: "rgba(234,243,255,.8)",
                              marginBottom: 6
                            }}>
                              Adjuntar archivo (.docx) - Opcional
                            </label>
                            <input
                              type="file"
                              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                              onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)}
                              style={{
                                width: "100%",
                                padding: 8,
                                background: "rgba(255,255,255,.05)",
                                border: "1px solid rgba(255,255,255,.15)",
                                borderRadius: 8,
                                color: "var(--text)",
                                fontSize: 13,
                                fontFamily: "inherit",
                              }}
                            />
                            {replyFile && (
                              <div style={{
                                marginTop: 6,
                                fontSize: 12,
                                color: "rgba(234,243,255,.7)"
                              }}>
                                Archivo seleccionado: {replyFile.name}
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => {
                              setSelectedNotif(null);
                              setReplyText("");
                              setReplyFile(null);
                            }}
                            className="btn"
                            disabled={replying}
                            style={{ padding: "8px 16px", fontSize: 13 }}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleReply}
                            className="btn"
                            disabled={replying || !replyText.trim()}
                            style={{
                              padding: "8px 16px",
                              fontSize: 13,
                              opacity: (!replyText.trim() || replying) ? 0.6 : 1
                            }}
                          >
                            {replying ? "Enviando..." : replyFile ? "Responder con archivo" : "Responder"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
