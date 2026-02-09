"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";

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
  metadata?: {
    caratula?: string | null;
    juzgado?: string | null;
    numero?: string | null;
    expediente_id?: string;
    is_pjn_favorito?: boolean;
    cedula_id?: string;
    sender_id?: string;
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

export default function NotificacionesPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Notif[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [backUrl, setBackUrl] = useState<string>("/app");
  const [selectedNotif, setSelectedNotif] = useState<Notif | null>(null);
  const [replyText, setReplyText] = useState<string>("");
  const [replying, setReplying] = useState(false);
  const [expedienteInfo, setExpedienteInfo] = useState<{
    caratula?: string | null;
    juzgado?: string | null;
    numero?: string | null;
  } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string; suggestion?: string } | null>(null);

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
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado")
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
            let parsedMetadata = item.metadata;
            if (typeof item.metadata === 'string') {
              try {
                parsedMetadata = JSON.parse(item.metadata);
              } catch (e) {
                console.error("Error parseando metadata:", e, item.metadata);
                parsedMetadata = {};
              }
            }
            console.log("[Notificaciones] Item parseado:", {
              id: item.id,
              title: item.title,
              metadata: parsedMetadata,
              metadataType: typeof item.metadata
            });
            return {
              ...item,
              metadata: parsedMetadata || {}
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
    setExpedienteInfo(null);

    // Intentar obtener información del expediente de varias formas
    let expedienteId = notif.expediente_id;
    let isPjn = notif.is_pjn_favorito;

    // Si no hay expediente_id, intentar extraerlo del link o body
    if (!expedienteId && notif.link) {
      // El link puede tener formato:
      // - /superadmin/mis-juzgados#pjn_123 (PJN favorito)
      // - /superadmin/mis-juzgados#123 (expediente)
      // - /app#cedula_id (cédula/oficio)
      if (notif.link.startsWith("/app#")) {
        // Es una cédula
        const hashMatch = notif.link.match(/#([a-f0-9-]+)$/i);
        if (hashMatch) {
          expedienteId = hashMatch[1];
          isPjn = false;
        }
      } else {
        // Es un expediente o PJN favorito
        const hashMatch = notif.link.match(/#(pjn_)?([a-f0-9-]+)$/i);
        if (hashMatch) {
          expedienteId = hashMatch[1] ? hashMatch[0].substring(1) : hashMatch[2];
          isPjn = !!hashMatch[1];
        }
      }
    }

    // Si aún no hay expediente_id, intentar extraer del body (buscar carátula mencionada)
    if (!expedienteId && notif.body) {
      // Buscar tanto en expedientes como en cédulas
      const caratulaMatch = notif.body.match(/(?:expediente|cedula|oficio)\s+"([^"]+)"/i);
      if (caratulaMatch) {
        const caratulaBuscada = caratulaMatch[1];
        // Primero intentar buscar en cédulas (si el body menciona "cédula/oficio")
        if (notif.body.toLowerCase().includes("cédula") || notif.body.toLowerCase().includes("oficio")) {
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
    const metadata = notif.metadata || {};
    const isCedula = metadata.cedula_id || (notif.link && notif.link.startsWith("/app#"));
    
    // Si tenemos expediente_id, obtener la información
    if (expedienteId) {
      try {
        if (isPjn) {
          const pjnId = expedienteId.replace(/^pjn_/, "");
          const { data: pjnFav } = await supabase
            .from("pjn_favoritos")
            .select("caratula, juzgado, numero")
            .eq("id", pjnId)
            .single();
          
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
          const { data: exp } = await supabase
            .from("expedientes")
            .select("caratula, juzgado, numero_expediente")
            .eq("id", expedienteId)
            .single();
          
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

      const res = await fetch("/api/notifications/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({
          parent_notification_id: selectedNotif.id,
          message: replyText.trim(),
          expediente_id: selectedNotif.expediente_id,
          is_pjn_favorito: selectedNotif.is_pjn_favorito,
        }),
      });

        if (res.ok) {
          const result = await res.json();
          setReplyText("");
          
          // Mostrar mensaje de éxito
          if (result.ok) {
            setToast({
              type: "success",
              message: "Respuesta enviada correctamente. El remitente original recibirá una notificación."
            });
            // Auto-ocultar después de 4 segundos
            setTimeout(() => setToast(null), 4000);
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
              const parsedData = data.map((item: any) => ({
                ...item,
                metadata: typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata
              }));
              setItems(parsedData as Notif[]);
            }
          }
          setSelectedNotif(null);
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
          <button className="btn danger" onClick={logout}>
            Salir
          </button>
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
                      <div style={{ fontSize: 12, color: "rgba(234,243,255,.7)", marginBottom: 4 }}>
                        De: {selectedNotif.body.split(" te mencionó")[0] || "Sistema"}
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(234,243,255,.7)" }}>
                        Fecha: {fmtTime(selectedNotif.created_at)}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedNotif(null)}
                      className="btn"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Cuerpo del email - Primera parte: Nota completa */}
                {selectedNotif.nota_context && (
                  <div style={{
                    padding: 16,
                    background: "rgba(255,255,255,.03)",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,.1)"
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(234,243,255,.8)", marginBottom: 8 }}>
                      Nota completa:
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(234,243,255,.9)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {selectedNotif.nota_context}
                    </div>
                  </div>
                )}

                {/* Cuerpo del email - Segunda parte: Metadata (Carátula, Juzgado, etc.) */}
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
                    {/* Usar metadata si existe, sino usar expedienteInfo cargado dinámicamente */}
                    {(() => {
                      const info = selectedNotif.metadata && Object.keys(selectedNotif.metadata).length > 0 
                        ? selectedNotif.metadata 
                        : expedienteInfo;
                      
                      return (
                        <>
                          {info?.caratula ? (
                            <div style={{ marginBottom: 6 }}><strong>Carátula:</strong> {info.caratula}</div>
                          ) : (
                            <div style={{ marginBottom: 6, color: "rgba(234,243,255,.5)", fontStyle: "italic" }}>Sin carátula</div>
                          )}
                          {info?.juzgado ? (
                            <div style={{ marginBottom: 6 }}><strong>Juzgado:</strong> {info.juzgado}</div>
                          ) : (
                            <div style={{ marginBottom: 6, color: "rgba(234,243,255,.5)", fontStyle: "italic" }}>Sin juzgado</div>
                          )}
                          {info?.numero ? (
                            <div style={{ marginBottom: 6 }}><strong>Número:</strong> {info.numero}</div>
                          ) : (
                            <div style={{ marginBottom: 6, color: "rgba(234,243,255,.5)", fontStyle: "italic" }}>Sin número</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Botón de responder */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 16 }}>
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
                    <button
                      onClick={() => {
                        setSelectedNotif(null);
                        setReplyText("");
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
                      {replying ? "Enviando..." : "Responder"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
