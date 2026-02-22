"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pjnScraperSupabase } from "@/lib/pjn-scraper-supabase";
import jsPDF from "jspdf";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  fecha_vencimiento: string | null;
  estado: string;
  tipo_documento: "CEDULA" | "OFICIO" | null;
  created_by_user_id?: string | null;
};

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  estado: string;
  created_by_user_id?: string | null;
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
  movimientos?: any; // Agregar movimientos para filtro de Prueba/Pericia
};

type Profile = { id: string; full_name: string | null; email: string | null };

type UserJuzgados = {
  user_id: string;
  juzgado: string;
};

const UMBRAL_AMARILLO = 30;
const UMBRAL_ROJO = 60;

type TimeFilter = "all" | "week" | "month" | "custom";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getDateRange(filter: TimeFilter, customStart?: string, customEnd?: string): { start: string | null; end: string | null } {
  const now = new Date();
  const today = startOfDay(now);
  
  switch (filter) {
    case "week": {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return {
        start: weekAgo.toISOString(),
        end: now.toISOString(),
      };
    }
    case "month": {
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return {
        start: monthAgo.toISOString(),
        end: now.toISOString(),
      };
    }
    case "custom": {
      if (customStart && customEnd) {
        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
        const end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
        return {
          start: start.toISOString(),
          end: end.toISOString(),
        };
      }
      return { start: null, end: null };
    }
    default:
      return { start: null, end: null };
  }
}

// Convertir fecha a ISO (YYYY-MM-DD)
// Maneja múltiples formatos:
// - DD/MM/AAAA (formato esperado)
// - YYYY-MM-DD (formato actual en BD)
// - AAAA-MM-DD (variante)
function ddmmaaaaToISO(fecha: string | null): string | null {
  if (!fecha || fecha.trim() === "") return null;
  
  const fechaTrim = fecha.trim();
  
  // Intentar formato DD/MM/AAAA
  const m1 = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fechaTrim);
  if (m1) {
    const [, dia, mes, anio] = m1;
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  
  // Intentar formato YYYY-MM-DD o AAAA-MM-DD (formato actual en BD)
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaTrim);
  if (m2) {
    const [, anio, mes, dia] = m2;
    // Ya está en formato ISO, solo agregar la hora
    return `${anio}-${mes}-${dia}T00:00:00.000Z`;
  }
  
  // Si no coincide con ningún formato, retornar null
  console.warn(`[Dashboard] Formato de fecha no reconocido: ${fechaTrim}`);
  return null;
}

// Función para detectar si un expediente tiene Prueba/Pericia en sus movimientos
function tienePruebaPericia(movimientos: any): boolean {
  if (!movimientos) return false;
  
  try {
    // Si movimientos es un string JSON, parsearlo
    let movs = movimientos;
    if (typeof movimientos === 'string') {
      try {
        movs = JSON.parse(movimientos);
      } catch {
        return false;
      }
    }
    
    // Si es un array de objetos
    if (Array.isArray(movs) && movs.length > 0) {
      for (const mov of movs) {
        if (typeof mov === 'object' && mov !== null) {
          // Buscar en el campo "Detalle" o en "cols"
          let detalleText = '';
          
          if (mov.Detalle) {
            detalleText = String(mov.Detalle).toUpperCase();
          } else if (mov.cols && Array.isArray(mov.cols)) {
            // Buscar en cols el campo "Detalle:" (puede estar en cualquier posición del array)
            for (const col of mov.cols) {
              const colStr = String(col).trim();
              // Buscar "Detalle:" al inicio o en cualquier parte
              const matchDetalle = colStr.match(/Detalle:\s*(.+)$/i);
              if (matchDetalle) {
                detalleText = matchDetalle[1].toUpperCase();
                break;
              }
            }
            // Si no se encontró "Detalle:", buscar los patrones directamente en todos los cols
            if (!detalleText) {
              const allColsText = mov.cols.map((col: any) => String(col)).join(' ').toUpperCase();
              detalleText = allColsText;
            }
          }
          
          // Patrones canónicos para Prueba/Pericia
          const patrones = [
            /SE\s+ORDENA.*PERICI/i,
            /ORDENA.*PERICI/i,
            /SOLICITA.*PROVEE.*PRUEBA\s+PERICI/i,
            /PRUEBA\s+PERICIAL/i,
            /PERITO.*ACEPTA\s+(?:EL\s+)?CARGO/i,  // Mejorado: acepta "EL CARGO" o "CARGO"
            /PERITO.*PRESENTA\s+INFORME/i,         // Nuevo
            /PERITO.*FIJA\s+(?:NUEVA\s+)?FECHA/i, // Nuevo
            /PERITO.*INFORMA/i,                    // Nuevo
            /PERITO.*CITA/i,                       // Nuevo
            /LLAMA.*PERICI/i,
            /DISPONE.*PERICI/i,
            /TRASLADO.*PERICI/i,
            /PERICI.*M[EÉ]DIC/i,
            /PERICI.*PSICOL/i,
            /PERICI.*CONTAB/i,
            /PERICI.*INGENIER/i,                   // Nuevo
            /PERICI.*LEGIST/i,                      // Nuevo
            /ACREDITA.*PERITO/i,                    // Nuevo: para "ACREDITA ANTICIPO DE GASTOS PERITO"
            /ANTICIPO.*PERITO/i,                    // Nuevo
            /GASTOS.*PERITO/i                       // Nuevo
          ];
          
          for (const patron of patrones) {
            if (patron.test(detalleText)) {
              return true;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Prueba/Pericia] Error al analizar movimientos:`, err);
  }
  
  return false;
}

/**
 * Calcula los días desde una fecha, excluyendo los días de enero (feria judicial)
 * @param fechaCargaISO Fecha en formato ISO
 * @returns Número de días efectivos (excluyendo enero)
 */
function daysSince(fechaCargaISO: string | null) {
  if (!fechaCargaISO) return 0;
  const carga = new Date(fechaCargaISO);
  if (isNaN(carga.getTime())) return 0;
  const today = startOfDay(new Date());
  const base = startOfDay(carga);
  
  // Calcular días totales
  const diffMs = today.getTime() - base.getTime();
  const totalDays = Math.floor(diffMs / 86400000);
  
  // Contar días de enero (feria judicial) en el rango
  let eneroDays = 0;
  const currentDate = new Date(base);
  
  while (currentDate <= today) {
    // Si el día actual es de enero (mes 0 en JavaScript), contarlo
    if (currentDate.getMonth() === 0) { // Enero es mes 0
      eneroDays++;
    }
    // Avanzar un día
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Retornar días efectivos (total - días de enero)
  return Math.max(0, totalDays - eneroDays);
}

/**
 * Obtiene la fecha base para calcular el semáforo
 * Para cédulas/oficios: usa fecha_carga
 * Para expedientes: usa fecha_ultima_modificacion
 */
function getFechaBaseParaSemaforo(
  fechaCarga: string | null | undefined,
  fechaUltimaModificacion: string | null | undefined,
  esExpediente: boolean = false
): string | null {
  // Para expedientes, usar fecha_ultima_modificacion
  if (esExpediente) {
    return fechaUltimaModificacion || null;
  }
  
  // Para cédulas/oficios, usar fecha_carga
  return fechaCarga || null;
}

function semaforoPorAntiguedad(diasDesdeCarga: number) {
  if (diasDesdeCarga >= UMBRAL_ROJO) return "ROJO";
  if (diasDesdeCarga >= UMBRAL_AMARILLO) return "AMARILLO";
  return "VERDE";
}

function displayName(p?: Profile) {
  const name = (p?.full_name || "").trim();
  if (name) return name;
  const email = (p?.email || "").trim();
  if (email) return email;
  return "Sin nombre";
}

function KPICard({ 
  title, 
  value, 
  subValue, 
  change, 
  changePositive, 
  color = "blue",
  trend,
  target
}: {
  title: string;
  value: string | number;
  subValue?: string;
  change?: string;
  changePositive?: boolean;
  color?: "blue" | "green" | "red" | "yellow" | "orange";
  trend?: "up" | "down";
  target?: string;
}) {
  const colorClasses = {
    blue: { bg: "rgba(0,82,156,.15)", border: "rgba(0,82,156,.35)", text: "#608dba" },
    green: { bg: "rgba(0,169,82,.15)", border: "rgba(0,169,82,.35)", text: "#00a952" },
    red: { bg: "rgba(225,57,64,.15)", border: "rgba(225,57,64,.35)", text: "#e13940" },
    yellow: { bg: "rgba(255,200,60,.15)", border: "rgba(255,200,60,.35)", text: "#ffc83c" },
    orange: { bg: "rgba(255,165,0,.15)", border: "rgba(255,165,0,.35)", text: "#ffa500" },
  };
  
  const colors = colorClasses[color];
  const changeColor = changePositive === false ? "#e13940" : changePositive === true ? "#00a952" : "rgba(234,243,255,.72)";
  
  const renderTrend = () => {
    if (!trend) return null;
    // polyline points debe ser formato "x1,y1 x2,y2 x3,y3..." no un path SVG
    const points = trend === "up" 
      ? "2,18 8,12 14,10 20,6 26,4"
      : "2,4 8,8 14,10 20,14 26,16";
    const strokeColor = trend === "up" ? "#00a952" : "#e13940";
    
    return (
      <svg width="120" height="20" style={{ marginTop: 8, opacity: 0.7 }}>
        <polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  const renderProgress = () => {
    if (!target) return null;
    const numValue = typeof value === "number" ? value : parseInt(String(value).replace(/[^0-9]/g, ""));
    const numTarget = parseInt(target.replace(/[^0-9]/g, ""));
    const percentage = numTarget > 0 ? Math.min((numValue / numTarget) * 100, 100) : 0;
    
    return (
      <div style={{ marginTop: 12, width: "100%" }}>
        <div style={{
          width: "100%",
          height: 6,
          backgroundColor: "rgba(255,255,255,.08)",
          borderRadius: 3,
          overflow: "hidden"
        }}>
          <div style={{
            width: `${percentage}%`,
            height: "100%",
            backgroundColor: colors.text,
            borderRadius: 3,
            transition: "width 0.3s ease"
          }} />
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: "rgba(234,243,255,.6)" }}>
          Target: {target}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${colors.bg}, rgba(255,255,255,.04))`,
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      transition: "transform 0.2s ease, box-shadow 0.2s ease",
      boxShadow: "0 4px 12px rgba(0,0,0,.15)",
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = "translateY(-2px)";
      e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,.2)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,.15)";
    }}
    >
      <div style={{ fontSize: 12, color: "rgba(234,243,255,.72)", fontWeight: 500, letterSpacing: "0.3px" }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ 
          fontSize: 32, 
          fontWeight: 700, 
          color: colors.text,
          lineHeight: 1
        }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {subValue && (
          <div style={{ fontSize: 14, color: "rgba(234,243,255,.6)", fontWeight: 500 }}>
            {subValue}
          </div>
        )}
      </div>
      {renderTrend()}
      {renderProgress()}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8 }}>
        <div style={{ fontSize: 11, color: "rgba(234,243,255,.6)" }}>
          Total
        </div>
        {change && (
          <div style={{ 
            fontSize: 13, 
            fontWeight: 600, 
            color: changeColor,
            display: "flex",
            alignItems: "center",
            gap: 4
          }}>
            {changePositive !== false && <span>↑</span>}
            {changePositive === false && <span>↓</span>}
            {change}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SuperAdminPage() {
  const [checking, setChecking] = useState(true);
  const [msg, setMsg] = useState("");
  const [cedulas, setCedulas] = useState<Cedula[]>([]);
  const [allCedulas, setAllCedulas] = useState<Cedula[]>([]); // Todas las cédulas sin filtrar
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [allExpedientes, setAllExpedientes] = useState<Expediente[]>([]); // Todos los expedientes sin filtrar
  const [pjnFavoritos, setPjnFavoritos] = useState<PjnFavorito[]>([]); // Favoritos de pjn-scraper
  const [userJuzgadosMap, setUserJuzgadosMap] = useState<Record<string, string[]>>({}); // Mapa de user_id -> juzgados[]
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [juzgadoFilter, setJuzgadoFilter] = useState<"mis_juzgados" | "todos" | "beneficio" | "prueba_pericia" | string>("todos");
  const [userJuzgados, setUserJuzgados] = useState<string[]>([]);
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [roleFlags, setRoleFlags] = useState<{ isSuperadmin: boolean; isAbogado: boolean }>({ isSuperadmin: false, isAbogado: false });

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    // Usar setTimeout para que el click del botón no cierre inmediatamente el menú
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 100);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { window.location.href = "/login"; return; }
      const uid = sess.session.user.id;
      setCurrentUserId(uid);
      
      // Obtener nombre del usuario desde la sesión o user_metadata
      const sessionFullName = (sess.session.user.user_metadata as { full_name?: string })?.full_name;
      const sessionEmail = (sess.session.user.email || "").trim();
      const baseName = (sessionFullName || "").trim() || sessionEmail;
      setCurrentUserName(baseName);

      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (pErr) { window.location.href = "/login"; return; }
      if (prof?.must_change_password) { window.location.href = "/cambiar-password"; return; }

      // Verificar roles del usuario (superadmin, abogado, expedientes)
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_abogado, is_admin_expedientes")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isSuperadmin = roleData?.is_superadmin === true;
      const isAbogado = roleData?.is_abogado === true;
      const isAdminExpedientes = roleData?.is_admin_expedientes === true;

      setRoleFlags({ isSuperadmin, isAbogado });
      
      console.log(`[Dashboard] Roles del usuario:`, {
        isSuperadmin,
        isAbogado,
        isAdminExpedientes,
        userId: uid
      });
      
      if (!isSuperadmin && !isAbogado) { 
        window.location.href = "/app"; 
        return; 
      }

      // Si es abogado (y no superadmin), fijar el filtro de usuario a sí mismo
      // para evitar inconsistencias al navegar por el dashboard.
      if (isAbogado && !isSuperadmin) {
        setSelectedUserId(uid);
        setJuzgadoFilter("mis_juzgados");
      }

      // Obtener juzgados asignados al usuario (si es abogado o superadmin)
      // Los superadmins que también son abogados pueden tener juzgados asignados
      if (isAbogado || isSuperadmin) {
        const { data: juzgadosData, error: juzgadosErr } = await supabase
          .from("user_juzgados")
          .select("juzgado")
          .eq("user_id", uid);
        
        if (!juzgadosErr && juzgadosData && juzgadosData.length > 0) {
          const juzgadosAsignados = juzgadosData.map(j => j.juzgado);
          setUserJuzgados(juzgadosAsignados);
          console.log(`[Dashboard] Juzgados asignados al usuario:`, juzgadosAsignados);
        } else {
          console.log(`[Dashboard] Usuario no tiene juzgados asignados o error:`, juzgadosErr);
        }
      }

      // Cargar TODOS los perfiles primero
      const { data: profs, error: profsErr } = await supabase
        .from("profiles")
        .select("id, full_name, email");

      if (profsErr) { setMsg(profsErr.message); setChecking(false); return; }

      const map: Record<string, Profile> = {};
      const profList = (profs ?? []) as unknown as Profile[];
      profList.forEach((p) => { map[p.id] = p; });
      
      // Mejorar el nombre del usuario actual si hay perfil en la BD
      if (map[uid]) {
        const profileName = map[uid].full_name?.trim() || map[uid].email?.trim() || "";
        if (profileName) {
          setCurrentUserName(profileName);
        }
      }
      
      // Después de cargar expedientes y cédulas, asegurar que todos los usuarios tengan perfil
      // (esto se hará en un useEffect separado después de cargar los datos)
      setProfiles(map);

      // Intentar obtener con tipo_documento, created_by_user_id y fecha_vencimiento, pero hacer fallback si no existen las columnas
      const query = supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, fecha_vencimiento, estado, tipo_documento, created_by_user_id")
        .neq("estado", "CERRADA")
        .order("fecha_carga", { ascending: true });

      const { data: cs, error: cErr } = await query;

      if (cErr) {
        // Si falla por columna inexistente, reintentar sin ellas
        if (cErr.message?.includes("tipo_documento") || cErr.message?.includes("created_by_user_id") || cErr.message?.includes("fecha_vencimiento")) {
          const { data: cs2, error: cErr2 } = await supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado")
        .neq("estado", "CERRADA")
            .order("fecha_carga", { ascending: true });
          
          if (cErr2) { 
            setMsg(cErr2.message); 
            setChecking(false); 
            return; 
          }
          
          const csWithNull = (cs2 ?? []).map((c) => ({ ...(c as Record<string, unknown>), tipo_documento: null, created_by_user_id: null, fecha_vencimiento: null }));
          setAllCedulas(csWithNull as Cedula[]);
        } else {
          setMsg(cErr.message);
          setChecking(false);
          return;
        }
      } else {
        setAllCedulas((cs ?? []) as Cedula[]);
        console.log(`[Dashboard] Cédulas cargadas inicialmente: ${(cs ?? []).length}`, {
          isSuperadmin,
          isAbogado,
          juzgadoFilter: "todos (carga inicial)"
        });
        // Log de juzgados únicos en las cédulas cargadas
        const csTyped = (cs ?? []) as unknown as Cedula[];
        const juzgadosUnicos = [...new Set(csTyped.map((c) => c.juzgado).filter(Boolean))];
        const usuariosUnicos = [...new Set(csTyped.map((c) => c.owner_user_id))];
        console.log(`[Dashboard] Juzgados únicos en cédulas: ${juzgadosUnicos.length}`, juzgadosUnicos.slice(0, 10));
        console.log(`[Dashboard] Usuarios únicos en cédulas: ${usuariosUnicos.length}`, usuariosUnicos);
      }
      
      // Cargar expedientes (incluyendo created_by_user_id)
      // NOTA: No cargar fecha_vencimiento porque no existe en la tabla - se calcula desde fecha_ultima_modificacion
      const { data: exps, error: eErr } = await supabase
        .from("expedientes")
        .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
        .eq("estado", "ABIERTO")
        .order("fecha_ultima_modificacion", { ascending: true });

      if (eErr) {
        // Si la tabla no existe, simplemente no cargar expedientes
        if (!eErr.message?.includes("relation \"expedientes\" does not exist")) {
          setMsg("Error cargando expedientes: " + eErr.message);
        }
        setAllExpedientes([]);
      } else {
        setAllExpedientes((exps ?? []) as Expediente[]);
        console.log(`[Dashboard] Expedientes cargados inicialmente: ${(exps ?? []).length}`, {
          isSuperadmin,
          isAbogado,
          juzgadoFilter: "todos (carga inicial)"
        });
        // Log de juzgados únicos en los expedientes cargados
        const expsTyped = (exps ?? []) as unknown as Expediente[];
        const juzgadosUnicos = [...new Set(expsTyped.map((e) => e.juzgado).filter(Boolean))];
        const usuariosUnicos = [...new Set(expsTyped.map((e) => e.owner_user_id))];
        console.log(`[Dashboard] Juzgados únicos en expedientes: ${juzgadosUnicos.length}`, juzgadosUnicos.slice(0, 10));
        console.log(`[Dashboard] Usuarios únicos en expedientes: ${usuariosUnicos.length}`, usuariosUnicos);
      }
      
      // Cargar favoritos de pjn-scraper (pjn_favoritos)
      // IMPORTANTE: Filtrar favoritos removidos (si existe columna removido o estado)
      console.log(`[Dashboard] Cargando favoritos de pjn-scraper...`);
      
      // Intentar cargar con filtro de removido primero
      let favoritosData: (PjnFavorito & { removido?: boolean; estado?: string })[] | null = null;
      let favoritosErr: { message?: string } | null = null;
      
      const { data: favoritosDataWithStatus, error: favoritosErrWithStatus } = await supabase
        .from("pjn_favoritos")
        .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones, notas, removido, estado, movimientos")
        .order("updated_at", { ascending: false });
      
      // Si falla porque la columna no existe, intentar sin incluirla en el select
      if (favoritosErrWithStatus && (favoritosErrWithStatus.message?.includes("removido") || favoritosErrWithStatus.message?.includes("estado") || favoritosErrWithStatus.message?.includes("notas") || favoritosErrWithStatus.message?.includes("movimientos"))) {
        console.log(`[Dashboard] Columnas removido/estado/notas/movimientos no encontradas, cargando sin ellas...`);
        const { data: favoritosData2, error: favoritosErr2 } = await supabase
          .from("pjn_favoritos")
          .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones")
          .order("updated_at", { ascending: false });
        
        if (favoritosErr2) {
          favoritosErr = favoritosErr2;
        } else {
          // Agregar propiedades removido, estado, notas y movimientos como undefined/null para mantener consistencia
          favoritosData = (favoritosData2 || []).map((f: PjnFavorito) => ({ ...f, removido: undefined, estado: undefined, notas: null, movimientos: null }));
          favoritosErr = null;
        }
      } else {
        favoritosData = favoritosDataWithStatus as (PjnFavorito & { removido?: boolean; estado?: string })[] | null;
        favoritosErr = favoritosErrWithStatus;
      }
      
      // Filtrar favoritos removidos en memoria si las columnas existen
      if (favoritosData && !favoritosErr) {
        favoritosData = favoritosData.filter((f) => {
          // Si tiene columna removido, filtrar los que están removidos
          if (f.removido === true) return false;
          // Si tiene columna estado, filtrar los que están REMOVIDO
          if (f.estado === "REMOVIDO") return false;
          return true;
        });
      }
      
      if (favoritosErr) {
        console.warn(`[Dashboard] ⚠️  Error al cargar pjn_favoritos:`, favoritosErr);
        setPjnFavoritos([]);
      } else {
        setPjnFavoritos((favoritosData ?? []) as PjnFavorito[]);
        const favoritosConMovimientos = (favoritosData ?? []).filter((f: any) => f.movimientos).length;
        console.log(`[Dashboard] ✅ Favoritos de pjn-scraper cargados: ${(favoritosData ?? []).length}`);
        console.log(`[Dashboard] Favoritos con movimientos desde BD: ${favoritosConMovimientos} de ${(favoritosData ?? []).length}`);
      }
      
      // Cargar juzgados asignados a TODOS los usuarios (para asignar favoritos)
      console.log(`[Dashboard] Cargando juzgados asignados a todos los usuarios...`);
      const { data: allJuzgadosData, error: allJuzgadosErr } = await supabase
        .from("user_juzgados")
        .select("user_id, juzgado");
      
      if (allJuzgadosErr) {
        console.warn(`[Dashboard] ⚠️  Error al cargar user_juzgados:`, allJuzgadosErr);
        setUserJuzgadosMap({});
      } else {
        // Crear mapa de user_id -> juzgados[]
        const juzgadosMap: Record<string, string[]> = {};
        (allJuzgadosData ?? []).forEach((uj: UserJuzgados) => {
          if (!juzgadosMap[uj.user_id]) {
            juzgadosMap[uj.user_id] = [];
          }
          juzgadosMap[uj.user_id].push(uj.juzgado);
        });
        setUserJuzgadosMap(juzgadosMap);
        console.log(`[Dashboard] ✅ Juzgados asignados cargados para ${Object.keys(juzgadosMap).length} usuarios`);
      }
      
      setChecking(false);
    })();
  }, []);

  const selectedUserJuzgados = useMemo(() => {
    if (selectedUserId === "all") return userJuzgados;
    return userJuzgadosMap[selectedUserId] ?? [];
  }, [selectedUserId, userJuzgados, userJuzgadosMap]);

  // Cargar perfiles faltantes de usuarios que tienen expedientes/cédulas pero no están en profiles
  useEffect(() => {
    if (Object.keys(profiles).length === 0) return; // Esperar a que se carguen los perfiles iniciales
    
    const userIdsEnDatos = new Set<string>();
    
    // Recolectar todos los owner_user_id de cédulas y expedientes
    allCedulas.forEach(c => {
      if (c.owner_user_id && c.owner_user_id.trim() !== "") {
        userIdsEnDatos.add(c.owner_user_id);
      }
    });
    
    allExpedientes.forEach(e => {
      if (e.owner_user_id && e.owner_user_id.trim() !== "") {
        userIdsEnDatos.add(e.owner_user_id);
      }
    });
    
    // Identificar usuarios que no están en profiles
    const userIdsFaltantes = Array.from(userIdsEnDatos).filter(uid => !profiles[uid]);
    
    if (userIdsFaltantes.length > 0) {
      console.log(`[Dashboard] Cargando ${userIdsFaltantes.length} perfiles faltantes...`);
      
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIdsFaltantes)
        .then(({ data: profsFaltantes, error: err }) => {
          if (!err && profsFaltantes && profsFaltantes.length > 0) {
            const nuevosPerfiles: Record<string, Profile> = { ...profiles };
            (profsFaltantes as Profile[]).forEach((p) => {
              nuevosPerfiles[p.id] = p;
            });
            setProfiles(nuevosPerfiles);
            console.log(`[Dashboard] ✅ ${profsFaltantes.length} perfiles adicionales cargados`);
          }
        });
    }
  }, [allCedulas, allExpedientes, profiles]);

  // Asegurar que si no hay juzgados asignados, el filtro vuelva a "todos"
  useEffect(() => {
    if (juzgadoFilter === "mis_juzgados" && selectedUserJuzgados.length === 0) {
      console.log(`[Dashboard] Usuario no tiene juzgados asignados, cambiando filtro a "todos"`);
      setJuzgadoFilter("todos");
    }
  }, [juzgadoFilter, selectedUserJuzgados.length]);

  // Filtrar cédulas según los filtros seleccionados
  useEffect(() => {
    let filtered = [...allCedulas];
    const initialCount = filtered.length;
    
    console.log(`[Dashboard] Filtrando cédulas - Inicial: ${initialCount}, Filtro juzgados: ${juzgadoFilter}`, {
      allCedulasCount: allCedulas.length,
      juzgadoFilter,
      userJuzgadosCount: userJuzgados.length
    });

    // Filtro por usuario
    if (selectedUserId !== "all") {
      const beforeUserFilter = filtered.length;
      filtered = filtered.filter(c => c.owner_user_id === selectedUserId);
      console.log(`[Dashboard] Filtro por usuario: ${beforeUserFilter} -> ${filtered.length}`);
    }

    // Filtro por juzgados
    if (juzgadoFilter === "mis_juzgados" && selectedUserJuzgados.length > 0) {
      const juzgadosNormalizados = selectedUserJuzgados.map(j => 
        j?.trim().replace(/\s+/g, " ").toUpperCase()
      );
      
      const beforeJuzgadoFilter = filtered.length;
      
      filtered = filtered.filter(c => {
        if (!c.juzgado) return false;
        const juzgadoNormalizado = normalizarJuzgado(c.juzgado);
        
        // Comparación exacta normalizada
        if (juzgadosNormalizados.includes(juzgadoNormalizado)) return true;
        
        // Comparación por número de juzgado (más flexible) - misma lógica que mis-juzgados
        return juzgadosNormalizados.some(jAsignado => {
          const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
          const numJuzgado = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
          if (numAsignado && numJuzgado && numAsignado === numJuzgado) {
            // Verificar que ambos contengan "JUZGADO" y el mismo número
            if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
              return true;
            }
          }
          return false;
        });
      });
      
      console.log(`[Dashboard] Filtro cédulas por juzgados (mis_juzgados): ${beforeJuzgadoFilter} -> ${filtered.length}`, {
        juzgadoFilter,
        userJuzgadosCount: selectedUserJuzgados.length,
        juzgadosNormalizados: juzgadosNormalizados.slice(0, 5) // Solo primeros 5 para no saturar
      });
    } else if (juzgadoFilter === "todos") {
      console.log(`[Dashboard] Filtro juzgados = "todos" - NO aplicando filtro de juzgados. Cédulas: ${filtered.length}`);
    } else if (juzgadoFilter && juzgadoFilter !== "mis_juzgados" && juzgadoFilter !== "todos") {
      // Filtro por juzgado específico
      const beforeJuzgadoFilter = filtered.length;
      const juzgadoFiltroNormalizado = normalizarJuzgado(juzgadoFilter);
      
      filtered = filtered.filter(c => {
        if (!c.juzgado) return false;
        const juzgadoNormalizado = normalizarJuzgado(c.juzgado);
        
        // Comparación exacta normalizada
        if (juzgadoNormalizado === juzgadoFiltroNormalizado) return true;
        
        // Comparación por número de juzgado (más flexible)
        const numFiltro = juzgadoFiltroNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
        const numJuzgado = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
        if (numFiltro && numJuzgado && numFiltro === numJuzgado) {
          if (juzgadoFiltroNormalizado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
            return true;
          }
        }
        
        return false;
      });
      
      console.log(`[Dashboard] Filtro cédulas por juzgado específico: ${beforeJuzgadoFilter} -> ${filtered.length}`, {
        juzgadoFilter,
        juzgadoFiltroNormalizado
      });
    }

    // Filtro por tiempo
    if (timeFilter !== "all") {
      const { start, end } = getDateRange(timeFilter, customStartDate, customEndDate);
      if (start && end) {
        filtered = filtered.filter(c => {
          if (!c.fecha_carga) return false;
          const fechaCarga = new Date(c.fecha_carga);
          return fechaCarga >= new Date(start) && fechaCarga <= new Date(end);
        });
      }
    }

    setCedulas(filtered);
  }, [allCedulas, timeFilter, selectedUserId, juzgadoFilter, selectedUserJuzgados, customStartDate, customEndDate, userJuzgados.length]);

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

  // Obtener todos los juzgados únicos de cédulas, expedientes y favoritos, ordenados ascendente
  // Separar entre asignados y sin asignar
  const juzgadosData = useMemo(() => {
    const juzgadosSet = new Set<string>();
    
    // Agregar juzgados de cédulas
    allCedulas.forEach(c => {
      if (c.juzgado && c.juzgado.trim()) {
        juzgadosSet.add(c.juzgado.trim());
      }
    });
    
    // Agregar juzgados de expedientes
    allExpedientes.forEach(e => {
      if (e.juzgado && e.juzgado.trim()) {
        juzgadosSet.add(e.juzgado.trim());
      }
    });
    
    // Agregar juzgados de favoritos
    pjnFavoritos.forEach(f => {
      if (f.juzgado && f.juzgado.trim()) {
        juzgadosSet.add(f.juzgado.trim());
      }
    });
    
    // Obtener todos los juzgados asignados (de todos los usuarios)
    const juzgadosAsignadosSet = new Set<string>();
    Object.values(userJuzgadosMap).forEach(juzgadosDelUsuario => {
      juzgadosDelUsuario.forEach(j => {
        if (j && j.trim()) {
          juzgadosAsignadosSet.add(j.trim());
        }
      });
    });
    
    // Separar juzgados en asignados y sin asignar
    // Primero, eliminar duplicados por número de juzgado, priorizando el formato "JUZGADO CIVIL [NÚMERO]"
    const juzgadosArray = Array.from(juzgadosSet);
    const juzgadosPorNumero = new Map<string, string>(); // Map: número -> mejor formato
    const juzgadosSinNumero = new Set<string>(); // Juzgados que no tienen número extraíble
    
    juzgadosArray.forEach(juzgado => {
      // Intentar extraer número de cualquier formato
      const numMatch = juzgado.match(/(?:N[°º]?\s*|NRO\.?\s*|NUMERO\s+)?(\d+)/i);
      
      if (numMatch && numMatch[1]) {
        const numero = numMatch[1];
        const formatoPreferido = `JUZGADO CIVIL ${numero}`;
        const juzgadoUpper = juzgado.toUpperCase().trim();
        const esFormatoPreferido = juzgadoUpper === formatoPreferido;
        
        // Si ya existe un juzgado con este número
        if (juzgadosPorNumero.has(numero)) {
          const existente = juzgadosPorNumero.get(numero)!;
          const existenteUpper = existente.toUpperCase().trim();
          const existenteEsPreferido = existenteUpper === formatoPreferido;
          
          // Priorizar el formato "JUZGADO CIVIL [NÚMERO]" sobre otros formatos
          if (esFormatoPreferido && !existenteEsPreferido) {
            juzgadosPorNumero.set(numero, formatoPreferido);
          } else if (!esFormatoPreferido && !existenteEsPreferido) {
            // Si ninguno es el formato preferido, usar el más corto
            if (juzgado.length < existente.length) {
              juzgadosPorNumero.set(numero, juzgado);
            }
          }
          // Si ambos son el formato preferido o el existente ya es preferido, mantener el existente
        } else {
          // Si es el formato preferido, usarlo directamente
          if (esFormatoPreferido) {
            juzgadosPorNumero.set(numero, formatoPreferido);
          } else {
            juzgadosPorNumero.set(numero, juzgado);
          }
        }
      } else {
        // Si no tiene número extraíble, agregarlo directamente (sin duplicados por nombre exacto)
        juzgadosSinNumero.add(juzgado);
      }
    });
    
    // Convertir el Map a array de juzgados únicos y agregar los que no tienen número
    const juzgadosUnicos = [...Array.from(juzgadosPorNumero.values()), ...Array.from(juzgadosSinNumero)];
    
    const asignados: string[] = [];
    const sinAsignar: string[] = [];
    
    juzgadosUnicos.forEach(juzgado => {
      // Normalizar para comparar
      const juzgadoNorm = normalizarJuzgado(juzgado);
      const estaAsignado = Array.from(juzgadosAsignadosSet).some(jAsignado => {
        const jAsignadoNorm = normalizarJuzgado(jAsignado);
        return juzgadosCoinciden(juzgadoNorm, jAsignadoNorm);
      });
      
      if (estaAsignado) {
        asignados.push(juzgado);
      } else {
        sinAsignar.push(juzgado);
      }
    });
    
    // Función de ordenamiento
    const sortJuzgados = (a: string, b: string) => {
      // Normalizar para comparación
      const aNorm = normalizarJuzgado(a);
      const bNorm = normalizarJuzgado(b);
      
      // Extraer números para ordenamiento numérico
      const aNum = parseInt(aNorm.match(/\d+/)?.[0] || "0", 10);
      const bNum = parseInt(bNorm.match(/\d+/)?.[0] || "0", 10);
      
      if (aNum !== bNum) {
        return aNum - bNum;
      }
      
      return aNorm.localeCompare(bNorm, 'es', { numeric: true, sensitivity: 'base' });
    };
    
    // Ordenar ambos grupos
    asignados.sort(sortJuzgados);
    sinAsignar.sort(sortJuzgados);
    
    return {
      todosLosJuzgados: juzgadosUnicos.sort(sortJuzgados),
      juzgadosAsignados: asignados,
      juzgadosSinAsignar: sinAsignar
    };
  }, [allCedulas, allExpedientes, pjnFavoritos, userJuzgadosMap]);
  
  // Valores por defecto para evitar errores durante la carga inicial
  const todosLosJuzgados = juzgadosData?.todosLosJuzgados || [];
  const juzgadosAsignados = juzgadosData?.juzgadosAsignados || [];
  const juzgadosSinAsignar = juzgadosData?.juzgadosSinAsignar || [];

  // Convertir favoritos de pjn-scraper a expedientes (SIN duplicar - solo mostrar favoritos filtrados por juzgado)
  const favoritosComoExpedientes = useMemo(() => {
    // Convertir TODOS los favoritos a expedientes, sin asignar a usuarios específicos
    // El filtrado por juzgado se hará después en el useEffect de filtrado
    let fechasConvertidas = 0;
    let fechasNoConvertidas = 0;
    const fechasEjemplo: string[] = [];
    
    const expedientesFromFavoritos: Expediente[] = pjnFavoritos.map((favorito) => {
      const numeroExpediente = `${favorito.jurisdiccion} ${favorito.numero}/${favorito.anio}`;
      const fechaISO = ddmmaaaaToISO(favorito.fecha_ultima_carga);
      
      if (fechaISO) {
        fechasConvertidas++;
        if (fechasEjemplo.length < 3) {
          fechasEjemplo.push(`${favorito.fecha_ultima_carga} -> ${fechaISO}`);
        }
      } else {
        fechasNoConvertidas++;
        if (fechasNoConvertidas <= 3) {
          console.warn(`[Dashboard] No se pudo convertir fecha de favorito PJN: ${favorito.fecha_ultima_carga} (ID: ${favorito.id})`);
        }
      }
      
      return {
        id: `pjn_${favorito.id}`, // ID único por favorito (sin duplicar por usuario)
        owner_user_id: "", // Los favoritos no tienen owner específico
        caratula: favorito.caratula,
        juzgado: favorito.juzgado,
        numero_expediente: numeroExpediente,
        fecha_ultima_modificacion: fechaISO, // IMPORTANTE: Para expedientes, el semáforo se calcula desde fecha_ultima_modificacion
        estado: "ABIERTO",
        created_by_user_id: null,
        is_pjn_favorito: true,
      };
    });
    
    console.log(`[Dashboard] Favoritos convertidos a expedientes: ${expedientesFromFavoritos.length} (de ${pjnFavoritos.length} favoritos únicos)`, {
      fechasConvertidas,
      fechasNoConvertidas,
      ejemplos: fechasEjemplo
    });
    return expedientesFromFavoritos;
  }, [pjnFavoritos]);

  // Cargar movimientos desde cases cuando el filtro es "prueba_pericia"
  useEffect(() => {
    if (juzgadoFilter === "prueba_pericia" && pjnFavoritos.length > 0) {
      const favoritosSinMovimientos = pjnFavoritos.filter(f => !f.movimientos);
      if (favoritosSinMovimientos.length > 0) {
        console.log(`[Dashboard] Cargando movimientos desde cases para ${favoritosSinMovimientos.length} favoritos...`);
        
        (async () => {
          try {
            const pjnUrl = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_URL;
            const pjnKey = process.env.NEXT_PUBLIC_PJN_SCRAPER_SUPABASE_ANON_KEY;
            
            if (pjnUrl && pjnKey) {
              // Construir los keys de los favoritos sin movimientos
              const keys = favoritosSinMovimientos
                .filter(f => f.jurisdiccion && f.numero && f.anio)
                .map(f => {
                  const numeroNormalizado = String(f.numero).padStart(6, '0');
                  return `${f.jurisdiccion} ${numeroNormalizado}/${f.anio}`;
                });
              
              if (keys.length > 0) {
                // Cargar movimientos desde cases en lotes
                const batchSize = 50;
                const movimientosMap = new Map<string, any>();
                
                for (let i = 0; i < keys.length; i += batchSize) {
                  const batch = keys.slice(i, i + batchSize);
                  const { data: casesData, error: casesErr } = await pjnScraperSupabase
                    .from("cases")
                    .select("key, movimientos")
                    .in("key", batch);
                  
                  if (!casesErr && casesData) {
                    casesData.forEach((c: any) => {
                      if (c.movimientos) {
                        movimientosMap.set(c.key, c.movimientos);
                      }
                    });
                  }
                }
                
                // Actualizar los favoritos con los movimientos (crear nuevo array para que React detecte el cambio)
                if (movimientosMap.size > 0) {
                  setPjnFavoritos(prev => {
                    const actualizados = prev.map(f => {
                      if (!f.movimientos && f.jurisdiccion && f.numero && f.anio) {
                        const numeroNormalizado = String(f.numero).padStart(6, '0');
                        const key = `${f.jurisdiccion} ${numeroNormalizado}/${f.anio}`;
                        
                        if (movimientosMap.has(key)) {
                          return { ...f, movimientos: movimientosMap.get(key) };
                        }
                      }
                      return f;
                    });
                    return actualizados;
                  });
                  
                  console.log(`[Dashboard] ✅ Movimientos cargados desde cases: ${movimientosMap.size} movimientos encontrados`);
                }
              }
            }
          } catch (err: any) {
            console.warn(`[Dashboard] ⚠️  Error al cargar movimientos desde cases:`, err);
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [juzgadoFilter]);

  // Filtrar expedientes según los filtros seleccionados
  useEffect(() => {
    // Combinar expedientes locales con favoritos convertidos
    // IMPORTANTE: Eliminar duplicados por ID antes de filtrar
    const expedientesMap = new Map<string, Expediente>();
    
    // Primero agregar expedientes locales (tienen prioridad)
    allExpedientes.forEach(e => {
      expedientesMap.set(e.id, e);
    });
    
    // Luego agregar favoritos PJN solo si no existen ya (por ID único)
    favoritosComoExpedientes.forEach(e => {
      if (!expedientesMap.has(e.id)) {
        expedientesMap.set(e.id, e);
      }
    });
    
    let filtered: Expediente[] = Array.from(expedientesMap.values());
    const initialCount = filtered.length;
    
    console.log(`[Dashboard] Filtrando expedientes - Inicial: ${initialCount}, Filtro juzgados: ${juzgadoFilter}`, {
      allExpedientesCount: allExpedientes.length,
      juzgadoFilter,
      userJuzgadosCount: userJuzgados.length
    });

    // Filtro por usuario
    if (selectedUserId !== "all") {
      const beforeUserFilter = filtered.length;
      const juzgadosDelUsuario = selectedUserJuzgados.map(j => j?.trim().replace(/\s+/g, " ").toUpperCase());

      // Mantener expedientes locales por owner, y favoritos PJN por juzgado asignado del usuario seleccionado
      // IMPORTANTE: Asignar owner_user_id a favoritos PJN para que aparezcan correctamente en el ranking
      const juzgadosDelUsuarioNormalizados = juzgadosDelUsuario.map(j => normalizarJuzgado(j));
      filtered = filtered.map(e => {
        if (e.is_pjn_favorito) {
          if (!e.juzgado) return null;
          // Usar comparación estricta
          const matchJuzgado = juzgadosDelUsuarioNormalizados.some(jAsignado => {
            return juzgadosCoinciden(e.juzgado || "", jAsignado);
          });
          if (matchJuzgado) {
            // Asignar el owner_user_id del usuario seleccionado para que aparezca en el ranking
            return { ...e, owner_user_id: selectedUserId };
          }
          return null;
        }
        return e.owner_user_id === selectedUserId ? e : null;
      }).filter((e): e is Expediente => e !== null);

      console.log(`[Dashboard] Filtro por usuario (local por owner, PJN por juzgado asignado): ${beforeUserFilter} -> ${filtered.length}`);
    } else {
      // Cuando se selecciona "Todos los usuarios", mostrar TODOS los expedientes:
      // 1. Todos los expedientes locales (ya tienen owner_user_id)
      // 2. Todos los favoritos PJN asignados a usuarios (asignar al primer usuario que coincida)
      // IMPORTANTE: NO filtrar, solo asignar favoritos PJN sin asignar
      filtered = filtered.map(e => {
        // Si es un favorito PJN sin asignar, buscar el primer usuario que tenga este juzgado asignado
        if (e.is_pjn_favorito && (!e.owner_user_id || e.owner_user_id.trim() === "")) {
          if (!e.juzgado) return e; // Mantener sin asignar si no tiene juzgado
          
          // Buscar el primer usuario que tenga este juzgado asignado
          for (const [userId, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
            const juzgadosNormalizados = juzgadosDelUsuario.map(j => normalizarJuzgado(j));
            
            // Usar comparación estricta
            const matchJuzgado = juzgadosNormalizados.some(jAsignado => {
              return juzgadosCoinciden(e.juzgado || "", jAsignado);
            });
            
            if (matchJuzgado) {
              return { ...e, owner_user_id: userId };
            }
          }
          // Si no se encuentra ningún usuario con este juzgado, mantener sin asignar (no se contará en métricas)
          return e;
        }
        // Mantener todos los demás expedientes (locales y favoritos ya asignados)
        return e;
      });
      
      console.log(`[Dashboard] Modo "Todos los usuarios" - Total expedientes: ${filtered.length} (${filtered.filter(e => !e.is_pjn_favorito).length} locales + ${filtered.filter(e => e.is_pjn_favorito && e.owner_user_id && e.owner_user_id.trim() !== "").length} favoritos PJN asignados)`);
    }

    // Filtro por juzgados
    if (juzgadoFilter === "mis_juzgados" && selectedUserJuzgados.length > 0) {
      const juzgadosNormalizados = selectedUserJuzgados.map(j => 
        j?.trim().replace(/\s+/g, " ").toUpperCase()
      );
      
      const beforeJuzgadoFilter = filtered.length;
      
      filtered = filtered.filter(e => {
        if (!e.juzgado) return false;
        return juzgadosNormalizados.some(jAsignado => {
          return juzgadosCoinciden(e.juzgado || "", jAsignado);
        });
      });
      
      console.log(`[Dashboard] Filtro expedientes por juzgados (mis_juzgados): ${beforeJuzgadoFilter} -> ${filtered.length}`, {
        juzgadoFilter,
        userJuzgadosCount: userJuzgados.length,
        juzgadosNormalizados: juzgadosNormalizados.slice(0, 5) // Solo primeros 5 para no saturar
      });
    } else if (juzgadoFilter === "todos") {
      console.log(`[Dashboard] Filtro juzgados = "todos" - NO aplicando filtro de juzgados. Expedientes: ${filtered.length}`);
    } else if (juzgadoFilter === "beneficio") {
      // Filtro por "BENEFICIO DE LITIGAR SIN GASTOS" en la carátula
      // IMPORTANTE: Mostrar TODOS los expedientes con esta frase, sin filtrar por juzgados asignados
      const beforeBeneficioFilter = filtered.length;
      const fraseBeneficio = "BENEFICIO DE LITIGAR SIN GASTOS";
      
      filtered = filtered.filter(e => {
        // Verificar que tenga la frase en la carátula (case insensitive)
        if (!e.caratula) return false;
        const caratulaUpper = e.caratula.toUpperCase();
        return caratulaUpper.includes(fraseBeneficio);
      });
      
      console.log(`[Dashboard] Filtro expedientes por BENEFICIO: ${beforeBeneficioFilter} -> ${filtered.length}`, {
        juzgadoFilter,
        selectedUserJuzgadosCount: selectedUserJuzgados.length
      });
    } else if (juzgadoFilter === "prueba_pericia") {
      // Filtro por Prueba/Pericia en movimientos
      // Solo aplica a favoritos de PJN que tienen movimientos
      const beforePruebaPericiaFilter = filtered.length;
      
      console.log(`[Dashboard] Filtrando por PRUEBA/PERICIA. Total favoritos: ${pjnFavoritos.length}`);
      const favoritosConMovimientos = pjnFavoritos.filter(f => f.movimientos).length;
      console.log(`[Dashboard] Favoritos con movimientos: ${favoritosConMovimientos} de ${pjnFavoritos.length}`);
      
      filtered = filtered.filter(e => {
        // Solo los favoritos de PJN tienen movimientos
        if (!e.is_pjn_favorito) return false;
        
        // Buscar el favorito correspondiente usando el ID (que tiene formato pjn_${favorito.id})
        const favoritoId = e.id.replace(/^pjn_/, '');
        const favorito = pjnFavoritos.find(f => f.id === favoritoId);
        
        if (!favorito || !favorito.movimientos) {
          return false;
        }
        
        const tienePericia = tienePruebaPericia(favorito.movimientos);
        return tienePericia;
      });
      
      console.log(`[Dashboard] Filtro expedientes por PRUEBA/PERICIA: ${beforePruebaPericiaFilter} -> ${filtered.length}`, {
        juzgadoFilter,
        pjnFavoritosCount: pjnFavoritos.length,
        favoritosConMovimientos,
        expedientesFiltrados: filtered.length
      });
    } else if (juzgadoFilter && juzgadoFilter !== "mis_juzgados" && juzgadoFilter !== "todos" && juzgadoFilter !== "beneficio" && juzgadoFilter !== "prueba_pericia") {
      // Filtro por juzgado específico
      const beforeJuzgadoFilter = filtered.length;
      const juzgadoFiltroNormalizado = normalizarJuzgado(juzgadoFilter);
      
      filtered = filtered.filter(e => {
        if (!e.juzgado) return false;
        return juzgadosCoinciden(e.juzgado, juzgadoFilter);
      });
      
      console.log(`[Dashboard] Filtro expedientes por juzgado específico: ${beforeJuzgadoFilter} -> ${filtered.length}`, {
        juzgadoFilter,
        juzgadoFiltroNormalizado
      });
    }

    // Filtro por tiempo
    if (timeFilter !== "all") {
      const { start, end } = getDateRange(timeFilter, customStartDate, customEndDate);
      if (start && end) {
        filtered = filtered.filter(e => {
          if (!e.fecha_ultima_modificacion) return false;
          const fechaMod = new Date(e.fecha_ultima_modificacion);
          return fechaMod >= new Date(start) && fechaMod <= new Date(end);
        });
      }
    }

    setExpedientes(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExpedientes, favoritosComoExpedientes, timeFilter, selectedUserId, juzgadoFilter, selectedUserJuzgados, customStartDate, customEndDate, userJuzgados.length]);

  const ranking = useMemo(() => {
    const perUser: Record<string, { rojos: number; amarillos: number; verdes: number; total: number; maxDias: number }> = {};

    // Contar cédulas (tipo_documento === "CEDULA" o null)
    // IMPORTANTE: Para cédulas, el semáforo se calcula desde fecha_carga
    for (const c of cedulas) {
      // Solo contar cédulas, no oficios (los oficios se cuentan por separado)
      if (c.tipo_documento === "OFICIO") continue;
      
      // Ignorar cédulas sin owner_user_id válido
      if (!c.owner_user_id || c.owner_user_id.trim() === "") continue;
      
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      const uid = c.owner_user_id;

      perUser[uid] ||= { rojos: 0, amarillos: 0, verdes: 0, total: 0, maxDias: -1 };
      perUser[uid].total++;
      perUser[uid].maxDias = Math.max(perUser[uid].maxDias, dias);

      if (s === "ROJO") perUser[uid].rojos++;
      else if (s === "AMARILLO") perUser[uid].amarillos++;
      else perUser[uid].verdes++;
    }

    // Contar oficios (tipo_documento === "OFICIO")
    // IMPORTANTE: Para oficios, el semáforo se calcula desde fecha_carga
    for (const c of cedulas) {
      if (c.tipo_documento !== "OFICIO") continue;
      
      // Ignorar oficios sin owner_user_id válido
      if (!c.owner_user_id || c.owner_user_id.trim() === "") continue;
      
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      const uid = c.owner_user_id;

      perUser[uid] ||= { rojos: 0, amarillos: 0, verdes: 0, total: 0, maxDias: -1 };
      perUser[uid].total++;
      perUser[uid].maxDias = Math.max(perUser[uid].maxDias, dias);

      if (s === "ROJO") perUser[uid].rojos++;
      else if (s === "AMARILLO") perUser[uid].amarillos++;
      else perUser[uid].verdes++;
    }

    // Contar expedientes (ignorar los que no tienen owner_user_id válido)
    // IMPORTANTE: Para expedientes, el semáforo se calcula desde fecha_ultima_modificacion
    for (const e of expedientes) {
      // Ignorar expedientes sin owner_user_id (favoritos PJN sin asignar a usuario)
      if (!e.owner_user_id || e.owner_user_id.trim() === "") continue;
      
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      const uid = e.owner_user_id;

      perUser[uid] ||= { rojos: 0, amarillos: 0, verdes: 0, total: 0, maxDias: -1 };
      perUser[uid].total++;
      perUser[uid].maxDias = Math.max(perUser[uid].maxDias, dias);

      if (s === "ROJO") perUser[uid].rojos++;
      else if (s === "AMARILLO") perUser[uid].amarillos++;
      else perUser[uid].verdes++;
    }

    return Object.entries(perUser).map(([uid, v]) => {
      const profile = profiles[uid];
      let name = displayName(profile);
      
      // Si no hay perfil pero tenemos el uid, intentar obtener el email del usuario desde auth.users
      // Por ahora, si no hay perfil, usar el uid como fallback
      if (!profile && uid && uid.trim() !== "") {
        // Buscar en los perfiles cargados si hay alguno con ese id (por si acaso)
        const foundProfile = Object.values(profiles).find(p => p.id === uid);
        if (foundProfile) {
          name = displayName(foundProfile);
        } else {
          // Si realmente no hay perfil, usar el uid truncado como identificador temporal
          name = `Usuario ${uid.substring(0, 8)}...`;
        }
      }
      
      return {
        uid,
        ...v,
        name,
      };
    }).sort((a, b) =>
      (b.rojos - a.rojos) ||
      (b.amarillos - a.amarillos) ||
      (b.maxDias - a.maxDias)
    );
  }, [cedulas, expedientes, profiles]);

  const rankingExpedientes = useMemo(() => {
    const perUser: Record<string, { rojos: number; amarillos: number; verdes: number; total: number; maxDias: number }> = {};

    // IMPORTANTE: Usar el array filtrado (expedientes) para que el ranking refleje los filtros aplicados
    // Esto asegura que cuando se filtra por juzgado, el ranking solo muestre los expedientes filtrados
    
    // IMPORTANTE: Para expedientes, el semáforo se calcula desde fecha_ultima_modificacion
    for (const e of expedientes) {
      // Ignorar expedientes sin owner_user_id válido
      if (!e.owner_user_id || e.owner_user_id.trim() === "") continue;
      
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      const uid = e.owner_user_id;

      perUser[uid] ||= { rojos: 0, amarillos: 0, verdes: 0, total: 0, maxDias: -1 };
      perUser[uid].total++;
      perUser[uid].maxDias = Math.max(perUser[uid].maxDias, dias);

      if (s === "ROJO") perUser[uid].rojos++;
      else if (s === "AMARILLO") perUser[uid].amarillos++;
      else perUser[uid].verdes++;
    }

    return Object.entries(perUser).map(([uid, v]) => ({
      uid,
      ...v,
      name: displayName(profiles[uid]),
    })).sort((a, b) =>
      (b.rojos - a.rojos) ||
      (b.amarillos - a.amarillos) ||
      (b.maxDias - a.maxDias)
    );
  }, [expedientes, profiles]);

  const metrics = useMemo(() => {
    const cedulasFiltered = cedulas.filter(c => !c.tipo_documento || c.tipo_documento === "CEDULA");
    const oficiosFiltered = cedulas.filter(c => c.tipo_documento === "OFICIO");
    
    const totalAbiertas = cedulas.length;
    const totalCedulas = cedulasFiltered.length;
    const totalOficios = oficiosFiltered.length;
    
    // Calcular expedientesParaContar primero (misma lógica que más abajo)
    let expedientesParaContar: Expediente[];
    
    if (juzgadoFilter === "todos") {
      // Cuando es "todos", contar desde los datos originales sin filtrar por juzgado
      // Combinar expedientes locales y favoritos PJN únicos
      const expedientesMap = new Map<string, Expediente>();
      
      // Agregar todos los expedientes locales
      allExpedientes.forEach(e => {
        if (e.owner_user_id && e.owner_user_id.trim() !== "") {
          expedientesMap.set(e.id, e);
        }
      });
      
      // Agregar favoritos PJN únicos (solo si tienen juzgado asignado a algún usuario)
      favoritosComoExpedientes.forEach(e => {
        if (!expedientesMap.has(e.id)) {
          if (e.juzgado) {
            let tieneUsuarioAsignado = false;
            for (const [, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
              const juzgadosNormalizados = juzgadosDelUsuario.map(j => normalizarJuzgado(j));
              const matchJuzgado = juzgadosNormalizados.some(jAsignado => {
                return juzgadosCoinciden(e.juzgado || "", jAsignado);
              });
              if (matchJuzgado) {
                tieneUsuarioAsignado = true;
                break;
              }
            }
            if (tieneUsuarioAsignado) {
              // Asignar al primer usuario que coincida para contar en métricas
              for (const [userId, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
                const juzgadosNormalizados = juzgadosDelUsuario.map(j => normalizarJuzgado(j));
                const matchJuzgado = juzgadosNormalizados.some(jAsignado => {
                  return juzgadosCoinciden(e.juzgado || "", jAsignado);
                });
                if (matchJuzgado) {
                  expedientesMap.set(e.id, { ...e, owner_user_id: userId });
                  break;
                }
              }
            }
          }
        }
      });
      
      expedientesParaContar = Array.from(expedientesMap.values());
      
      // Si hay filtro de usuario, filtrar por usuario
      if (selectedUserId !== "all") {
        expedientesParaContar = expedientesParaContar.filter(e => {
          // Para favoritos PJN, verificar si el usuario seleccionado tiene el juzgado asignado
          if (e.is_pjn_favorito) {
            if (!e.juzgado) return false;
            const juzgadosDelUsuario = selectedUserJuzgados.map(j => normalizarJuzgado(j));
            return juzgadosDelUsuario.some(jAsignado => {
              return juzgadosCoinciden(e.juzgado || "", jAsignado);
            });
          }
          // Para expedientes locales, verificar por owner
          return e.owner_user_id === selectedUserId;
        });
      }
    } else {
      // Cuando hay filtro de juzgado específico, usar el array filtrado
      expedientesParaContar = expedientes.filter(e => {
        return e.owner_user_id && e.owner_user_id.trim() !== "";
      });
    }
    
    // Calcular métricas generales del semáforo contando TODOS los documentos (cédulas + oficios + expedientes)
    // Esto asegura que se cuenten todos los expedientes, no solo los filtrados
    let totalRojas = 0;
    let totalAmarillas = 0;
    let totalVerdes = 0;
    
    // Contar cédulas (semáforo desde fecha_carga)
    for (const c of cedulasFiltered) {
      if (!c.owner_user_id || c.owner_user_id.trim() === "") continue;
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      if (s === "ROJO") totalRojas++;
      else if (s === "AMARILLO") totalAmarillas++;
      else totalVerdes++;
    }
    
    // Contar oficios (semáforo desde fecha_carga)
    for (const c of oficiosFiltered) {
      if (!c.owner_user_id || c.owner_user_id.trim() === "") continue;
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      if (s === "ROJO") totalRojas++;
      else if (s === "AMARILLO") totalAmarillas++;
      else totalVerdes++;
    }
    
    // Contar expedientes (usando expedientesParaContar que incluye todos cuando juzgadoFilter === "todos")
    // IMPORTANTE: Para expedientes, el semáforo se calcula desde fecha_ultima_modificacion
    let expedientesSinFecha = 0;
    let expedientesConFecha = 0;
    for (const e of expedientesParaContar) {
      if (!e.owner_user_id || e.owner_user_id.trim() === "") continue;
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      if (!fechaBase) {
        expedientesSinFecha++;
        continue; // Si no hay fecha, no se puede calcular el semáforo
      }
      expedientesConFecha++;
      const dias = daysSince(fechaBase);
      const s = semaforoPorAntiguedad(dias);
      if (s === "ROJO") totalRojas++;
      else if (s === "AMARILLO") totalAmarillas++;
      else totalVerdes++;
    }
    
    if (expedientesSinFecha > 0) {
      console.warn(`[Dashboard Metrics] ${expedientesSinFecha} expedientes sin fecha_ultima_modificacion (no se pueden calcular en semáforo)`);
    }
    
    console.log(`[Dashboard Metrics] Expedientes contados en semáforo:`, {
      total: expedientesParaContar.length,
      conFecha: expedientesConFecha,
      sinFecha: expedientesSinFecha,
      rojos: totalRojas,
      amarillos: totalAmarillas,
      verdes: totalVerdes
    });
    
    // Calcular métricas por tipo de documento
    // IMPORTANTE: Cédulas y oficios usan fecha_carga para el semáforo
    const cedulasRojas = cedulasFiltered.filter(c => {
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const cedulasAmarillas = cedulasFiltered.filter(c => {
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const cedulasVerdes = cedulasFiltered.filter(c => {
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "VERDE";
    }).length;
    
    const oficiosRojos = oficiosFiltered.filter(c => {
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const oficiosAmarillos = oficiosFiltered.filter(c => {
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const oficiosVerdes = oficiosFiltered.filter(c => {
      const fechaBase = getFechaBaseParaSemaforo(c.fecha_carga, null, false);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "VERDE";
    }).length;
    
    const totalUsuarios = ranking.length;
    const promedioPorUsuario = totalUsuarios > 0 ? (totalAbiertas / totalUsuarios).toFixed(1) : "0";
    
    const pctRojas = totalAbiertas > 0 ? ((totalRojas / totalAbiertas) * 100).toFixed(1) : "0";
    const pctAmarillas = totalAbiertas > 0 ? ((totalAmarillas / totalAbiertas) * 100).toFixed(1) : "0";
    const pctVerdes = totalAbiertas > 0 ? ((totalVerdes / totalAbiertas) * 100).toFixed(1) : "0";
    
    const pctCedulasRojas = totalCedulas > 0 ? ((cedulasRojas / totalCedulas) * 100).toFixed(1) : "0";
    const pctCedulasAmarillas = totalCedulas > 0 ? ((cedulasAmarillas / totalCedulas) * 100).toFixed(1) : "0";
    const pctCedulasVerdes = totalCedulas > 0 ? ((cedulasVerdes / totalCedulas) * 100).toFixed(1) : "0";
    
    const pctOficiosRojos = totalOficios > 0 ? ((oficiosRojos / totalOficios) * 100).toFixed(1) : "0";
    const pctOficiosAmarillos = totalOficios > 0 ? ((oficiosAmarillos / totalOficios) * 100).toFixed(1) : "0";
    const pctOficiosVerdes = totalOficios > 0 ? ((oficiosVerdes / totalOficios) * 100).toFixed(1) : "0";
    
    const maxDias = ranking.length > 0 ? Math.max(...ranking.map(r => r.maxDias)) : 0;
    
    // Métricas de expedientes
    // NOTA: expedientesParaContar ya fue calculado arriba para las métricas generales del semáforo
    
    // Debug log
    console.log(`[Dashboard Metrics] Expedientes para contar: ${expedientesParaContar.length}`, {
      juzgadoFilter,
      selectedUserId,
      totalExpedientes: expedientes.length,
      expedientesConOwner: expedientesParaContar.length,
      usandoTodos: juzgadoFilter === "todos"
    });
    
    // Debug: Contar expedientes por estado del semáforo
    const expedientesRojosDebug = expedientesParaContar.filter(e => {
      if (!e.owner_user_id || e.owner_user_id.trim() === "") return false;
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const expedientesAmarillosDebug = expedientesParaContar.filter(e => {
      if (!e.owner_user_id || e.owner_user_id.trim() === "") return false;
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const expedientesVerdesDebug = expedientesParaContar.filter(e => {
      if (!e.owner_user_id || e.owner_user_id.trim() === "") return false;
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "VERDE";
    }).length;
    
    console.log(`[Dashboard Metrics] Expedientes por semáforo:`, {
      rojos: expedientesRojosDebug,
      amarillos: expedientesAmarillosDebug,
      verdes: expedientesVerdesDebug,
      total: expedientesParaContar.length
    });
    
    const totalExpedientes = expedientesParaContar.length;
    // IMPORTANTE: Expedientes usan fecha_ultima_modificacion para el semáforo
    const expedientesRojos = expedientesParaContar.filter(e => {
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const expedientesAmarillos = expedientesParaContar.filter(e => {
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const expedientesVerdes = expedientesParaContar.filter(e => {
      const fechaBase = getFechaBaseParaSemaforo(null, e.fecha_ultima_modificacion, true);
      const dias = daysSince(fechaBase);
      return semaforoPorAntiguedad(dias) === "VERDE";
    }).length;
    
    const pctExpedientesRojos = totalExpedientes > 0 ? ((expedientesRojos / totalExpedientes) * 100).toFixed(1) : "0";
    const pctExpedientesAmarillos = totalExpedientes > 0 ? ((expedientesAmarillos / totalExpedientes) * 100).toFixed(1) : "0";
    const pctExpedientesVerdes = totalExpedientes > 0 ? ((expedientesVerdes / totalExpedientes) * 100).toFixed(1) : "0";
    
    const maxDiasExpedientes = rankingExpedientes.length > 0 ? Math.max(...rankingExpedientes.map(r => r.maxDias)) : 0;
    
    return {
      totalAbiertas,
      totalCedulas,
      totalOficios,
      totalExpedientes,
      totalRojas,
      totalAmarillas,
      totalVerdes,
      cedulasRojas,
      cedulasAmarillas,
      cedulasVerdes,
      oficiosRojos,
      oficiosAmarillos,
      oficiosVerdes,
      expedientesRojos,
      expedientesAmarillos,
      expedientesVerdes,
      totalUsuarios,
      promedioPorUsuario,
      pctRojas,
      pctAmarillas,
      pctVerdes,
      pctCedulasRojas,
      pctCedulasAmarillas,
      pctCedulasVerdes,
      pctOficiosRojos,
      pctOficiosAmarillos,
      pctOficiosVerdes,
      pctExpedientesRojos,
      pctExpedientesAmarillos,
      pctExpedientesVerdes,
      maxDias,
      maxDiasExpedientes,
    };
  }, [cedulas, expedientes, ranking, rankingExpedientes, selectedUserId, juzgadoFilter, selectedUserJuzgados, allExpedientes, favoritosComoExpedientes, userJuzgadosMap]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function imprimirDashboard() {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let yPos = margin;

    // Colores (RGB como números individuales para jsPDF)
    const colorPrimaryR = 0, colorPrimaryG = 82, colorPrimaryB = 156;
    const colorRedR = 225, colorRedG = 57, colorRedB = 64;
    const colorYellowR = 255, colorYellowG = 200, colorYellowB = 60;
    const colorGreenR = 0, colorGreenG = 169, colorGreenB = 82;
    const colorGrayR = 100, colorGrayG = 100, colorGrayB = 100;

    // Función helper para agregar nueva página si es necesario
    const checkNewPage = (requiredSpace: number) => {
      if (yPos + requiredSpace > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
        return true;
      }
      return false;
    };

    // Título principal
    doc.setFontSize(20);
    doc.setTextColor(colorPrimaryR, colorPrimaryG, colorPrimaryB);
    doc.setFont("helvetica", "bold");
    doc.text("Dashboard - Reporte de Gestión", pageWidth / 2, yPos, { align: "center" });
    yPos += 10;

    // Fecha de generación
    const fecha = new Date().toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    doc.setFontSize(10);
    doc.setTextColor(colorGrayR, colorGrayG, colorGrayB);
    doc.setFont("helvetica", "normal");
    doc.text(`Generado el: ${fecha}`, pageWidth / 2, yPos, { align: "center" });
    yPos += 15;

    // Tabla de Rendimiento por Usuario (mover aquí, justo después de la fecha)
    doc.setFontSize(14);
    doc.setTextColor(colorPrimaryR, colorPrimaryG, colorPrimaryB);
    doc.setFont("helvetica", "bold");
    doc.text("Rendimiento por Usuario", margin, yPos);
    yPos += 10;

    // Encabezados de tabla
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(colorPrimaryR, colorPrimaryG, colorPrimaryB);
    doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 8, "F");
    
    // Calcular posiciones de columnas para que no se pisen
    // Distribuir el ancho disponible (180mm) entre las columnas con más padding
    // Cada columna numérica tiene un ancho de ~20mm con padding entre ellas
    const colUsuario = margin + 2;           // Usuario: ~50mm de ancho
    const colRojo = margin + 55;             // ROJO: centro en 55mm, ancho ~20mm
    const colAmarillo = margin + 78;          // AMARILLO: centro en 78mm, ancho ~20mm
    const colVerde = margin + 101;           // VERDE: centro en 101mm, ancho ~20mm
    const colTotal = margin + 124;           // TOTAL: centro en 124mm, ancho ~20mm
    const colAntigua = margin + 147;         // MÁS ANTIGUA: centro en 147mm, ancho ~20mm
    
    doc.setFont("helvetica", "bold");
    doc.text("Usuario", colUsuario, yPos);
    doc.text("ROJO", colRojo, yPos, { align: "center" });
    doc.text("AMARILLO", colAmarillo, yPos, { align: "center" });
    doc.text("VERDE", colVerde, yPos, { align: "center" });
    doc.text("TOTAL", colTotal, yPos, { align: "center" });
    doc.text("MÁS ANTIGUA", colAntigua, yPos, { align: "center" });
    yPos += 10;

    // Filas de datos
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    
    ranking.forEach((r, idx) => {
      checkNewPage(8);
      
      // Alternar color de fondo
      if (idx % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 6, "F");
      }
      
      // Resaltar si es crítico
      if (r.rojos > 0 || r.maxDias >= UMBRAL_ROJO) {
        doc.setFillColor(255, 240, 240);
        doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 6, "F");
      }

      doc.setTextColor(0, 0, 0);
      doc.text(r.name.length > 30 ? r.name.substring(0, 27) + "..." : r.name, colUsuario, yPos);
      
      doc.setTextColor(colorRedR, colorRedG, colorRedB);
      doc.text(r.rojos.toString(), colRojo, yPos, { align: "center" });
      
      doc.setTextColor(colorYellowR, colorYellowG, colorYellowB);
      doc.text(r.amarillos.toString(), colAmarillo, yPos, { align: "center" });
      
      doc.setTextColor(colorGreenR, colorGreenG, colorGreenB);
      doc.text(r.verdes.toString(), colVerde, yPos, { align: "center" });
      
      doc.setTextColor(0, 0, 0);
      doc.text(r.total.toString(), colTotal, yPos, { align: "center" });
      doc.text(r.maxDias >= 0 ? r.maxDias.toString() : "-", colAntigua, yPos, { align: "center" });
      
      yPos += 6;
    });

    yPos += 15;
    checkNewPage(50);

    // Sección: Métricas Generales
    doc.setFontSize(14);
    doc.setTextColor(colorPrimaryR, colorPrimaryG, colorPrimaryB);
    doc.setFont("helvetica", "bold");
    doc.text("Métricas Generales", margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    
    // Totales
    doc.setFont("helvetica", "bold");
    doc.text("Totales:", margin, yPos);
    yPos += 6;
    doc.setFont("helvetica", "normal");
    doc.text(`  • Total Documentos Abiertos: ${metrics.totalAbiertas}`, margin + 5, yPos);
    yPos += 5;
    doc.text(`  • Total Cédulas: ${metrics.totalCedulas}`, margin + 5, yPos);
    yPos += 5;
    doc.text(`  • Total Oficios: ${metrics.totalOficios}`, margin + 5, yPos);
    yPos += 5;
    doc.text(`  • Total Expedientes: ${metrics.totalExpedientes}`, margin + 5, yPos);
    yPos += 5;
    doc.text(`  • Total Usuarios: ${metrics.totalUsuarios}`, margin + 5, yPos);
    yPos += 5;
    doc.text(`  • Promedio por Usuario: ${metrics.promedioPorUsuario} documentos`, margin + 5, yPos);
    yPos += 10;

    checkNewPage(30);

    // Estados por Semáforo
    doc.setFont("helvetica", "bold");
    doc.text("Estados por Semáforo:", margin, yPos);
    yPos += 6;
    doc.setFont("helvetica", "normal");
    
    doc.setTextColor(colorRedR, colorRedG, colorRedB);
    doc.text(`  • Estado Crítico (Rojo): ${metrics.totalRojas} (${metrics.pctRojas}%)`, margin + 5, yPos);
    yPos += 5;
    
    doc.setTextColor(colorYellowR, colorYellowG, colorYellowB);
    doc.text(`  • Estado Advertencia (Amarillo): ${metrics.totalAmarillas} (${metrics.pctAmarillas}%)`, margin + 5, yPos);
    yPos += 5;
    
    doc.setTextColor(colorGreenR, colorGreenG, colorGreenB);
    doc.text(`  • Estado Normal (Verde): ${metrics.totalVerdes} (${metrics.pctVerdes}%)`, margin + 5, yPos);
    yPos += 10;

    checkNewPage(40);

    // Desglose por Tipo
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("Desglose por Tipo de Documento:", margin, yPos);
    yPos += 6;
    doc.setFont("helvetica", "normal");
    
    doc.text("Cédulas:", margin + 5, yPos);
    yPos += 5;
    doc.setTextColor(colorRedR, colorRedG, colorRedB);
    doc.text(`  - Rojas: ${metrics.cedulasRojas} (${metrics.pctCedulasRojas}%)`, margin + 10, yPos);
    yPos += 5;
    doc.setTextColor(colorYellowR, colorYellowG, colorYellowB);
    doc.text(`  - Amarillas: ${metrics.cedulasAmarillas} (${metrics.pctCedulasAmarillas}%)`, margin + 10, yPos);
    yPos += 5;
    doc.setTextColor(colorGreenR, colorGreenG, colorGreenB);
    doc.text(`  - Verdes: ${metrics.cedulasVerdes} (${metrics.pctCedulasVerdes}%)`, margin + 10, yPos);
    yPos += 8;

    doc.setTextColor(0, 0, 0);
    doc.text("Oficios:", margin + 5, yPos);
    yPos += 5;
    doc.setTextColor(colorRedR, colorRedG, colorRedB);
    doc.text(`  - Rojos: ${metrics.oficiosRojos} (${metrics.pctOficiosRojos}%)`, margin + 10, yPos);
    yPos += 5;
    doc.setTextColor(colorYellowR, colorYellowG, colorYellowB);
    doc.text(`  - Amarillos: ${metrics.oficiosAmarillos} (${metrics.pctOficiosAmarillos}%)`, margin + 10, yPos);
    yPos += 5;
    doc.setTextColor(colorGreenR, colorGreenG, colorGreenB);
    doc.text(`  - Verdes: ${metrics.oficiosVerdes} (${metrics.pctOficiosVerdes}%)`, margin + 10, yPos);
    yPos += 8;

    doc.setTextColor(0, 0, 0);
    doc.text("Expedientes:", margin + 5, yPos);
    yPos += 5;
    doc.setTextColor(colorRedR, colorRedG, colorRedB);
    doc.text(`  - Rojos: ${metrics.expedientesRojos} (${metrics.pctExpedientesRojos}%)`, margin + 10, yPos);
    yPos += 5;
    doc.setTextColor(colorYellowR, colorYellowG, colorYellowB);
    doc.text(`  - Amarillos: ${metrics.expedientesAmarillos} (${metrics.pctExpedientesAmarillos}%)`, margin + 10, yPos);
    yPos += 5;
    doc.setTextColor(colorGreenR, colorGreenG, colorGreenB);
    doc.text(`  - Verdes: ${metrics.expedientesVerdes} (${metrics.pctExpedientesVerdes}%)`, margin + 10, yPos);
    yPos += 15;

    // Pie de página
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(colorGrayR, colorGrayG, colorGrayB);
      doc.text(
        `Página ${i} de ${totalPages}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );
    }

    // Descargar PDF
    const fileName = `dashboard-reporte-${new Date().toISOString().split("T")[0]}.pdf`;
    doc.save(fileName);
  }

  if (checking) {
    return (
      <div style={{ 
        minHeight: "100vh", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center" 
      }}>
        <div style={{ color: "rgba(234,243,255,.72)", fontSize: 16 }}>Cargando dashboard…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
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
            <div style={{
              width: 20,
              height: 2,
              background: "var(--text)",
              borderRadius: 1,
              transition: "all 0.3s ease"
            }} />
            <div style={{
              width: 20,
              height: 2,
              background: "var(--text)",
              borderRadius: 1,
              transition: "all 0.3s ease"
            }} />
            <div style={{
              width: 20,
              height: 2,
              background: "var(--text)",
              borderRadius: 1,
              transition: "all 0.3s ease"
            }} />
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
              {roleFlags.isAbogado && (
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
                  📅 Turnos Pericias
                </Link>
              )}
            </div>
          )}

          <div>
            <h1 style={{ 
              margin: 0, 
              fontSize: 22, 
              fontWeight: 700, 
              color: "var(--text)",
              letterSpacing: "0.2px"
            }}>
              Dashboard SuperAdmin
            </h1>
            <p style={{ 
              margin: "4px 0 0 0", 
              fontSize: 13, 
              color: "rgba(234,243,255,.65)",
              fontWeight: 400
            }}>
              Visión general de rendimiento
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* Nombre del usuario */}
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
                whiteSpace: "nowrap"
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
          <button
            onClick={imprimirDashboard}
            style={{
              padding: "10px 16px",
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.16)",
              borderRadius: 10,
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,.12)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,.22)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,.16)";
            }}
          >
            🖨️ Imprimir
          </button>
          <button 
            onClick={logout}
            style={{
              padding: "10px 16px",
              background: "rgba(225,57,64,.15)",
              border: "1px solid rgba(225,57,64,.35)",
              borderRadius: 10,
              color: "#ffcccc",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(225,57,64,.22)";
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

      <main style={{ 
        flex: 1, 
        padding: "32px 24px",
        maxWidth: "1400px",
        width: "100%",
        margin: "0 auto"
      }}>
        {msg && (
          <div style={{
            marginBottom: 24,
            padding: "12px 16px",
            background: "rgba(225,57,64,.15)",
            border: "1px solid rgba(225,57,64,.35)",
            borderRadius: 12,
            color: "#ffcccc",
            fontSize: 14
          }}>
            {msg}
          </div>
        )}

        {/* Filtros */}
        <section style={{ 
          marginBottom: 32,
          padding: "20px",
          background: "#ffffff",
          border: "1px solid rgba(0,0,0,.12)",
          borderRadius: 16,
          boxShadow: "0 4px 12px rgba(0,0,0,.08)"
        }}>
          <h3 style={{ 
            margin: "0 0 16px 0", 
            fontSize: 16, 
            fontWeight: 600, 
            color: "#1a1a1a",
            letterSpacing: "0.3px"
          }}>
            Filtros
          </h3>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: 16
          }}>
            {/* Filtro por Usuario */}
            <div>
              <label style={{
                display: "block",
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 500,
                color: "#1a1a1a"
              }}>
                Usuario
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={roleFlags.isAbogado && !roleFlags.isSuperadmin}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#ffffff",
                  border: "1px solid rgba(0,0,0,.15)",
                  borderRadius: 8,
                  color: "#1a1a1a",
                  fontSize: 14,
                  cursor: roleFlags.isAbogado && !roleFlags.isSuperadmin ? "not-allowed" : "pointer",
                  outline: "none",
                  transition: "all 0.2s ease"
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,82,156,.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,82,156,.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,0,0,.15)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {roleFlags.isAbogado && !roleFlags.isSuperadmin ? (
                  <option value={currentUserId}>{displayName(profiles[currentUserId])}</option>
                ) : (
                  <>
                    <option value="all">Todos los usuarios</option>
                    {Object.entries(profiles).map(([uid, profile]) => (
                      <option key={uid} value={uid}>
                        {displayName(profile)}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            {/* Filtro por Juzgados */}
            <div>
              <label style={{
                display: "block",
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 500,
                color: "#1a1a1a"
              }}>
                Juzgados
              </label>
              <select
                value={juzgadoFilter}
                onChange={(e) => {
                  const newFilter = e.target.value;
                  setJuzgadoFilter(newFilter);
                  console.log(`[Dashboard] Filtro de juzgados cambiado a: ${newFilter}`, {
                    userJuzgadosCount: userJuzgados.length,
                    userJuzgados: userJuzgados,
                    todosLosJuzgadosCount: todosLosJuzgados.length,
                    asignadosCount: juzgadosAsignados.length,
                    sinAsignarCount: juzgadosSinAsignar.length
                  });
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#ffffff",
                  border: "1px solid rgba(0,0,0,.15)",
                  borderRadius: 8,
                  color: "#1a1a1a",
                  fontSize: 14,
                  cursor: "pointer",
                  outline: "none",
                  transition: "all 0.2s ease"
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,82,156,.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,82,156,.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,0,0,.15)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <option value="todos">Todos los Juzgados</option>
                <option value="mis_juzgados" disabled={selectedUserJuzgados.length === 0}>
                  Mis Juzgados {selectedUserJuzgados.length === 0 ? "(sin asignar)" : `(${selectedUserJuzgados.length})`}
                </option>
                <option value="beneficio">Beneficio</option>
                <option value="prueba_pericia">Prueba/Pericia</option>
                {juzgadosAsignados.length > 0 && (
                  <optgroup label="Juzgados individuales">
                    {juzgadosAsignados.map((juzgado) => (
                      <option key={juzgado} value={juzgado}>
                        {juzgado}
                      </option>
                    ))}
                  </optgroup>
                )}
                {juzgadosSinAsignar.length > 0 && (
                  <optgroup label="Juzgados Sin Asignar">
                    {juzgadosSinAsignar.map((juzgado) => (
                      <option key={juzgado} value={juzgado}>
                        {juzgado}
                      </option>
                    ))}
                  </optgroup>
                )}
                {juzgadosSinAsignar.length > 0 && (
                  <optgroup label="Juzgados Sin Asignar">
                    {juzgadosSinAsignar.map((juzgado) => (
                      <option key={juzgado} value={juzgado}>
                        {juzgado}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Filtro por Tiempo */}
            <div>
              <label style={{
                display: "block",
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 500,
                color: "#1a1a1a"
              }}>
                Período de tiempo
              </label>
              <select
                value={timeFilter}
                onChange={(e) => {
                  setTimeFilter(e.target.value as TimeFilter);
                  if (e.target.value !== "custom") {
                    setCustomStartDate("");
                    setCustomEndDate("");
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#ffffff",
                  border: "1px solid rgba(0,0,0,.15)",
                  borderRadius: 8,
                  color: "#1a1a1a",
                  fontSize: 14,
                  cursor: "pointer",
                  outline: "none",
                  transition: "all 0.2s ease"
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,82,156,.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,82,156,.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,0,0,.15)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <option value="all">Todos</option>
                <option value="week">Última semana</option>
                <option value="month">Último mes</option>
                <option value="custom">Rango personalizado</option>
              </select>
            </div>

            {/* Fechas personalizadas */}
            {timeFilter === "custom" && (
              <>
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#1a1a1a"
                  }}>
                    Fecha inicio
                  </label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: "#ffffff",
                      border: "1px solid rgba(0,0,0,.15)",
                      borderRadius: 8,
                      color: "#1a1a1a",
                      fontSize: 14,
                      outline: "none",
                      transition: "all 0.2s ease"
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "rgba(0,82,156,.5)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,82,156,.1)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "rgba(0,0,0,.15)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                </div>
                <div>
                  <label style={{
                    display: "block",
                    marginBottom: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#1a1a1a"
                  }}>
                    Fecha fin
                  </label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: "#ffffff",
                      border: "1px solid rgba(0,0,0,.15)",
                      borderRadius: 8,
                      color: "#1a1a1a",
                      fontSize: 14,
                      outline: "none",
                      transition: "all 0.2s ease"
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "rgba(0,82,156,.5)";
                      e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,82,156,.1)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "rgba(0,0,0,.15)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Métricas Generales */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ 
            margin: "0 0 20px 0", 
            fontSize: 18, 
            fontWeight: 600, 
            color: "var(--text)",
            letterSpacing: "0.3px"
          }}>
            Métricas Generales
          </h2>
          
          {/* Fila 1: Totales */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
            marginBottom: 20
          }}>
            <KPICard
              title="Total Documentos Abiertos"
              value={metrics.totalAbiertas}
              color="blue"
              trend={metrics.totalAbiertas > 0 ? "up" : undefined}
            />
            <KPICard
              title="Total Cédulas"
              value={metrics.totalCedulas}
              color="blue"
            />
            <KPICard
              title="Total Oficios"
              value={metrics.totalOficios}
              color="blue"
            />
          </div>
          
          {/* Fila 2: Continuación de Totales + Expedientes y Usuarios */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
            marginBottom: 20
          }}>
            <KPICard
              title="Total Expedientes"
              value={metrics.totalExpedientes}
              color="blue"
            />
            <KPICard
              title="Total de Usuarios"
              value={metrics.totalUsuarios}
              color="blue"
            />
            <KPICard
              title="Promedio por Usuario"
              value={metrics.promedioPorUsuario}
              subValue="documentos"
              color="orange"
            />
          </div>
          
          {/* Fila 3: Estados Generales (Rojo, Amarillo, Verde) */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
            marginBottom: 20
          }}>
            <KPICard
              title="Estado Crítico (Rojo)"
              value={metrics.totalRojas}
              subValue={`${metrics.pctRojas}%`}
              color="red"
              trend={metrics.totalRojas > 0 ? "up" : undefined}
              change={`${metrics.pctRojas}%`}
              changePositive={false}
            />
            <KPICard
              title="Estado Advertencia (Amarillo)"
              value={metrics.totalAmarillas}
              subValue={`${metrics.pctAmarillas}%`}
              color="yellow"
              trend={metrics.totalAmarillas > 0 ? "up" : undefined}
              change={`${metrics.pctAmarillas}%`}
              changePositive={metrics.totalAmarillas === 0}
            />
            <KPICard
              title="Estado Normal (Verde)"
              value={metrics.totalVerdes}
              subValue={`${metrics.pctVerdes}%`}
              color="green"
              trend="up"
              change={`${metrics.pctVerdes}%`}
              changePositive={true}
            />
          </div>
          
          {/* Fila 4: Estadísticas adicionales */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20
          }}>
            <KPICard
              title="Máxima Antigüedad"
              value={metrics.maxDias}
              subValue="días"
              color={metrics.maxDias >= UMBRAL_ROJO ? "red" : metrics.maxDias >= UMBRAL_AMARILLO ? "yellow" : "green"}
              trend={metrics.maxDias >= UMBRAL_AMARILLO ? "down" : undefined}
            />
            <KPICard
              title="Umbral Crítico"
              value={UMBRAL_ROJO}
              subValue="días"
              color="red"
            />
            {/* Espacio vacío para mantener 3 columnas */}
            <div></div>
          </div>
        </section>

        {/* Métricas por Tipo de Documento */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ 
            margin: "0 0 20px 0", 
            fontSize: 18, 
            fontWeight: 600, 
            color: "var(--text)",
            letterSpacing: "0.3px"
          }}>
            Métricas por Tipo de Documento
          </h2>
          
          {/* Fila 1: Cédulas - Rojo, Amarillo, Verde */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
            marginBottom: 20
          }}>
            <KPICard
              title="Cédulas - Crítico (Rojo)"
              value={metrics.cedulasRojas}
              subValue={`${metrics.totalCedulas > 0 ? `${metrics.pctCedulasRojas}%` : '0%'}`}
              color="red"
              trend={metrics.cedulasRojas > 0 ? "up" : undefined}
            />
            <KPICard
              title="Cédulas - Advertencia (Amarillo)"
              value={metrics.cedulasAmarillas}
              subValue={`${metrics.totalCedulas > 0 ? `${metrics.pctCedulasAmarillas}%` : '0%'}`}
              color="yellow"
            />
            <KPICard
              title="Cédulas - Normal (Verde)"
              value={metrics.cedulasVerdes}
              subValue={`${metrics.totalCedulas > 0 ? `${metrics.pctCedulasVerdes}%` : '0%'}`}
              color="green"
            />
          </div>
          
          {/* Fila 2: Oficios - Rojo, Amarillo, Verde */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
            marginBottom: 20
          }}>
            <KPICard
              title="Oficios - Crítico (Rojo)"
              value={metrics.oficiosRojos}
              subValue={`${metrics.totalOficios > 0 ? `${metrics.pctOficiosRojos}%` : '0%'}`}
              color="red"
              trend={metrics.oficiosRojos > 0 ? "up" : undefined}
            />
            <KPICard
              title="Oficios - Advertencia (Amarillo)"
              value={metrics.oficiosAmarillos}
              subValue={`${metrics.totalOficios > 0 ? `${metrics.pctOficiosAmarillos}%` : '0%'}`}
              color="yellow"
            />
            <KPICard
              title="Oficios - Normal (Verde)"
              value={metrics.oficiosVerdes}
              subValue={`${metrics.totalOficios > 0 ? `${metrics.pctOficiosVerdes}%` : '0%'}`}
              color="green"
            />
          </div>
          
          {/* Fila 3: Expedientes - Rojo, Amarillo, Verde */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20
          }}>
            <KPICard
              title="Expedientes - Crítico (Rojo)"
              value={metrics.expedientesRojos}
              subValue={`${metrics.totalExpedientes > 0 ? `${metrics.pctExpedientesRojos}%` : '0%'}`}
              color="red"
              trend={metrics.expedientesRojos > 0 ? "up" : undefined}
            />
            <KPICard
              title="Expedientes - Advertencia (Amarillo)"
              value={metrics.expedientesAmarillos}
              subValue={`${metrics.totalExpedientes > 0 ? `${metrics.pctExpedientesAmarillos}%` : '0%'}`}
              color="yellow"
            />
            <KPICard
              title="Expedientes - Normal (Verde)"
              value={metrics.expedientesVerdes}
              subValue={`${metrics.totalExpedientes > 0 ? `${metrics.pctExpedientesVerdes}%` : '0%'}`}
              color="green"
            />
          </div>
        </section>

        <section>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 12
          }}>
            <h2 style={{ 
              margin: 0, 
              fontSize: 18, 
              fontWeight: 600, 
              color: "var(--text)",
              letterSpacing: "0.3px"
            }}>
              Rendimiento por Usuario
            </h2>
            <div style={{ 
              fontSize: 13, 
              color: "rgba(234,243,255,.65)",
              padding: "6px 12px",
              background: "rgba(255,255,255,.06)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.1)"
            }}>
              Orden: más críticos primero
            </div>
          </div>

          <div style={{
            background: "linear-gradient(135deg, rgba(255,255,255,.08), rgba(255,255,255,.04))",
            border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 4px 12px rgba(0,0,0,.15)"
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "800px"
              }}>
              <thead>
                  <tr style={{ background: "rgba(0,82,156,.12)" }}>
                    <th style={{
                      textAlign: "left",
                      padding: "14px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      color: "rgba(234,243,255,.85)",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,.12)"
                    }}>
                      Usuario
                    </th>
                    <th style={{
                      textAlign: "right",
                      padding: "14px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      color: "rgba(234,243,255,.85)",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,.12)"
                    }}>
                      🔴 ROJO
                    </th>
                    <th style={{
                      textAlign: "right",
                      padding: "14px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      color: "rgba(234,243,255,.85)",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,.12)"
                    }}>
                      🟡 AMARILLO
                    </th>
                    <th style={{
                      textAlign: "right",
                      padding: "14px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      color: "rgba(234,243,255,.85)",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,.12)"
                    }}>
                      🟢 VERDE
                    </th>
                    <th style={{
                      textAlign: "right",
                      padding: "14px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      color: "rgba(234,243,255,.85)",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,.12)"
                    }}>
                      Total
                    </th>
                    <th style={{
                      textAlign: "right",
                      padding: "14px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.3px",
                      color: "rgba(234,243,255,.85)",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(255,255,255,.12)"
                    }}>
                      Más antigua (días)
                    </th>
                </tr>
              </thead>
              <tbody>
                  {ranking.map((r, idx) => {
                    const isCritical = r.rojos > 0 || r.maxDias >= UMBRAL_ROJO;
                    return (
                      <tr 
                        key={r.uid}
                        style={{
                          borderBottom: idx < ranking.length - 1 ? "1px solid rgba(255,255,255,.06)" : "none",
                          background: isCritical ? "rgba(225,57,64,.05)" : "transparent",
                          transition: "background 0.2s ease"
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = isCritical 
                            ? "rgba(225,57,64,.1)" 
                            : "rgba(255,255,255,.06)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isCritical 
                            ? "rgba(225,57,64,.05)" 
                            : "transparent";
                        }}
                      >
                        <td style={{ padding: "14px 16px", fontWeight: 500, color: "var(--text)" }}>
                          {r.name}
                        </td>
                        <td style={{ 
                          padding: "14px 16px", 
                          textAlign: "right",
                          color: r.rojos > 0 ? "#e13940" : "rgba(234,243,255,.65)",
                          fontWeight: r.rojos > 0 ? 600 : 400
                        }}>
                          {r.rojos}
                        </td>
                        <td style={{ 
                          padding: "14px 16px", 
                          textAlign: "right",
                          color: r.amarillos > 0 ? "#ffc83c" : "rgba(234,243,255,.65)",
                          fontWeight: r.amarillos > 0 ? 600 : 400
                        }}>
                          {r.amarillos}
                        </td>
                        <td style={{ 
                          padding: "14px 16px", 
                          textAlign: "right",
                          color: r.verdes > 0 ? "#00a952" : "rgba(234,243,255,.65)",
                          fontWeight: r.verdes > 0 ? 600 : 400
                        }}>
                          {r.verdes}
                        </td>
                        <td style={{ 
                          padding: "14px 16px", 
                          textAlign: "right",
                          color: "var(--text)",
                          fontWeight: 500
                        }}>
                          {r.total}
                        </td>
                        <td style={{ 
                          padding: "14px 16px", 
                          textAlign: "right",
                          color: r.maxDias >= UMBRAL_ROJO 
                            ? "#e13940" 
                            : r.maxDias >= UMBRAL_AMARILLO 
                              ? "#ffc83c" 
                              : r.maxDias >= 0 
                                ? "#00a952" 
                                : "rgba(234,243,255,.65)",
                          fontWeight: r.maxDias >= UMBRAL_AMARILLO ? 600 : 400
                        }}>
                          {r.maxDias < 0 ? "-" : r.maxDias}
                        </td>
                  </tr>
                    );
                  })}
                {ranking.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ 
                        padding: "32px 16px", 
                        textAlign: "center", 
                        color: "rgba(234,243,255,.6)",
                        fontSize: 14
                      }}>
                        No hay cédulas abiertas aún.
                      </td>
                    </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          <p style={{ 
            marginTop: 16, 
            fontSize: 13, 
            color: "rgba(234,243,255,.65)",
            lineHeight: 1.6
          }}>
            <strong>Leyenda:</strong> Las filas resaltadas en rojo indican usuarios con cédulas críticas. 
            El orden de prioridad es: más cédulas ROJAS, luego AMARILLAS, y finalmente mayor antigüedad desde la carga.
            Amarillo desde {UMBRAL_AMARILLO} días • Rojo desde {UMBRAL_ROJO} días
          </p>
      </section>
    </main>
    </div>
  );
}
