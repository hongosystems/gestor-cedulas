"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pjnScraperSupabase } from "@/lib/pjn-scraper-supabase";
import { daysSince } from "@/lib/semaforo";

// Estilos globales para mejorar contraste del dropdown
if (typeof document !== 'undefined') {
  const styleId = 'mis-juzgados-dropdown-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Mejorar contraste del dropdown "Cargado por" */
      select option {
        background-color: rgba(11,47,85,1) !important;
        color: rgba(234,243,255,.95) !important;
      }
      select option:hover,
      select option:focus,
      select option:checked {
        background-color: rgba(96,141,186,.3) !important;
        color: rgba(234,243,255,1) !important;
      }
    `;
    document.head.appendChild(style);
  }
}

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  estado: string;
  tipo_documento: "CEDULA" | "OFICIO" | null;
  pdf_path: string | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
};

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  estado: string;
  observaciones: string | null;
  notas: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  is_pjn_favorito?: boolean; // Indica si viene de pjn_favoritos
};

type PjnFavorito = {
  id: string;
  jurisdiccion: string;
  numero: string;
  anio: number;
  caratula: string | null;
  juzgado: string | null;
  fecha_ultima_carga: string | null; // Formato DD/MM/AAAA
  observaciones: string | null;
  notas?: string | null;
  removido?: boolean | null;
  estado?: string | null;
};

// Normalizar juzgado para mostrar SIN "- SECRETARIA N° X"
function normalizeJuzgado(raw: string | null): string | null {
  if (!raw) return null;
  const j = raw.trim().replace(/\s+/g, " ").toUpperCase();
  const mCivil = /^JUZGADO\s+CIVIL\s+(\d+)\b/i.exec(j);
  if (mCivil) return `JUZGADO CIVIL ${mCivil[1]}`;
  const stripped = j.replace(/\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$/i, "").trim();
  return stripped || null;
}

function isoToDDMMAAAA(iso: string | null): string {
  if (!iso || iso.trim() === "") return "";
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Convertir fecha DD/MM/AAAA a ISO (YYYY-MM-DD)
function ddmmaaaaToISO(ddmm: string | null): string | null {
  if (!ddmm || ddmm.trim() === "") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmm.trim());
  if (!m) return null;
  const [, dia, mes, anio] = m;
  return `${anio}-${mes}-${dia}T00:00:00.000Z`;
}

type Semaforo = "VERDE" | "AMARILLO" | "ROJO";

const UMBRAL_AMARILLO = 30;
const UMBRAL_ROJO = 60;

function semaforoByAge(dias: number): Semaforo {
  if (dias >= UMBRAL_ROJO) return "ROJO";
  if (dias >= UMBRAL_AMARILLO) return "AMARILLO";
  return "VERDE";
}

type User = {
  id: string;
  email: string;
  full_name: string | null;
  username: string; // email sin dominio para @mentions
};

function NotasTextarea({
  itemId,
  isPjnFavorito,
  initialValue,
  notasEditables,
  setNotasEditables,
  notasGuardando,
  setNotasGuardando,
  setMsg,
  caratula,
  numeroExpediente,
  juzgado
}: {
  itemId: string;
  isPjnFavorito: boolean;
  initialValue: string;
  notasEditables: Record<string, string>;
  setNotasEditables: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  notasGuardando: Record<string, boolean>;
  setNotasGuardando: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setMsg: React.Dispatch<React.SetStateAction<string>>;
  caratula?: string | null;
  numeroExpediente?: string | null;
  juzgado?: string | null;
}) {
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [mentionState, setMentionState] = React.useState<{
    show: boolean;
    position: { top: number; left: number };
    query: string;
    selectedIndex: number;
  } | null>(null);
  const [users, setUsers] = React.useState<User[]>([]);
  const value = notasEditables[itemId] !== undefined ? notasEditables[itemId] : initialValue;
  const trimmedValue = value?.trim() || "";

  // Cargar usuarios del sistema desde API (incluye todos los usuarios de auth.users)
  React.useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) return;

        const res = await fetch("/api/users/list", {
          headers: {
            "Authorization": `Bearer ${session.session.access_token}`,
          },
        });

        if (res.ok) {
          const { users: usersList } = await res.json();
          console.log(`[NotasTextarea] Usuarios cargados desde API: ${usersList?.length || 0}`);
          console.log(`[NotasTextarea] Primeros usuarios:`, usersList?.slice(0, 5).map((u: any) => `${u.full_name || u.email} (@${u.username})`));
          setUsers(usersList || []);
        } else {
          console.error("Error al cargar usuarios:", await res.text());
          // Fallback: intentar cargar desde profiles
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, email, full_name")
            .order("full_name", { ascending: true });
          
          if (profiles) {
            const fallbackUsers: User[] = profiles.map((p: any) => {
              const username = (p.email || "").split("@")[0].toLowerCase();
              return {
                id: p.id,
                email: p.email || "",
                full_name: p.full_name,
                username,
              };
            });
            setUsers(fallbackUsers);
          }
        }
      } catch (err) {
        console.error("Error al cargar usuarios:", err);
        // Fallback: intentar cargar desde profiles
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .order("full_name", { ascending: true });
        
        if (profiles) {
          const fallbackUsers: User[] = profiles.map((p: any) => {
            const username = (p.email || "").split("@")[0].toLowerCase();
            return {
              id: p.id,
              email: p.email || "",
              full_name: p.full_name,
              username,
            };
          });
          setUsers(fallbackUsers);
        }
      }
    })();
  }, []);

  // Detectar menciones en el texto y crear notificaciones
  const detectarYNotificarMenciones = React.useCallback(async (texto: string, currentUserId: string) => {
    // Buscar patrones @username en el texto
    const mentionRegex = /@(\w+)/g;
    const matches = [...texto.matchAll(mentionRegex)];
    const mentionedUsernames = [...new Set(matches.map(m => m[1].toLowerCase()))];
    
    if (mentionedUsernames.length === 0) return;
    
    // Obtener información del usuario actual
    const { data: currentUserProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", currentUserId)
      .single();
    
    const currentUserName = currentUserProfile?.full_name || currentUserProfile?.email || "Un usuario";
    
    // Crear notificaciones para cada usuario mencionado
    for (const username of mentionedUsernames) {
      const mentionedUser = users.find(u => u.username.toLowerCase() === username);
      if (!mentionedUser || mentionedUser.id === currentUserId) continue;
      
      // Construir link al expediente
      const link = isPjnFavorito 
        ? `/superadmin/mis-juzgados#pjn_${itemId.replace(/^pjn_/, "")}`
        : `/superadmin/mis-juzgados#${itemId}`;
      
      // Guardar la nota completa (no solo el contexto)
      // El asunto será la parte donde fueron mencionados, pero el cuerpo tendrá la nota completa
      const mentionIndex = texto.toLowerCase().indexOf(`@${username}`);
      const startContext = Math.max(0, mentionIndex - 50);
      const endContext = Math.min(texto.length, mentionIndex + username.length + 50);
      const notaContextParaAsunto = texto.substring(startContext, endContext).trim();
      
      // La nota completa se guarda en nota_context
      const notaCompleta = texto.trim();
      
      // Limpiar itemId para expediente_id (quitar prefijo pjn_ si existe, ya que expediente_id es UUID)
      const expedienteIdLimpio = itemId.replace(/^pjn_/, "");
      
      // Obtener el ID del usuario actual (remitente)
      const { data: session } = await supabase.auth.getSession();
      const senderId = session.session?.user.id;
      
      // Crear metadata con información del expediente y el remitente
      const metadata = {
        caratula: caratula || null,
        juzgado: juzgado || null,
        numero: numeroExpediente || null,
        expediente_id: itemId, // Guardar el ID completo con prefijo en metadata para referencia
        is_pjn_favorito: isPjnFavorito,
        sender_id: senderId, // Guardar el ID del remitente para poder responderle
      };
      
      // Crear notificación
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) return;
        
        console.log("[NotasTextarea] Creando mención con metadata:", {
          caratula,
          juzgado,
          numeroExpediente,
          metadata
        });

        const res = await fetch("/api/notifications/create-mention", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({
            user_id: mentionedUser.id,
            title: notaContextParaAsunto || (caratula ? `Mencionado en: ${caratula.substring(0, 50)}${caratula.length > 50 ? '...' : ''}` : "Fuiste mencionado en una nota"),
            body: `${currentUserName} te mencionó en las notas${caratula ? ` del expediente "${caratula}"` : numeroExpediente ? ` del expediente ${numeroExpediente}` : ""}`,
            link,
            expediente_id: expedienteIdLimpio, // UUID sin prefijo pjn_
            is_pjn_favorito: isPjnFavorito,
            nota_context: notaCompleta, // Guardar la nota completa
            metadata: metadata,
          }),
        });
        
        if (res.ok) {
          const result = await res.json();
          console.log("[NotasTextarea] Notificación creada:", result);
          if (result.warning) {
            console.warn("[NotasTextarea] Advertencia:", result.warning);
          }
        } else {
          const errorText = await res.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          console.error("[NotasTextarea] Error al crear notificación:", errorData);
          console.error("[NotasTextarea] Status:", res.status);
          console.error("[NotasTextarea] Response:", errorText);
        }
      } catch (err) {
        console.error(`Error al crear notificación:`, err);
      }
    }
  }, [users, isPjnFavorito, itemId, caratula, numeroExpediente, juzgado]);

  const guardarNotas = React.useCallback(async (newValue: string) => {
    if (notasGuardando[itemId]) return;
    
    setNotasGuardando(prev => ({ ...prev, [itemId]: true }));
    
    try {
      // Obtener usuario actual para notificaciones
      const { data: session } = await supabase.auth.getSession();
      const currentUserId = session.session?.user.id;
      
      // Detectar y notificar menciones antes de guardar
      if (currentUserId) {
        await detectarYNotificarMenciones(newValue, currentUserId);
      }
      if (isPjnFavorito) {
        // Para favoritos PJN, extraer el ID real (sin el prefijo "pjn_")
        const pjnId = itemId.replace(/^pjn_/, "");
        
        console.log(`[Notas] Intentando guardar notas para favorito PJN: ${itemId} (ID real: ${pjnId})`);
        
        // Intentar primero con el cliente principal
        let { data, error } = await supabase
          .from("pjn_favoritos")
          .update({ notas: newValue.trim() || null })
          .eq("id", pjnId)
          .select();
        
        // Log detallado del error
        if (error) {
          const errorObj = error as any;
          console.log(`[Notas] Error del cliente principal:`, {
            message: errorObj.message,
            code: errorObj.code,
            details: errorObj.details,
            hint: errorObj.hint,
            status: errorObj.status,
            statusText: errorObj.statusText,
            error: JSON.stringify(errorObj, Object.getOwnPropertyNames(errorObj))
          });
        } else {
          console.log(`[Notas] ✅ Notas guardadas exitosamente con cliente principal:`, data);
        }
        
        // Si falla porque la tabla no está en la BD principal, intentar con pjn-scraper
        if (error) {
          const errorMsg = (error as any).message || String(error) || "";
          const errorCode = (error as any).code || "";
          const errorDetails = (error as any).details || "";
          const errorHint = (error as any).hint || "";
          const errorStatus = (error as any).status || "";
          
          console.log(`[Notas] Analizando error:`, { errorMsg, errorCode, errorDetails, errorHint, errorStatus });
          
          // Si es error de tabla/columna no encontrada, intentar con pjn-scraper
          const isTableOrColumnError = 
            errorMsg.includes("relation") || 
            errorMsg.includes("does not exist") || 
            errorCode === "PGRST116" || 
            errorMsg.includes("column") || 
            errorDetails.includes("column") ||
            errorMsg.includes("permission denied") ||
            errorMsg.includes("new row violates row-level security");
          
          if (isTableOrColumnError) {
            const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
            const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
            
            console.log(`[Notas] Intentando con cliente pjn-scraper...`, { pjnUrl: !!pjnUrl, pjnKey: !!pjnKey });
            
            if (pjnUrl && pjnKey) {
              // Intentar con el cliente pjn-scraper
              const { data: pjnData, error: pjnError } = await pjnScraperSupabase
                .from("pjn_favoritos")
                .update({ notas: newValue.trim() || null })
                .eq("id", pjnId)
                .select();
              
              if (pjnError) {
                const pjnErrorObj = pjnError as any;
                console.error(`[Notas] Error del cliente pjn-scraper:`, {
                  message: pjnErrorObj.message,
                  code: pjnErrorObj.code,
                  details: pjnErrorObj.details,
                  hint: pjnErrorObj.hint,
                  status: pjnErrorObj.status,
                  error: JSON.stringify(pjnErrorObj, Object.getOwnPropertyNames(pjnErrorObj))
                });
                const pjnErrorMsg = pjnErrorObj.message || String(pjnError) || "Error desconocido";
                setMsg(`Error al guardar notas: ${pjnErrorMsg}. Verifica que la columna notas exista en pjn_favoritos y que tengas permisos de escritura.`);
                return;
              }
              // Éxito con pjn-scraper
              console.log(`[Notas] ✅ Notas guardadas exitosamente con cliente pjn-scraper:`, pjnData);
              error = null;
            } else {
              console.error(`[Notas] Cliente pjn-scraper no configurado`);
              setMsg(`Error al guardar notas: ${errorMsg || "Tabla pjn_favoritos no encontrada y cliente pjn-scraper no configurado"}`);
              return;
            }
          } else {
            // Otro tipo de error (posiblemente permisos RLS)
            const fullError = {
              message: errorMsg,
              code: errorCode,
              details: errorDetails,
              hint: errorHint,
              status: errorStatus,
              originalError: error
            };
            console.error(`[Notas] Error completo:`, fullError);
            
            // Mensaje más descriptivo basado en el tipo de error
            let userMessage = errorMsg || errorDetails || "Error desconocido";
            if (errorMsg.includes("permission denied") || errorMsg.includes("row-level security")) {
              userMessage = "Error de permisos: Verifica que exista una política RLS de UPDATE para pjn_favoritos. Ejecuta la migración SQL para crear la política.";
            } else if (errorMsg.includes("column") || errorDetails.includes("column")) {
              userMessage = "Error: La columna 'notas' no existe en pjn_favoritos. Ejecuta la migración SQL para agregarla.";
            }
            
            setMsg(`Error al guardar notas: ${userMessage}`);
            return;
          }
        }
      } else {
        // Para expedientes locales
        const { error } = await supabase
          .from("expedientes")
          .update({ notas: newValue.trim() || null })
          .eq("id", itemId);
        
        if (error) {
          console.error(`Error al guardar notas para expediente ${itemId}:`, error);
          setMsg(`Error al guardar notas: ${error.message}`);
        }
      }
    } catch (err) {
      console.error(`Error al guardar notas:`, err);
      setMsg(`Error al guardar notas: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setNotasGuardando(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
    }
  }, [itemId, isPjnFavorito, notasGuardando, setMsg, detectarYNotificarMenciones]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const textarea = e.target;
    const cursorPos = textarea.selectionStart;
    
    setNotasEditables(prev => ({ ...prev, [itemId]: newValue }));
    
    // Detectar si se está escribiendo después de "@"
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      // Verificar que no hay espacio entre @ y el cursor
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        const query = textAfterAt.toLowerCase();
        
        // Calcular posición del dropdown
        const textareaRect = textarea.getBoundingClientRect();
        const scrollTop = textarea.scrollTop;
        const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
        const lines = textBeforeCursor.split("\n");
        const currentLine = lines.length - 1;
        const top = textareaRect.top + (currentLine * lineHeight) - scrollTop + lineHeight;
        
        setMentionState({
          show: true,
          position: { top, left: textareaRect.left },
          query,
          selectedIndex: 0,
        });
      } else {
        setMentionState(null);
      }
    } else {
      setMentionState(null);
    }
    
    // Cancelar timeout anterior
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Guardar automáticamente después de 30 segundos sin escribir
    timeoutRef.current = setTimeout(() => {
      guardarNotas(newValue);
    }, 30000);
  };

  const insertarMencion = (user: User) => {
    const currentValue = notasEditables[itemId] !== undefined ? notasEditables[itemId] : initialValue;
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = currentValue.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const newText = 
        currentValue.substring(0, lastAtIndex + 1) + 
        user.username + 
        " " + 
        currentValue.substring(cursorPos);
      
      setNotasEditables(prev => ({ ...prev, [itemId]: newText }));
      setMentionState(null);
      
      // Reposicionar cursor después de la mención
      setTimeout(() => {
        const newCursorPos = lastAtIndex + 1 + user.username.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Manejar navegación en el dropdown de menciones
    if (mentionState?.show) {
      const query = mentionState.query.toLowerCase();
      const filteredUsers = !query || query.length === 0
        ? users.slice(0, 20)
        : users.filter(u => 
            u.username.toLowerCase().includes(query) ||
            (u.full_name && u.full_name.toLowerCase().includes(query)) ||
            u.email.toLowerCase().includes(query)
          ).slice(0, 20);
      
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionState(prev => prev ? {
          ...prev,
          selectedIndex: Math.min(prev.selectedIndex + 1, filteredUsers.length - 1)
        } : null);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionState(prev => prev ? {
          ...prev,
          selectedIndex: Math.max(prev.selectedIndex - 1, 0)
        } : null);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredUsers[mentionState.selectedIndex]) {
          insertarMencion(filteredUsers[mentionState.selectedIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    
    // Guardar inmediatamente con ENTER (Ctrl+Enter o Cmd+Enter) o TAB
    if (e.key === "Tab" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      const currentValue = notasEditables[itemId] !== undefined ? notasEditables[itemId] : initialValue;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      guardarNotas(currentValue);
      setIsEditing(false);
      setMentionState(null);
    }
    // ESC para cancelar edición
    if (e.key === "Escape" && !mentionState?.show) {
      setNotasEditables(prev => {
        const newState = { ...prev };
        delete newState[itemId];
        return newState;
      });
      setIsEditing(false);
      setMentionState(null);
    }
  };

  const handleBlur = () => {
    const currentValue = notasEditables[itemId] !== undefined ? notasEditables[itemId] : initialValue;
    if (currentValue !== initialValue) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      guardarNotas(currentValue);
    }
    setIsEditing(false);
  };

  const handleClick = () => {
    setIsEditing(true);
    // Enfocar el textarea después de un pequeño delay para que se renderice
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Filtrar usuarios para el dropdown (mostrar hasta 20 usuarios)
  const filteredUsers = mentionState ? (() => {
    const query = mentionState.query.toLowerCase();
    // Si no hay query o es muy corta, mostrar todos los usuarios (limitado a 20)
    if (!query || query.length === 0) {
      return users.slice(0, 20);
    }
    // Si hay query, filtrar y mostrar hasta 20
    return users.filter(u => 
      u.username.toLowerCase().includes(query) ||
      (u.full_name && u.full_name.toLowerCase().includes(query)) ||
      u.email.toLowerCase().includes(query)
    ).slice(0, 20);
  })() : [];

  // Si está editando, mostrar textarea
  if (isEditing) {
    return (
      <div style={{ 
        width: "100%",
        padding: "6px 8px",
        background: "rgba(255,255,255,.03)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,.06)",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        boxSizing: "border-box",
        position: "relative"
      }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            // Delay para permitir click en el dropdown
            setTimeout(() => {
              if (!dropdownRef.current?.contains(document.activeElement)) {
                handleBlur();
                setMentionState(null);
              }
            }, 200);
          }}
          placeholder="Agregar notas... (usa @ para mencionar usuarios)"
          disabled={notasGuardando[itemId]}
          style={{
            width: "100%",
            minHeight: "50px",
            padding: "6px 8px",
            background: "rgba(255,255,255,.05)",
            border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 6,
            color: "rgba(234,243,255,.95)",
            fontSize: 12.5,
            fontFamily: "inherit",
            resize: "vertical",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            transition: "all 0.2s ease",
            outline: "none",
            textAlign: "left",
            boxSizing: "border-box"
          }}
        />
        
        {/* Dropdown de menciones */}
        {mentionState?.show && filteredUsers.length > 0 && (
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: mentionState.position.top,
              left: mentionState.position.left,
              zIndex: 1000,
              background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
              border: "1px solid rgba(255,255,255,.2)",
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,.5)",
              backdropFilter: "blur(20px)",
              minWidth: 280,
              maxWidth: 320,
              maxHeight: 300,
              overflowY: "auto",
            }}
            onMouseDown={(e) => e.preventDefault()} // Prevenir blur del textarea
          >
            {filteredUsers.map((user, idx) => (
              <div
                key={user.id}
                onClick={() => insertarMencion(user)}
                style={{
                  padding: "10px 14px",
                  cursor: "pointer",
                  background: idx === mentionState.selectedIndex 
                    ? "rgba(96,141,186,.3)" 
                    : "transparent",
                  borderLeft: idx === mentionState.selectedIndex 
                    ? "3px solid rgba(96,141,186,.8)" 
                    : "3px solid transparent",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={() => setMentionState(prev => prev ? { ...prev, selectedIndex: idx } : null)}
              >
                <div style={{ 
                  fontWeight: 600, 
                  fontSize: 13, 
                  color: "var(--text)",
                  marginBottom: 2
                }}>
                  {user.full_name || user.email}
                </div>
                <div style={{ 
                  fontSize: 11, 
                  color: "rgba(234,243,255,.6)" 
                }}>
                  @{user.username}
                </div>
              </div>
            ))}
          </div>
        )}
        
        <div style={{
          padding: "2px 0 0 0",
          fontSize: 9.5,
          color: "rgba(234,243,255,.5)",
          fontStyle: "italic",
          textAlign: "left",
          letterSpacing: "0.01em",
          lineHeight: 1.3,
          wordBreak: "break-word",
          whiteSpace: "normal"
        }}>
          Autoguardado en 30 segundos, presionando Ctrl+Enter ó Tab
        </div>
        {notasGuardando[itemId] && (
          <div style={{ 
            fontSize: 9.5, 
            color: "rgba(234,243,255,.5)", 
            textAlign: "left",
            fontStyle: "italic",
            padding: "2px 0 0 0"
          }}>
            Guardando...
          </div>
        )}
      </div>
    );
  }

  // Si no está editando, mostrar bloque similar a Observaciones
  if (!trimmedValue) {
    return (
      <div
        onClick={handleClick}
        style={{
          padding: "6px 8px",
          background: "rgba(255,255,255,.03)",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,.06)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "rgba(234,243,255,.5)",
          fontSize: 12.5,
          letterSpacing: "0.01em",
          cursor: "pointer",
          transition: "all 0.2s ease",
          textAlign: "left",
          boxSizing: "border-box"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,.05)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,.1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,.03)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,.06)";
        }}
      >
        <div style={{
          fontSize: 9.5,
          color: "rgba(234,243,255,.5)",
          fontStyle: "italic",
          lineHeight: 1.3,
          wordBreak: "break-word",
          whiteSpace: "normal"
        }}>
          Autoguardado en 30 segundos, presionando Ctrl+Enter ó Tab
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      style={{
        padding: "6px 8px",
        background: "rgba(255,255,255,.03)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,.06)",
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "rgba(234,243,255,.88)",
        fontSize: 12.5,
        letterSpacing: "0.01em",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
        textAlign: "left",
        boxSizing: "border-box"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,.05)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,.03)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,.06)";
      }}
      title="Haz clic para editar"
    >
      {trimmedValue}
      {notasGuardando[itemId] && (
        <div style={{ 
          fontSize: 9.5, 
          color: "rgba(234,243,255,.5)", 
          marginTop: 6,
          textAlign: "left",
          fontStyle: "italic"
        }}>
          Guardando...
        </div>
      )}
    </div>
  );
}

function SemaforoChip({ value }: { value: Semaforo }) {
  const style: React.CSSProperties =
    value === "VERDE"
      ? {
          background: "rgba(46, 204, 113, 0.16)",
          border: "1px solid rgba(46, 204, 113, 0.35)",
          color: "rgba(210, 255, 226, 0.95)",
        }
      : value === "AMARILLO"
      ? {
          background: "rgba(241, 196, 15, 0.14)",
          border: "1px solid rgba(241, 196, 15, 0.35)",
          color: "rgba(255, 246, 205, 0.95)",
        }
      : {
          background: "rgba(231, 76, 60, 0.14)",
          border: "1px solid rgba(231, 76, 60, 0.35)",
          color: "rgba(255, 220, 216, 0.95)",
        };

  return (
    <span
      style={{
        ...style,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 12px",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.4,
        minWidth: 88,
      }}
    >
      {value}
    </span>
  );
}

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

type SortField = "semaforo" | "fecha" | "dias" | "juzgado" | null;
type SortDirection = "asc" | "desc";

export default function MisJuzgadosPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [cedulas, setCedulas] = useState<Cedula[]>([]);
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"expedientes" | "cedulas" | "oficios">("expedientes");
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc"); // Por defecto: más viejo primero
  const [semaforoFilter, setSemaforoFilter] = useState<Semaforo | null>(null);
  const [notasEditables, setNotasEditables] = useState<Record<string, string>>({});
  const [notasGuardando, setNotasGuardando] = useState<Record<string, boolean>>({});
  const [juzgadoFilter, setJuzgadoFilter] = useState<"mis_juzgados" | "todos" | "beneficio" | string>("mis_juzgados");
  const [userJuzgados, setUserJuzgados] = useState<string[]>([]);
  const [isAbogado, setIsAbogado] = useState(false);
  const [createdByFilter, setCreatedByFilter] = useState<string>("all"); // "all" | user_id | "pjn"
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setMsg("");

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // Nombre base desde la sesión (para TODOS los usuarios, aunque no tengan profile)
      const sessionFullName = (session.user.user_metadata as any)?.full_name as string | undefined;
      const sessionEmail = (session.user.email || "").trim();
      const baseName = (sessionFullName || "").trim() || sessionEmail;
      if (baseName) {
        setCurrentUserName(baseName);
      }

      // Intentar mejorar el nombre con datos de profiles si existen
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", uid)
        .maybeSingle();

      if (!profileErr && profile) {
        const nameFromProfile = (profile.full_name || "").trim() || (profile.email || "").trim() || "";
        if (nameFromProfile) {
          setCurrentUserName(nameFromProfile);
        }
      }

      // Verificar que es superadmin/abogado
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_abogado")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isSuperadmin = !roleErr && roleData?.is_superadmin === true;
      const isAbogado = !roleErr && roleData?.is_abogado === true;
      
      setIsAbogado(isAbogado || false);
      
      if (!isSuperadmin && !isAbogado) {
        window.location.href = "/app";
        return;
      }

      // Si es abogado (y no superadmin), por defecto mostrar "Todos los Juzgados"
      // para evitar caer en pantalla vacía por falta de juzgados asignados.
      if (isAbogado && !isSuperadmin && juzgadoFilter === "mis_juzgados") {
        setJuzgadoFilter("todos");
      }

      // Obtener juzgados asignados al usuario
      const { data: juzgadosData, error: juzgadosErr } = await supabase
        .from("user_juzgados")
        .select("juzgado")
        .eq("user_id", uid);
      
      const juzgadosAsignados = juzgadosData && juzgadosData.length > 0 
        ? juzgadosData.map(j => j.juzgado)
        : [];
      
      setUserJuzgados(juzgadosAsignados);
      
      // Función para normalizar juzgado para comparación
      // Extrae el número del juzgado de manera consistente
      const normalizarJuzgado = (j: string | null): string => {
        if (!j) return "";
        const normalized = j.trim().replace(/\s+/g, " ").toUpperCase();
        
        // Intentar extraer número de juzgado civil
        // Patrones: "JUZGADO CIVIL 70", "JUZGADO NACIONAL EN LO CIVIL N° 70", etc.
        const matchCivil = normalized.match(/JUZGADO\s+(?:NACIONAL\s+EN\s+LO\s+)?CIVIL\s+(?:N[°º]?\s*)?(\d+)/i);
        if (matchCivil && matchCivil[1]) {
          return `JUZGADO CIVIL ${matchCivil[1]}`;
        }
        
        // Si no es civil, intentar extraer cualquier número después de "JUZGADO"
        const matchGeneric = normalized.match(/JUZGADO[^0-9]*?(\d+)/i);
        if (matchGeneric && matchGeneric[1]) {
          // Intentar determinar el tipo
          if (normalized.includes("CIVIL")) {
            return `JUZGADO CIVIL ${matchGeneric[1]}`;
          }
          // Para otros tipos, mantener el formato original pero normalizado
          return normalized;
        }
        
        // Si no se encuentra número, retornar normalizado
        return normalized;
      };
      
      // Función para comparar juzgados de manera estricta
      const juzgadosCoinciden = (j1: string, j2: string): boolean => {
        const n1 = normalizarJuzgado(j1);
        const n2 = normalizarJuzgado(j2);
        
        // Comparación exacta
        if (n1 === n2) return true;
        
        // Extraer números de ambos
        const num1 = n1.match(/(\d+)/)?.[1];
        const num2 = n2.match(/(\d+)/)?.[1];
        
        // Si ambos tienen números y son iguales, y ambos contienen "JUZGADO" y "CIVIL"
        if (num1 && num2 && num1 === num2) {
          if (n1.includes("JUZGADO") && n2.includes("JUZGADO") && 
              n1.includes("CIVIL") && n2.includes("CIVIL")) {
            return true;
          }
        }
        
        return false;
      };
      
      // Normalizar juzgados solo si el filtro es "mis_juzgados"
      let juzgadosNormalizados: string[] = [];
      if (juzgadoFilter === "mis_juzgados") {
        // Si no hay juzgados asignados y el filtro es "mis_juzgados", mostrar mensaje
        if (juzgadosAsignados.length === 0) {
          setMsg("No tienes juzgados asignados. Contacta al administrador o selecciona 'Todos los Juzgados'.");
          setLoading(false);
          return;
        }
        
        // Normalizar juzgados usando la función de normalización mejorada
        juzgadosNormalizados = juzgadosAsignados.map(j => normalizarJuzgado(j));
        
        // Debug: mostrar juzgados asignados
        console.log(`[Mis Juzgados] Juzgados asignados (${juzgadosNormalizados.length}):`, juzgadosNormalizados);
      } else {
        console.log(`[Mis Juzgados] Filtro: "Todos los Juzgados" - Mostrando todos los datos sin filtrar por juzgados`);
      }

      // Cargar todos los expedientes abiertos y filtrar por juzgados asignados
      // Intentar primero con todas las columnas (observaciones, notas y created_by_user_id)
      let queryExps = supabase
        .from("expedientes")
        .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, notas, created_by_user_id")
        .eq("estado", "ABIERTO")
        .order("fecha_ultima_modificacion", { ascending: true }); // Por defecto: más viejo primero
      
      const { data: allExps, error: eErr } = await queryExps;
      
      // Debug: verificar qué expedientes se están recibiendo
      console.log(`[Mis Juzgados] Total expedientes recibidos de BD: ${allExps?.length || 0}`);
      if (allExps && allExps.length > 0) {
        const uniqueOwners = [...new Set(allExps.map((e: any) => e.owner_user_id))];
        const currentUserId = uid;
        console.log(`[Mis Juzgados] Current user ID: ${currentUserId}`);
        console.log(`[Mis Juzgados] Expedientes de diferentes usuarios: ${uniqueOwners.length}`);
        console.log(`[Mis Juzgados] Owner IDs:`, uniqueOwners);
        console.log(`[Mis Juzgados] Expedientes propios: ${allExps.filter((e: any) => e.owner_user_id === currentUserId).length}`);
        console.log(`[Mis Juzgados] Expedientes de otros usuarios: ${allExps.filter((e: any) => e.owner_user_id !== currentUserId).length}`);
        
        // Mostrar algunos ejemplos de juzgados
        const juzgadosEjemplos = [...new Set(allExps.map((e: any) => e.juzgado).filter(Boolean).slice(0, 5))];
        console.log(`[Mis Juzgados] Ejemplos de juzgados en expedientes:`, juzgadosEjemplos);
      }
      
      // Si hay error por columna observaciones faltante, reintentar sin ella
      let allExpsData = allExps;
      if (eErr) {
        const errorMsg = eErr.message || String(eErr) || "";
        const errorCode = (eErr as any).code || "";
        
        // Detectar si es un error de columna observaciones faltante
        const isObservacionesError = 
          errorMsg.includes("observaciones") || 
          errorMsg.includes("does not exist") ||
          errorCode === "PGRST116";
        
        if (isObservacionesError) {
          console.warn(`[Mis Juzgados] Columna observaciones no existe en BD, cargando sin observaciones`);
          
          // Reintentar sin observaciones, pero mantener created_by_user_id
          const { data: allExps2, error: eErr2 } = await supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: true }); // Por defecto: más viejo primero
          
          if (eErr2) {
            setMsg(`Error al cargar expedientes: ${eErr2.message}`);
            setLoading(false);
            return;
          }
          
          // Establecer observaciones como null para todos los registros
          allExpsData = allExps2?.map((e: any) => ({
            ...e,
            observaciones: null
          })) || [];
        } else {
          setMsg(`Error al cargar expedientes: ${errorMsg}`);
          setLoading(false);
          return;
        }
      }
      
      // Verificar que observaciones se están cargando correctamente (si no hubo error)
      if (!eErr) {
        const expsWithObservaciones = allExpsData?.filter((e: any) => e.observaciones) || [];
        console.log(`[Mis Juzgados] Expedientes con observaciones cargadas: ${expsWithObservaciones.length}/${allExpsData?.length || 0}`);
      }
      
      // Cargar favoritos de pjn-scraper (pjn_favoritos)
      // NOTA: Si pjn-scraper está en la misma base de datos, usar el cliente principal
      let pjnFavoritos: PjnFavorito[] = [];
      try {
        console.log(`[Mis Juzgados] Intentando cargar favoritos de pjn_favoritos...`);
        
        // Intentar primero con el cliente principal (misma base de datos)
        // IMPORTANTE: Filtrar favoritos removidos (si existe columna removido o estado)
        let { data: favoritosData, error: favoritosErr } = await supabase
          .from("pjn_favoritos")
          .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones, notas, removido, estado")
          .order("updated_at", { ascending: false });
        
        // Si falla porque la columna no existe, intentar cargar las columnas disponibles
        if (favoritosErr && (favoritosErr.message?.includes("removido") || favoritosErr.message?.includes("estado") || favoritosErr.message?.includes("notas"))) {
          console.log(`[Mis Juzgados] Algunas columnas no encontradas, intentando cargar sin ellas...`);
          
          // Intentar primero cargar sin las columnas problemáticas
          const { data: favoritosData2, error: favoritosErr2 } = await supabase
            .from("pjn_favoritos")
            .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones")
            .order("updated_at", { ascending: false });
          
          if (favoritosErr2) {
            favoritosErr = favoritosErr2;
          } else {
            // Intentar cargar notas por separado solo si la columna notas existe
            // Primero verificar si podemos leer notas de un favorito de prueba
            let notasDisponibles = false;
            if (favoritosData2 && favoritosData2.length > 0) {
              try {
                const { data: testNota, error: testErr } = await supabase
                  .from("pjn_favoritos")
                  .select("notas")
                  .eq("id", favoritosData2[0].id)
                  .single();
                
                if (!testErr && testNota !== null) {
                  notasDisponibles = true;
                }
              } catch (e) {
                // Si falla, asumir que la columna no existe
                notasDisponibles = false;
              }
            }
            
            // Si las notas están disponibles, cargarlas para todos los favoritos
            if (notasDisponibles) {
              const favoritosConNotas = await Promise.all(
                (favoritosData2 || []).map(async (f: any) => {
                  try {
                    const { data: notaData, error: notaErr } = await supabase
                      .from("pjn_favoritos")
                      .select("notas")
                      .eq("id", f.id)
                      .single();
                    
                    return {
                      ...f,
                      removido: false,
                      estado: null,
                      notas: (!notaErr && notaData) ? (notaData.notas || null) : null
                    };
                  } catch (e) {
                    return {
                      ...f,
                      removido: false,
                      estado: null,
                      notas: null
                    };
                  }
                })
              );
              
              favoritosData = favoritosConNotas;
            } else {
              // Si las notas no están disponibles, establecer null para todos
              favoritosData = favoritosData2?.map((f: any) => ({
                ...f,
                removido: false,
                estado: null,
                notas: null
              })) || [];
            }
            
            favoritosErr = null;
          }
        }
        
        // Filtrar favoritos removidos en memoria si las columnas existen
        if (favoritosData && !favoritosErr) {
          favoritosData = favoritosData.filter((f: any) => {
            // Si tiene columna removido, filtrar los que están removidos
            if (f.removido === true) return false;
            // Si tiene columna estado, filtrar los que están REMOVIDO
            if (f.estado === "REMOVIDO") return false;
            return true;
          });
        }
        
        if (favoritosErr) {
          console.error(`[Mis Juzgados] ❌ Error al cargar pjn_favoritos:`, favoritosErr);
          console.error(`[Mis Juzgados] Error details:`, {
            message: favoritosErr.message,
            code: (favoritosErr as any).code,
            details: (favoritosErr as any).details,
            hint: (favoritosErr as any).hint
          });
          
          // Si el error es que la tabla no existe, intentar con el cliente de pjn-scraper (si está configurado)
          if (favoritosErr.message?.includes('relation') || favoritosErr.message?.includes('does not exist') || (favoritosErr as any).code === 'PGRST116') {
            console.warn(`[Mis Juzgados] ⚠️  Tabla pjn_favoritos no encontrada en base de datos principal. Intentando con cliente pjn-scraper...`);
            
            const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
            const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
            
            if (pjnUrl && pjnKey) {
              const { data: favoritosData2, error: favoritosErr2 } = await pjnScraperSupabase
                .from("pjn_favoritos")
                .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones")
                .order("updated_at", { ascending: false });
              
              if (favoritosErr2) {
                console.error(`[Mis Juzgados] ❌ Error también con cliente pjn-scraper:`, favoritosErr2);
                setMsg(msg ? `${msg} Error al cargar favoritos PJN: ${favoritosErr2.message}` : `Error al cargar favoritos PJN: ${favoritosErr2.message}`);
              } else if (favoritosData2) {
                pjnFavoritos = favoritosData2 as PjnFavorito[];
                console.log(`[Mis Juzgados] ✅ Favoritos cargados desde pjn-scraper DB: ${pjnFavoritos.length}`);
              }
            } else {
              console.warn(`[Mis Juzgados] ⚠️  Variables de entorno de pjn-scraper no configuradas`);
              setMsg(msg ? `${msg} Tabla pjn_favoritos no encontrada. Verifica que exista en la base de datos.` : `Tabla pjn_favoritos no encontrada. Verifica que exista en la base de datos.`);
            }
          } else {
            // Otro tipo de error
            setMsg(msg ? `${msg} Error al cargar favoritos PJN: ${favoritosErr.message}` : `Error al cargar favoritos PJN: ${favoritosErr.message}`);
          }
          } else if (favoritosData) {
            pjnFavoritos = favoritosData as PjnFavorito[];
            console.log(`[Mis Juzgados] ✅ Favoritos cargados desde base de datos principal: ${pjnFavoritos.length}`);
            
            // Si pjn_favoritos está vacía, intentar leer desde cases como fallback
            // NOTA: cases está en la base de datos de pjn-scraper, no en la principal
            if (pjnFavoritos.length === 0) {
              console.log(`[Mis Juzgados] Tabla pjn_favoritos está vacía. Intentando leer desde cases en pjn-scraper...`);
              
              // Intentar primero con el cliente principal (por si cases está en la misma DB)
              let casesData: any[] | null = null;
              let casesErr: any = null;
              
              const { data: casesDataMain, error: casesErrMain } = await supabase
                .from("cases")
                .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos")
                .order("ult_act", { ascending: false })
                .limit(1000);
              
              if (casesErrMain) {
                // Si falla en la base principal, intentar con pjn-scraper
                console.log(`[Mis Juzgados] cases no encontrada en BD principal. Intentando con pjn-scraper...`);
                
                const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
                const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
                
                if (pjnUrl && pjnKey) {
                  const { data: casesDataPjn, error: casesErrPjn } = await pjnScraperSupabase
                    .from("cases")
                    .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos")
                    .order("ult_act", { ascending: false })
                    .limit(1000);
                  
                  if (casesErrPjn) {
                    console.warn(`[Mis Juzgados] ⚠️  Error al leer desde cases en pjn-scraper:`, casesErrPjn);
                    casesErr = casesErrPjn;
                  } else {
                    casesData = casesDataPjn;
                  }
                } else {
                  console.warn(`[Mis Juzgados] ⚠️  Variables de entorno de pjn-scraper no configuradas. No se puede leer desde cases.`);
                  casesErr = { message: "Variables de entorno de pjn-scraper no configuradas" };
                }
              } else {
                casesData = casesDataMain;
              }
              
              if (casesErr) {
                console.warn(`[Mis Juzgados] ⚠️  No se pudo leer desde cases:`, casesErr);
              } else if (casesData && casesData.length > 0) {
                console.log(`[Mis Juzgados] ✅ Datos encontrados en cases: ${casesData.length}`);
                
                // Función para extraer observaciones de movimientos (mismo criterio que autocompletado)
                const extractObservaciones = (movimientos: any): string | null => {
                  if (!movimientos) return null;
                  
                  try {
                    // Si es un array de objetos
                    if (Array.isArray(movimientos) && movimientos.length > 0) {
                      let tipoActuacion: string | null = null;
                      let detalle: string | null = null;
                      
                      // Buscar desde el inicio hacia el final para encontrar el primero (más actual) con información completa
                      for (let i = 0; i < movimientos.length; i++) {
                        const mov = movimientos[i];
                        
                        if (typeof mov === 'object' && mov !== null) {
                          // Si tiene cols (array de strings)
                          if (mov.cols && Array.isArray(mov.cols)) {
                            // Buscar Tipo actuacion y Detalle en este movimiento
                            for (const col of mov.cols) {
                              const colStr = String(col).trim();
                              
                              // Buscar Tipo actuacion (verificar que tenga contenido después de :)
                              if (!tipoActuacion) {
                                const matchTipo = colStr.match(/^Tipo\s+actuacion:\s*(.+)$/i);
                                if (matchTipo && matchTipo[1].trim() !== "") {
                                  tipoActuacion = `Tipo actuacion: ${matchTipo[1].trim()}`;
                                }
                              }
                              
                              // Buscar Detalle (verificar que tenga contenido después de :)
                              if (!detalle) {
                                const matchDetalle = colStr.match(/^Detalle:\s*(.+)$/i);
                                if (matchDetalle && matchDetalle[1].trim() !== "") {
                                  detalle = `Detalle: ${matchDetalle[1].trim()}`;
                                }
                              }
                            }
                            
                            // Si encontramos ambos con información, ya tenemos lo que necesitamos
                            if (tipoActuacion && detalle) {
                              break;
                            }
                          }
                        }
                      }
                      
                      // Si encontramos ambos, formatear el resultado
                      if (tipoActuacion && detalle) {
                        return `${tipoActuacion}\n${detalle}`;
                      }
                    }
                  } catch (err) {
                    console.warn(`[Mis Juzgados] Error al extraer observaciones:`, err);
                  }
                  
                  return null;
                };
                
                // Convertir cases a formato PjnFavorito
                pjnFavoritos = casesData.map((c: any) => {
                  // Extraer jurisdiccion, numero y anio desde key o expediente
                  const expText = c.key || c.expediente || '';
                  const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
                  
                  if (match) {
                    const [, jurisdiccion, numero, anioStr] = match;
                    const anio = parseInt(anioStr, 10);
                    
                    // Convertir ult_act a formato DD/MM/AAAA
                    let fechaUltimaCarga: string | null = null;
                    if (c.ult_act) {
                      try {
                        // ult_act puede venir en formato DD/MM/YYYY o ISO
                        let date: Date;
                        if (typeof c.ult_act === 'string' && c.ult_act.includes('/')) {
                          // Formato DD/MM/YYYY
                          const parts = c.ult_act.trim().split('/');
                          if (parts.length === 3) {
                            const [dia, mes, anio] = parts.map((p: string) => parseInt(p, 10));
                            date = new Date(anio, mes - 1, dia);
                          } else {
                            date = new Date(c.ult_act);
                          }
                        } else {
                          date = new Date(c.ult_act);
                        }
                        
                        if (!isNaN(date.getTime())) {
                          const dia = String(date.getDate()).padStart(2, '0');
                          const mes = String(date.getMonth() + 1).padStart(2, '0');
                          const anio = date.getFullYear();
                          fechaUltimaCarga = `${dia}/${mes}/${anio}`;
                        }
                      } catch (e) {
                        console.warn(`[Mis Juzgados] Error al convertir fecha:`, e);
                      }
                    }
                    
                    // Extraer observaciones de movimientos
                    const observaciones = extractObservaciones(c.movimientos);
                    
                    return {
                      id: c.key || c.expediente || '',
                      jurisdiccion,
                      numero,
                      anio,
                      caratula: c.caratula || null,
                      juzgado: normalizeJuzgado(c.dependencia || null),
                      fecha_ultima_carga: fechaUltimaCarga,
                      observaciones: observaciones,
                    } as PjnFavorito;
                  }
                  return null;
                }).filter((f: PjnFavorito | null): f is PjnFavorito => f !== null);
                
                console.log(`[Mis Juzgados] ✅ Convertidos ${pjnFavoritos.length} casos desde cases a formato pjn_favoritos`);
              } else {
                console.warn(`[Mis Juzgados] ⚠️  No hay datos en la tabla cases`);
              }
            }
            
            // Debug: mostrar algunos ejemplos de juzgados en favoritos
            if (pjnFavoritos.length > 0) {
              const juzgadosEjemplos = [...new Set(pjnFavoritos.map(f => f.juzgado).filter(Boolean).slice(0, 10))];
              console.log(`[Mis Juzgados] Ejemplos de juzgados en favoritos (${juzgadosEjemplos.length}):`, juzgadosEjemplos);
              
              // Mostrar estadísticas
              const conJuzgado = pjnFavoritos.filter(f => f.juzgado).length;
              const conCaratula = pjnFavoritos.filter(f => f.caratula).length;
              const conFecha = pjnFavoritos.filter(f => f.fecha_ultima_carga).length;
              console.log(`[Mis Juzgados] Estadísticas de favoritos: ${conJuzgado} con juzgado, ${conCaratula} con carátula, ${conFecha} con fecha`);
            } else {
              console.warn(`[Mis Juzgados] ⚠️  No hay favoritos disponibles (ni en pjn_favoritos ni en cases)`);
            }
          } else {
            console.warn(`[Mis Juzgados] ⚠️  No se recibieron datos de pjn_favoritos (data es null/undefined)`);
          }
      } catch (err: any) {
        console.error(`[Mis Juzgados] ❌ Error inesperado al cargar favoritos:`, err);
        console.error(`[Mis Juzgados] Error message:`, err?.message);
        console.error(`[Mis Juzgados] Error stack:`, err?.stack);
        setMsg(msg ? `${msg} Error al cargar favoritos: ${err?.message || 'Error desconocido'}` : `Error al cargar favoritos: ${err?.message || 'Error desconocido'}`);
      }

      // Filtrar favoritos por juzgados asignados (si aplica)
      let favoritosFiltrados = pjnFavoritos;
      if (juzgadoFilter === "beneficio") {
        // Filtrar favoritos por "BENEFICIO DE LITIGAR SIN GASTOS" en la carátula
        const fraseBeneficio = "BENEFICIO DE LITIGAR SIN GASTOS";
        favoritosFiltrados = pjnFavoritos.filter((f: PjnFavorito) => {
          if (!f.caratula) return false;
          const caratulaUpper = f.caratula.toUpperCase();
          if (!caratulaUpper.includes(fraseBeneficio)) return false;
          
          // Respetar la distribución por juzgados asignados
          if (juzgadosNormalizados.length > 0) {
            if (!f.juzgado) return false;
            const juzgadoNormalizado = normalizarJuzgado(f.juzgado);
            return juzgadosNormalizados.some(jAsignado => {
              if (juzgadoNormalizado === jAsignado) return true;
              const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
              const numFavorito = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
              if (numAsignado && numFavorito && numAsignado === numFavorito) {
                if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
                  return true;
                }
              }
              return false;
            });
          }
          return true;
        });
        console.log(`[Mis Juzgados] ✅ Favoritos filtrados por BENEFICIO: ${favoritosFiltrados.length} de ${pjnFavoritos.length}`);
      } else if (juzgadoFilter && juzgadoFilter !== "mis_juzgados" && juzgadoFilter !== "todos" && juzgadoFilter !== "beneficio") {
        // Filtro por juzgado específico
        const juzgadoFiltroNormalizado = normalizarJuzgado(juzgadoFilter);
        favoritosFiltrados = pjnFavoritos.filter((f: PjnFavorito) => {
          if (!f.juzgado) return false;
          const juzgadoNormalizado = normalizarJuzgado(f.juzgado);
          if (juzgadoNormalizado === juzgadoFiltroNormalizado) return true;
          const numFiltro = juzgadoFiltroNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
          const numFavorito = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
          if (numFiltro && numFavorito && numFiltro === numFavorito) {
            if (juzgadoFiltroNormalizado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
              return true;
            }
          }
          return false;
        });
        console.log(`[Mis Juzgados] ✅ Favoritos filtrados por juzgado específico "${juzgadoFilter}": ${favoritosFiltrados.length}`);
      } else if (juzgadoFilter === "mis_juzgados" && juzgadosNormalizados.length > 0) {
        console.log(`[Mis Juzgados] Filtrando ${pjnFavoritos.length} favoritos por ${juzgadosNormalizados.length} juzgados asignados...`);
        
        favoritosFiltrados = pjnFavoritos.filter((f: PjnFavorito) => {
          if (!f.juzgado) {
            return false;
          }
          
          // Usar comparación estricta
          const matched = juzgadosNormalizados.some(jAsignado => {
            return juzgadosCoinciden(f.juzgado || "", jAsignado);
          });
          
          return matched;
        });
        
        console.log(`[Mis Juzgados] ✅ Favoritos filtrados por juzgados: ${favoritosFiltrados.length} de ${pjnFavoritos.length}`);
        
        // Debug: mostrar algunos ejemplos de favoritos que coincidieron
        if (favoritosFiltrados.length > 0) {
          const ejemplos = favoritosFiltrados.slice(0, 3).map(f => ({
            juzgado: f.juzgado,
            caratula: f.caratula?.substring(0, 50) + '...'
          }));
          console.log(`[Mis Juzgados] Ejemplos de favoritos que coincidieron:`, ejemplos);
        } else if (pjnFavoritos.length > 0) {
          console.warn(`[Mis Juzgados] ⚠️  No se encontraron favoritos que coincidan con los juzgados asignados`);
          console.warn(`[Mis Juzgados] Juzgados asignados (primeros 5):`, juzgadosNormalizados.slice(0, 5));
          console.warn(`[Mis Juzgados] Juzgados en favoritos (primeros 5):`, [...new Set(pjnFavoritos.map(f => normalizarJuzgado(f.juzgado)).filter(Boolean).slice(0, 5))]);
        }
      } else {
        console.log(`[Mis Juzgados] Mostrando TODOS los favoritos (sin filtrar por juzgados)`);
      }

      // Convertir favoritos a formato Expediente y combinar con expedientes locales
      const favoritosComoExpedientes: Expediente[] = favoritosFiltrados.map((f: PjnFavorito) => {
        const numeroExpediente = `${f.jurisdiccion} ${f.numero}/${f.anio}`;
        const fechaISO = ddmmaaaaToISO(f.fecha_ultima_carga);
        
        return {
          id: `pjn_${f.id}`, // Prefijo para identificar que viene de pjn
          owner_user_id: "", // Los favoritos no tienen owner
          caratula: f.caratula,
          juzgado: f.juzgado,
          numero_expediente: numeroExpediente,
          fecha_ultima_modificacion: fechaISO,
          estado: "ABIERTO", // Los favoritos siempre están abiertos
          observaciones: f.observaciones,
          notas: (f as any).notas || null, // Usar notas del favorito si existe
          created_by_user_id: null,
          created_by_name: "PJN Favoritos", // Indicar que viene de favoritos
          is_pjn_favorito: true,
        };
      });

      // Filtrar expedientes según el filtro seleccionado
      let exps = allExpsData ?? [];
      
      // Solo filtrar por juzgados si el filtro es "mis_juzgados" y hay juzgados asignados
      if (juzgadoFilter === "mis_juzgados" && juzgadosNormalizados.length > 0) {
        exps = allExpsData?.filter((e: any) => {
          if (!e.juzgado) return false;
          return juzgadosNormalizados.some(jAsignado => {
            return juzgadosCoinciden(e.juzgado, jAsignado);
          });
        }) ?? [];
        console.log(`[Mis Juzgados] Expedientes filtrados por juzgados: ${exps.length} de ${allExpsData?.length || 0}`);
      } else if (juzgadoFilter === "todos") {
        // No filtrar, mostrar todos los expedientes
        exps = allExpsData ?? [];
        console.log(`[Mis Juzgados] Mostrando TODOS los expedientes: ${exps.length}`);
      } else if (juzgadoFilter === "beneficio") {
        // Filtrar por "BENEFICIO DE LITIGAR SIN GASTOS" en la carátula
        const fraseBeneficio = "BENEFICIO DE LITIGAR SIN GASTOS";
        exps = (allExpsData ?? []).filter((e: any) => {
          if (!e.caratula) return false;
          const caratulaUpper = e.caratula.toUpperCase();
          if (!caratulaUpper.includes(fraseBeneficio)) return false;
          
          // Respetar la distribución por juzgados asignados
          if (juzgadosNormalizados.length > 0) {
            if (!e.juzgado) return false;
            return juzgadosNormalizados.some(jAsignado => {
              return juzgadosCoinciden(e.juzgado, jAsignado);
            });
          }
          return true;
        });
        console.log(`[Mis Juzgados] Expedientes con BENEFICIO: ${exps.length} de ${allExpsData?.length || 0}`);
      } else if (juzgadoFilter && juzgadoFilter !== "mis_juzgados" && juzgadoFilter !== "todos" && juzgadoFilter !== "beneficio") {
        // Filtro por juzgado específico
        exps = (allExpsData ?? []).filter((e: any) => {
          if (!e.juzgado) return false;
          return juzgadosCoinciden(e.juzgado, juzgadoFilter);
        });
        console.log(`[Mis Juzgados] Expedientes filtrados por juzgado específico "${juzgadoFilter}": ${exps.length}`);
      }

      // Combinar expedientes locales con favoritos de pjn
      const todosLosExpedientes = [...exps, ...favoritosComoExpedientes];
      console.log(`[Mis Juzgados] Total expedientes (locales + favoritos): ${todosLosExpedientes.length} (${exps.length} locales + ${favoritosComoExpedientes.length} favoritos)`);

      // Debug: verificar created_by_user_id en los expedientes
      console.log(`[Mis Juzgados] Expedientes encontrados: ${todosLosExpedientes.length}`);
      console.log(`[Mis Juzgados] Expedientes con created_by_user_id:`, todosLosExpedientes.filter((e: any) => e.created_by_user_id).length);
      
      if (todosLosExpedientes && todosLosExpedientes.length > 0) {
        // Obtener nombres de usuarios que crearon los expedientes (solo los locales, no los favoritos)
        const userIds = [...new Set((todosLosExpedientes ?? []).map((e: any) => e.created_by_user_id).filter(Boolean))];
        console.log(`[Mis Juzgados] UserIds únicos encontrados:`, userIds);
        
        let userNames: Record<string, string> = {};
        if (userIds.length > 0) {
          console.log(`[Mis Juzgados] Buscando profiles para ${userIds.length} userIds:`, userIds);
          
          const { data: profiles, error: profilesErr } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", userIds);
          
          if (profilesErr) {
            console.error(`[Mis Juzgados] Error al obtener profiles:`, profilesErr);
            console.error(`[Mis Juzgados] Error details:`, {
              message: profilesErr.message,
              code: (profilesErr as any).code,
              details: (profilesErr as any).details,
              hint: (profilesErr as any).hint
            });
          }
          
          if (profiles && profiles.length > 0) {
            console.log(`[Mis Juzgados] Profiles encontrados (${profiles.length}):`, profiles);
            userNames = profiles.reduce((acc: Record<string, string>, p: any) => {
              const name = p.full_name || p.email || "Sin nombre";
              acc[p.id] = name;
              console.log(`[Mis Juzgados] Mapeado userId ${p.id} -> ${name}`);
              return acc;
            }, {});
          } else {
            console.warn(`[Mis Juzgados] No se encontraron profiles para los userIds:`, userIds);
            console.warn(`[Mis Juzgados] profiles data:`, profiles);
            console.warn(`[Mis Juzgados] profiles error:`, profilesErr);
          }
        } else {
          console.warn(`[Mis Juzgados] No hay userIds para buscar nombres`);
        }
        
        const processedExps = (todosLosExpedientes ?? []).map((e: any) => {
          // Si es un favorito de pjn, ya tiene created_by_name = "PJN Favoritos"
          if (e.is_pjn_favorito) {
            return e;
          }
          
          // Para expedientes locales, buscar el nombre del usuario
          const createdByName = e.created_by_user_id ? (userNames[e.created_by_user_id] || null) : null;
          if (!createdByName && e.created_by_user_id) {
            console.warn(`[Mis Juzgados] No se encontró nombre para userId: ${e.created_by_user_id}`);
          }
          return {
            ...e,
            observaciones: e.observaciones || null, // Mantener observaciones si existe
            notas: e.notas || null, // Mantener notas si existe
            created_by_name: createdByName,
          };
        });
        
        console.log(`[Mis Juzgados] Expedientes procesados con nombres:`, processedExps.filter((e: any) => e.created_by_name).length);
        
        setExpedientes(processedExps as Expediente[]);
      } else {
        setExpedientes([]);
      }

      // Cargar todas las cédulas y oficios y filtrar por juzgados asignados
      // Intentar incluir tipo_documento, pdf_path y created_by_user_id, pero si no existen, usar select sin ellas
      let queryCedulas = supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado, tipo_documento, pdf_path, created_by_user_id")
        .neq("estado", "CERRADA")
        .order("fecha_carga", { ascending: true }); // Por defecto: más viejo primero
      
      const { data: allCs, error: cErr } = await queryCedulas;
      
      // Si el error es porque las columnas no existen, intentar sin ellas
      let allCsData = allCs;
      if (cErr) {
        const errorMsg = cErr.message || String(cErr) || "";
        const errorCode = (cErr as any).code || "";
        const errorDetails = (cErr as any).details || "";
        
        // Detectar si es un error de columna faltante
        const isColumnError = 
          errorMsg.includes("tipo_documento") || 
          errorMsg.includes("created_by_user_id") ||
          errorMsg.includes("pdf_path") ||
          errorMsg.includes("does not exist") ||
          errorMsg.includes("column") ||
          errorCode === "PGRST116" ||
          errorDetails?.includes("tipo_documento") ||
          errorDetails?.includes("created_by_user_id") ||
          errorDetails?.includes("pdf_path");
        
        if (isColumnError) {
          // Intentar primero con pdf_path pero sin tipo_documento y created_by_user_id
          let { data: allCs2, error: cErr2 } = await supabase
            .from("cedulas")
            .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado, pdf_path")
            .neq("estado", "CERRADA")
            .order("fecha_carga", { ascending: true }); // Por defecto: más viejo primero
          
          // Si aún falla, intentar sin pdf_path también
          if (cErr2 && (cErr2.message?.includes("pdf_path") || String(cErr2).includes("pdf_path"))) {
            const { data: allCs3, error: cErr3 } = await supabase
              .from("cedulas")
              .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado")
              .neq("estado", "CERRADA")
              .order("fecha_carga", { ascending: true });
            
            if (cErr3) {
              setMsg(msg ? `${msg} Error al cargar cédulas: ${cErr3.message}` : `Error al cargar cédulas: ${cErr3.message}`);
            } else {
              allCsData = allCs3?.map((c: any) => ({ 
                ...c, 
                tipo_documento: null, 
                created_by_user_id: null,
                pdf_path: null
              })) ?? [];
            }
          } else if (cErr2) {
            setMsg(msg ? `${msg} Error al cargar cédulas: ${cErr2.message}` : `Error al cargar cédulas: ${cErr2.message}`);
          } else {
            // Agregar propiedades faltantes como null para mantener el tipo correcto
            allCsData = allCs2?.map((c: any) => ({ 
              ...c, 
              tipo_documento: null, 
              created_by_user_id: null 
            })) ?? [];
          }
        } else {
          setMsg(msg ? `${msg} Error al cargar cédulas: ${errorMsg}` : `Error al cargar cédulas: ${errorMsg}`);
        }
      }
      
      // Filtrar cédulas/oficios según el filtro seleccionado
      let cs = allCsData ?? [];
      
      // Solo filtrar por juzgados si el filtro es "mis_juzgados" y hay juzgados asignados
      if (juzgadoFilter === "mis_juzgados" && juzgadosNormalizados.length > 0) {
        cs = allCsData?.filter((c: any) => {
          if (!c.juzgado) return false;
          
          const juzgadoNormalizado = normalizarJuzgado(c.juzgado);
          
          // Debug: log para ver qué se está comparando
          const matched = juzgadosNormalizados.some(jAsignado => {
            // Comparación exacta normalizada
            if (juzgadoNormalizado === jAsignado) {
              return true;
            }
            
            // Comparación por número de juzgado (más flexible)
            const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
            const numCedula = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
            
            if (numAsignado && numCedula && numAsignado === numCedula) {
              // Si ambos tienen el mismo número y contienen "Juzgado", considerarlos iguales
              const hasJuzgado = jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO");
              if (hasJuzgado) {
                return true;
              }
            }
            
            return false;
          });
          
          return matched;
        }) ?? [];
        console.log(`[Mis Juzgados] Cédulas filtradas por juzgados: ${cs.length} de ${allCsData?.length || 0}`);
      } else if (juzgadoFilter === "todos") {
        // No filtrar, mostrar todas las cédulas
        cs = allCsData ?? [];
        console.log(`[Mis Juzgados] Mostrando TODAS las cédulas: ${cs.length}`);
      } else if (juzgadoFilter === "beneficio") {
        // El filtro "beneficio" solo aplica a expedientes (tienen carátula), no a cédulas
        cs = [];
        console.log(`[Mis Juzgados] Filtro "beneficio" no aplica a cédulas, mostrando 0`);
      } else if (juzgadoFilter && juzgadoFilter !== "mis_juzgados" && juzgadoFilter !== "todos" && juzgadoFilter !== "beneficio") {
        // Filtro por juzgado específico
        const juzgadoFiltroNormalizado = normalizarJuzgado(juzgadoFilter);
        cs = (allCsData ?? []).filter((c: any) => {
          if (!c.juzgado) return false;
          const juzgadoNormalizado = normalizarJuzgado(c.juzgado);
          if (juzgadoNormalizado === juzgadoFiltroNormalizado) return true;
          const numFiltro = juzgadoFiltroNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
          const numJuzgado = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
          if (numFiltro && numJuzgado && numFiltro === numJuzgado) {
            if (juzgadoFiltroNormalizado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
              return true;
            }
          }
          return false;
        });
        console.log(`[Mis Juzgados] Cédulas filtradas por juzgado específico "${juzgadoFilter}": ${cs.length}`);
      }
      
      // Debug: mostrar cantidad de cédulas encontradas
      console.log(`[Mis Juzgados] Total cédulas cargadas: ${allCsData?.length || 0}, Filtradas por juzgados: ${cs.length}`);
      
      if (cs && cs.length > 0) {
        // Obtener nombres de usuarios que crearon las cédulas
        const userIds = [...new Set((cs ?? []).map((c: any) => c.created_by_user_id).filter(Boolean))];
        console.log(`[Mis Juzgados] Cédulas con created_by_user_id: ${userIds.length}/${cs.length}`);
        console.log(`[Mis Juzgados] UserIds únicos en cédulas:`, userIds);
        
        let userNames: Record<string, string> = {};
        if (userIds.length > 0) {
          console.log(`[Mis Juzgados] Buscando profiles para cédulas (${userIds.length} userIds):`, userIds);
          
          const { data: profiles, error: profilesErr } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", userIds);
          
          if (profilesErr) {
            console.error(`[Mis Juzgados] Error al obtener profiles para cédulas:`, profilesErr);
            console.error(`[Mis Juzgados] Error details (cédulas):`, {
              message: profilesErr.message,
              code: (profilesErr as any).code,
              details: (profilesErr as any).details,
              hint: (profilesErr as any).hint
            });
          }
          
          if (profiles && profiles.length > 0) {
            console.log(`[Mis Juzgados] Profiles encontrados para cédulas (${profiles.length}):`, profiles);
            userNames = profiles.reduce((acc: Record<string, string>, p: any) => {
              const name = p.full_name || p.email || "Sin nombre";
              acc[p.id] = name;
              console.log(`[Mis Juzgados] Mapeado userId cédula ${p.id} -> ${name}`);
              return acc;
            }, {});
          } else {
            console.warn(`[Mis Juzgados] No se encontraron profiles para los userIds de cédulas:`, userIds);
            console.warn(`[Mis Juzgados] profiles data (cédulas):`, profiles);
            console.warn(`[Mis Juzgados] profiles error (cédulas):`, profilesErr);
          }
        }
        
        const processedCedulas = (cs ?? []).map((c: any) => {
          const createdByName = c.created_by_user_id ? (userNames[c.created_by_user_id] || null) : null;
          if (!createdByName && c.created_by_user_id) {
            console.warn(`[Mis Juzgados] No se encontró nombre para userId de cédula: ${c.created_by_user_id}`);
          }
          return {
            ...c,
            tipo_documento: c.tipo_documento || null, // Será null si la columna no existe
            created_by_user_id: c.created_by_user_id || null, // Será null si la columna no existe
            created_by_name: createdByName,
          };
        });
        
        console.log(`[Mis Juzgados] Cédulas procesadas con nombres:`, processedCedulas.filter((c: any) => c.created_by_name).length);
        
        setCedulas(processedCedulas as Cedula[]);
      } else {
        setCedulas([]);
      }

      // Cargar fecha de última sincronización con PJN
      try {
        // Intentar primero sin filtro por ID (puede haber problemas con el formato UUID)
        let { data: syncMetadata, error: syncErr } = await supabase
          .from("pjn_sync_metadata")
          .select("last_sync_at")
          .limit(1)
          .maybeSingle();

        // Si falla, intentar con el ID fijo
        if (syncErr || !syncMetadata) {
          const fixedId = '00000000-0000-0000-0000-000000000001';
          const result = await supabase
            .from("pjn_sync_metadata")
            .select("last_sync_at")
            .eq("id", fixedId)
            .maybeSingle();
          
          syncMetadata = result.data;
          syncErr = result.error;
        }

        if (syncErr) {
          console.warn("[Mis Juzgados] Error al cargar fecha de sincronización:", syncErr);
          console.warn("[Mis Juzgados] Error code:", (syncErr as { code?: string }).code);
          console.warn("[Mis Juzgados] Error message:", syncErr.message);
          // Si la tabla no existe, no es crítico, solo no mostramos la fecha
          if ((syncErr as { code?: string }).code === 'PGRST116' || syncErr.message?.includes('does not exist')) {
            console.log("[Mis Juzgados] Tabla pjn_sync_metadata no existe aún. Ejecuta la migración SQL.");
          }
        } else if (syncMetadata?.last_sync_at) {
          console.log("[Mis Juzgados] ✅ Fecha de sincronización cargada:", syncMetadata.last_sync_at);
          setLastSyncDate(syncMetadata.last_sync_at);
        } else {
          console.log("[Mis Juzgados] ⚠️  No hay fecha de sincronización disponible aún.");
          console.log("[Mis Juzgados] syncMetadata:", syncMetadata);
        }
      } catch (syncError) {
        console.error("[Mis Juzgados] ❌ Error inesperado al cargar fecha de sincronización:", syncError);
      }

      setLoading(false);
    } catch (err) {
      console.error("Error loading data:", err);
      setMsg("Error al cargar los datos. Por favor intenta nuevamente.");
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Recargar datos cuando cambia el filtro de juzgados
  useEffect(() => {
    if (!loading) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [juzgadoFilter]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  // Inicializar notas editables cuando cambian los expedientes
  useEffect(() => {
    if (activeTab === "expedientes" && expedientes.length > 0) {
      setNotasEditables(prev => {
        // Solo actualizar las que no están siendo editadas
        const merged = { ...prev };
        expedientes.forEach(e => {
          if (e.notas && !(e.id in merged)) {
            merged[e.id] = e.notas;
          }
        });
        return merged;
      });
    }
  }, [expedientes, activeTab]);

  const cedulasFiltered = useMemo(() => {
    return cedulas.filter(c => !c.tipo_documento || c.tipo_documento === "CEDULA");
  }, [cedulas]);

  const oficiosFiltered = useMemo(() => {
    return cedulas.filter(c => c.tipo_documento === "OFICIO");
  }, [cedulas]);

  // Obtener juzgados únicos de los juzgados asignados, ordenados ascendente
  const juzgadosAsignadosOrdenados = useMemo(() => {
    if (userJuzgados.length === 0) return [];
    const juzgadosUnicos = [...new Set(userJuzgados)];
    return juzgadosUnicos.sort((a, b) => {
      const aNorm = a?.trim().replace(/\s+/g, " ").toUpperCase() || "";
      const bNorm = b?.trim().replace(/\s+/g, " ").toUpperCase() || "";
      return aNorm.localeCompare(bNorm, 'es', { numeric: true, sensitivity: 'base' });
    });
  }, [userJuzgados]);

  async function abrirArchivo(path: string) {
    if (!path) {
      setMsg("No hay archivo disponible para abrir");
      return;
    }

    try {
      // Obtener el token de sesión para autenticación
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setMsg("No estás autenticado");
        return;
      }

      // Usar el endpoint API que sirve el archivo con headers para abrirlo en el navegador
      const url = `/api/open-file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(sessionData.session.access_token)}`;
      
      // Obtener el archivo y crear un blob URL para abrirlo directamente en el navegador
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        setMsg("No se pudo abrir el archivo: " + errorText);
        return;
      }

      // Obtener el Content-Type del response
      const contentType = response.headers.get("Content-Type") || "application/octet-stream";
      
      // Obtener el blob y crear uno nuevo con el tipo MIME explícito
      const blob = await response.blob();
      const typedBlob = new Blob([blob], { type: contentType });
      const blobUrl = URL.createObjectURL(typedBlob);
      
      // Abrir el blob URL en una nueva pestaña - el navegador lo abrirá según el tipo MIME
      // Para PDFs se abrirá en el visor del navegador, para otros tipos dependerá del navegador
      window.open(blobUrl, "_blank");
      
      // Limpiar el blob URL después de un tiempo para liberar memoria
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error: any) {
      console.error("Error al abrir archivo:", error);
      setMsg("Error al abrir el archivo: " + (error?.message || "Error desconocido"));
    }
  }

  // Preparar y ordenar items según sortField y sortDirection
  // Por defecto: ordenar por fecha ascendente (más viejo primero)
  // IMPORTANTE: Este useMemo debe estar ANTES del return condicional para cumplir las reglas de Hooks
  const createdByOptions = useMemo(() => {
    const map = new Map<string, string>();
    // Expedientes locales (y favoritos PJN como opción fija)
    for (const e of expedientes) {
      if (e.is_pjn_favorito) continue;
      if (e.created_by_user_id) {
        map.set(e.created_by_user_id, e.created_by_name || "Sin nombre");
      }
    }
    // Cédulas/oficios
    for (const c of cedulas) {
      if (c.created_by_user_id) {
        map.set(c.created_by_user_id, c.created_by_name || "Sin nombre");
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [expedientes, cedulas]);

  const sortedItems = useMemo(() => {
    // Preparar items según el tab activo
    const itemsToShow = activeTab === "expedientes" 
      ? expedientes.map(e => ({
          type: "expediente" as const,
          id: e.id,
          caratula: e.caratula,
          juzgado: e.juzgado,
          fecha: e.fecha_ultima_modificacion,
          numero: e.numero_expediente,
          created_by: e.created_by_name,
          created_by_user_id: e.created_by_user_id,
          is_pjn_favorito: e.is_pjn_favorito === true,
          observaciones: e.observaciones,
          notas: e.notas || null,
          dias: e.fecha_ultima_modificacion ? daysSince(e.fecha_ultima_modificacion) : null,
          semaforo: e.fecha_ultima_modificacion ? semaforoByAge(daysSince(e.fecha_ultima_modificacion)) : "VERDE" as Semaforo,
        }))
      : activeTab === "cedulas"
      ? cedulasFiltered.map(c => ({
          type: "cedula" as const,
          id: c.id,
          caratula: c.caratula,
          juzgado: c.juzgado,
          fecha: c.fecha_carga,
          numero: null,
          created_by: c.created_by_name,
          created_by_user_id: c.created_by_user_id || null,
          pdf_path: c.pdf_path,
          tipo_documento: c.tipo_documento,
          dias: c.fecha_carga ? daysSince(c.fecha_carga) : null,
          semaforo: c.fecha_carga ? semaforoByAge(daysSince(c.fecha_carga)) : "VERDE" as Semaforo,
        }))
      : oficiosFiltered.map(o => ({
          type: "oficio" as const,
          id: o.id,
          caratula: o.caratula,
          juzgado: o.juzgado,
          fecha: o.fecha_carga,
          numero: null,
          created_by: o.created_by_name,
          created_by_user_id: o.created_by_user_id || null,
          pdf_path: o.pdf_path,
          tipo_documento: o.tipo_documento,
          observaciones: null,
          dias: o.fecha_carga ? daysSince(o.fecha_carga) : null,
          semaforo: o.fecha_carga ? semaforoByAge(daysSince(o.fecha_carga)) : "VERDE" as Semaforo,
        }));
    
    // Preparar items para mostrar (agregar observaciones y notas si faltan)
    const itemsWithObservations = itemsToShow.map(item => ({
      ...item,
      observaciones: 'observaciones' in item ? item.observaciones : null,
      notas: 'notas' in item ? item.notas : null
    }));

    // Aplicar filtro "Cargado por"
    let filteredByCreator = itemsWithObservations;
    if (createdByFilter !== "all") {
      filteredByCreator = itemsWithObservations.filter((item: any) => {
        // Favoritos PJN
        if (createdByFilter === "pjn") {
          return item.is_pjn_favorito === true || item.created_by === "PJN Favoritos";
        }
        // Otros usuarios
        return item.created_by_user_id === createdByFilter;
      });
    }

    // Aplicar filtro de semáforo
    let filtered = filteredByCreator;
    if (semaforoFilter) {
      filtered = filteredByCreator.filter((item) => item.semaforo === semaforoFilter);
    }

    // Aplicar filtro de búsqueda (busca en número de expediente y carátula)
    if (searchTerm.trim()) {
      const searchLower = searchTerm.trim().toLowerCase();
      filtered = filtered.filter((item: any) => {
        // Buscar en número de expediente (la propiedad se llama "numero" en los items mapeados)
        const numeroExpediente = (item.numero || "").toLowerCase();
        // Buscar en carátula
        const caratula = (item.caratula || "").toLowerCase();
        return numeroExpediente.includes(searchLower) || caratula.includes(searchLower);
      });
    }

    // Ordenar items
    const sorted = [...filtered];
    
    sorted.sort((a, b) => {
      let compareA: number;
      let compareB: number;

      // Si no hay sortField, usar fecha ascendente por defecto
      const currentSortField = sortField || "fecha";
      const currentSortDirection = sortField ? sortDirection : "asc";

      if (currentSortField === "dias") {
        compareA = a.dias ?? -1;
        compareB = b.dias ?? -1;
      } else if (currentSortField === "semaforo") {
        const semOrder: Record<Semaforo, number> = { ROJO: 2, AMARILLO: 1, VERDE: 0 };
        compareA = semOrder[a.semaforo as Semaforo] ?? 0;
        compareB = semOrder[b.semaforo as Semaforo] ?? 0;
      } else if (currentSortField === "fecha") {
        if (!a.fecha && !b.fecha) return 0;
        if (!a.fecha) return 1; // Los sin fecha van al final
        if (!b.fecha) return -1;
        compareA = new Date(a.fecha).getTime();
        compareB = new Date(b.fecha).getTime();
      } else if (currentSortField === "juzgado") {
        // Ordenamiento alfabético de juzgado (case-insensitive)
        // null va al final
        const juzgadoA = (a.juzgado || "").trim().toUpperCase();
        const juzgadoB = (b.juzgado || "").trim().toUpperCase();
        if (!juzgadoA && !juzgadoB) return 0;
        if (!juzgadoA) return 1;
        if (!juzgadoB) return -1;
        // Comparación alfabética directa
        if (juzgadoA < juzgadoB) return currentSortDirection === "asc" ? -1 : 1;
        if (juzgadoA > juzgadoB) return currentSortDirection === "asc" ? 1 : -1;
        return 0;
      } else {
        return 0;
      }

      const diff = compareA - compareB;
      return currentSortDirection === "asc" ? diff : -diff;
    });

    return sorted;
  }, [activeTab, expedientes, cedulasFiltered, oficiosFiltered, sortField, sortDirection, semaforoFilter, createdByFilter, searchTerm]);

  // Paginación: solo para expedientes
  const paginatedItems = useMemo(() => {
    if (activeTab !== "expedientes") {
      return sortedItems; // Sin paginación para cédulas/oficios
    }
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sortedItems.slice(startIndex, endIndex);
  }, [sortedItems, currentPage, activeTab]);

  const totalPages = useMemo(() => {
    if (activeTab !== "expedientes") return 1;
    return Math.ceil(sortedItems.length / itemsPerPage);
  }, [sortedItems.length, activeTab]);

  // Resetear a página 1 cuando cambia el filtro o el tab
  useEffect(() => {
    setCurrentPage(1);
  }, [juzgadoFilter, createdByFilter, semaforoFilter, activeTab, searchTerm]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      // Si ya está ordenado por este campo, cambiar dirección
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Si es un campo nuevo, empezar con ascendente
      setSortField(field);
      setSortDirection("asc");
    }
  }

  async function refreshData() {
    setLoading(true);
    setMsg("");
    await loadData();
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
    <main className="container" style={{ maxWidth: '95%', width: 'min(2400px, calc(100% - 32px))' }}>
      <section className="card">
        <header style={{
          background: "linear-gradient(135deg, rgba(0,82,156,.25), rgba(0,82,156,.08))",
          borderBottom: "1px solid rgba(255,255,255,.12)",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          position: "relative"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Menú Hamburguesa */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              style={{
                background: "rgba(255,255,255,.08)",
                border: "1px solid rgba(255,255,255,.16)",
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                minWidth: 40,
                minHeight: 40
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,.08)";
              }}
            >
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
              <div style={{ width: 20, height: 2, background: "var(--text)", borderRadius: 1 }} />
            </button>

            {/* Menú desplegable */}
            {menuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 24,
                  marginTop: 8,
                  background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
                  border: "1px solid rgba(255,255,255,.16)",
                  borderRadius: 12,
                  padding: "12px 0",
                  minWidth: 220,
                  boxShadow: "0 8px 24px rgba(0,0,0,.4)",
                  zIndex: 1000,
                  backdropFilter: "blur(10px)"
                }}
              >
                <Link
                  href="/superadmin"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    color: "var(--text)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid transparent"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.08)";
                    e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderLeftColor = "transparent";
                  }}
                >
                  📊 Dashboard SuperAdmin
                </Link>
                <Link
                  href="/superadmin/mis-juzgados"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    color: "var(--text)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid rgba(96,141,186,1)",
                    background: "rgba(255,255,255,.05)"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.05)";
                  }}
                >
                  📋 Mis Juzgados
                </Link>
                <Link
                  href="/app/expedientes/nueva"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 20px",
                    color: "var(--text)",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 600,
                    transition: "background 0.2s ease",
                    borderLeft: "3px solid transparent"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.08)";
                    e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderLeftColor = "transparent";
                  }}
                >
                  ➕ Carga Expedientes
                </Link>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flex: 1, gap: 16, minWidth: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "0.2px" }}>
                  Mis Juzgados
                </h1>
                <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "rgba(234,243,255,.65)", fontWeight: 400 }}>
                  Expedientes, cédulas y oficios de mis juzgados asignados
                </p>
              </div>
              {lastSyncDate && (
                <div style={{ 
                  display: "flex", 
                  flexDirection: "column", 
                  alignItems: "flex-end",
                  padding: "8px 14px",
                  background: "rgba(96,141,186,.12)",
                  border: "1px solid rgba(96,141,186,.25)",
                  borderRadius: 8,
                  flexShrink: 0,
                  minWidth: 200
                }}>
                  <span style={{ 
                    fontSize: 11, 
                    color: "rgba(234,243,255,.7)", 
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 4,
                    whiteSpace: "nowrap"
                  }}>
                    Última Actualización con PJN
                  </span>
                  <span style={{ 
                    fontSize: 13, 
                    color: "rgba(234,243,255,.95)", 
                    fontWeight: 600,
                    fontFamily: "monospace",
                    whiteSpace: "nowrap"
                  }}>
                    {(() => {
                      try {
                        if (!lastSyncDate) return "N/A";
                        const date = new Date(lastSyncDate);
                        if (isNaN(date.getTime())) {
                          console.warn("[Mis Juzgados] Fecha inválida:", lastSyncDate);
                          return "N/A";
                        }
                        // Convertir a hora local de Argentina (UTC-3)
                        const day = String(date.getDate()).padStart(2, '0');
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const year = String(date.getFullYear()).slice(-2);
                        const hours = String(date.getHours()).padStart(2, '0');
                        const minutes = String(date.getMinutes()).padStart(2, '0');
                        return `${day}/${month}/${year} ${hours}:${minutes}`;
                      } catch (err) {
                        console.error("[Mis Juzgados] Error al formatear fecha:", err, "lastSyncDate:", lastSyncDate);
                        return "N/A";
                      }
                    })()}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {currentUserName && (
              <div
                style={{
                  padding: "8px 14px",
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.14)",
                  borderRadius: 999,
                  color: "rgba(234,243,255,.92)",
                  fontSize: 13,
                  fontWeight: 650,
                  letterSpacing: "0.01em",
                  maxWidth: 260,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 40,
                }}
                title={currentUserName}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#4ade80",
                    boxShadow: "0 0 0 2px rgba(74,222,128,.35)",
                  }}
                />
                <span>{currentUserName}</span>
              </div>
            )}

            <button
              onClick={refreshData}
              disabled={loading}
              style={{
                padding: "10px 16px",
                background: "rgba(96,141,186,.15)",
                border: "1px solid rgba(96,141,186,.35)",
                borderRadius: 10,
                color: "var(--brand-blue-2)",
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
                transition: "all 0.2s ease",
                opacity: loading ? 0.6 : 1,
                height: 40,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = "rgba(96,141,186,.25)";
                  e.currentTarget.style.borderColor = "rgba(96,141,186,.45)";
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = "rgba(96,141,186,.15)";
                  e.currentTarget.style.borderColor = "rgba(96,141,186,.35)";
                }
              }}
              title="Actualizar datos"
            >
              🔄 Refresh
            </button>
            <button
              onClick={logout}
              style={{
                padding: "10px 16px",
                background: "rgba(225,57,64,.15)",
                border: "1px solid rgba(225,57,64,.35)",
                borderRadius: 10,
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                height: 40,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(225,57,64,.25)";
                e.currentTarget.style.borderColor = "rgba(225,57,64,.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(225,57,64,.15)";
                e.currentTarget.style.borderColor = "rgba(225,57,64,.35)";
              }}
            >
              Salir
            </button>
          </div>
        </header>

        <div className="page">
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Semáforo automático por antigüedad:
            </span>
            <button
              onClick={() => setSemaforoFilter(semaforoFilter === "VERDE" ? null : "VERDE")}
              style={{
                cursor: "pointer",
                border: semaforoFilter === "VERDE" ? "2px solid rgba(46, 204, 113, 0.8)" : "1px solid rgba(46, 204, 113, 0.35)",
                background: semaforoFilter === "VERDE" ? "rgba(46, 204, 113, 0.25)" : "rgba(46, 204, 113, 0.16)",
                color: "rgba(210, 255, 226, 0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.4,
                minWidth: 88,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              VERDE
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>0–29</span>
            <button
              onClick={() => setSemaforoFilter(semaforoFilter === "AMARILLO" ? null : "AMARILLO")}
              style={{
                cursor: "pointer",
                border: semaforoFilter === "AMARILLO" ? "2px solid rgba(241, 196, 15, 0.8)" : "1px solid rgba(241, 196, 15, 0.35)",
                background: semaforoFilter === "AMARILLO" ? "rgba(241, 196, 15, 0.25)" : "rgba(241, 196, 15, 0.14)",
                color: "rgba(255, 246, 205, 0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.4,
                minWidth: 88,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              AMARILLO
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>30–59</span>
            <button
              onClick={() => setSemaforoFilter(semaforoFilter === "ROJO" ? null : "ROJO")}
              style={{
                cursor: "pointer",
                border: semaforoFilter === "ROJO" ? "2px solid rgba(231, 76, 60, 0.8)" : "1px solid rgba(231, 76, 60, 0.35)",
                background: semaforoFilter === "ROJO" ? "rgba(231, 76, 60, 0.25)" : "rgba(231, 76, 60, 0.14)",
                color: "rgba(255, 220, 216, 0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 0.4,
                minWidth: 88,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
              }}
            >
              ROJO
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>60+ días</span>
            {semaforoFilter && (
              <button
                onClick={() => setSemaforoFilter(null)}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,.3)",
                  background: "rgba(255,255,255,.1)",
                  color: "var(--text)",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: 12,
                  transition: "all 0.2s ease",
                }}
              >
                Limpiar filtro
              </button>
            )}

            {/* Campo de búsqueda */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
                Buscar:
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Expediente, Carátula..."
                style={{
                  padding: "8px 10px",
                  background: "rgba(11,47,85,.95)",
                  border: "1px solid rgba(255,255,255,.2)",
                  borderRadius: 10,
                  color: "rgba(234,243,255,.95)",
                  fontSize: 13,
                  fontWeight: 600,
                  outline: "none",
                  minWidth: 250,
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(96,141,186,.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(96,141,186,.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,.2)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Filtro por Juzgado/Beneficio y Cargado por */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              {juzgadosAsignadosOrdenados.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
                    Juzgado:
                  </span>
                  <select
                    value={juzgadoFilter}
                    onChange={(e) => {
                      setJuzgadoFilter(e.target.value);
                      setCurrentPage(1); // Resetear a primera página al cambiar filtro
                    }}
                    style={{
                      padding: "8px 10px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 10,
                      color: "rgba(234,243,255,.95)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      outline: "none",
                      minWidth: 220,
                      transition: "all 0.2s ease",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.5)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(96,141,186,.1)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "rgba(255,255,255,.2)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <option value="mis_juzgados" style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>
                      Mis Juzgados ({userJuzgados.length})
                    </option>
                    <option value="beneficio" style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>
                      Beneficio
                    </option>
                    {juzgadosAsignadosOrdenados.map((juzgado) => (
                      <option key={juzgado} value={juzgado} style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>
                        {juzgado}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Filtro "Cargado por" */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
                  Cargado por:
                </span>
              <select
                value={createdByFilter}
                onChange={(e) => setCreatedByFilter(e.target.value)}
                style={{
                  padding: "8px 10px",
                  background: "rgba(11,47,85,.95)",
                  border: "1px solid rgba(255,255,255,.2)",
                  borderRadius: 10,
                  color: "rgba(234,243,255,.95)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  outline: "none",
                  minWidth: 220,
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(96,141,186,.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(96,141,186,.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,.2)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <option value="all" style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>Todos</option>
                <option value="pjn" style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>PJN Favoritos</option>
                {createdByOptions.map((u) => (
                  <option key={u.id} value={u.id} style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {msg && <div className="error">{msg}</div>}

          {/* Tabs */}
          <div style={{ 
            display: "flex", 
            gap: 8, 
            marginBottom: 24,
            borderBottom: "1px solid rgba(255,255,255,.1)"
          }}>
            <button
              onClick={() => setActiveTab("expedientes")}
              style={{
                padding: "12px 20px",
                background: activeTab === "expedientes" ? "rgba(255,255,255,.1)" : "transparent",
                border: "none",
                borderBottom: activeTab === "expedientes" ? "2px solid var(--brand-blue-2)" : "2px solid transparent",
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              Expedientes ({expedientes.length})
            </button>
            <button
              onClick={() => setActiveTab("cedulas")}
              style={{
                padding: "12px 20px",
                background: activeTab === "cedulas" ? "rgba(255,255,255,.1)" : "transparent",
                border: "none",
                borderBottom: activeTab === "cedulas" ? "2px solid var(--brand-blue-2)" : "2px solid transparent",
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              Cédulas ({cedulasFiltered.length})
            </button>
            <button
              onClick={() => setActiveTab("oficios")}
              style={{
                padding: "12px 20px",
                background: activeTab === "oficios" ? "rgba(255,255,255,.1)" : "transparent",
                border: "none",
                borderBottom: activeTab === "oficios" ? "2px solid var(--brand-blue-2)" : "2px solid transparent",
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              Oficios ({oficiosFiltered.length})
            </button>
          </div>

          {/* Tabla */}
          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table" style={{ minWidth: '1800px' }}>
              <thead>
                <tr>
                  <th 
                    style={{ width: 130, cursor: "pointer" }}
                    onClick={() => handleSort("semaforo")}
                    title="Haz clic para ordenar"
                  >
                    Semáforo{" "}
                    <span style={{ opacity: sortField === "semaforo" ? 1 : 0.4 }}>
                      {sortField === "semaforo" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  <th>Carátula</th>
                  <th 
                    className="sortable"
                    style={{ cursor: "pointer" }}
                    onClick={() => handleSort("juzgado")}
                    title="Haz clic para ordenar"
                  >
                    Juzgado{" "}
                    <span style={{ opacity: sortField === "juzgado" ? 1 : 0.4 }}>
                      {sortField === "juzgado" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  <th 
                    style={{ width: 220, cursor: "pointer" }}
                    onClick={() => handleSort("fecha")}
                    title="Haz clic para ordenar"
                  >
                    {activeTab === "expedientes" ? "Fecha Última Modificación" : "Fecha de Carga"}{" "}
                    <span style={{ opacity: 1 }}>
                      {sortField === "fecha" ? (sortDirection === "asc" ? "↑" : "↓") : "↑"}
                    </span>
                  </th>
                  <th 
                    style={{ width: 80, textAlign: "right", cursor: "pointer" }}
                    onClick={() => handleSort("dias")}
                    title="Haz clic para ordenar"
                  >
                    Días{" "}
                    <span style={{ opacity: sortField === "dias" ? 1 : 0.4 }}>
                      {sortField === "dias" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  {activeTab === "expedientes" && (
                    <th style={{ width: 200 }}>Expediente</th>
                  )}
                  <th style={{ width: 180 }}>Cargado por</th>
                  {isAbogado && (activeTab === "cedulas" || activeTab === "oficios") && (
                    <th style={{ width: 140 }}>Acción</th>
                  )}
                  {activeTab === "expedientes" && (
                    <th style={{ width: 380, minWidth: 380, textAlign: "center" }}>Observaciones</th>
                  )}
                  {activeTab === "expedientes" && (
                    <th style={{ width: 380, minWidth: 380, textAlign: "center" }}>Notas</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((item: any) => {
                  const dias = item.dias ?? null;
                  const sem = item.semaforo || (dias !== null ? semaforoByAge(dias) : "VERDE");
                  
                  return (
                    <tr key={item.id} style={{ verticalAlign: "top" }}>
                      <td>
                        <SemaforoChip value={sem as Semaforo} />
                      </td>
                      <td style={{ fontWeight: 650 }}>
                        {item.caratula?.trim() ? item.caratula : <span className="muted">Sin carátula</span>}
                      </td>
                      <td>{item.juzgado?.trim() ? item.juzgado : <span className="muted">—</span>}</td>
                      <td>
                        {item.fecha ? isoToDDMMAAAA(item.fecha) : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {typeof dias === "number" && !isNaN(dias) ? dias : <span className="muted">—</span>}
                      </td>
                      {activeTab === "expedientes" && (
                        <td>
                          {item.numero?.trim() ? item.numero : <span className="muted">—</span>}
                        </td>
                      )}
                      <td>
                        {item.created_by ? (
                          <span style={{ fontSize: 13 }}>{item.created_by}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {isAbogado && (activeTab === "cedulas" || activeTab === "oficios") && (
                        <td>
                          {item.pdf_path ? (
                            <button
                              className="btn primary"
                              onClick={() => abrirArchivo(item.pdf_path)}
                              style={{
                                fontSize: 12,
                                padding: "6px 12px",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {item.tipo_documento === "OFICIO" ? "VER OFICIO" : "VER CÉDULA"}
                            </button>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>—</span>
                          )}
                        </td>
                      )}
                      {activeTab === "expedientes" && (
                        <td style={{ fontSize: 13, width: 380, minWidth: 380, textAlign: "center", padding: "11px 12px" }}>
                          {item.observaciones?.trim() ? (
                            <div style={{ 
                              padding: "8px 10px",
                              background: "rgba(255,255,255,.03)",
                              borderRadius: 8,
                              border: "1px solid rgba(255,255,255,.06)",
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              color: "rgba(234,243,255,.88)",
                              fontSize: 12.5,
                              letterSpacing: "0.01em",
                              textAlign: "left"
                            }}>
                              {item.observaciones}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      )}
                      {activeTab === "expedientes" && (
                        <td style={{ fontSize: 13, width: 380, minWidth: 380, textAlign: "center", padding: "11px 12px" }}>
                          <NotasTextarea
                            itemId={item.id}
                            isPjnFavorito={item.is_pjn_favorito === true}
                            initialValue={item.notas || ""}
                            notasEditables={notasEditables}
                            setNotasEditables={setNotasEditables}
                            notasGuardando={notasGuardando}
                            setNotasGuardando={setNotasGuardando}
                            setMsg={setMsg}
                            caratula={item.caratula}
                            numeroExpediente={item.numero}
                            juzgado={item.juzgado}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
                {sortedItems.length === 0 && (
                  <tr>
                    <td colSpan={
                      activeTab === "expedientes" 
                        ? 9 
                        : isAbogado 
                          ? 7 
                          : 6
                    } className="muted">
                      No hay {activeTab === "expedientes" ? "expedientes" : activeTab === "cedulas" ? "cédulas" : "oficios"} cargados para tus juzgados asignados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación - solo para expedientes */}
          {activeTab === "expedientes" && totalPages > 1 && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                margin: "24px auto",
                padding: "16px",
                background: "rgba(255,255,255,.02)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.06)",
                maxWidth: 680
              }}>
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  style={{
                    padding: "8px 16px",
                    background: currentPage === 1 ? "rgba(255,255,255,.05)" : "rgba(96,141,186,.2)",
                    border: `1px solid ${currentPage === 1 ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.4)"}`,
                    borderRadius: 8,
                    color: currentPage === 1 ? "rgba(255,255,255,.3)" : "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                    transition: "all 0.2s ease",
                    opacity: currentPage === 1 ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = "rgba(96,141,186,.3)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.6)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = "rgba(96,141,186,.2)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.4)";
                    }
                  }}
                >
                  Inicio
                </button>

                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: "8px 16px",
                    background: currentPage === 1 ? "rgba(255,255,255,.05)" : "rgba(96,141,186,.2)",
                    border: `1px solid ${currentPage === 1 ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.4)"}`,
                    borderRadius: 8,
                    color: currentPage === 1 ? "rgba(255,255,255,.3)" : "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                    transition: "all 0.2s ease",
                    opacity: currentPage === 1 ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = "rgba(96,141,186,.3)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.6)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== 1) {
                      e.currentTarget.style.background = "rgba(96,141,186,.2)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.4)";
                    }
                  }}
                >
                  ← Anterior
                </button>
                
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--text)",
                  fontSize: 14,
                  fontWeight: 600
                }}>
                  <span>Página</span>
                  <span style={{
                    padding: "6px 12px",
                    background: "rgba(96,141,186,.2)",
                    borderRadius: 6,
                    border: "1px solid rgba(96,141,186,.3)",
                    minWidth: 50,
                    textAlign: "center"
                  }}>
                    {currentPage}
                  </span>
                  <span>de</span>
                  <span style={{
                    padding: "6px 12px",
                    background: "rgba(255,255,255,.05)",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,.1)",
                    minWidth: 50,
                    textAlign: "center"
                  }}>
                    {totalPages}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                    ({sortedItems.length} expedientes)
                  </span>
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: "8px 16px",
                    background: currentPage === totalPages ? "rgba(255,255,255,.05)" : "rgba(96,141,186,.2)",
                    border: `1px solid ${currentPage === totalPages ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.4)"}`,
                    borderRadius: 8,
                    color: currentPage === totalPages ? "rgba(255,255,255,.3)" : "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                    transition: "all 0.2s ease",
                    opacity: currentPage === totalPages ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = "rgba(96,141,186,.3)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.6)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = "rgba(96,141,186,.2)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.4)";
                    }
                  }}
                >
                  Siguiente →
                </button>

                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: "8px 16px",
                    background: currentPage === totalPages ? "rgba(255,255,255,.05)" : "rgba(96,141,186,.2)",
                    border: `1px solid ${currentPage === totalPages ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.4)"}`,
                    borderRadius: 8,
                    color: currentPage === totalPages ? "rgba(255,255,255,.3)" : "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                    transition: "all 0.2s ease",
                    opacity: currentPage === totalPages ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = "rgba(96,141,186,.3)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.6)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== totalPages) {
                      e.currentTarget.style.background = "rgba(96,141,186,.2)";
                      e.currentTarget.style.borderColor = "rgba(96,141,186,.4)";
                    }
                  }}
                >
                  Fin
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
