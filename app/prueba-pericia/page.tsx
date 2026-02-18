"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pjnScraperSupabase } from "@/lib/pjn-scraper-supabase";
import { daysSince } from "@/lib/semaforo";

// Estilos globales para mejorar contraste del dropdown
if (typeof document !== 'undefined') {
  const styleId = 'prueba-pericia-dropdown-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
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

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  fecha_ultima_carga?: string | null;
  estado: string;
  observaciones: string | null;
  notas: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  is_pjn_favorito?: boolean;
};

type PjnFavorito = {
  id: string;
  jurisdiccion: string;
  numero: string;
  anio: number;
  caratula: string | null;
  juzgado: string | null;
  fecha_ultima_carga: string | null;
  observaciones: string | null;
  notas?: string | null;
  removido?: boolean | null;
  estado?: string | null;
  movimientos?: any;
};

// Normalizar juzgado
function normalizeJuzgado(raw: string | null): string | null {
  if (!raw) return null;
  const j = raw.trim().replace(/\s+/g, " ").toUpperCase();
  const mCivil = /^JUZGADO\s+CIVIL\s+(\d+)\b/i.exec(j);
  if (mCivil) return `JUZGADO CIVIL ${mCivil[1]}`;
  const stripped = j.replace(/\s*-\s*SECRETAR[ÍI]A\s*N[°º]?\s*\d+\s*.*$/i, "").trim();
  return stripped || null;
}

function limpiarJuzgadoParaMostrar(juzgado: string | null | undefined): string {
  if (!juzgado || !juzgado.trim()) return "";
  
  let juzgadoLimpio = juzgado.trim();
  
  const matchCivil = /JUZGADO\s+CIVIL\s+(\d+)/i.exec(juzgadoLimpio);
  if (matchCivil) {
    const numero = matchCivil[1];
    return `JUZGADO CIVIL ${numero}`;
  }
  
  juzgadoLimpio = juzgadoLimpio.replace(/\s*-\s*SECRETAR[ÍI]A\s*.*$/i, "").trim();
  juzgadoLimpio = juzgadoLimpio.replace(/\s+/g, " ").trim();
  
  return juzgadoLimpio || "";
}

function isoToDDMMAAAA(iso: string | null): string {
  if (!iso || iso.trim() === "") return "";
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatFecha(fecha: string | null | undefined): string {
  if (!fecha || fecha.trim() === "") return "";
  
  const ddmmaaaaPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (ddmmaaaaPattern.test(fecha.trim())) {
    return fecha.trim();
  }
  
  return isoToDDMMAAAA(fecha);
}

function ddmmaaaaToISO(ddmm: string | null): string | null {
  if (!ddmm || ddmm.trim() === "") return null;
  
  const fechaTrim = ddmm.trim();
  
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fechaTrim);
  if (m) {
    const [, dia, mes, anio] = m;
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  
  const isoPattern = /^(\d{4})-(\d{2})-(\d{2})/;
  if (isoPattern.test(fechaTrim)) {
    if (fechaTrim.length === 10) {
      return `${fechaTrim}T00:00:00.000Z`;
    }
    return fechaTrim;
  }
  
  return null;
}

// Función para detectar si un expediente tiene Prueba/Pericia en sus movimientos
function tienePruebaPericia(movimientos: any): boolean {
  if (!movimientos) return false;
  
  try {
    let movs = movimientos;
    if (typeof movimientos === 'string') {
      try {
        movs = JSON.parse(movimientos);
      } catch {
        return false;
      }
    }
    
    if (Array.isArray(movs) && movs.length > 0) {
      for (const mov of movs) {
        if (typeof mov === 'object' && mov !== null) {
          let detalleText = '';
          
          if (mov.Detalle) {
            detalleText = String(mov.Detalle).toUpperCase();
          } else if (mov.cols && Array.isArray(mov.cols)) {
            for (const col of mov.cols) {
              const colStr = String(col).trim();
              const matchDetalle = colStr.match(/^Detalle:\s*(.+)$/i);
              if (matchDetalle) {
                detalleText = matchDetalle[1].toUpperCase();
                break;
              }
            }
          }
          
          const patrones = [
            /SE\s+ORDENA.*PERICI/i,
            /ORDENA.*PERICI/i,
            /SOLICITA.*PROVEE.*PRUEBA\s+PERICI/i,
            /PRUEBA\s+PERICIAL/i,
            /PERITO.*ACEPTA\s+CARGO/i,
            /LLAMA.*PERICI/i,
          ];
          
          for (const patron of patrones) {
            if (patron.test(detalleText)) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    console.warn(`[Prueba/Pericia] Error al analizar movimientos:`, err);
    return false;
  }
}

type Semaforo = "VERDE" | "AMARILLO" | "ROJO";

// Semáforo personalizado para Prueba/Pericia: 0-20 Verde, 20-40 Amarillo, >=50 Rojo
function semaforoByAgePruebaPericia(dias: number): Semaforo {
  if (dias >= 50) return "ROJO";
  if (dias >= 20) return "AMARILLO";
  return "VERDE";
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

type User = {
  id: string;
  email: string;
  full_name: string | null;
  username: string;
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
          setUsers(usersList || []);
        } else {
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

  const detectarYNotificarMenciones = React.useCallback(async (texto: string, currentUserId: string) => {
    const mentionRegex = /@([\w.-]+)/g;
    const matches = [...texto.matchAll(mentionRegex)];
    const mentionedUsernames = [...new Set(matches.map(m => m[1].toLowerCase()))];
    
    if (mentionedUsernames.length === 0) return;
    
    const { data: currentUserProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", currentUserId)
      .single();
    
    const currentUserName = currentUserProfile?.full_name || currentUserProfile?.email || "Un usuario";

    for (const username of mentionedUsernames) {
      const mentionedUser = users.find(u => u.username.toLowerCase() === username);
      if (!mentionedUser || mentionedUser.id === currentUserId) continue;
      
      const link = isPjnFavorito 
        ? `/prueba-pericia#pjn_${itemId.replace(/^pjn_/, "")}`
        : `/prueba-pericia#${itemId}`;
      
      const mentionIndex = texto.toLowerCase().indexOf(`@${username}`);
      const startContext = Math.max(0, mentionIndex - 50);
      const endContext = Math.min(texto.length, mentionIndex + username.length + 50);
      const notaContextParaAsunto = texto.substring(startContext, endContext).trim();
      
      const notaCompleta = texto.trim();
      const expedienteIdLimpio = itemId.replace(/^pjn_/, "");
      
      const { data: session } = await supabase.auth.getSession();
      const senderId = session.session?.user.id;
      
      const metadata = {
        caratula: caratula || null,
        juzgado: juzgado || null,
        numero: numeroExpediente || null,
        expediente_id: itemId,
        is_pjn_favorito: isPjnFavorito,
        sender_id: senderId,
      };
      
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) return;
        
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
            expediente_id: expedienteIdLimpio,
            is_pjn_favorito: isPjnFavorito,
            nota_context: notaCompleta,
            metadata: metadata,
          }),
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error("[NotasTextarea] Error al crear notificación:", errorText);
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
      const { data: session } = await supabase.auth.getSession();
      const currentUserId = session.session?.user.id;
      
      if (currentUserId) {
        await detectarYNotificarMenciones(newValue, currentUserId);
      }
      
      if (isPjnFavorito) {
        const pjnId = itemId.replace(/^pjn_/, "");
        
        let { error } = await supabase
          .from("pjn_favoritos")
          .update({ notas: newValue.trim() || null })
          .eq("id", pjnId);
        
        if (error) {
          const errorMsg = (error as any).message || String(error) || "";
          const errorCode = (error as any).code || "";
          const errorDetails = (error as any).details || "";
          
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
            
            if (pjnUrl && pjnKey) {
              const { error: pjnError } = await pjnScraperSupabase
                .from("pjn_favoritos")
                .update({ notas: newValue.trim() || null })
                .eq("id", pjnId);
              
              if (pjnError) {
                setMsg(`Error al guardar notas: ${(pjnError as any).message || "Error desconocido"}`);
                return;
              }
            } else {
              setMsg(`Error al guardar notas: ${errorMsg || "Tabla pjn_favoritos no encontrada"}`);
              return;
            }
          } else {
            setMsg(`Error al guardar notas: ${errorMsg}`);
            return;
          }
        }
      } else {
        const { error } = await supabase
          .from("expedientes")
          .update({ notas: newValue.trim() || null })
          .eq("id", itemId);
        
        if (error) {
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
    
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        const query = textAfterAt.toLowerCase();
        
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
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
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
      
      setTimeout(() => {
        const newCursorPos = lastAtIndex + 1 + user.username.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const filteredUsers = mentionState ? (() => {
    const query = mentionState.query.toLowerCase();
    if (!query || query.length === 0) {
      return users.slice(0, 20);
    }
    return users.filter(u => 
      u.username.toLowerCase().includes(query) ||
      (u.full_name && u.full_name.toLowerCase().includes(query)) ||
      u.email.toLowerCase().includes(query)
    ).slice(0, 20);
  })() : [];

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
            onMouseDown={(e) => e.preventDefault()}
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
          Haz clic para agregar notas...
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

// Feature flag para órdenes y seguimiento
// IMPORTANTE: Para activar, crear .env.local con: NEXT_PUBLIC_FEATURE_ORDENES_SEGUIMIENTO=true
// y reiniciar el servidor de desarrollo
const FEATURE_ORDENES_SEGUIMIENTO = process.env.NEXT_PUBLIC_FEATURE_ORDENES_SEGUIMIENTO === "true";

export default function PruebaPericiaPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [pjnFavoritos, setPjnFavoritos] = useState<PjnFavorito[]>([]);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [semaforoFilter, setSemaforoFilter] = useState<Semaforo | null>(null);
  const [notasEditables, setNotasEditables] = useState<Record<string, string>>({});
  const [notasGuardando, setNotasGuardando] = useState<Record<string, boolean>>({});
  const [createdByFilter, setCreatedByFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [createdByOptions, setCreatedByOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [juzgadoFilter, setJuzgadoFilter] = useState<"todos" | string>("todos");
  const [userJuzgados, setUserJuzgados] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [userRoles, setUserRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAdminCedulas: boolean;
    isAbogado: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAdminCedulas: false,
    isAbogado: false,
  });
  
  // Estados para órdenes/seguimiento (solo si el flag está activo)
  const [activeTab, setActiveTab] = useState<"deteccion" | "ordenes">("deteccion");
  const [ordenesData, setOrdenesData] = useState<any[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedOrden, setSelectedOrden] = useState<any | null>(null);
  const [uploadingOrden, setUploadingOrden] = useState<Record<string, boolean>>({});
  const [ordenesExistentes, setOrdenesExistentes] = useState<Record<string, boolean>>({}); // case_ref -> tiene orden
  
  // Filtros para órdenes/seguimiento
  const [semaforoFilterOrdenes, setSemaforoFilterOrdenes] = useState<Semaforo | null>(null);
  const [searchTermOrdenes, setSearchTermOrdenes] = useState<string>("");
  const [createdByFilterOrdenes, setCreatedByFilterOrdenes] = useState<string>("all");
  const [createdByOptionsOrdenes, setCreatedByOptionsOrdenes] = useState<Array<{ id: string; name: string }>>([]);
  
  // Estados para formularios en el Drawer
  const [showComunicacionForm, setShowComunicacionForm] = useState(false);
  const [showTurnoForm, setShowTurnoForm] = useState(false);
  const [comunicacionForm, setComunicacionForm] = useState({
    canal: "TELEFONO",
    resultado: "SATISFACTORIO",
    motivo_falla: "",
    detalle: "",
    tipo: "GESTION" as "ORDEN" | "GESTION"
  });
  const [turnoForm, setTurnoForm] = useState({
    centro_medico: "",
    fecha: "",
    hora: "",
  });
  const [savingComunicacion, setSavingComunicacion] = useState(false);
  const [savingTurno, setSavingTurno] = useState(false);
  const [creatingGestion, setCreatingGestion] = useState(false);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 100);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  const loadData = async () => {
    try {
      setMsg("");
      setLoading(true);

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;
      
      // Obtener nombre del usuario desde la sesión o user_metadata
      const sessionFullName = (session.user.user_metadata as { full_name?: string })?.full_name;
      const sessionEmail = (session.user.email || "").trim();
      const baseName = (sessionFullName || "").trim() || sessionEmail;
      setCurrentUserName(baseName);
      
      // Intentar mejorar el nombre desde profiles
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

      // Verificar roles del usuario
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isAdminExp = !roleErr && roleData?.is_admin_expedientes === true;
      const isAdminCedulas = !roleErr && roleData?.is_admin_cedulas === true;
      const isAbogado = !roleErr && roleData?.is_abogado === true;
      const isSuperadmin = !roleErr && roleData?.is_superadmin === true;
      
      setUserRoles({
        isSuperadmin: isSuperadmin || false,
        isAdminExpedientes: isAdminExp || false,
        isAdminCedulas: isAdminCedulas || false,
        isAbogado: isAbogado || false,
      });

      // Cargar juzgados asignados al usuario
      const { data: juzgadosData, error: juzgadosErr } = await supabase
        .from("user_juzgados")
        .select("juzgado")
        .eq("user_id", uid);
      
      const juzgadosAsignados = juzgadosData && juzgadosData.length > 0 
        ? juzgadosData.map(j => j.juzgado)
        : [];
      
      setUserJuzgados(juzgadosAsignados);


      // Cargar expedientes
      const { data: expedientesData, error: expError } = await supabase
        .from("expedientes")
        .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, notas, created_by_user_id")
        .eq("estado", "ABIERTO")
        .order("fecha_ultima_modificacion", { ascending: true });

      if (expError) {
        console.error("Error cargando expedientes:", expError);
        setMsg("Error al cargar expedientes");
      } else {
        // Mapear expedientes para incluir created_by_name
        const expedientesConNombre = (expedientesData || []).map((e: any) => ({
          ...e,
          created_by_name: null, // Se cargará después desde profiles
        }));
        setExpedientes(expedientesConNombre);
      }

      // Cargar directamente desde cases (no desde pjn_favoritos)
      let favoritosData: any[] | null = null;
      
      const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
      const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
      
      if (pjnUrl && pjnKey) {
        try {
          const { data: casesData, error: casesErr } = await pjnScraperSupabase
            .from("cases")
            .select("key, expediente, caratula, dependencia, ult_act, situacion, movimientos")
            .order("ult_act", { ascending: false })
            .limit(1000);
          
          if (casesErr) {
            console.warn(`[Prueba/Pericia] ⚠️  Error al leer desde cases:`, casesErr);
          } else if (casesData && casesData.length > 0) {
            console.log(`[Prueba/Pericia] ✅ Datos encontrados en cases: ${casesData.length}`);
            
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
                console.warn(`[Prueba/Pericia] Error al extraer observaciones:`, err);
              }
              
              return null;
            };
            
            // Convertir cases a formato PjnFavorito
            const casosConvertidos = casesData.map((c: any) => {
              const expText = c.key || c.expediente || '';
              const match = expText.match(/^([A-Z]+)\s+(\d+)\/(\d+)/);
              
              if (match) {
                const [, jurisdiccion, numero, anioStr] = match;
                const anio = parseInt(anioStr, 10);
                
                // Convertir ult_act a formato DD/MM/AAAA
                let fechaUltimaCarga: string | null = null;
                if (c.ult_act) {
                  try {
                    let date: Date;
                    if (typeof c.ult_act === 'string' && c.ult_act.includes('/')) {
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
                    console.warn(`[Prueba/Pericia] Error al convertir fecha:`, e);
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
                    movimientos: c.movimientos || null,
                  } as PjnFavorito;
              }
              return null;
            }).filter((f: PjnFavorito | null): f is PjnFavorito => f !== null);
            
            if (casosConvertidos.length > 0) {
              favoritosData = casosConvertidos;
              console.log(`[Prueba/Pericia] ✅ Convertidos ${casosConvertidos.length} casos desde cases`);
            }
          }
        } catch (err) {
          console.warn(`[Prueba/Pericia] Error al intentar cargar desde cases:`, err);
        }
      }
      
      setPjnFavoritos(favoritosData || []);

      // Si el flag está activo, cargar órdenes existentes para verificar cuáles expedientes ya tienen órdenes
      if (FEATURE_ORDENES_SEGUIMIENTO) {
        try {
          const ordenesRes = await fetch("/api/ordenes-medicas/list", {
            headers: {
              "Authorization": `Bearer ${session.access_token}`,
            },
          });
          
          if (ordenesRes.ok) {
            const { data: ordenes } = await ordenesRes.json();
            if (ordenes && Array.isArray(ordenes)) {
              // Crear un mapa de case_ref -> tiene orden
              const ordenesMap: Record<string, boolean> = {};
              ordenes.forEach((orden: any) => {
                if (orden.case_ref) {
                  ordenesMap[orden.case_ref] = true;
                }
                // También mapear por expediente_id si existe
                if (orden.expediente_id) {
                  ordenesMap[orden.expediente_id] = true;
                }
              });
              setOrdenesExistentes(ordenesMap);
            }
          }
        } catch (err) {
          console.warn("Error cargando órdenes existentes:", err);
        }
      }

      // Cargar nombres de usuarios para "Cargado por"
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name", { ascending: true });

      if (profilesData) {
        // Actualizar expedientes con los nombres de los usuarios
        setExpedientes(prev => {
          return prev.map(e => {
            if (e.created_by_user_id) {
              const profile = profilesData.find(p => p.id === e.created_by_user_id);
              if (profile) {
                return {
                  ...e,
                  created_by_name: profile.full_name || profile.email || "Sin nombre"
                };
              }
            }
            return e;
          });
        });
        
        // Construir opciones para el filtro "Cargado por"
        const options: Array<{ id: string; name: string }> = [];
        const userIds = new Set<string>();
        (expedientesData || []).forEach((e: any) => {
          if (e.created_by_user_id && !userIds.has(e.created_by_user_id)) {
            userIds.add(e.created_by_user_id);
            const profile = profilesData.find(p => p.id === e.created_by_user_id);
            if (profile) {
              options.push({ id: e.created_by_user_id, name: profile.full_name || profile.email || "Sin nombre" });
            }
          }
        });
        
        setCreatedByOptions(options);
      }

    } catch (err: any) {
      console.error("Error en loadData:", err);
      setMsg("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  // Función para cargar órdenes médicas (solo si el flag está activo)
  const loadOrdenes = async () => {
    if (!FEATURE_ORDENES_SEGUIMIENTO) {
      console.log("[loadOrdenes] Feature flag desactivado");
      return;
    }
    
    try {
      setLoadingOrdenes(true);
      console.log("[loadOrdenes] Iniciando carga de órdenes...");
      
      const session = await requireSessionOrRedirect();
      if (!session) {
        console.warn("[loadOrdenes] No hay sesión");
        return;
      }

      console.log("[loadOrdenes] Sesión obtenida, haciendo fetch...");
      const res = await fetch("/api/ordenes-medicas/list", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });
      
      console.log("[loadOrdenes] Response recibida:", {
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries())
      });

      if (res.ok) {
        const result = await res.json();
        const ordenes = result.data || [];
        setOrdenesData(ordenes);
        
        // Construir opciones para el filtro "Cargado por" basado en los usuarios que crearon órdenes
        const userIds = new Set<string>();
        const options: Array<{ id: string; name: string }> = [];
        
        ordenes.forEach((orden: any) => {
          if (orden.emitida_por_user_id && !userIds.has(orden.emitida_por_user_id)) {
            userIds.add(orden.emitida_por_user_id);
          }
        });
        
        if (userIds.size > 0) {
          const { data: profilesData } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", Array.from(userIds));
          
          if (profilesData) {
            profilesData.forEach((profile: any) => {
              options.push({
                id: profile.id,
                name: profile.full_name || profile.email || "Sin nombre"
              });
            });
          }
        }
        
        setCreatedByOptionsOrdenes(options);
        
        // Mostrar advertencia si hay un warning (ej: tablas no existen)
        if (result.warning) {
          console.warn("[Órdenes] Advertencia:", result.warning);
          setMsg(result.warning);
        }
      } else {
        // Mejorar el manejo de errores para mostrar más información
        let errorData: any = { error: "Error desconocido" };
        let errorText = "";
        
        try {
          errorText = await res.text();
          console.log("[loadOrdenes] Response text:", errorText);
          console.log("[loadOrdenes] Status:", res.status, res.statusText);
          
          if (errorText) {
            try {
              errorData = JSON.parse(errorText);
              console.log("[loadOrdenes] Parsed JSON:", errorData);
            } catch (parseError) {
              console.warn("[loadOrdenes] No es JSON válido, usando texto:", errorText);
              errorData = { error: errorText || `HTTP ${res.status}: ${res.statusText}` };
            }
          } else {
            errorData = { error: `HTTP ${res.status}: ${res.statusText} (sin body)` };
          }
        } catch (parseError) {
          console.error("[loadOrdenes] Error al leer respuesta:", parseError);
          errorData = { error: `HTTP ${res.status}: ${res.statusText} (error al leer respuesta)` };
        }
        
        console.error("Error cargando órdenes:", {
          status: res.status,
          statusText: res.statusText,
          error: errorData,
          rawText: errorText
        });
        
        const errorMessage = errorData.error || errorData.message || `HTTP ${res.status}: ${res.statusText}`;
        setMsg(`Error al cargar órdenes: ${errorMessage}`);
      }
    } catch (err) {
      console.error("Error en loadOrdenes:", err);
      setMsg(`Error al cargar órdenes: ${err instanceof Error ? err.message : "Error desconocido"}`);
    } finally {
      setLoadingOrdenes(false);
    }
  };

  // Función para normalizar juzgado para comparación
  const normalizarJuzgadoParaComparar = (j: string | null): string => {
    if (!j) return "";
    const normalized = j.trim().replace(/\s+/g, " ").toUpperCase();
    const matchCivil = normalized.match(/JUZGADO\s+(?:NACIONAL\s+EN\s+LO\s+)?CIVIL\s+(?:N[°º]?\s*)?(\d+)/i);
    if (matchCivil && matchCivil[1]) {
      return `JUZGADO CIVIL ${matchCivil[1]}`;
    }
    const matchGeneric = normalized.match(/JUZGADO[^0-9]*?(\d+)/i);
    if (matchGeneric && matchGeneric[1]) {
      if (normalized.includes("CIVIL")) {
        return `JUZGADO CIVIL ${matchGeneric[1]}`;
      }
      return normalized;
    }
    return normalized;
  };

  const juzgadosNormalizados = useMemo(() => {
    return userJuzgados.map(j => normalizarJuzgadoParaComparar(j));
  }, [userJuzgados]);

  useEffect(() => {
    loadData();
  }, []);

  // Cargar órdenes cuando el tab está activo y el flag está habilitado
  useEffect(() => {
    if (FEATURE_ORDENES_SEGUIMIENTO && activeTab === "ordenes") {
      loadOrdenes();
    }
  }, [activeTab]);

  // Filtrar expedientes por Prueba/Pericia y juzgados
  const expedientesFiltrados = useMemo(() => {
    const todos: Array<Expediente & { is_pjn_favorito?: boolean; movimientos?: any; fecha_ultima_carga?: string | null }> = [];
    const expedientesIds = new Set<string>();

    // Agregar expedientes normales (filtrar por juzgados si aplica)
    expedientes.forEach(e => {
      // Filtrar por juzgados si el filtro no es "todos"
      if (juzgadoFilter !== "todos") {
        if (!e.juzgado) return;
        const juzgadoNormalizado = normalizarJuzgadoParaComparar(e.juzgado);
        const filtroNormalizado = normalizarJuzgadoParaComparar(juzgadoFilter);
        
        // Comparar juzgados
        if (juzgadoNormalizado !== filtroNormalizado) {
          const num1 = juzgadoNormalizado.match(/(\d+)/)?.[1];
          const num2 = filtroNormalizado.match(/(\d+)/)?.[1];
          if (!(num1 && num2 && num1 === num2 && juzgadoNormalizado.includes("CIVIL") && filtroNormalizado.includes("CIVIL"))) {
            return;
          }
        }
      }
      
      // Evitar duplicados por número de expediente
      const numExp = e.numero_expediente || "";
      if (numExp && expedientesIds.has(numExp)) return;
      expedientesIds.add(numExp);
      
      todos.push({ ...e, is_pjn_favorito: false });
    });

    // Agregar favoritos PJN como expedientes (filtrar por juzgados si aplica)
    pjnFavoritos.forEach(f => {
      // Filtrar por juzgados si el filtro no es "todos"
      if (juzgadoFilter !== "todos") {
        if (!f.juzgado) return;
        const juzgadoNormalizado = normalizarJuzgadoParaComparar(f.juzgado);
        const filtroNormalizado = normalizarJuzgadoParaComparar(juzgadoFilter);
        
        // Comparar juzgados
        if (juzgadoNormalizado !== filtroNormalizado) {
          const num1 = juzgadoNormalizado.match(/(\d+)/)?.[1];
          const num2 = filtroNormalizado.match(/(\d+)/)?.[1];
          if (!(num1 && num2 && num1 === num2 && juzgadoNormalizado.includes("CIVIL") && filtroNormalizado.includes("CIVIL"))) {
            return;
          }
        }
      }
      
      const numExp = `${f.numero}/${f.anio}`;
      // Evitar duplicados: si ya existe un expediente con el mismo número, no agregar el favorito
      if (expedientesIds.has(numExp)) return;
      expedientesIds.add(numExp);
      
      todos.push({
        id: f.id,
        owner_user_id: f.id,
        caratula: f.caratula,
        juzgado: f.juzgado,
        numero_expediente: numExp,
        fecha_ultima_modificacion: null,
        fecha_ultima_carga: f.fecha_ultima_carga,
        estado: f.estado || "activo",
        observaciones: f.observaciones,
        notas: f.notas || null,
        created_by_user_id: null,
        created_by_name: "PJN Favoritos",
        is_pjn_favorito: true,
        movimientos: f.movimientos,
      });
    });

    // Filtrar solo por Prueba/Pericia usando el patrón canónico
    return todos.filter(e => {
      return e.movimientos ? tienePruebaPericia(e.movimientos) : false;
    });
  }, [expedientes, pjnFavoritos, juzgadoFilter, juzgadosNormalizados]);

  // Preparar items para mostrar
  const itemsToShow = useMemo(() => {
    return expedientesFiltrados.map(e => {
      let fechaParaCalcularDias: string | null = null;
      
      if (e.fecha_ultima_modificacion && e.fecha_ultima_modificacion.trim() !== "") {
        fechaParaCalcularDias = e.fecha_ultima_modificacion;
      } else if (e.fecha_ultima_carga && e.fecha_ultima_carga.trim() !== "") {
        const fechaConvertida = ddmmaaaaToISO(e.fecha_ultima_carga);
        if (fechaConvertida) {
          fechaParaCalcularDias = fechaConvertida;
        }
      }
      
      const dias = fechaParaCalcularDias ? daysSince(fechaParaCalcularDias) : null;
      const semaforo = dias !== null ? semaforoByAgePruebaPericia(dias) : "VERDE" as Semaforo;
      
      return {
        type: "expediente" as const,
        id: e.id,
        caratula: e.caratula,
        juzgado: e.juzgado,
        fecha: e.fecha_ultima_modificacion,
        fecha_ultima_carga: e.fecha_ultima_carga,
        numero: e.numero_expediente,
        created_by: e.created_by_name || "PJN Favoritos",
        created_by_user_id: e.created_by_user_id,
        is_pjn_favorito: e.is_pjn_favorito === true,
        observaciones: e.observaciones,
        notas: e.notas || null,
        dias: dias,
        semaforo: semaforo,
      };
    });
  }, [expedientesFiltrados]);

  // Aplicar filtros
  let filtered = itemsToShow;
  
  if (createdByFilter !== "all") {
    filtered = filtered.filter((item: any) => {
      if (createdByFilter === "pjn") {
        return item.is_pjn_favorito === true || item.created_by === "PJN Favoritos";
      }
      return item.created_by_user_id === createdByFilter;
    });
  }

  if (semaforoFilter) {
    filtered = filtered.filter((item) => item.semaforo === semaforoFilter);
  }

  if (searchTerm.trim()) {
    const searchLower = searchTerm.trim().toLowerCase();
    filtered = filtered.filter((item: any) => {
      const numeroExpediente = (item.numero || "").toLowerCase();
      const caratula = (item.caratula || "").toLowerCase();
      return numeroExpediente.includes(searchLower) || caratula.includes(searchLower);
    });
  }

  // Ordenar
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    let compareA: number;
    let compareB: number;

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
      if (!a.fecha) return 1;
      if (!b.fecha) return -1;
      compareA = new Date(a.fecha).getTime();
      compareB = new Date(b.fecha).getTime();
    } else if (currentSortField === "juzgado") {
      const juzgadoA = (a.juzgado || "").trim().toUpperCase();
      const juzgadoB = (b.juzgado || "").trim().toUpperCase();
      if (!juzgadoA && !juzgadoB) return 0;
      if (!juzgadoA) return 1;
      if (!juzgadoB) return -1;
      if (juzgadoA < juzgadoB) return currentSortDirection === "asc" ? -1 : 1;
      if (juzgadoA > juzgadoB) return currentSortDirection === "asc" ? 1 : -1;
      return 0;
    } else {
      return 0;
    }

    if (compareA === compareB) return 0;
    return currentSortDirection === "asc" 
      ? (compareA < compareB ? -1 : 1)
      : (compareA > compareB ? -1 : 1);
  });

  // Paginación
  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const paginatedItems = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text)" }}>
        Cargando...
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "100%", overflowX: "auto" }}>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, position: "relative" }}>
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
                left: 0,
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
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes) && (
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
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes) && (
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
                  📋 Mis Juzgados
                </Link>
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes || userRoles.isAbogado) && (
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
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes || userRoles.isAdminCedulas || userRoles.isAbogado) && (
                <Link
                  href="/app"
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
                  📋 Mis Cédulas/Oficios
                </Link>
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes || userRoles.isAdminCedulas || userRoles.isAbogado) && (
                <Link
                  href="/app/nueva"
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
                  ➕ Nueva Cédula/Oficio
                </Link>
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes || userRoles.isAdminCedulas || userRoles.isAbogado) && (
                <Link
                  href="/app/enviar"
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
                  📤 Enviar Cédula/Oficio
                </Link>
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes || userRoles.isAdminCedulas || userRoles.isAbogado) && (
                <Link
                  href="/app/recibidos"
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
                  📥 Recibidos / Enviados
                </Link>
              )}
              {(userRoles.isSuperadmin || userRoles.isAdminExpedientes || userRoles.isAdminCedulas || userRoles.isAbogado) && (
                <Link
                  href="/app/notificaciones"
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
                  🔔 Notificaciones
                </Link>
              )}
              {userRoles.isAbogado && (
                <Link
                  href="/prueba-pericia"
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
                  📅 Turnos Pericias
                </Link>
              )}
            </div>
          )}

          <img className="logoMini" src="/logo.png" alt="Logo" style={{ width: 32, height: 32 }} />
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
          Prueba/Pericia
        </h1>
        </div>
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
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)"
            }}
          >
            {currentUserName}
          </div>
        )}
      </div>

      {/* Tabs (solo si el flag está activo) */}
      {FEATURE_ORDENES_SEGUIMIENTO && (
        <div style={{ 
          display: "flex", 
          gap: 8, 
          marginBottom: 24,
          borderBottom: "2px solid rgba(255,255,255,.1)"
        }}>
          <button
            onClick={() => setActiveTab("deteccion")}
            style={{
              padding: "12px 24px",
              background: activeTab === "deteccion" ? "rgba(96,141,186,.2)" : "transparent",
              border: "none",
              borderBottom: activeTab === "deteccion" ? "2px solid rgba(96,141,186,.8)" : "2px solid transparent",
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Detección
          </button>
          <button
            onClick={() => setActiveTab("ordenes")}
            style={{
              padding: "12px 24px",
              background: activeTab === "ordenes" ? "rgba(96,141,186,.2)" : "transparent",
              border: "none",
              borderBottom: activeTab === "ordenes" ? "2px solid rgba(96,141,186,.8)" : "2px solid transparent",
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            Órdenes/Seguimiento
          </button>
        </div>
      )}

      {/* Contenido del tab de Órdenes/Seguimiento */}
      {FEATURE_ORDENES_SEGUIMIENTO && activeTab === "ordenes" && (
        <div>
          {loadingOrdenes ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text)" }}>
              Cargando órdenes...
            </div>
          ) : (
            <>
              {/* Filtros para órdenes */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                marginBottom: 16,
                padding: "16px",
                background: "rgba(255,255,255,.03)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.08)"
              }}>
                {/* Semáforo automático por horas */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>
                    Semáforo automático por horas:
                  </span>
                  <button
                    onClick={() => setSemaforoFilterOrdenes(semaforoFilterOrdenes === "VERDE" ? null : "VERDE")}
                    style={{
                      cursor: "pointer",
                      border: semaforoFilterOrdenes === "VERDE" ? "2px solid rgba(46, 204, 113, 0.8)" : "1px solid rgba(46, 204, 113, 0.35)",
                      background: semaforoFilterOrdenes === "VERDE" ? "rgba(46, 204, 113, 0.25)" : "rgba(46, 204, 113, 0.16)",
                      color: "rgba(210, 255, 226, 0.95)",
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: 0.4,
                      transition: "all 0.2s ease"
                    }}
                  >
                    VERDE
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>0-24hrs</span>
                  <button
                    onClick={() => setSemaforoFilterOrdenes(semaforoFilterOrdenes === "AMARILLO" ? null : "AMARILLO")}
                    style={{
                      cursor: "pointer",
                      border: semaforoFilterOrdenes === "AMARILLO" ? "2px solid rgba(241, 196, 15, 0.8)" : "1px solid rgba(241, 196, 15, 0.35)",
                      background: semaforoFilterOrdenes === "AMARILLO" ? "rgba(241, 196, 15, 0.25)" : "rgba(241, 196, 15, 0.14)",
                      color: "rgba(255, 246, 205, 0.95)",
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: 0.4,
                      transition: "all 0.2s ease"
                    }}
                  >
                    AMARILLO
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>24-48hrs</span>
                  <button
                    onClick={() => setSemaforoFilterOrdenes(semaforoFilterOrdenes === "ROJO" ? null : "ROJO")}
                    style={{
                      cursor: "pointer",
                      border: semaforoFilterOrdenes === "ROJO" ? "2px solid rgba(231, 76, 60, 0.8)" : "1px solid rgba(231, 76, 60, 0.35)",
                      background: semaforoFilterOrdenes === "ROJO" ? "rgba(231, 76, 60, 0.25)" : "rgba(231, 76, 60, 0.14)",
                      color: "rgba(255, 220, 216, 0.95)",
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: 0.4,
                      transition: "all 0.2s ease"
                    }}
                  >
                    ROJO
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>48-72hrs+</span>
                  {semaforoFilterOrdenes && (
                    <button
                      onClick={() => setSemaforoFilterOrdenes(null)}
                      style={{
                        cursor: "pointer",
                        padding: "4px 8px",
                        background: "rgba(255,255,255,.08)",
                        border: "1px solid rgba(255,255,255,.16)",
                        borderRadius: 6,
                        color: "var(--text)",
                        fontSize: 11,
                        fontWeight: 600
                      }}
                    >
                      ✕ Limpiar
                    </button>
                  )}
                </div>

                {/* Buscador */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
                  <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Buscar:</span>
                  <input
                    type="text"
                    value={searchTermOrdenes}
                    onChange={(e) => setSearchTermOrdenes(e.target.value)}
                    placeholder="Case Ref, Archivo..."
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: "rgba(255,255,255,.06)",
                      border: "1px solid rgba(255,255,255,.14)",
                      borderRadius: 8,
                      color: "var(--text)",
                      fontSize: 13,
                      minWidth: 200
                    }}
                  />
                </div>

                {/* Cargado por */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Cargado por:</span>
                  <select
                    value={createdByFilterOrdenes}
                    onChange={(e) => setCreatedByFilterOrdenes(e.target.value)}
                    style={{
                      padding: "8px 10px",
                      background: "rgba(255,255,255,.06)",
                      border: "1px solid rgba(255,255,255,.14)",
                      borderRadius: 8,
                      color: "var(--text)",
                      fontSize: 13,
                      cursor: "pointer",
                      minWidth: 150
                    }}
                  >
                    <option value="all">Todos</option>
                    {createdByOptionsOrdenes.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tabla de órdenes filtradas */}
              {(() => {
                let ordenesFiltradas = [...ordenesData];

                // Filtrar por semáforo
                if (semaforoFilterOrdenes) {
                  ordenesFiltradas = ordenesFiltradas.filter((orden: any) => orden.semaforo === semaforoFilterOrdenes);
                }

                // Filtrar por búsqueda
                if (searchTermOrdenes.trim()) {
                  const searchLower = searchTermOrdenes.trim().toLowerCase();
                  ordenesFiltradas = ordenesFiltradas.filter((orden: any) => {
                    const caseRef = (orden.case_ref || "").toLowerCase();
                    const filename = (orden.filename || "").toLowerCase();
                    return caseRef.includes(searchLower) || filename.includes(searchLower);
                  });
                }

                // Filtrar por "Cargado por"
                if (createdByFilterOrdenes !== "all") {
                  ordenesFiltradas = ordenesFiltradas.filter((orden: any) => orden.emitida_por_user_id === createdByFilterOrdenes);
                }

                return (
                  <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="table" style={{ minWidth: '1400px' }}>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Semáforo SLA</th>
                    <th>Case Ref</th>
                    <th>Archivo</th>
                    <th>Estado Gestión</th>
                    <th>Centro Médico</th>
                    <th>Turno</th>
                    <th>Responsable</th>
                    <th style={{ textAlign: "center" }}>Días sin contacto</th>
                    <th style={{ width: 100 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenesFiltradas.map((orden: any) => (
                    <tr key={orden.id} style={{ verticalAlign: "top" }}>
                      <td>
                        <SemaforoChip value={orden.semaforo as Semaforo} />
                      </td>
                      <td style={{ fontWeight: 650 }}>
                        {orden.case_ref || <span className="muted">—</span>}
                      </td>
                      <td>
                        {orden.filename ? (
                          <span style={{ fontSize: 13 }}>{orden.filename}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 13 }}>
                          {orden.gestion?.estado || "Sin gestión"}
                        </span>
                      </td>
                      <td>
                        {orden.gestion?.centro_medico || <span className="muted">—</span>}
                      </td>
                      <td>
                        {orden.gestion?.turno_fecha_hora ? (
                          <span style={{ fontSize: 13 }}>
                            {formatFecha(orden.gestion.turno_fecha_hora)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {orden.gestion?.responsable?.full_name || orden.gestion?.responsable?.email || <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                        {orden.dias_sin_contacto !== null ? orden.dias_sin_contacto : <span className="muted">—</span>}
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            setSelectedOrden(orden);
                            setDrawerOpen(true);
                          }}
                          style={{
                            padding: "6px 12px",
                            background: "rgba(96,141,186,.2)",
                            border: "1px solid rgba(96,141,186,.4)",
                            borderRadius: 6,
                            color: "var(--text)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                  {ordenesFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted">
                        No hay órdenes médicas cargadas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Contenido del tab de Detección (o vista completa si el flag está desactivado) */}
      {(FEATURE_ORDENES_SEGUIMIENTO ? activeTab === "deteccion" : true) && (
        <>

      {/* Filtros */}
      <div style={{ 
        display: "flex", 
        flexWrap: "wrap", 
        gap: 16, 
        marginBottom: 24,
        padding: "16px",
        background: "rgba(255,255,255,.02)",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,.06)"
      }}>
        {/* Filtros de semáforo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Semáforo automático por antigüedad:</span>
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
          <span style={{ color: "var(--muted)", fontSize: 13 }}>0–19</span>
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
          <span style={{ color: "var(--muted)", fontSize: 13 }}>20–49</span>
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
          <span style={{ color: "var(--muted)", fontSize: 13 }}>50+ días</span>
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
        </div>

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

        {/* Filtro por Juzgado */}
        {userJuzgados.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
              Juzgado:
            </span>
            <select
              value={juzgadoFilter}
              onChange={(e) => {
                setJuzgadoFilter(e.target.value);
                setCurrentPage(1);
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
              <option value="todos" style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>
                Todos los Juzgados
              </option>
              {userJuzgados.map((juzgado) => (
                <option key={juzgado} value={juzgado} style={{ background: "rgba(11,47,85,1)", color: "rgba(234,243,255,.95)" }}>
                  {juzgado}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Filtro "Cargado por" */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
                Fecha Última Modificación{" "}
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
              <th style={{ width: 200 }}>Expediente</th>
              <th style={{ width: 180 }}>Cargado por</th>
              <th style={{ width: 380, minWidth: 380, textAlign: "center" }}>Observaciones</th>
              <th style={{ width: 380, minWidth: 380, textAlign: "center" }}>Notas</th>
              {FEATURE_ORDENES_SEGUIMIENTO && (
                <th style={{ width: 150, textAlign: "center" }}>Acciones</th>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((item: any) => {
              const dias = item.dias ?? null;
              const sem = item.semaforo || (dias !== null ? semaforoByAgePruebaPericia(dias) : "VERDE");
              
              return (
                <tr key={item.id} style={{ verticalAlign: "top" }}>
                  <td>
                    <SemaforoChip value={sem as Semaforo} />
                  </td>
                  <td style={{ fontWeight: 650 }}>
                    {item.caratula?.trim() ? item.caratula : <span className="muted">Sin carátula</span>}
                  </td>
                  <td>{item.juzgado ? limpiarJuzgadoParaMostrar(item.juzgado) : <span className="muted">—</span>}</td>
                  <td>
                    {item.fecha_ultima_carga 
                      ? formatFecha(item.fecha_ultima_carga)
                      : item.fecha 
                        ? formatFecha(item.fecha) 
                        : <span className="muted">—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {typeof dias === "number" && !isNaN(dias) ? dias : <span className="muted">—</span>}
                  </td>
                  <td>
                    {item.numero?.trim() ? item.numero : <span className="muted">—</span>}
                  </td>
                  <td>
                    {item.created_by ? (
                      <span style={{ fontSize: 13 }}>{item.created_by}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
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
                  {FEATURE_ORDENES_SEGUIMIENTO && (() => {
                    const caseRef = item.numero || item.caratula || "Sin referencia";
                    const tieneOrden = ordenesExistentes[caseRef] || (!item.is_pjn_favorito && ordenesExistentes[item.id]);
                    const isUploading = uploadingOrden[item.id] === true;
                    
                    return (
                      <td style={{ textAlign: "center", padding: "11px 12px" }}>
                        <button
                          onClick={async () => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = ".pdf,.doc,.docx";
                            input.multiple = true; // Permitir múltiples archivos
                            input.onchange = async (e) => {
                              const files = Array.from((e.target as HTMLInputElement).files || []);
                              if (files.length === 0) return;
                              
                              if (files.length > 5) {
                                setMsg("Error: Máximo 5 archivos por orden");
                                return;
                              }

                              const itemId = item.id;
                              setUploadingOrden(prev => ({ ...prev, [itemId]: true }));
                              try {
                                const session = await requireSessionOrRedirect();
                                if (!session) return;

                                const formData = new FormData();
                                // Agregar todos los archivos
                                files.forEach((file, index) => {
                                  formData.append(`file_${index}`, file);
                                });
                                formData.append("case_ref", caseRef);
                                if (!item.is_pjn_favorito) {
                                  formData.append("expediente_id", item.id);
                                }

                                const res = await fetch("/api/ordenes-medicas/upload", {
                                  method: "POST",
                                  headers: {
                                    "Authorization": `Bearer ${session.access_token}`,
                                  },
                                  body: formData,
                                });

                                if (res.ok) {
                                  const result = await res.json();
                                  if (result.orden_existente) {
                                    setMsg(`${files.length} archivo(s) agregado(s) a la orden existente`);
                                  } else {
                                    setMsg("Orden médica creada exitosamente");
                                  }
                                  // Actualizar estado de órdenes existentes
                                  setOrdenesExistentes(prev => ({
                                    ...prev,
                                    [caseRef]: true,
                                    ...(!item.is_pjn_favorito ? { [item.id]: true } : {}),
                                  }));
                                  if (activeTab === "ordenes") {
                                    loadOrdenes();
                                  }
                                } else {
                                  const error = await res.json().catch(() => ({ error: "Error desconocido" }));
                                  setMsg("Error: " + (error.error || "Error desconocido"));
                                }
                              } catch (err) {
                                console.error("Error subiendo orden:", err);
                                setMsg("Error al subir la orden médica");
                              } finally {
                                setUploadingOrden(prev => {
                                  const newState = { ...prev };
                                  delete newState[itemId];
                                  return newState;
                                });
                              }
                            };
                            input.click();
                          }}
                          disabled={isUploading}
                          style={{
                            padding: "6px 12px",
                            background: isUploading 
                              ? "rgba(255,255,255,.1)" 
                              : tieneOrden 
                                ? "rgba(255,193,7,.3)" // Amarillo cuando tiene orden
                                : "rgba(96,141,186,.2)",
                            border: `1px solid ${tieneOrden ? "rgba(255,193,7,.6)" : "rgba(96,141,186,.4)"}`,
                            borderRadius: 6,
                            color: "var(--text)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: isUploading ? "not-allowed" : "pointer",
                            opacity: isUploading ? 0.6 : 1,
                          }}
                        >
                          {isUploading ? "Subiendo..." : tieneOrden ? "Orden Creada" : "Crear Orden"}
                        </button>
                      </td>
                    );
                  })()}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={FEATURE_ORDENES_SEGUIMIENTO ? 10 : 9} className="muted">
                  No hay expedientes de Prueba/Pericia cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
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
            }}
          >
            « Primera
          </button>
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
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
            }}
          >
            ‹ Anterior
          </button>
          <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, padding: "0 16px" }}>
            Página {currentPage} de {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
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
            }}
          >
            Siguiente ›
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
            }}
          >
            Última »
          </button>
        </div>
      )}
        </>
      )}

      {/* Drawer para detalles de orden (solo si el flag está activo) */}
      {FEATURE_ORDENES_SEGUIMIENTO && drawerOpen && selectedOrden && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "600px",
            height: "100vh",
            background: "rgba(11,47,85,.98)",
            borderLeft: "1px solid rgba(255,255,255,.2)",
            boxShadow: "-4px 0 24px rgba(0,0,0,.5)",
            zIndex: 1000,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
              Orden Médica
            </h2>
            <button
              onClick={() => {
                setDrawerOpen(false);
                setSelectedOrden(null);
                setShowComunicacionForm(false);
                setShowTurnoForm(false);
                setComunicacionForm({
                  canal: "TELEFONO",
                  resultado: "SATISFACTORIO",
                  motivo_falla: "",
                  detalle: "",
                  tipo: "GESTION"
                });
                setTurnoForm({ centro_medico: "", fecha: "", hora: "" });
              }}
              style={{
                padding: "8px 16px",
                background: "rgba(255,255,255,.1)",
                border: "1px solid rgba(255,255,255,.2)",
                borderRadius: 6,
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <strong style={{ color: "var(--muted)", fontSize: 12 }}>Case Ref:</strong>
              <div style={{ color: "var(--text)", fontSize: 14, marginTop: 4 }}>
                {selectedOrden.case_ref}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <strong style={{ color: "var(--muted)", fontSize: 12 }}>Archivo:</strong>
              <div style={{ color: "var(--text)", fontSize: 14, marginTop: 4 }}>
                {selectedOrden.filename}
              </div>
            </div>
            {selectedOrden.gestion && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ color: "var(--muted)", fontSize: 12 }}>Estado:</strong>
                  <div style={{ color: "var(--text)", fontSize: 14, marginTop: 4 }}>
                    {selectedOrden.gestion.estado}
                  </div>
                </div>
                {selectedOrden.gestion.centro_medico && (
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: "var(--muted)", fontSize: 12 }}>Centro Médico:</strong>
                    <div style={{ color: "var(--text)", fontSize: 14, marginTop: 4 }}>
                      {selectedOrden.gestion.centro_medico}
                    </div>
                  </div>
                )}
                {selectedOrden.gestion.turno_fecha_hora && (
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: "var(--muted)", fontSize: 12 }}>Turno:</strong>
                    <div style={{ color: "var(--text)", fontSize: 14, marginTop: 4 }}>
                      {formatFecha(selectedOrden.gestion.turno_fecha_hora)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Lista de archivos y botón para descargar */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Archivos ({selectedOrden.archivos?.length || 0})
            </h3>
            
            {selectedOrden.archivos && selectedOrden.archivos.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                {selectedOrden.archivos.map((archivo: any, index: number) => (
                  <div
                    key={archivo.id || index}
                    style={{
                      padding: "8px 12px",
                      marginBottom: 6,
                      background: "rgba(255,255,255,.03)",
                      border: "1px solid rgba(255,255,255,.08)",
                      borderRadius: 6,
                      fontSize: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {archivo.filename || `Archivo ${archivo.orden_archivo || index + 1}`}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          const session = await requireSessionOrRedirect();
                          if (!session) return;

                          const res = await fetch(`/api/ordenes-medicas/download?orden_id=${selectedOrden.id}&archivo_id=${archivo.id}`, {
                            headers: {
                              "Authorization": `Bearer ${session.access_token}`,
                            },
                          });

                          if (res.ok) {
                            const blob = await res.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            const contentDisposition = res.headers.get("Content-Disposition");
                            const filename = contentDisposition
                              ? contentDisposition.match(/filename="?(.+)"?/)?.[1] || archivo.filename || "archivo.pdf"
                              : archivo.filename || "archivo.pdf";
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                          } else {
                            setMsg("Error al descargar el archivo");
                          }
                        } catch (err) {
                          console.error("Error descargando:", err);
                          setMsg("Error al descargar el archivo");
                        }
                      }}
                      style={{
                        padding: "4px 8px",
                        marginLeft: 8,
                        background: "rgba(96,141,186,.2)",
                        border: "1px solid rgba(96,141,186,.4)",
                        borderRadius: 4,
                        color: "var(--text)",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Descargar
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12, fontStyle: "italic" }}>
                No hay archivos disponibles (orden antigua)
              </div>
            )}

            <button
              onClick={async () => {
                try {
                  const session = await requireSessionOrRedirect();
                  if (!session) return;

                  const res = await fetch(`/api/ordenes-medicas/download?orden_id=${selectedOrden.id}`, {
                    headers: {
                      "Authorization": `Bearer ${session.access_token}`,
                    },
                  });

                  if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    // Obtener el nombre del archivo del header Content-Disposition
                    const contentDisposition = res.headers.get("Content-Disposition");
                    const filename = contentDisposition
                      ? contentDisposition.match(/filename="?(.+)"?/)?.[1] || "orden-medica.zip"
                      : (selectedOrden.archivos && selectedOrden.archivos.length > 1)
                        ? `orden-medica-${selectedOrden.case_ref || selectedOrden.id.substring(0, 8)}.zip`
                        : selectedOrden.filename || "orden-medica.pdf";
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  } else {
                    setMsg("Error al descargar el archivo");
                  }
                } catch (err) {
                  console.error("Error descargando:", err);
                  setMsg("Error al descargar el archivo");
                }
              }}
              style={{
                padding: "10px 20px",
                background: "rgba(96,141,186,.2)",
                border: "1px solid rgba(96,141,186,.4)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                width: "100%",
              }}
            >
              {selectedOrden.archivos && selectedOrden.archivos.length > 1
                ? `Descargar Todos los Archivos (${selectedOrden.archivos.length})`
                : "Descargar Orden Médica"}
            </button>
          </div>

          {/* Acciones según estado */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              Acciones
            </h3>
            
            {!selectedOrden.gestion ? (
              <div style={{
                padding: "16px",
                background: "rgba(241, 196, 15, 0.1)",
                border: "1px solid rgba(241, 196, 15, 0.3)",
                borderRadius: 8,
                color: "rgba(255, 246, 205, 0.95)",
                fontSize: 13,
              }}>
                <div style={{ marginBottom: 12, textAlign: "center" }}>
                  ⚠️ Esta orden no tiene gestión asociada
                </div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
                  La gestión se crea automáticamente al subir una orden nueva. 
                  Si esta orden fue creada antes, puedes crear la gestión manualmente.
                </div>
                <button
                  type="button"
                  disabled={creatingGestion}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (creatingGestion) return;
                    
                    setCreatingGestion(true);
                    try {
                      console.log("[Crear Gestión] Iniciando...");
                      const session = await requireSessionOrRedirect();
                      if (!session) {
                        console.error("[Crear Gestión] No hay sesión");
                        setCreatingGestion(false);
                        return;
                      }

                      console.log("[Crear Gestión] Orden ID:", selectedOrden.id);

                      // Buscar usuario "Andrea" o usar el usuario actual
                      const { data: andreaProfile } = await supabase
                        .from("profiles")
                        .select("id")
                        .or("full_name.ilike.%andrea%,email.ilike.%andrea%")
                        .limit(1)
                        .maybeSingle();

                      const responsableUserId = andreaProfile?.id || session.user.id;
                      console.log("[Crear Gestión] Responsable ID:", responsableUserId);

                      const requestBody = {
                        orden_id: selectedOrden.id,
                        responsable_user_id: responsableUserId,
                      };
                      console.log("[Crear Gestión] Request body:", requestBody);

                      const res = await fetch("/api/ordenes-medicas/create-gestion", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "Authorization": `Bearer ${session.access_token}`,
                        },
                        body: JSON.stringify(requestBody),
                      });

                      if (res.ok) {
                        const result = await res.json();
                        console.log("[Crear Gestión] Resultado:", result);
                        
                        if (result.warning) {
                          setMsg("La gestión ya existía. Recargando...");
                        } else {
                          setMsg("Gestión creada exitosamente");
                        }
                        
                        // Recargar la orden seleccionada directamente
                        const updatedRes = await fetch("/api/ordenes-medicas/list", {
                          headers: {
                            "Authorization": `Bearer ${session.access_token}`,
                          },
                        });
                        if (updatedRes.ok) {
                          const { data } = await updatedRes.json();
                          const updated = data.find((o: any) => o.id === selectedOrden.id);
                          if (updated) {
                            console.log("[Crear Gestión] Orden actualizada:", updated);
                            setSelectedOrden(updated);
                            // Actualizar también la lista si estamos en el tab de órdenes
                            if (activeTab === "ordenes") {
                              setOrdenesData(data || []);
                            }
                          } else {
                            console.warn("[Crear Gestión] No se encontró la orden actualizada");
                          }
                        }
                      } else {
                        let errorData: any = { error: "Error desconocido" };
                        try {
                          const text = await res.text();
                          console.error("[Crear Gestión] Error response text:", text);
                          if (text) {
                            try {
                              errorData = JSON.parse(text);
                            } catch {
                              errorData = { error: text || `HTTP ${res.status}` };
                            }
                          }
                        } catch (parseError) {
                          console.error("[Crear Gestión] Error parseando respuesta:", parseError);
                          errorData = { error: `HTTP ${res.status}` };
                        }
                        
                        console.error("[Crear Gestión] Error completo:", {
                          status: res.status,
                          statusText: res.statusText,
                          error: errorData
                        });
                        
                        setMsg("Error: " + (errorData.error || "Error desconocido"));
                      }
                    } catch (err) {
                      console.error("Error creando gestión:", err);
                      setMsg("Error al crear la gestión: " + (err instanceof Error ? err.message : String(err)));
                    } finally {
                      setCreatingGestion(false);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    background: creatingGestion ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.2)",
                    border: "1px solid rgba(96,141,186,.4)",
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: creatingGestion ? "not-allowed" : "pointer",
                    opacity: creatingGestion ? 0.6 : 1,
                  }}
                >
                  {creatingGestion ? "Creando..." : "➕ Crear Gestión"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Botón: Registrar Contacto Cliente */}
              {selectedOrden.gestion && (
                <button
                  onClick={() => {
                    setComunicacionForm({
                      canal: "TELEFONO",
                      resultado: "SATISFACTORIO",
                      motivo_falla: "",
                      detalle: "",
                      tipo: "GESTION"
                    });
                    setShowComunicacionForm(true);
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(96,141,186,.2)",
                    border: "1px solid rgba(96,141,186,.4)",
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  📞 Registrar Contacto Cliente
                </button>
              )}

              {/* Botón: Registrar Contacto Centro Médico */}
              {selectedOrden.gestion && (
                <button
                  onClick={() => {
                    setComunicacionForm({
                      canal: "TELEFONO",
                      resultado: "SATISFACTORIO",
                      motivo_falla: "",
                      detalle: "",
                      tipo: "GESTION"
                    });
                    setShowComunicacionForm(true);
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(96,141,186,.2)",
                    border: "1px solid rgba(96,141,186,.4)",
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  🏥 Registrar Contacto Centro Médico
                </button>
              )}

              {/* Botón: Asignar Turno */}
              {selectedOrden.gestion && selectedOrden.gestion.estado !== "ESTUDIO_REALIZADO" && (
                <button
                  onClick={() => {
                    setTurnoForm({
                      centro_medico: selectedOrden.gestion?.centro_medico || "",
                      fecha: "",
                      hora: "",
                    });
                    setShowTurnoForm(true);
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(96,141,186,.2)",
                    border: "1px solid rgba(96,141,186,.4)",
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  📅 Asignar Turno
                </button>
              )}

              {/* Botón: Marcar Estudio Realizado */}
              {selectedOrden.gestion && 
               selectedOrden.gestion.estado !== "ESTUDIO_REALIZADO" && 
               selectedOrden.gestion.turno_fecha_hora && (
                <button
                  onClick={async () => {
                    if (!confirm("¿Marcar el estudio como realizado?")) return;
                    
                    try {
                      const session = await requireSessionOrRedirect();
                      if (!session) return;

                      const res = await fetch("/api/ordenes-medicas/update-estado", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "Authorization": `Bearer ${session.access_token}`,
                        },
                        body: JSON.stringify({
                          gestion_id: selectedOrden.gestion.id,
                          estado: "ESTUDIO_REALIZADO",
                          fecha_estudio_realizado: new Date().toISOString(),
                          generar_notificacion: true,
                        }),
                      });

                      if (res.ok) {
                        setMsg("Estudio marcado como realizado");
                        await loadOrdenes();
                        // Recargar la orden seleccionada
                        const updatedRes = await fetch("/api/ordenes-medicas/list", {
                          headers: {
                            "Authorization": `Bearer ${session.access_token}`,
                          },
                        });
                        if (updatedRes.ok) {
                          const { data } = await updatedRes.json();
                          const updated = data.find((o: any) => o.id === selectedOrden.id);
                          if (updated) setSelectedOrden(updated);
                        }
                      } else {
                        const error = await res.json().catch(() => ({ error: "Error desconocido" }));
                        setMsg("Error: " + (error.error || "Error desconocido"));
                      }
                    } catch (err) {
                      console.error("Error marcando estudio:", err);
                      setMsg("Error al marcar estudio como realizado");
                    }
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(46, 204, 113, 0.2)",
                    border: "1px solid rgba(46, 204, 113, 0.4)",
                    borderRadius: 8,
                    color: "rgba(210, 255, 226, 0.95)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  ✅ Marcar Estudio Realizado
                </button>
              )}

              {/* Botón: Reprogramar (si hay turno) */}
              {selectedOrden.gestion && 
               selectedOrden.gestion.turno_fecha_hora && 
               selectedOrden.gestion.estado !== "ESTUDIO_REALIZADO" && (
                <button
                  onClick={() => {
                    setTurnoForm({
                      centro_medico: selectedOrden.gestion?.centro_medico || "",
                      fecha: "",
                      hora: "",
                    });
                    setShowTurnoForm(true);
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(241, 196, 15, 0.2)",
                    border: "1px solid rgba(241, 196, 15, 0.4)",
                    borderRadius: 8,
                    color: "rgba(255, 246, 205, 0.95)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  🔄 Reprogramar Turno
                </button>
              )}
              </div>
            )}
          </div>

          {/* Formulario: Registrar Comunicación */}
          {showComunicacionForm && (
            <div style={{
              marginBottom: 24,
              padding: "16px",
              background: "rgba(255,255,255,.05)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.1)",
            }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                Registrar Comunicación
              </h4>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Canal
                  </label>
                  <select
                    value={comunicacionForm.canal}
                    onChange={(e) => setComunicacionForm({ ...comunicacionForm, canal: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 13,
                    }}
                  >
                    <option value="TELEFONO">Teléfono</option>
                    <option value="EMAIL">Email</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="PRESENCIAL">Presencial</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Resultado
                  </label>
                  <select
                    value={comunicacionForm.resultado}
                    onChange={(e) => setComunicacionForm({ ...comunicacionForm, resultado: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 13,
                    }}
                  >
                    <option value="SATISFACTORIO">Satisfactorio</option>
                    <option value="INSATISFACTORIO">Insatisfactorio</option>
                    <option value="SIN_RESPUESTA">Sin Respuesta</option>
                    <option value="RECHAZO">Rechazo</option>
                  </select>
                </div>

                {(comunicacionForm.resultado === "INSATISFACTORIO" || comunicacionForm.resultado === "RECHAZO") && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                      Motivo de Falla
                    </label>
                    <input
                      type="text"
                      value={comunicacionForm.motivo_falla}
                      onChange={(e) => setComunicacionForm({ ...comunicacionForm, motivo_falla: e.target.value })}
                      placeholder="Ej: Cliente no disponible, número incorrecto..."
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "rgba(11,47,85,.95)",
                        border: "1px solid rgba(255,255,255,.2)",
                        borderRadius: 6,
                        color: "var(--text)",
                        fontSize: 13,
                      }}
                    />
                  </div>
                )}

                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Detalle
                  </label>
                  <textarea
                    value={comunicacionForm.detalle}
                    onChange={(e) => setComunicacionForm({ ...comunicacionForm, detalle: e.target.value })}
                    placeholder="Detalle de la comunicación..."
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={async () => {
                      if (!comunicacionForm.detalle.trim()) {
                        setMsg("El detalle es requerido");
                        return;
                      }

                      setSavingComunicacion(true);
                      try {
                        const session = await requireSessionOrRedirect();
                        if (!session) return;

                        const entidadId = comunicacionForm.tipo === "GESTION" 
                          ? selectedOrden.gestion?.id 
                          : selectedOrden.id;

                        if (!entidadId) {
                          setMsg("Error: No se encontró la gestión");
                          return;
                        }

                        // Determinar nuevo estado según resultado
                        let nuevoEstado = null;
                        if (comunicacionForm.tipo === "GESTION" && selectedOrden.gestion) {
                          const estadoActual = selectedOrden.gestion.estado;
                          if (estadoActual === "PENDIENTE_CONTACTO_CLIENTE") {
                            nuevoEstado = comunicacionForm.resultado === "SATISFACTORIO" 
                              ? "CONTACTO_CLIENTE_OK" 
                              : "CONTACTO_CLIENTE_FALLIDO";
                          } else if (estadoActual === "CONTACTO_CLIENTE_OK" || estadoActual === "TURNO_CONFIRMADO") {
                            nuevoEstado = "SEGUIMIENTO_PRE_TURNO";
                          }
                        }

                        const res = await fetch("/api/ordenes-medicas/comunicacion", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${session.access_token}`,
                          },
                          body: JSON.stringify({
                            entidad_tipo: comunicacionForm.tipo,
                            entidad_id: entidadId,
                            canal: comunicacionForm.canal,
                            resultado: comunicacionForm.resultado,
                            motivo_falla: comunicacionForm.motivo_falla || null,
                            detalle: comunicacionForm.detalle.trim(),
                            actualizar_estado: nuevoEstado !== null,
                            nuevo_estado: nuevoEstado,
                          }),
                        });

                        if (res.ok) {
                          setMsg("Comunicación registrada exitosamente");
                          setShowComunicacionForm(false);
                          setComunicacionForm({
                            canal: "TELEFONO",
                            resultado: "SATISFACTORIO",
                            motivo_falla: "",
                            detalle: "",
                            tipo: "GESTION"
                          });
                          await loadOrdenes();
                          // Recargar la orden seleccionada
                          const updatedRes = await fetch("/api/ordenes-medicas/list", {
                            headers: {
                              "Authorization": `Bearer ${session.access_token}`,
                            },
                          });
                          if (updatedRes.ok) {
                            const { data } = await updatedRes.json();
                            const updated = data.find((o: any) => o.id === selectedOrden.id);
                            if (updated) setSelectedOrden(updated);
                          }
                        } else {
                          const error = await res.json().catch(() => ({ error: "Error desconocido" }));
                          setMsg("Error: " + (error.error || "Error desconocido"));
                        }
                      } catch (err) {
                        console.error("Error guardando comunicación:", err);
                        setMsg("Error al guardar la comunicación");
                      } finally {
                        setSavingComunicacion(false);
                      }
                    }}
                    disabled={savingComunicacion}
                    style={{
                      flex: 1,
                      padding: "10px 16px",
                      background: savingComunicacion ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.2)",
                      border: "1px solid rgba(96,141,186,.4)",
                      borderRadius: 8,
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: savingComunicacion ? "not-allowed" : "pointer",
                      opacity: savingComunicacion ? 0.6 : 1,
                    }}
                  >
                    {savingComunicacion ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => {
                      setShowComunicacionForm(false);
                      setComunicacionForm({
                        canal: "TELEFONO",
                        resultado: "SATISFACTORIO",
                        motivo_falla: "",
                        detalle: "",
                        tipo: "GESTION"
                      });
                    }}
                    style={{
                      padding: "10px 16px",
                      background: "rgba(255,255,255,.1)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 8,
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Formulario: Asignar Turno */}
          {showTurnoForm && (
            <div style={{
              marginBottom: 24,
              padding: "16px",
              background: "rgba(255,255,255,.05)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.1)",
            }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                {selectedOrden.gestion?.turno_fecha_hora ? "Reprogramar Turno" : "Asignar Turno"}
              </h4>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Centro Médico
                  </label>
                  <input
                    type="text"
                    value={turnoForm.centro_medico}
                    onChange={(e) => setTurnoForm({ ...turnoForm, centro_medico: e.target.value })}
                    placeholder="Nombre del centro médico"
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={turnoForm.fecha}
                    onChange={(e) => setTurnoForm({ ...turnoForm, fecha: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    Hora
                  </label>
                  <input
                    type="time"
                    value={turnoForm.hora}
                    onChange={(e) => setTurnoForm({ ...turnoForm, hora: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "rgba(11,47,85,.95)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={async () => {
                      if (!turnoForm.centro_medico.trim() || !turnoForm.fecha || !turnoForm.hora) {
                        setMsg("Todos los campos son requeridos");
                        return;
                      }

                      setSavingTurno(true);
                      try {
                        const session = await requireSessionOrRedirect();
                        if (!session) return;

                        // Combinar fecha y hora en ISO string
                        const fechaHora = new Date(`${turnoForm.fecha}T${turnoForm.hora}:00`).toISOString();

                        const res = await fetch("/api/ordenes-medicas/update-estado", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${session.access_token}`,
                          },
                          body: JSON.stringify({
                            gestion_id: selectedOrden.gestion?.id,
                            estado: "TURNO_CONFIRMADO",
                            centro_medico: turnoForm.centro_medico.trim(),
                            turno_fecha_hora: fechaHora,
                          }),
                        });

                        if (res.ok) {
                          setMsg("Turno asignado exitosamente");
                          setShowTurnoForm(false);
                          setTurnoForm({ centro_medico: "", fecha: "", hora: "" });
                          await loadOrdenes();
                          // Recargar la orden seleccionada
                          const updatedRes = await fetch("/api/ordenes-medicas/list", {
                            headers: {
                              "Authorization": `Bearer ${session.access_token}`,
                            },
                          });
                          if (updatedRes.ok) {
                            const { data } = await updatedRes.json();
                            const updated = data.find((o: any) => o.id === selectedOrden.id);
                            if (updated) setSelectedOrden(updated);
                          }
                        } else {
                          const error = await res.json().catch(() => ({ error: "Error desconocido" }));
                          setMsg("Error: " + (error.error || "Error desconocido"));
                        }
                      } catch (err) {
                        console.error("Error asignando turno:", err);
                        setMsg("Error al asignar el turno");
                      } finally {
                        setSavingTurno(false);
                      }
                    }}
                    disabled={savingTurno}
                    style={{
                      flex: 1,
                      padding: "10px 16px",
                      background: savingTurno ? "rgba(255,255,255,.1)" : "rgba(96,141,186,.2)",
                      border: "1px solid rgba(96,141,186,.4)",
                      borderRadius: 8,
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: savingTurno ? "not-allowed" : "pointer",
                      opacity: savingTurno ? 0.6 : 1,
                    }}
                  >
                    {savingTurno ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => {
                      setShowTurnoForm(false);
                      setTurnoForm({ centro_medico: "", fecha: "", hora: "" });
                    }}
                    style={{
                      padding: "10px 16px",
                      background: "rgba(255,255,255,.1)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 8,
                      color: "var(--text)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Timeline de comunicaciones */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              Comunicaciones
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedOrden.gestion?.comunicaciones?.length > 0 ? (
                selectedOrden.gestion.comunicaciones.map((com: any) => (
                  <div
                    key={com.id}
                    style={{
                      padding: "12px",
                      background: "rgba(255,255,255,.03)",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,.06)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {com.canal}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 4,
                          background:
                            com.resultado === "SATISFACTORIO"
                              ? "rgba(46, 204, 113, 0.16)"
                              : com.resultado === "INSATISFACTORIO" || com.resultado === "RECHAZO"
                              ? "rgba(231, 76, 60, 0.16)"
                              : "rgba(241, 196, 15, 0.14)",
                          color:
                            com.resultado === "SATISFACTORIO"
                              ? "rgba(210, 255, 226, 0.95)"
                              : com.resultado === "INSATISFACTORIO" || com.resultado === "RECHAZO"
                              ? "rgba(255, 220, 216, 0.95)"
                              : "rgba(255, 246, 205, 0.95)",
                        }}
                      >
                        {com.resultado}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                      {formatFecha(com.created_at)} - {com.realizado_por?.full_name || com.realizado_por?.email || "Usuario"}
                    </div>
                    {com.detalle && (
                      <div style={{ fontSize: 13, color: "var(--text)", marginTop: 8, whiteSpace: "pre-wrap" }}>
                        {com.detalle}
                      </div>
                    )}
                    {com.motivo_falla && (
                      <div style={{ fontSize: 12, color: "rgba(231, 76, 60, 0.8)", marginTop: 4 }}>
                        Motivo: {com.motivo_falla}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "20px" }}>
                  No hay comunicaciones registradas
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
