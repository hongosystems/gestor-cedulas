"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import jsPDF from "jspdf";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
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

// Convertir fecha DD/MM/AAAA a ISO (YYYY-MM-DD)
function ddmmaaaaToISO(ddmm: string | null): string | null {
  if (!ddmm || ddmm.trim() === "") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmm.trim());
  if (!m) return null;
  const [, dia, mes, anio] = m;
  return `${anio}-${mes}-${dia}T00:00:00.000Z`;
}

function daysSince(fechaCargaISO: string | null) {
  if (!fechaCargaISO) return 0;
  const carga = new Date(fechaCargaISO);
  if (isNaN(carga.getTime())) return 0;
  const today = startOfDay(new Date());
  const base = startOfDay(carga);
  const diffMs = today.getTime() - base.getTime();
  return Math.floor(diffMs / 86400000);
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
  const [juzgadoFilter, setJuzgadoFilter] = useState<"mis_juzgados" | "todos" | "beneficio" | string>("todos");
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

      // Intentar obtener con tipo_documento y created_by_user_id, pero hacer fallback si no existe la columna
      const query = supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado, tipo_documento, created_by_user_id")
        .neq("estado", "CERRADA")
        .order("fecha_carga", { ascending: true });

      const { data: cs, error: cErr } = await query;

      if (cErr) {
        // Si falla por columna tipo_documento o created_by_user_id inexistente, reintentar sin ellas
        if (cErr.message?.includes("tipo_documento") || cErr.message?.includes("created_by_user_id")) {
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
          
          const csWithNull = (cs2 ?? []).map((c) => ({ ...(c as Record<string, unknown>), tipo_documento: null, created_by_user_id: null }));
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
      console.log(`[Dashboard] Cargando favoritos de pjn-scraper...`);
      const { data: favoritosData, error: favoritosErr } = await supabase
        .from("pjn_favoritos")
        .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones")
        .order("updated_at", { ascending: false });
      
      if (favoritosErr) {
        console.warn(`[Dashboard] ⚠️  Error al cargar pjn_favoritos:`, favoritosErr);
        setPjnFavoritos([]);
      } else {
        setPjnFavoritos((favoritosData ?? []) as PjnFavorito[]);
        console.log(`[Dashboard] ✅ Favoritos de pjn-scraper cargados: ${(favoritosData ?? []).length}`);
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
  const normalizarJuzgado = (j: string | null) => {
    if (!j) return "";
    return j.trim().replace(/\s+/g, " ").toUpperCase();
  };

  // Obtener todos los juzgados únicos de cédulas, expedientes y favoritos, ordenados ascendente
  const todosLosJuzgados = useMemo(() => {
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
    
    // Convertir a array y ordenar ascendente
    const juzgadosArray = Array.from(juzgadosSet);
    juzgadosArray.sort((a, b) => {
      // Normalizar para comparación
      const aNorm = normalizarJuzgado(a);
      const bNorm = normalizarJuzgado(b);
      return aNorm.localeCompare(bNorm, 'es', { numeric: true, sensitivity: 'base' });
    });
    
    return juzgadosArray;
  }, [allCedulas, allExpedientes, pjnFavoritos]);

  // Convertir favoritos de pjn-scraper a expedientes (SIN duplicar - solo mostrar favoritos filtrados por juzgado)
  const favoritosComoExpedientes = useMemo(() => {
    // Convertir TODOS los favoritos a expedientes, sin asignar a usuarios específicos
    // El filtrado por juzgado se hará después en el useEffect de filtrado
    const expedientesFromFavoritos: Expediente[] = pjnFavoritos.map((favorito) => {
      const numeroExpediente = `${favorito.jurisdiccion} ${favorito.numero}/${favorito.anio}`;
      const fechaISO = ddmmaaaaToISO(favorito.fecha_ultima_carga);
      
      return {
        id: `pjn_${favorito.id}`, // ID único por favorito (sin duplicar por usuario)
        owner_user_id: "", // Los favoritos no tienen owner específico
        caratula: favorito.caratula,
        juzgado: favorito.juzgado,
        numero_expediente: numeroExpediente,
        fecha_ultima_modificacion: fechaISO,
        estado: "ABIERTO",
        created_by_user_id: null,
        is_pjn_favorito: true,
      };
    });
    
    console.log(`[Dashboard] Favoritos convertidos a expedientes: ${expedientesFromFavoritos.length} (de ${pjnFavoritos.length} favoritos únicos)`);
    return expedientesFromFavoritos;
  }, [pjnFavoritos]);

  // Filtrar expedientes según los filtros seleccionados
  useEffect(() => {
    // Combinar expedientes locales con favoritos convertidos
    let filtered: Expediente[] = [...allExpedientes, ...favoritosComoExpedientes];
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
      filtered = filtered.map(e => {
        if (e.is_pjn_favorito) {
          if (!e.juzgado) return null;
          const juzgadoNormalizado = normalizarJuzgado(e.juzgado);
          // Comparación exacta normalizada
          if (juzgadosDelUsuario.includes(juzgadoNormalizado)) {
            // Asignar el owner_user_id del usuario seleccionado para que aparezca en el ranking
            return { ...e, owner_user_id: selectedUserId };
          }
          // Comparación por número de juzgado (más flexible)
          const matchJuzgado = juzgadosDelUsuario.some(jAsignado => {
            const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
            const numJuzgado = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
            if (numAsignado && numJuzgado && numAsignado === numJuzgado) {
              if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
                return true;
              }
            }
            return false;
          });
          if (matchJuzgado) {
            return { ...e, owner_user_id: selectedUserId };
          }
          return null;
        }
        return e.owner_user_id === selectedUserId ? e : null;
      }).filter((e): e is Expediente => e !== null);

      console.log(`[Dashboard] Filtro por usuario (local por owner, PJN por juzgado asignado): ${beforeUserFilter} -> ${filtered.length}`);
    } else {
      // Cuando se selecciona "Todos los usuarios", distribuir favoritos PJN entre todos los usuarios
      // que tienen ese juzgado asignado, pero solo una vez por favorito (asignar al primer usuario que coincida)
      filtered = filtered.map(e => {
        if (e.is_pjn_favorito && (!e.owner_user_id || e.owner_user_id.trim() === "")) {
          if (!e.juzgado) return e; // Mantener sin asignar si no tiene juzgado
          const juzgadoNormalizado = normalizarJuzgado(e.juzgado);
          
          // Buscar el primer usuario que tenga este juzgado asignado
          for (const [userId, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
            const juzgadosNormalizados = juzgadosDelUsuario.map(j => j?.trim().replace(/\s+/g, " ").toUpperCase());
            
            // Comparación exacta normalizada
            if (juzgadosNormalizados.includes(juzgadoNormalizado)) {
              return { ...e, owner_user_id: userId };
            }
            
            // Comparación por número de juzgado (más flexible)
            const matchJuzgado = juzgadosNormalizados.some(jAsignado => {
              const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
              const numJuzgado = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
              if (numAsignado && numJuzgado && numAsignado === numJuzgado) {
                if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
                  return true;
                }
              }
              return false;
            });
            
            if (matchJuzgado) {
              return { ...e, owner_user_id: userId };
            }
          }
          // Si no se encuentra ningún usuario con este juzgado, mantener sin asignar
          return e;
        }
        return e;
      });
      
      console.log(`[Dashboard] Distribución de favoritos PJN entre usuarios: ${filtered.filter(e => e.is_pjn_favorito && e.owner_user_id && e.owner_user_id.trim() !== "").length} favoritos asignados`);
    }

    // Filtro por juzgados
    if (juzgadoFilter === "mis_juzgados" && selectedUserJuzgados.length > 0) {
      const juzgadosNormalizados = selectedUserJuzgados.map(j => 
        j?.trim().replace(/\s+/g, " ").toUpperCase()
      );
      
      const beforeJuzgadoFilter = filtered.length;
      
      filtered = filtered.filter(e => {
        if (!e.juzgado) return false;
        const juzgadoNormalizado = normalizarJuzgado(e.juzgado);
        
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
    } else if (juzgadoFilter && juzgadoFilter !== "mis_juzgados" && juzgadoFilter !== "todos" && juzgadoFilter !== "beneficio") {
      // Filtro por juzgado específico
      const beforeJuzgadoFilter = filtered.length;
      const juzgadoFiltroNormalizado = normalizarJuzgado(juzgadoFilter);
      
      filtered = filtered.filter(e => {
        if (!e.juzgado) return false;
        const juzgadoNormalizado = normalizarJuzgado(e.juzgado);
        
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
  }, [allExpedientes, favoritosComoExpedientes, timeFilter, selectedUserId, juzgadoFilter, selectedUserJuzgados, customStartDate, customEndDate, userJuzgados.length]);

  const ranking = useMemo(() => {
    const perUser: Record<string, { rojos: number; amarillos: number; verdes: number; total: number; maxDias: number }> = {};

    // Contar cédulas (tipo_documento === "CEDULA" o null)
    for (const c of cedulas) {
      // Solo contar cédulas, no oficios (los oficios se cuentan por separado)
      if (c.tipo_documento === "OFICIO") continue;
      
      // Ignorar cédulas sin owner_user_id válido
      if (!c.owner_user_id || c.owner_user_id.trim() === "") continue;
      
      const dias = daysSince(c.fecha_carga);
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
    for (const c of cedulas) {
      if (c.tipo_documento !== "OFICIO") continue;
      
      // Ignorar oficios sin owner_user_id válido
      if (!c.owner_user_id || c.owner_user_id.trim() === "") continue;
      
      const dias = daysSince(c.fecha_carga);
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
    for (const e of expedientes) {
      // Ignorar expedientes sin owner_user_id (favoritos PJN sin asignar a usuario)
      if (!e.owner_user_id || e.owner_user_id.trim() === "") continue;
      
      const dias = daysSince(e.fecha_ultima_modificacion);
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

    for (const e of expedientes) {
      const dias = daysSince(e.fecha_ultima_modificacion);
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
    
    const totalRojas = ranking.reduce((a, r) => a + r.rojos, 0);
    const totalAmarillas = ranking.reduce((a, r) => a + r.amarillos, 0);
    const totalVerdes = ranking.reduce((a, r) => a + r.verdes, 0);
    
    // Calcular métricas por tipo de documento
    const cedulasRojas = cedulasFiltered.filter(c => {
      const dias = daysSince(c.fecha_carga);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const cedulasAmarillas = cedulasFiltered.filter(c => {
      const dias = daysSince(c.fecha_carga);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const cedulasVerdes = cedulasFiltered.filter(c => {
      const dias = daysSince(c.fecha_carga);
      return semaforoPorAntiguedad(dias) === "VERDE";
    }).length;
    
    const oficiosRojos = oficiosFiltered.filter(c => {
      const dias = daysSince(c.fecha_carga);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const oficiosAmarillos = oficiosFiltered.filter(c => {
      const dias = daysSince(c.fecha_carga);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const oficiosVerdes = oficiosFiltered.filter(c => {
      const dias = daysSince(c.fecha_carga);
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
    const totalExpedientes = expedientes.length;
    const expedientesRojos = expedientes.filter(e => {
      const dias = daysSince(e.fecha_ultima_modificacion);
      return semaforoPorAntiguedad(dias) === "ROJO";
    }).length;
    const expedientesAmarillos = expedientes.filter(e => {
      const dias = daysSince(e.fecha_ultima_modificacion);
      return semaforoPorAntiguedad(dias) === "AMARILLO";
    }).length;
    const expedientesVerdes = expedientes.filter(e => {
      const dias = daysSince(e.fecha_ultima_modificacion);
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
  }, [cedulas, expedientes, ranking, rankingExpedientes]);

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
                    todosLosJuzgadosCount: todosLosJuzgados.length
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
                {todosLosJuzgados.length > 0 && (
                  <optgroup label="Juzgados individuales">
                    {todosLosJuzgados.map((juzgado) => (
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
