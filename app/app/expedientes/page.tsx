"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { daysSince } from "@/lib/semaforo";
import { FilterableTh } from "@/app/components/FilterableTh";
import NotificationBell from "@/app/components/NotificationBell";
import ResponsableAvatars from "@/app/components/ResponsableAvatars";
import { useColumnFilters, uniqueOptionsFromField } from "@/app/hooks/useColumnFilters";

type Expediente = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  numero_expediente: string | null;
  fecha_ultima_modificacion: string | null;
  estado: string;
  observaciones: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
};

function isoToDDMMAAAA(iso: string | null): string {
  // Maneja formatos ISO: YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss+00:00
  if (!iso || iso.trim() === "") return "";
  
  // Extraer solo la parte de la fecha (primeros 10 caracteres: YYYY-MM-DD)
  const datePart = iso.substring(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function ddmmaaaaToISO(ddmmaaaa: string): string | null {
  // Convertir DD/MM/AAAA a ISO (YYYY-MM-DDTHH:mm:ss)
  if (!ddmmaaaa || ddmmaaaa.trim() === "") return null;
  
  const parts = ddmmaaaa.trim().split("/");
  if (parts.length !== 3) return null;
  
  const [day, month, year] = parts.map(p => parseInt(p, 10));
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
  
  try {
    const date = new Date(year, month - 1, day);
    // Verificar que la fecha es válida (evita 31/02)
    if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
      return null;
    }
    return date.toISOString();
  } catch {
    return null;
  }
}

function formatDateInput(value: string): string {
  // Formatear el input mientras se escribe: solo números y barras
  const cleaned = value.replace(/[^\d/]/g, "");
  
  // Limitar a 10 caracteres (DD/MM/AAAA)
  if (cleaned.length > 10) return cleaned.slice(0, 10);
  
  // Agregar barras automáticamente
  let formatted = cleaned.replace(/\//g, "");
  
  if (formatted.length > 2) {
    formatted = formatted.slice(0, 2) + "/" + formatted.slice(2);
  }
  if (formatted.length > 5) {
    formatted = formatted.slice(0, 5) + "/" + formatted.slice(5);
  }
  
  return formatted;
}

type Semaforo = "VERDE" | "AMARILLO" | "ROJO";

function semaforoByAge(diasDesdeModificacion: number): Semaforo {
  if (diasDesdeModificacion >= 60) return "ROJO";
  if (diasDesdeModificacion >= 30) return "AMARILLO";
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

async function requireSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login";
    return null;
  }
  return data.session;
}

type SortField = "dias" | "semaforo" | "fecha_ultima_modificacion" | "juzgado" | null;
type SortDirection = "asc" | "desc";

type ExpedientesTableFilterKey = "semaforo" | "tablaJuzgado";

export default function MisExpedientesPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [editingFecha, setEditingFecha] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const { filters, setFilter, clearAll, hasActiveFilters, openFilter, setOpenFilter } =
    useColumnFilters<ExpedientesTableFilterKey>({
      semaforo: null as string | null,
      tablaJuzgado: null as string | null,
    });
  const [userRoles, setUserRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAbogado: boolean;
    isAdminMediaciones: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAbogado: false,
    isAdminMediaciones: false,
  });
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [usuariosByKey, setUsuariosByKey] = useState<Record<string, { id: string; nombre: string; email?: string }[]>>({});

  useEffect(() => {
    (async () => {
      setMsg("");

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
        .select("is_admin_expedientes, is_abogado, is_superadmin, is_admin_mediaciones")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isAdminExp = !roleErr && roleData?.is_admin_expedientes === true;
      const isAbogado = !roleErr && roleData?.is_abogado === true;
      const isSuperadmin = !roleErr && roleData?.is_superadmin === true;
      const isAdminMediaciones = !roleErr && roleData?.is_admin_mediaciones === true;
      
      if (!isAdminExp && !isAbogado) {
        window.location.href = "/app";
        return;
      }

      // Guardar roles para mostrar botones de navegación
      setUserRoles({
        isSuperadmin: isSuperadmin || false,
        isAdminExpedientes: isAdminExp || false,
        isAbogado: isAbogado || false,
        isAdminMediaciones: isAdminMediaciones || false,
      });

      // must_change_password guard
      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (pErr) {
        window.location.href = "/login";
        return;
      }
      if (prof?.must_change_password) {
        window.location.href = "/cambiar-password";
        return;
      }

      // Si es ABOGADO, obtener juzgados asignados y filtrar por ellos
      let juzgadosAsignados: string[] = [];
      if (isAbogado) {
        const { data: juzgadosData, error: juzgadosErr } = await supabase
          .from("user_juzgados")
          .select("juzgado")
          .eq("user_id", uid);
        
        if (!juzgadosErr && juzgadosData) {
          juzgadosAsignados = juzgadosData.map(j => j.juzgado);
        }
      }

      // Construir query según el rol (sin join para evitar errores)
      // Intentar incluir observaciones, pero si no existe la columna, usar select sin ella
      let query;
      if (isAbogado && juzgadosAsignados.length > 0) {
        // ABOGADO: ver todos los expedientes de sus juzgados asignados
        query = supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
          .in("juzgado", juzgadosAsignados)
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
      } else if (isAdminExp) {
        // ADMIN_EXPEDIENTES: ver todos los expedientes (o solo los propios, según política RLS)
        query = supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
      } else {
        // Fallback: solo propios
        query = supabase
          .from("expedientes")
          .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
          .eq("owner_user_id", uid)
          .eq("estado", "ABIERTO")
          .order("fecha_ultima_modificacion", { ascending: false });
      }

      const { data: exps, error: eErr } = await query;
      
      // Si el error es porque la columna observaciones no existe, intentar sin ella
      let expsData = exps;
      if (eErr && (eErr.message?.includes("observaciones") || eErr.message?.includes("does not exist"))) {
        console.warn(`[Expedientes] Columna observaciones no existe, reintentando sin observaciones`);
        
        let query2;
        if (isAbogado && juzgadosAsignados.length > 0) {
          query2 = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .in("juzgado", juzgadosAsignados)
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
        } else if (isAdminExp) {
          query2 = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
        } else {
          query2 = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, created_by_user_id")
            .eq("owner_user_id", uid)
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
        }
        
        const { data: exps2, error: eErr2 } = await query2;
        
        if (eErr2) {
          setMsg(`Error al cargar expedientes: ${eErr2.message}`);
          setLoading(false);
          return;
        }
        
        // Establecer observaciones como null para todos
        expsData = (exps2 ?? []).map((e: any) => ({
          ...e,
          observaciones: null
        }));
      } else if (eErr) {
        setMsg(`Error al cargar expedientes: ${eErr.message}`);
        setLoading(false);
        return;
      } else {
        // Si no hubo error, verificar que observaciones se están cargando
        const expsWithObservaciones = (expsData ?? []).filter((e: any) => e.observaciones && e.observaciones.trim());
        console.log(`[Expedientes] Expedientes con observaciones: ${expsWithObservaciones.length}/${expsData?.length || 0}`);
        if (expsData && expsData.length > 0) {
          console.log(`[Expedientes] Primer expediente tiene observaciones:`, expsData[0].observaciones || "null/vacío");
        }
      }

      // Obtener nombres de usuarios que crearon los expedientes
      const userIds = [...new Set((expsData ?? []).map((e: any) => e.created_by_user_id).filter(Boolean))];
      let userNames: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        
        if (profiles) {
          userNames = profiles.reduce((acc: Record<string, string>, p: any) => {
            acc[p.id] = p.full_name || p.email || "Sin nombre";
            return acc;
          }, {});
        }
      }
      
      // Procesar expedientes y agregar nombres de usuarios
      const processedExps = (expsData ?? []).map((e: any) => {
        // Asegurarse de que observaciones esté presente
        const observaciones = e.observaciones !== undefined ? e.observaciones : null;
        return {
          ...e,
          observaciones: observaciones || null,
          created_by_name: e.created_by_user_id ? (userNames[e.created_by_user_id] || null) : null,
        };
      });
      
      setExpedientes(processedExps as Expediente[]);
      setLoading(false);
    })();
  }, []);

  // Cargar usuarios por juzgado para columna Responsable (abogados asignados)
  useEffect(() => {
    if (expedientes.length === 0) {
      setUsuariosByKey({});
      return;
    }
    const seen = new Set<string>();
    const uniqueItems: { juzgado: string; caratula: string | null }[] = [];
    for (const e of expedientes) {
      const j = e.juzgado?.trim() || "";
      if (!j) continue;
      const car = e.caratula?.trim() || null;
      const key = `${j}|||${car || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueItems.push({ juzgado: j, caratula: car });
    }
    if (uniqueItems.length === 0) {
      setUsuariosByKey({});
      return;
    }
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const res = await fetch("/api/get-users-by-juzgado", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${data?.session?.access_token}`,
          },
          body: JSON.stringify({ items: uniqueItems }),
        });
        if (!res.ok) return;
        const json = await res.json();
        setUsuariosByKey(json.map || {});
      } catch {
        setUsuariosByKey({});
      }
    })();
  }, [expedientes]);

  const juzgadoOptions = useMemo(
    () =>
      uniqueOptionsFromField(
        expedientes as unknown as readonly Record<string, unknown>[],
        "juzgado"
      ),
    [expedientes]
  );

  const rows = useMemo(() => {
    let mapped = expedientes.map((e) => {
      const fechaModISO = e.fecha_ultima_modificacion || "";
      const dias = fechaModISO ? daysSince(fechaModISO) : null;
      const diasValidos = dias !== null && !isNaN(dias) && dias >= 0 ? dias : null;
      const sem = diasValidos === null ? ("VERDE" as Semaforo) : semaforoByAge(diasValidos);
      return { ...e, fechaModISO, dias: diasValidos, sem };
    });

    // Aplicar filtro de semáforo
    if (filters.semaforo) {
      mapped = mapped.filter((e) => e.sem === filters.semaforo);
    }

    if (filters.tablaJuzgado) {
      const jf = filters.tablaJuzgado;
      mapped = mapped.filter((e) => (e.juzgado || "").trim() === jf);
    }

    // Aplicar ordenamiento
    if (sortField) {
      mapped.sort((a, b) => {
        let compareA: number;
        let compareB: number;

        if (sortField === "dias") {
          compareA = a.dias ?? -1;
          compareB = b.dias ?? -1;
        } else if (sortField === "semaforo") {
          const semOrder: Record<Semaforo, number> = { ROJO: 2, AMARILLO: 1, VERDE: 0 };
          compareA = semOrder[a.sem];
          compareB = semOrder[b.sem];
        } else if (sortField === "fecha_ultima_modificacion") {
          if (!a.fechaModISO && !b.fechaModISO) return 0;
          if (!a.fechaModISO) return 1;
          if (!b.fechaModISO) return -1;
          // Usar getTime() para comparación completa de timestamp
          compareA = new Date(a.fechaModISO).getTime();
          compareB = new Date(b.fechaModISO).getTime();
        } else if (sortField === "juzgado") {
          const juzgadoA = (a.juzgado || "").trim().toUpperCase();
          const juzgadoB = (b.juzgado || "").trim().toUpperCase();
          if (!juzgadoA && !juzgadoB) return 0;
          if (!juzgadoA) return 1;
          if (!juzgadoB) return -1;
          if (juzgadoA < juzgadoB) return sortDirection === "asc" ? -1 : 1;
          if (juzgadoA > juzgadoB) return sortDirection === "asc" ? 1 : -1;
          return 0;
        } else {
          return 0;
        }

        if (compareA < compareB) return sortDirection === "asc" ? -1 : 1;
        if (compareA > compareB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return mapped;
  }, [expedientes, sortField, sortDirection, filters]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "juzgado" ? "asc" : "desc");
    }
  }

  async function logout() {
    // Limpiar estado de conexión PJN
    try {
      localStorage.removeItem("pjnConnected");
      localStorage.removeItem("pjnConnectedTimestamp");
    } catch (e) {
      // Ignorar errores de localStorage
    }
    
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function isoToDateInput(iso: string | null): string {
    if (!iso) return "";
    // Convertir ISO a DD/MM/AAAA para input type="text"
    return isoToDDMMAAAA(iso);
  }

  async function updateFechaExpediente(expedienteId: string, nuevaFecha: string) {
    if (!nuevaFecha) {
      setEditingFecha(null);
      return;
    }
    
      setUpdatingId(expedienteId);
    try {
      // Convertir fecha del input (DD/MM/AAAA) a ISO
      const fechaISO = ddmmaaaaToISO(nuevaFecha);
      if (!fechaISO) {
        setMsg("La fecha ingresada no es válida. Use el formato DD/MM/AAAA.");
        setEditingFecha(null);
        setUpdatingId(null);
        return;
      }
      
      const { error } = await supabase
        .from("expedientes")
        .update({ fecha_ultima_modificacion: fechaISO })
        .eq("id", expedienteId);

      if (error) {
        setMsg("Error al actualizar fecha: " + error.message);
        // Recargar expedientes para revertir el cambio visual
        const session = await requireSessionOrRedirect();
        if (session) {
          const uid = session.user.id;
          let query = supabase
            .from("expedientes")
            .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones")
            .eq("owner_user_id", uid)
            .eq("estado", "ABIERTO")
            .order("fecha_ultima_modificacion", { ascending: false });
          
          const { data: exps, error: eErr } = await query;
          
          if (eErr) {
            // Si falla por columna observaciones inexistente, reintentar sin ella
            const errorMsg = eErr.message || String(eErr);
            if (errorMsg.includes("observaciones") || 
                (errorMsg.includes("column") && errorMsg.includes("does not exist"))) {
              const { data: exps2, error: eErr2 } = await supabase
                .from("expedientes")
                .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado")
                .eq("owner_user_id", uid)
                .eq("estado", "ABIERTO")
                .order("fecha_ultima_modificacion", { ascending: false });
              
              if (eErr2) {
                // Si aún falla, intentar sin ordenamiento
                const { data: exps3 } = await supabase
                  .from("expedientes")
                  .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado")
                  .eq("owner_user_id", uid)
                  .eq("estado", "ABIERTO");
                
                if (exps3) {
                  const sorted = exps3.sort((a: any, b: any) => {
                    const dateA = a.fecha_ultima_modificacion ? new Date(a.fecha_ultima_modificacion).getTime() : 0;
                    const dateB = b.fecha_ultima_modificacion ? new Date(b.fecha_ultima_modificacion).getTime() : 0;
                    return dateB - dateA;
                  });
                  const expsWithNull = sorted.map((e: any) => ({ ...e, observaciones: null }));
                  setExpedientes(expsWithNull as Expediente[]);
                }
              } else if (exps2) {
                const expsWithNull = exps2.map((e: any) => ({ ...e, observaciones: null }));
                setExpedientes(expsWithNull as Expediente[]);
              }
            }
          } else if (exps) {
            setExpedientes(exps as Expediente[]);
          }
        }
        setEditingFecha(null);
        return;
      }

      // Actualizar el estado local (el useMemo recalculará días y semáforo automáticamente)
      setExpedientes(prev => prev.map(e => 
        e.id === expedienteId 
          ? { ...e, fecha_ultima_modificacion: fechaISO }
          : e
      ));
      
      setEditingFecha(null);
    } finally {
      setUpdatingId(null);
    }
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
      <section className="card">
        <header className="nav">
          <img className="logoMini" src="/logo.png" alt="Logo" />
          <h1>Mis Expedientes</h1>
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
          {userRoles.isSuperadmin && (
            <Link className="btn" href="/superadmin" style={{ marginRight: 8 }}>
              DASHBOARD
            </Link>
          )}
          {userRoles.isAbogado && (
            <Link className="btn" href="/app/abogado" style={{ marginRight: 8 }}>
              HOME
            </Link>
          )}
          {(userRoles.isAdminExpedientes || userRoles.isAbogado) && (
            <Link className="btn primary" href="/app/expedientes/nueva" style={{ marginRight: 8 }}>
              Cargar
            </Link>
          )}
          <NotificationBell />
        </header>

        <div className="page">
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Semáforo automático por antigüedad desde la última modificación:
            </span>
            <button
              onClick={() => setFilter("semaforo", filters.semaforo === "VERDE" ? null : "VERDE")}
              style={{
                cursor: "pointer",
                border: filters.semaforo === "VERDE" ? "2px solid rgba(46, 204, 113, 0.8)" : "1px solid rgba(46, 204, 113, 0.35)",
                background: filters.semaforo === "VERDE" ? "rgba(46, 204, 113, 0.25)" : "rgba(46, 204, 113, 0.16)",
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
              onClick={() => setFilter("semaforo", filters.semaforo === "AMARILLO" ? null : "AMARILLO")}
              style={{
                cursor: "pointer",
                border: filters.semaforo === "AMARILLO" ? "2px solid rgba(241, 196, 15, 0.8)" : "1px solid rgba(241, 196, 15, 0.35)",
                background: filters.semaforo === "AMARILLO" ? "rgba(241, 196, 15, 0.25)" : "rgba(241, 196, 15, 0.14)",
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
              onClick={() => setFilter("semaforo", filters.semaforo === "ROJO" ? null : "ROJO")}
              style={{
                cursor: "pointer",
                border: filters.semaforo === "ROJO" ? "2px solid rgba(231, 76, 60, 0.8)" : "1px solid rgba(231, 76, 60, 0.35)",
                background: filters.semaforo === "ROJO" ? "rgba(231, 76, 60, 0.25)" : "rgba(231, 76, 60, 0.14)",
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
            {hasActiveFilters && (
              <button
                type="button"
                className="btn"
                onClick={() => clearAll()}
                style={{ fontSize: 12 }}
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {msg && <div className="error">{msg}</div>}

          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <FilterableTh
                    label="Semáforo"
                    filterKey="semaforo"
                    options={[
                      { value: "VERDE", label: "VERDE" },
                      { value: "AMARILLO", label: "AMARILLO" },
                      { value: "ROJO", label: "ROJO" },
                    ]}
                    activeFilter={filters.semaforo}
                    onFilter={(v) => setFilter("semaforo", v)}
                    isOpen={openFilter === "semaforo"}
                    onToggle={() => setOpenFilter((p) => (p === "semaforo" ? null : "semaforo"))}
                    sortable
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={() => handleSort("semaforo")}
                    width={130}
                  />
                  <th>Carátula</th>
                  <FilterableTh
                    label="Juzgado"
                    filterKey="tablaJuzgado"
                    options={juzgadoOptions}
                    activeFilter={filters.tablaJuzgado}
                    onFilter={(v) => setFilter("tablaJuzgado", v)}
                    isOpen={openFilter === "tablaJuzgado"}
                    onToggle={() => setOpenFilter((p) => (p === "tablaJuzgado" ? null : "tablaJuzgado"))}
                    sortable
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={() => handleSort("juzgado")}
                    sortColumnId="juzgado"
                    menuMinWidth={250}
                    menuScrollable
                    optionWhiteSpaceNormal
                  />
                  <th style={{ width: 80, textAlign: "center" }} title="Responsable según juzgado asignado">
                    <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>Responsable</span>
                  </th>
                  <th 
                    className="sortable"
                    style={{ width: 220 }}
                    onClick={() => handleSort("fecha_ultima_modificacion")}
                    title="Haz clic para ordenar"
                  >
                    Fecha Última Modificación{" "}
                    <span style={{ opacity: sortField === "fecha_ultima_modificacion" ? 1 : 0.4 }}>
                      {sortField === "fecha_ultima_modificacion" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                  <th 
                    className="sortable"
                    style={{ width: 80, textAlign: "right" }}
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
                  <th style={{ width: 400 }}>Observaciones</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} style={{ verticalAlign: "top" }}>
                    <td>
                      <SemaforoChip value={e.sem} />
                    </td>

                    <td style={{ fontWeight: 650 }}>
                      {e.caratula?.trim() ? e.caratula : <span className="muted">Sin carátula</span>}
                    </td>

                    <td>{e.juzgado?.trim() ? e.juzgado : <span className="muted">—</span>}</td>

                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                      <ResponsableAvatars
                        usuarios={
                          e.juzgado?.trim()
                            ? usuariosByKey[`${e.juzgado.trim()}|||${(e.caratula || "").trim()}`] || []
                            : []
                        }
                      />
                    </td>

                    <td>
                      {editingFecha === e.id ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            placeholder="DD/MM/AAAA"
                            defaultValue={isoToDateInput(e.fechaModISO)}
                            onChange={(ev) => {
                              const formatted = formatDateInput(ev.target.value);
                              ev.target.value = formatted;
                            }}
                            onBlur={(ev) => {
                              const nuevaFecha = ev.target.value.trim();
                              if (nuevaFecha && nuevaFecha !== isoToDateInput(e.fechaModISO)) {
                                if (nuevaFecha.length === 10) {
                                  updateFechaExpediente(e.id, nuevaFecha);
                                } else {
                                  setMsg("La fecha debe tener el formato DD/MM/AAAA.");
                                  setEditingFecha(null);
                                }
                              } else {
                                setEditingFecha(null);
                              }
                            }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") {
                                ev.currentTarget.blur();
                              } else if (ev.key === "Escape") {
                                setEditingFecha(null);
                              }
                            }}
                            autoFocus
                            disabled={updatingId === e.id}
                            maxLength={10}
                            style={{
                              padding: "6px 8px",
                              fontSize: 13,
                              borderRadius: 6,
                              border: "1px solid rgba(255,255,255,.2)",
                              background: "rgba(255,255,255,.08)",
                              color: "var(--text)",
                              outline: "none",
                              width: 140,
                              fontVariantNumeric: "normal",
                            }}
                          />
                          {updatingId === e.id && (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Guardando...</span>
                          )}
                        </div>
                      ) : (
                        <div 
                          onClick={() => setEditingFecha(e.id)}
                          style={{ 
                            cursor: "pointer",
                            padding: "4px 8px",
                            borderRadius: 4,
                            transition: "background 0.2s ease"
                          }}
                          onMouseEnter={(ev) => {
                            ev.currentTarget.style.background = "rgba(255,255,255,.08)";
                          }}
                          onMouseLeave={(ev) => {
                            ev.currentTarget.style.background = "transparent";
                          }}
                          title="Haz clic para editar la fecha"
                        >
                          {e.fechaModISO ? isoToDDMMAAAA(e.fechaModISO) : <span className="muted">—</span>}
                        </div>
                      )}
                    </td>

                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {typeof e.dias === "number" && !isNaN(e.dias) ? e.dias : <span className="muted">—</span>}
                    </td>

                    <td>
                      {e.numero_expediente?.trim() ? e.numero_expediente : <span className="muted">—</span>}
                    </td>

                    <td>
                      {e.created_by_name ? (
                        <span style={{ fontSize: 13 }}>{e.created_by_name}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    <td style={{ fontSize: 13, maxWidth: 400 }}>
                      {e.observaciones?.trim() ? (
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
                          letterSpacing: "0.01em"
                        }}>
                          {e.observaciones}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      {userRoles.isAbogado 
                        ? "No hay expedientes cargados para tus juzgados asignados."
                        : "Todavía no cargaste expedientes."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
