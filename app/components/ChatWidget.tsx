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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const readConversationsRef = useRef<Set<string>>(new Set());

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

  // Cargar solo conversaciones (optimización: separado de usuarios)
  const loadConversations = useCallback(async () => {
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error("Error de sesión:", sessionError);
        await handleAuthError(sessionError);
        return;
      }
      
      if (!session?.session) return;

      const convRes = await fetch("/api/chat/conversations", {
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
      });
      
      if (convRes.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        return;
      }
      
      if (!convRes.ok) {
        const errorText = await convRes.text();
        console.error("[ChatWidget] Error al cargar conversaciones:", convRes.status, errorText);
        return;
      }
      
      const convData = await convRes.json();
      
      if (convData.ok && convData.data) {
        // Preservar el estado optimista de conversaciones marcadas como leídas
        setConversations((prevConvs) => {
          const newConvs = convData.data || [];
          const readSet = readConversationsRef.current;
          return newConvs.map((newConv: Conversation) => {
            const prevConv = prevConvs.find(c => c.id === newConv.id);
            if (prevConv && prevConv.unread_count === 0 && readSet.has(newConv.id)) {
              return { ...newConv, unread_count: 0 };
            }
            return newConv;
          });
        });
      } else {
        setConversations(convData.data || []);
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
      await handleAuthError(error);
    }
  }, [handleAuthError]);

  // Cargar solo usuarios (optimización: separado de conversaciones)
  const loadUsers = useCallback(async () => {
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        await handleAuthError(sessionError);
        return;
      }
      
      if (!session?.session) return;

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
        // No lanzar error, solo loguear (comportamiento original)
      } else {
        const usersData = await usersRes.json();
        setUsers(usersData.users || usersData.data || []);
      }
    } catch (error) {
      console.error("Error loading users:", error);
      // No llamar handleAuthError aquí para mantener compatibilidad
    }
  }, [handleAuthError]);

  // Cargar datos completos (mantener para compatibilidad con carga inicial)
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Cargar ambos en paralelo para mejor rendimiento
      await Promise.all([
        loadConversations(),
        loadUsers()
      ]);
    } catch (error) {
      console.error("Error loading data:", error);
      await handleAuthError(error);
    } finally {
      setLoading(false);
    }
  }, [loadConversations, loadUsers, handleAuthError]);

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
        setTimeout(() => scrollToBottom(true), 100);
      } else {
        console.warn("[ChatWidget] Formato de respuesta inesperado para mensajes:", data);
        setMessages(data.data || []);
        setTimeout(() => scrollToBottom(true), 100);
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
          const userId = session.session.user.id;
          setCurrentUserId((prev) => prev !== userId ? userId : prev);
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

  // Marcar conversación como leída (debe estar antes de los useEffect que lo usan)
  const markAsRead = useCallback(async (conversationId: string) => {
    if (!conversationId) return;
    
    // Optimistic UI: actualizar estado local inmediatamente
    // Usar useRef para evitar re-renders innecesarios
    readConversationsRef.current.add(conversationId);
    setConversations((prevConvs) =>
      prevConvs.map((conv) =>
        conv.id === conversationId
          ? { ...conv, unread_count: 0 }
          : conv
      )
    );

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

      if (!res.ok) {
        // Si falla, revertir el estado optimista recargando solo conversaciones
        loadConversations().catch(console.error);
        return;
      }

      // NO recargar datos aquí para evitar sobrescribir el estado optimista
      // El estado ya fue actualizado localmente (unread_count = 0)
      // Los cambios se reflejarán cuando se recarguen las conversaciones naturalmente
      console.log("[ChatWidget] Conversación marcada como leída (optimistic UI aplicado).");
    } catch (error) {
      console.error("[ChatWidget] Error marking as read:", error);
      // Si hay error, revertir el estado optimista recargando solo conversaciones
      loadConversations().catch(console.error);
      await handleAuthError(error);
    }
  }, [handleAuthError, loadConversations]);

  // Cargar mensajes cuando se selecciona una conversación
  useEffect(() => {
    if (selectedConversation && selectedConversation.trim() !== "") {
      console.log("[ChatWidget] Conversación seleccionada:", selectedConversation);
      loadMessages(selectedConversation).catch(console.error);
      markAsRead(selectedConversation).catch(console.error);
    }
  }, [selectedConversation, loadMessages, markAsRead]);

  // Suscribirse a nuevos mensajes en tiempo real
  useEffect(() => {
    if (!selectedConversation) return;

    console.log("[ChatWidget] Suscribiéndose a mensajes de conversación:", selectedConversation);

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
          console.log("[ChatWidget] Nuevo mensaje recibido via Realtime:", payload);
          
          const newMessage = payload.new as any;
          if (!newMessage || newMessage.id === undefined) {
            console.warn("[ChatWidget] Payload de mensaje inválido:", payload);
            return;
          }

          // Verificar si el mensaje ya existe en el estado (evitar duplicados)
          setMessages((prevMessages) => {
            const existingIndex = prevMessages.findIndex(msg => msg.id === newMessage.id);
            if (existingIndex !== -1) {
              // Si ya existe, actualizar con datos más completos si los hay
              const existing = prevMessages[existingIndex];
              // Si el mensaje existente no tiene sender completo, esperar a que loadMessages lo actualice
              if (existing.sender && existing.sender.email) {
                console.log("[ChatWidget] Mensaje ya existe en el estado con sender completo, ignorando:", newMessage.id);
                return prevMessages;
              }
              // Si no tiene sender completo, mantener el existente y dejar que loadMessages lo actualice
              console.log("[ChatWidget] Mensaje ya existe pero sin sender completo, esperando actualización:", newMessage.id);
              return prevMessages;
            }

            // Mientras tanto, agregar mensaje básico para feedback inmediato
            const tempMessage: Message = {
              id: newMessage.id,
              conversation_id: newMessage.conversation_id,
              sender_id: newMessage.sender_id,
              content: newMessage.content,
              created_at: newMessage.created_at,
            };

            const updatedMessages = [...prevMessages, tempMessage].sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );

            // Auto-scroll solo si el usuario está cerca del final
            setTimeout(() => {
              if (messagesContainerRef.current) {
                const container = messagesContainerRef.current;
                const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
                if (isNearBottom || !isScrolledUp) {
                  scrollToBottom(true);
                }
              } else {
                scrollToBottom(true);
              }
            }, 50);

            return updatedMessages;
          });

          // Recargar mensajes para obtener el sender completo (en background)
          // Esto asegura que el mensaje tenga todos los datos necesarios
          setTimeout(() => {
            loadMessages(selectedConversation).catch(console.error);
          }, 100);

          // Actualizar solo conversaciones (no usuarios) para reflejar el nuevo mensaje
          loadConversations().catch(console.error);
        }
      )
      .subscribe((status) => {
        console.log("[ChatWidget] Estado de suscripción a mensajes:", status);
      });

    return () => {
      console.log("[ChatWidget] Desuscribiéndose de mensajes de conversación:", selectedConversation);
      supabase.removeChannel(channel);
    };
  }, [selectedConversation, handleAuthError, loadMessages, loadConversations, isScrolledUp]);

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
          loadConversations().catch(console.error);
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
          loadConversations().catch(console.error);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          console.log("[ChatWidget] Nuevo mensaje global detectado");
          // Solo actualizar conversaciones (no usuarios) para actualizar el último mensaje y contador
          loadConversations().catch(console.error);
          
          // NO recargar mensajes aquí si es de la conversación actual
          // La suscripción específica ya se encarga de eso
          // Esto evita duplicados y conflictos
        }
      )
      .subscribe((status) => {
        console.log("[ChatWidget] Estado de suscripción conversations:", status);
      });

    return () => {
      supabase.removeChannel(conversationsChannel);
    };
  }, [loadConversations]);

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
        const responseData = await res.json();
        const sentMessage = responseData.data;
        
        // Agregar mensaje inmediatamente al estado (optimistic update)
        if (sentMessage && currentUserId) {
          const optimisticMessage: Message = {
            id: sentMessage.id,
            conversation_id: sentMessage.conversation_id,
            sender_id: sentMessage.sender_id,
            content: sentMessage.content,
            created_at: sentMessage.created_at,
            sender: sentMessage.sender || {
              id: currentUserId,
              full_name: null,
              email: "",
            },
          };
          
          setMessages((prevMessages) => {
            // Verificar si ya existe (por si llegó por Realtime antes)
            const exists = prevMessages.some(msg => msg.id === optimisticMessage.id);
            if (exists) {
              return prevMessages;
            }
            // Agregar al final y ordenar por fecha
            return [...prevMessages, optimisticMessage].sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        }
        
        setNewMessage("");
        // Resetear altura del textarea
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        // Auto-scroll al enviar
        setTimeout(() => scrollToBottom(true), 100);
        // Recargar solo conversaciones (no usuarios) para asegurar que se actualice la lista
        setTimeout(() => {
          loadConversations().catch(console.error);
        }, 300);
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
        // Recargar solo conversaciones (no usuarios) para mostrar la nueva
        setTimeout(() => {
          loadConversations().catch(console.error);
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

  const scrollToBottom = (force: boolean = false) => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      
      if (force || isNearBottom || !isScrolledUp) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        setIsScrolledUp(false);
        setShowScrollButton(false);
      }
    }
  };

  // Detectar si el usuario scrolleó hacia arriba
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !selectedConversation) return;

    const handleScroll = () => {
      // Throttle para evitar demasiadas actualizaciones
      if (scrollTimeoutRef.current) return;
      
      scrollTimeoutRef.current = setTimeout(() => {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
        const newIsScrolledUp = !isNearBottom;
        const newShowScrollButton = !isNearBottom && scrollTop > 200;
        
        // Solo actualizar si cambió
        setIsScrolledUp((prev) => prev !== newIsScrolledUp ? newIsScrolledUp : prev);
        setShowScrollButton((prev) => prev !== newShowScrollButton ? newShowScrollButton : prev);
        scrollTimeoutRef.current = null;
      }, 100); // Throttle de 100ms
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    // Verificar estado inicial
    handleScroll();
    
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [selectedConversation, messages]);

  // Función para obtener iniciales del nombre
  const getInitials = (name: string | null, email: string) => {
    if (name) {
      const parts = name.trim().split(" ");
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  // Función para formatear fecha como separador
  const formatDateSeparator = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return "Hoy";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Ayer";
    } else {
      const daysDiff = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff < 7) {
        return date.toLocaleDateString("es-AR", { weekday: "long" });
      }
      return date.toLocaleDateString("es-AR", { 
        day: "numeric", 
        month: "long",
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined
      });
    }
  };

  // Función para borrar conversación (soft delete)
  const deleteConversation = useCallback(async (conversationId: string) => {
    if (!conversationId || deletingConversation) return;

    setDeletingConversation(true);
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        await handleAuthError(sessionError);
        setDeletingConversation(false);
        return;
      }
      if (!session?.session) {
        setDeletingConversation(false);
        return;
      }

      const res = await fetch("/api/chat/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      if (res.status === 401) {
        await handleAuthError({ message: "Unauthorized" });
        setDeletingConversation(false);
        return;
      }

      if (res.ok) {
        // Optimistic UI: remover conversación de la lista inmediatamente
        setConversations((prevConvs) =>
          prevConvs.filter((conv) => conv.id !== conversationId)
        );
        
        // Si la conversación borrada estaba seleccionada, deseleccionarla
        if (selectedConversation === conversationId) {
          setSelectedConversation(null);
          setMessages([]);
        }
        
        console.log("[ChatWidget] Conversación borrada exitosamente.");
      } else {
        const error = await res.json();
        console.error("[ChatWidget] Error al borrar conversación:", error);
        alert(error.error || "Error al borrar conversación");
      }
    } catch (error) {
      console.error("[ChatWidget] Error deleting conversation:", error);
      alert("Error al borrar conversación");
    } finally {
      setDeletingConversation(false);
      setShowDeleteConfirm(null);
    }
  }, [handleAuthError, deletingConversation, selectedConversation]);

  // Mejorar formatTime para mostrar hora exacta cuando es hoy
  const formatTime = (dateString: string, forList: boolean = false) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    // Para la lista de conversaciones, mostrar hora si es hoy
    if (forList) {
      if (days === 0 && hours < 24) {
        return date.toLocaleTimeString("es-AR", { 
          hour: "2-digit", 
          minute: "2-digit" 
        });
      }
      if (days === 1) return "Ayer";
      if (days < 7) return `Hace ${days}d`;
      return date.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit"
      });
    }

    // Para mensajes en el chat
    if (days === 0 && hours < 24) {
      return date.toLocaleTimeString("es-AR", { 
        hour: "2-digit", 
        minute: "2-digit" 
      });
    }
    
    if (minutes < 1) return "Ahora";
    if (minutes < 60) return `Hace ${minutes}m`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 7) return `Hace ${days}d`;
    return date.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit"
    });
  };


  // Cargar usuarios lazy cuando se abre la lista (optimización)
  useEffect(() => {
    if (showUserList && users.length === 0) {
      loadUsers().catch(console.error);
    }
  }, [showUserList, users.length, loadUsers]);

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
          {!selectedConversation && (
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
          )}

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
              {!selectedConversation && (
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
                  // Filtrar la conversación activa y ordenar: primero no leídas, luego por fecha
                  conversations
                    .filter(conv => !selectedConversation || conv.id !== selectedConversation)
                    .sort((a, b) => {
                      // Primero las que tienen mensajes no leídos
                      if (a.unread_count > 0 && b.unread_count === 0) return -1;
                      if (a.unread_count === 0 && b.unread_count > 0) return 1;
                      // Luego ordenar por fecha del último mensaje (más reciente primero)
                      const dateA = a.last_message?.created_at || a.updated_at;
                      const dateB = b.last_message?.created_at || b.updated_at;
                      return new Date(dateB).getTime() - new Date(dateA).getTime();
                    })
                    .map((conv) => {
                    const otherUser = conv.other_user;
                    const displayName = conv.type === "direct" && otherUser
                      ? (otherUser.full_name || otherUser.email || "Usuario")
                      : conv.name || "Conversación";
                    const initials = conv.type === "direct" && otherUser
                      ? getInitials(otherUser.full_name, otherUser.email)
                      : "GC";
                    
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
                        <div className={styles.conversationAvatar}>
                          {initials}
                        </div>
                        <div className={styles.conversationInfo}>
                          <div className={styles.conversationItemHeader}>
                            <div className={styles.conversationName}>{displayName}</div>
                            {conv.last_message && (
                              <div className={styles.conversationTime}>
                                {formatTime(conv.last_message.created_at, true)}
                              </div>
                            )}
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
              )}

              {selectedConversation ? (() => {
                const selectedConv = conversations.find(c => c.id === selectedConversation);
                const otherUser = selectedConv?.other_user;
                const displayName = selectedConv?.type === "direct" && otherUser
                  ? (otherUser.full_name || otherUser.email || "Usuario")
                  : selectedConv?.name || "Conversación";
                const initials = selectedConv?.type === "direct" && otherUser
                  ? getInitials(otherUser.full_name, otherUser.email)
                  : "GC";
                
                return (
                  <div className={styles.messagesPanel}>
                    {/* Header de conversación estilo WhatsApp */}
                    <div className={styles.conversationHeader}>
                      <div className={styles.conversationHeaderInfo}>
                        <button
                          className={styles.backButton}
                          onClick={() => setSelectedConversation(null)}
                          title="Volver a conversaciones"
                        >
                          ←
                        </button>
                        <div className={styles.conversationHeaderAvatar}>
                          {initials}
                        </div>
                        <div className={styles.conversationHeaderName}>
                          {displayName}
                        </div>
                      </div>
                      <div className={styles.chatActions}>
                        <button
                          className={styles.closeButton}
                          onClick={() => setIsOpen(false)}
                          aria-label="Cerrar chat"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <div
                      className={styles.messagesContainer}
                      ref={messagesContainerRef}
                    >
                      {messages.length === 0 ? (
                        <div className={styles.emptyMessages}>
                          <p>No hay mensajes en esta conversación</p>
                        </div>
                      ) : (
                        messages.map((msg, index) => {
                          const msgDate = new Date(msg.created_at);
                          const prevMsg = index > 0 ? messages[index - 1] : null;
                          const prevMsgDate = prevMsg ? new Date(prevMsg.created_at) : null;
                          const showDateSeparator = !prevMsgDate || 
                            msgDate.toDateString() !== prevMsgDate.toDateString();
                          
                          const isSent = msg.sender_id === currentUserId;
                          const isSameSender = prevMsg && prevMsg.sender_id === msg.sender_id;
                          const timeDiff = prevMsg ? 
                            (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) : 
                            Infinity;
                          const isConsecutive = prevMsg && isSameSender && timeDiff < 300000; // 5 minutos
                          const showAvatar = !isSent && (!isSameSender || !isConsecutive);
                          const showSenderName = !isSent && (!isSameSender || !isConsecutive);
                          const senderInitials = msg.sender
                            ? getInitials(msg.sender.full_name, msg.sender.email)
                            : "U";
                          
                          return (
                            <div key={msg.id}>
                              {showDateSeparator && (
                                <div className={styles.dateSeparator}>
                                  <span>{formatDateSeparator(msg.created_at)}</span>
                                </div>
                              )}
                              <div
                                className={`${styles.message} ${
                                  isSent ? styles.messageSent : styles.messageReceived
                                } ${isSameSender && isConsecutive ? styles.messageGrouped : ""}`}
                              >
                                {showAvatar && (
                                  <div className={styles.messageAvatar}>
                                    {senderInitials}
                                  </div>
                                )}
                                {!showAvatar && !isSent && <div className={styles.messageAvatarSpacer} />}
                                <div className={styles.messageContent}>
                                  {showSenderName && (
                                    <div className={styles.messageSender}>
                                      {msg.sender?.full_name || msg.sender?.email || "Usuario"}
                                    </div>
                                  )}
                                  <div className={styles.messageBubble}>
                                    <div className={styles.messageText}>{msg.content}</div>
                                    <div className={styles.messageTime}>
                                      {formatTime(msg.created_at)}
                                      {isSent && (
                                        <span className={styles.messageStatus}>✓✓</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                      {showScrollButton && (
                        <button
                          className={styles.scrollToBottomButton}
                          onClick={() => scrollToBottom(true)}
                          title="Ir al último mensaje"
                          aria-label="Ir al último mensaje"
                        >
                          ⬇
                        </button>
                      )}
                    </div>
                    <div className={styles.messageInput}>
                      <textarea
                        ref={textareaRef}
                        value={newMessage}
                        onChange={(e) => {
                          setNewMessage(e.target.value);
                          // Auto-resize
                          e.target.style.height = "auto";
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                          }
                        }}
                        onFocus={() => {
                          // Auto-scroll cuando el usuario empieza a escribir
                          setTimeout(() => scrollToBottom(true), 100);
                        }}
                        placeholder="Escribe un mensaje..."
                        disabled={sending}
                        rows={1}
                        className={styles.messageTextarea}
                      />
                      <button
                        onClick={sendMessage}
                        disabled={!newMessage.trim() || sending}
                        className={styles.sendButton}
                        title="Enviar (Enter)"
                      >
                        {sending ? "..." : "✈"}
                      </button>
                    </div>
                  </div>
                );
              })() : null}
            </>
          )}
        </div>
      )}

      {/* Modal de confirmación para borrar conversación */}
      {showDeleteConfirm && (
        <div className={styles.deleteModalOverlay} onClick={() => setShowDeleteConfirm(null)}>
          <div className={styles.deleteModal} onClick={(e) => e.stopPropagation()}>
            <h3>¿Está seguro que desea borrar esta conversación?</h3>
            <p>Esta acción solo ocultará la conversación para usted. El otro usuario seguirá viéndola.</p>
            <div className={styles.deleteModalActions}>
              <button
                className={styles.deleteModalCancel}
                onClick={() => setShowDeleteConfirm(null)}
                disabled={deletingConversation}
              >
                Cancelar
              </button>
              <button
                className={styles.deleteModalConfirm}
                onClick={() => deleteConversation(showDeleteConfirm)}
                disabled={deletingConversation}
              >
                {deletingConversation ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
