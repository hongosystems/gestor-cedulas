"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./ChatWidget.module.css";

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: {
    id: string;
    full_name: string | null;
    email: string;
  };
};

type Conversation = {
  id: string;
  type: string;
  name: string;
  updated_at: string;
  last_message?: Message | null;
  other_user?: {
    id: string;
    full_name: string | null;
    email: string;
  } | null;
  unread_count: number;
};

type User = {
  id: string;
  full_name: string | null;
  email: string;
};

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [showUserList, setShowUserList] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Función para manejar errores de autenticación
  const handleAuthError = useCallback(async (error: any) => {
    if (error?.message?.includes("Refresh Token") || 
        error?.message?.includes("Invalid Refresh Token") ||
        error?.message?.includes("refresh_token_not_found") ||
        error?.message === "Unauthorized") {
      console.warn("Token de refresh inválido o no autorizado, cerrando sesión...");
      try {
        await supabase.auth.signOut();
        // Limpiar localStorage
        if (typeof window !== 'undefined') {
          localStorage.removeItem('sb-auth-token');
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          if (supabaseUrl) {
            const projectId = supabaseUrl.split('//')[1]?.split('.')[0];
            if (projectId) {
              localStorage.removeItem(`sb-${projectId}-auth-token`);
            }
          }
        }
        window.location.href = "/login";
      } catch (signOutError) {
        console.error("Error al cerrar sesión:", signOutError);
        window.location.href = "/login";
      }
    }
  }, []);

  // Cargar conversaciones y usuarios (debe estar antes del useEffect que lo usa)
  const loadData = useCallback(async () => {
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      
      // Si hay error de refresh token, limpiar sesión y redirigir
      if (sessionError) {
        console.error("Error de sesión:", sessionError);
        await handleAuthError(sessionError);
        return;
      }
      
      if (!session?.session) return;

      // Cargar conversaciones
      const convRes = await fetch("/api/chat/conversations", {
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
      });
      
      if (convRes.status === 401) {
        // Token inválido, redirigir a login
        await handleAuthError({ message: "Unauthorized" });
        return;
      }
      
      if (!convRes.ok) {
        const errorText = await convRes.text();
        console.error("[ChatWidget] Error al cargar conversaciones:", convRes.status, errorText);
        setLoading(false);
        return;
      }
      
      const convData = await convRes.json();
      console.log("[ChatWidget] Conversaciones cargadas:", convData);
      
      if (convData.ok && convData.data) {
        console.log("[ChatWidget] Estableciendo conversaciones:", convData.data.length, "conversaciones");
        setConversations(convData.data || []);
      } else {
        console.warn("[ChatWidget] Formato de respuesta inesperado:", convData);
        setConversations(convData.data || []);
      }

      // Cargar lista de usuarios para iniciar conversaciones
      const usersRes = await fetch("/api/users/list", {
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
      });
      
      if (usersRes.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        return;
      }
      
      if (!usersRes.ok) {
        const errorText = await usersRes.text();
        console.error("[ChatWidget] Error al cargar usuarios:", usersRes.status, errorText);
        // No retornar aquí, continuar aunque falle la carga de usuarios
      } else {
        const usersData = await usersRes.json();
        console.log("[ChatWidget] Usuarios cargados:", usersData);
        setUsers(usersData.users || usersData.data || []);
      }

      setLoading(false);
    } catch (error) {
      console.error("Error loading data:", error);
      await handleAuthError(error);
      setLoading(false);
    }
  }, [handleAuthError]);

  // Cargar mensajes de una conversación (debe estar antes de los useEffect que lo usan)
  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId || conversationId.trim() === "") {
      console.warn("[ChatWidget] loadMessages llamado con conversationId inválido:", conversationId);
      return;
    }
    
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        await handleAuthError(sessionError);
        return;
      }
      if (!session?.session) return;

      console.log("[ChatWidget] Cargando mensajes para conversación:", conversationId);
      const res = await fetch(`/api/chat/messages/${conversationId}`, {
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
      });

      if (res.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        return;
      }

      if (!res.ok) {
        const errorText = await res.text();
        console.error("[ChatWidget] Error al cargar mensajes:", res.status, errorText);
        return;
      }
      
      const data = await res.json();
      console.log("[ChatWidget] Mensajes cargados:", data);
      
      if (data.ok && data.data) {
        console.log("[ChatWidget] Estableciendo mensajes:", data.data.length, "mensajes");
        setMessages(data.data || []);
        setTimeout(scrollToBottom, 100);
      } else {
        console.warn("[ChatWidget] Formato de respuesta inesperado para mensajes:", data);
        setMessages(data.data || []);
        setTimeout(scrollToBottom, 100);
      }
    } catch (error) {
      console.error("Error loading messages:", error);
      await handleAuthError(error);
    }
  }, [handleAuthError]);

  // Obtener sesión y cargar datos iniciales con listener de auth state
  useEffect(() => {
    let mounted = true;
    
    // Listener para cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        if (event === 'SIGNED_OUT') {
          setCurrentUserId(null);
          setConversations([]);
          setMessages([]);
          setIsOpen(false);
        } else if (event === 'TOKEN_REFRESHED' && session) {
          setCurrentUserId(session.user.id);
        } else if (event === 'SIGNED_IN' && session) {
          setCurrentUserId(session.user.id);
          if (mounted) {
            loadData().catch(console.error);
          }
        }
      }
    );

    // Cargar datos iniciales
    (async () => {
      try {
        const { data: session, error } = await supabase.auth.getSession();
        if (error) {
          console.error("Error obteniendo sesión:", error);
          await handleAuthError(error);
          return;
        }
        if (session?.session) {
          setCurrentUserId(session.session.user.id);
        }
        if (mounted) {
          loadData().catch(console.error);
        }
      } catch (error) {
        console.error("Error en useEffect inicial:", error);
        await handleAuthError(error);
      }
    })();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleAuthError, loadData]);

  // Cargar mensajes cuando se selecciona una conversación
  useEffect(() => {
    if (selectedConversation && selectedConversation.trim() !== "") {
      console.log("[ChatWidget] Conversación seleccionada:", selectedConversation);
      loadMessages(selectedConversation);
      markAsRead(selectedConversation);
    }
  }, [selectedConversation, handleAuthError, loadMessages]);

  // Suscribirse a nuevos mensajes en tiempo real
  useEffect(() => {
    if (!selectedConversation) return;

    const channel = supabase
      .channel(`messages:${selectedConversation}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedConversation}`,
        },
        async (payload) => {
          // Obtener el mensaje completo con datos del sender
          const { data: session, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            await handleAuthError(sessionError);
            return;
          }
          if (!session?.session) return;

          const res = await fetch(
            `/api/chat/messages/${selectedConversation}`,
            {
              headers: {
                Authorization: `Bearer ${session.session.access_token}`,
              },
            }
          );
          
          if (res.status === 401) {
            await handleAuthError({ message: "Unauthorized" });
            return;
          }
          
          if (res.ok) {
            const data = await res.json();
            setMessages(data.data || []);
            scrollToBottom();
          }

          // Actualizar conversaciones para reflejar el nuevo mensaje
          loadData().catch(console.error);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation, handleAuthError, loadData, loadMessages]);

  // Suscribirse a actualizaciones de conversaciones, participantes y mensajes globales
  useEffect(() => {
    const conversationsChannel = supabase
      .channel("conversations-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
        },
        () => {
          console.log("[ChatWidget] Cambio detectado en conversations, recargando...");
          loadData().catch(console.error);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_participants",
        },
        () => {
          console.log("[ChatWidget] Cambio detectado en participants, recargando...");
          loadData().catch(console.error);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          console.log("[ChatWidget] Nuevo mensaje global detectado:", payload);
          // Recargar conversaciones para actualizar el último mensaje y contador de no leídos
          loadData().catch(console.error);
          
          // Si el mensaje es de la conversación actual, también recargar mensajes
          if (selectedConversation && payload.new?.conversation_id === selectedConversation) {
            loadMessages(selectedConversation).catch(console.error);
          }
        }
      )
      .subscribe((status) => {
        console.log("[ChatWidget] Estado de suscripción conversations:", status);
      });

    return () => {
      supabase.removeChannel(conversationsChannel);
    };
  }, [loadData, selectedConversation, loadMessages]);

  const markAsRead = async (conversationId: string) => {
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        await handleAuthError(sessionError);
        return;
      }
      if (!session?.session) return;

      const res = await fetch("/api/chat/mark-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      if (res.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        return;
      }

      // Actualizar conversaciones para reflejar que se leyeron
      loadData();
    } catch (error) {
      console.error("Error marking as read:", error);
      await handleAuthError(error);
    }
  };

  const sendMessage = async () => {
    if (!selectedConversation || !newMessage.trim() || sending) return;

    setSending(true);
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        await handleAuthError(sessionError);
        setSending(false);
        return;
      }
      if (!session?.session) {
        setSending(false);
        return;
      }

      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({
          conversation_id: selectedConversation,
          content: newMessage.trim(),
        }),
      });

      if (res.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        setSending(false);
        return;
      }

      if (res.ok) {
        setNewMessage("");
        // El mensaje se agregará automáticamente vía Realtime
        // También recargar conversaciones para asegurar que se actualice la lista
        setTimeout(() => {
          loadData().catch(console.error);
        }, 500);
      } else {
        const error = await res.json();
        alert(error.error || "Error al enviar mensaje");
      }
    } catch (error) {
      console.error("Error sending message:", error);
      await handleAuthError(error);
      alert("Error al enviar mensaje");
    } finally {
      setSending(false);
    }
  };

  const startConversation = async (userId: string) => {
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        await handleAuthError(sessionError);
        return;
      }
      if (!session?.session) return;

      const res = await fetch("/api/chat/conversation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ other_user_id: userId }),
      });

      if (res.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setSelectedConversation(data.data.conversation_id);
        setShowUserList(false);
        // Recargar conversaciones para mostrar la nueva
        setTimeout(() => {
          loadData().catch(console.error);
        }, 300);
      } else {
        const error = await res.json();
        alert(error.error || "Error al crear conversación");
      }
    } catch (error) {
      console.error("Error starting conversation:", error);
      await handleAuthError(error);
      alert("Error al crear conversación");
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Ahora";
    if (minutes < 60) return `Hace ${minutes}m`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 7) return `Hace ${days}d`;
    return date.toLocaleDateString("es-AR");
  };


  // No mostrar el chat si no hay sesión
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: session, error } = await supabase.auth.getSession();
        if (error) {
          await handleAuthError(error);
          setHasSession(false);
          return;
        }
        setHasSession(!!session?.session);
      } catch (error) {
        console.error("Error checking session:", error);
        setHasSession(false);
      }
    })();
  }, []);

  if (!hasSession) {
    return null;
  }

  const totalUnread = conversations.reduce((sum, conv) => sum + conv.unread_count, 0);

  if (loading) {
    return (
      <div className={styles.chatWidget}>
        <button
          className={styles.chatToggle}
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Abrir chat"
        >
          💬
        </button>
      </div>
    );
  }

  return (
    <div className={styles.chatWidget}>
      <button
        className={styles.chatToggle}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Abrir chat"
      >
        💬
        {totalUnread > 0 && (
          <span className={styles.unreadBadge}>{totalUnread}</span>
        )}
      </button>

      {isOpen && (
        <div className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <h3>Chat</h3>
            <div className={styles.chatActions}>
              <button
                className={styles.newChatButton}
                onClick={() => setShowUserList(!showUserList)}
                title="Nueva conversación"
              >
                +
              </button>
              <button
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                aria-label="Cerrar chat"
              >
                ×
              </button>
            </div>
          </div>

          {showUserList ? (
            <div className={styles.userList}>
              <h4>Seleccionar usuario</h4>
              <div className={styles.userListContent}>
                {users.map((user) => (
                  <button
                    key={user.id}
                    className={styles.userItem}
                    onClick={() => startConversation(user.id)}
                  >
                    <div className={styles.userName}>
                      {user.full_name || user.email}
                    </div>
                    <div className={styles.userEmail}>{user.email}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className={styles.conversationsList}>
                {conversations.length === 0 ? (
                  <div className={styles.emptyState}>
                    <p>No hay conversaciones</p>
                    <button
                      className={styles.startChatButton}
                      onClick={() => {
                        console.log("[ChatWidget] Botón 'Iniciar conversación' clickeado");
                        setShowUserList(true);
                      }}
                    >
                      Iniciar conversación
                    </button>
                  </div>
                ) : (
                  conversations.map((conv) => {
                    console.log("[ChatWidget] Renderizando conversación:", conv.id, conv.name);
                    return (
                    <button
                      key={conv.id}
                      className={`${styles.conversationItem} ${
                        selectedConversation === conv.id ? styles.active : ""
                      }`}
                      onClick={() => {
                        setSelectedConversation(conv.id);
                        markAsRead(conv.id);
                      }}
                    >
                      <div className={styles.conversationInfo}>
                        <div className={styles.conversationName}>
                          {conv.type === "direct" && conv.other_user
                            ? (conv.other_user.full_name || conv.other_user.email || "Usuario")
                            : conv.name || "Conversación"}
                        </div>
                        {conv.last_message && (
                          <div className={styles.conversationPreview}>
                            {conv.last_message.content.substring(0, 50)}
                            {conv.last_message.content.length > 50 ? "..." : ""}
                          </div>
                        )}
                      </div>
                      {conv.unread_count > 0 && (
                        <span className={styles.conversationUnread}>
                          {conv.unread_count}
                        </span>
                      )}
                    </button>
                    );
                  })
                )}
              </div>

              {selectedConversation && (
                <div className={styles.messagesPanel}>
                  <div
                    className={styles.messagesContainer}
                    ref={messagesContainerRef}
                  >
                    {messages.length === 0 ? (
                      <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
                        <p>No hay mensajes en esta conversación</p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        console.log("[ChatWidget] Renderizando mensaje:", msg.id, msg.content.substring(0, 50));
                        return (
                          <div
                            key={msg.id}
                            className={`${styles.message} ${
                              msg.sender_id === currentUserId
                                ? styles.messageSent
                                : styles.messageReceived
                            }`}
                          >
                            <div className={styles.messageContent}>
                              {msg.sender_id !== currentUserId && (
                                <div className={styles.messageSender}>
                                  {msg.sender?.full_name || msg.sender?.email || "Usuario"}
                                </div>
                              )}
                              <div className={styles.messageText}>{msg.content}</div>
                              <div className={styles.messageTime}>
                                {formatTime(msg.created_at)}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className={styles.messageInput}>
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Escribe un mensaje..."
                      disabled={sending}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!newMessage.trim() || sending}
                      className={styles.sendButton}
                    >
                      {sending ? "..." : "Enviar"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
