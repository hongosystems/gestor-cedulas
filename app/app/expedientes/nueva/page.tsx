"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function todayDDMMAAAA(): string {
  // Retornar la fecha de hoy en formato DD/MM/AAAA
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
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
  // Permitir formato parcial como DD/MM o DD/MM/AA
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

export default function NuevaExpedientePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [userRoles, setUserRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAbogado: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAbogado: false,
  });
  const [currentUserName, setCurrentUserName] = useState<string>("");

  const [jurisdiccion, setJurisdiccion] = useState("");
  const [numeroExpediente, setNumeroExpediente] = useState("");
  const [añoExpediente, setAñoExpediente] = useState("");
  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [fechaUltimaModificacion, setFechaUltimaModificacion] = useState(todayDDMMAAAA());
  const [observaciones, setObservaciones] = useState("");
  const [searching, setSearching] = useState(false);

  async function requireSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.href = "/login";
      return null;
    }
    return data.session;
  }

  useEffect(() => {
    (async () => {
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
        .select("is_superadmin, is_admin_expedientes, is_abogado")
        .eq("user_id", uid)
        .maybeSingle();
      
      const isAdminExp = !roleErr && roleData?.is_admin_expedientes === true;
      const isAbogado = !roleErr && roleData?.is_abogado === true;
      const isSuperadmin = !roleErr && roleData?.is_superadmin === true;
      
      if (!isAdminExp && !isAbogado) {
        window.location.href = "/app";
        return;
      }

      // Guardar roles para mostrar botones de navegación
      setUserRoles({
        isSuperadmin: isSuperadmin || false,
        isAdminExpedientes: isAdminExp || false,
        isAbogado: isAbogado || false,
      });

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

      setLoading(false);
    })();
  }, []);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = () => setMenuOpen(false);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  // Buscar automáticamente en pjn-scraper cuando se complete jurisdicción, número y año
  useEffect(() => {
    const buscarExpediente = async () => {
      // Solo buscar si todos los campos están completos
      if (!jurisdiccion || !numeroExpediente.trim() || !añoExpediente.trim() || añoExpediente.length !== 4) {
        return;
      }

      setSearching(true);
      try {
        console.log("[Nueva Expediente] Buscando expediente:", { jurisdiccion, numero: numeroExpediente.trim(), año: añoExpediente.trim() });
        
        const response = await fetch("/api/search-expediente-pjn", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jurisdiccion,
            numero: numeroExpediente.trim(),
            año: añoExpediente.trim(),
          }),
        });

        if (!response.ok) {
          // Si es un error 500 o similar, intentar parsear como JSON primero
          try {
            const errorData = await response.json();
            console.log("[Nueva Expediente] Servicio de búsqueda no disponible:", errorData.message || "Servicio no configurado");
            // No mostrar error al usuario, simplemente no autocompletar
            return;
          } catch {
            const errorText = await response.text();
            console.error("[Nueva Expediente] Error al buscar expediente:", errorText);
            // No mostrar error al usuario si el servicio no está disponible
            return;
          }
        }

        const data = await response.json();
        console.log("[Nueva Expediente] Respuesta de API:", data);

        if (data.found) {
          // Autocompletar campos con los datos encontrados
          if (data.caratula) {
            setCaratula(data.caratula);
            console.log("[Nueva Expediente] Autocompletado caratula:", data.caratula);
          }
          if (data.juzgado) {
            setJuzgado(data.juzgado);
            console.log("[Nueva Expediente] Autocompletado juzgado:", data.juzgado);
          }
          if (data.fechaUltimaModificacion) {
            setFechaUltimaModificacion(data.fechaUltimaModificacion);
            console.log("[Nueva Expediente] Autocompletado fecha:", data.fechaUltimaModificacion);
          }
          if (data.observaciones) {
            setObservaciones(data.observaciones);
            console.log("[Nueva Expediente] Autocompletado observaciones:", data.observaciones);
          }
        } else {
          console.log("[Nueva Expediente] Expediente no encontrado en la base de datos");
        }
      } catch (error) {
        console.error("[Nueva Expediente] Error al buscar expediente:", error);
      } finally {
        setSearching(false);
      }
    };

    // Debounce: esperar 500ms después del último cambio antes de buscar
    const timeoutId = setTimeout(buscarExpediente, 500);
    return () => clearTimeout(timeoutId);
  }, [jurisdiccion, numeroExpediente, añoExpediente]);

  async function onSave() {
    setMsg("");

    if (!numeroExpediente.trim()) {
      setMsg("Falta completar Número de Expediente.");
      return;
    }
    if (!añoExpediente.trim() || añoExpediente.length !== 4) {
      setMsg("Falta completar el Año del Expediente (4 dígitos).");
      return;
    }
    if (!caratula.trim()) {
      setMsg("Falta completar Carátula.");
      return;
    }
    if (!fechaUltimaModificacion || fechaUltimaModificacion.trim() === "") {
      setMsg("Falta completar Fecha Última Modificación.");
      return;
    }

    // Convertir fecha del input (DD/MM/AAAA) a ISO
    const fechaISO = ddmmaaaaToISO(fechaUltimaModificacion);
    if (!fechaISO) {
      setMsg("La fecha ingresada no es válida. Use el formato DD/MM/AAAA.");
      return;
    }

    setSaving(true);
    try {
      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

      // Combinar número y año en formato NUMERO/AÑO
      const numeroCompleto = `${numeroExpediente.trim()}/${añoExpediente.trim()}`;

      let insertData: any = {
        owner_user_id: uid,
        caratula: caratula.trim(),
        juzgado: juzgado.trim() || null,
        numero_expediente: numeroCompleto,
        fecha_ultima_modificacion: fechaISO,
        estado: "ABIERTO",
        created_by_user_id: uid,
      };

      // Incluir observaciones siempre (incluso si está vacío, será null)
      // La columna debería existir después de ejecutar la migración
      if (observaciones.trim()) {
        insertData.observaciones = observaciones.trim();
      } else {
        insertData.observaciones = null;
      }

      console.log(`[Nueva Expediente] Guardando con observaciones:`, observaciones.trim() || "(vacío)");
      
      let { data: created, error: insErr } = await supabase
        .from("expedientes")
        .insert(insertData)
        .select("id")
        .single();

      // Si falla por columna observaciones inexistente, mostrar mensaje pero intentar sin ella
      if (insErr && (insErr.message?.includes("observaciones") || insErr.message?.includes("does not exist"))) {
        console.warn(`[Nueva Expediente] Columna observaciones no existe, guardando sin observaciones`);
        console.warn(`[Nueva Expediente] Error:`, insErr.message);
        
        // Guardar sin observaciones pero advertir al usuario
        delete insertData.observaciones;
        const { data: createdRetry, error: insErrRetry } = await supabase
          .from("expedientes")
          .insert(insertData)
          .select("id")
          .single();
        
        if (insErrRetry || !createdRetry?.id) {
          setMsg(insErrRetry?.message || "No se pudo crear el expediente.");
          return;
        }
        
        // Advertir que las observaciones no se guardaron
        if (observaciones.trim()) {
          setMsg(`Expediente creado, pero las observaciones no se guardaron porque la columna no existe en la base de datos. Por favor ejecuta la migración para agregar la columna observaciones.`);
        }
        
        created = createdRetry;
        insErr = null;
      } else if (insErr) {
        console.error(`[Nueva Expediente] Error al guardar:`, insErr);
      } else {
        console.log(`[Nueva Expediente] Expediente guardado exitosamente con ID:`, created?.id);
      }

      if (insErr || !created?.id) {
        setMsg(insErr?.message || "No se pudo crear el expediente.");
        return;
      }

      // Redirigir según el rol del usuario
      if (userRoles.isAbogado) {
        window.location.href = "/superadmin/mis-juzgados";
      } else {
        window.location.href = "/app/expedientes";
      }
    } finally {
      setSaving(false);
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
        <div className="page">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Cargar Expediente</h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
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
              
              {/* Botón menú hamburguesa */}
              {userRoles.isAbogado && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(!menuOpen);
                    }}
                    style={{
                      background: "rgba(96,141,186,.15)",
                      border: "1px solid rgba(96,141,186,.35)",
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
                      e.currentTarget.style.background = "rgba(96,141,186,.22)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(96,141,186,.15)";
                    }}
                  >
                    <div style={{
                      width: 20,
                      height: 2,
                      background: "var(--brand-blue-2)",
                      borderRadius: 1,
                      transition: "all 0.3s ease"
                    }} />
                    <div style={{
                      width: 20,
                      height: 2,
                      background: "var(--brand-blue-2)",
                      borderRadius: 1,
                      transition: "all 0.3s ease"
                    }} />
                    <div style={{
                      width: 20,
                      height: 2,
                      background: "var(--brand-blue-2)",
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
                        right: 0,
                        marginTop: 8,
                        background: "#ffffff",
                        border: "1px solid rgba(0,0,0,.12)",
                        borderRadius: 12,
                        padding: "12px 0",
                        minWidth: 220,
                        boxShadow: "0 8px 24px rgba(0,0,0,.15)",
                        zIndex: 1000
                      }}
                    >
                      <Link
                        href="/superadmin"
                        onClick={() => setMenuOpen(false)}
                        style={{
                          display: "block",
                          padding: "12px 20px",
                          color: "#1a1a1a",
                          textDecoration: "none",
                          fontSize: 14,
                          fontWeight: 600,
                          transition: "background 0.2s ease",
                          borderLeft: "3px solid transparent"
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(96,141,186,.08)";
                          e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderLeftColor = "transparent";
                        }}
                      >
                        📊 Dashboard
                      </Link>
                      <Link
                        href="/superadmin/mis-juzgados"
                        onClick={() => setMenuOpen(false)}
                        style={{
                          display: "block",
                          padding: "12px 20px",
                          color: "#1a1a1a",
                          textDecoration: "none",
                          fontSize: 14,
                          fontWeight: 600,
                          transition: "background 0.2s ease",
                          borderLeft: "3px solid transparent"
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(96,141,186,.08)";
                          e.currentTarget.style.borderLeftColor = "var(--brand-blue-2)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderLeftColor = "transparent";
                        }}
                      >
                        📋 Mis Juzgados
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {msg && <div className="error">{msg}</div>}

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <div className="field">
              <label className="label">
                Jurisdicción
                {searching && <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>(Buscando...)</span>}
              </label>
              <select
                className="input"
                value={jurisdiccion}
                onChange={(e) => setJurisdiccion(e.target.value)}
                disabled={saving}
              >
                <option value="">Seleccione una jurisdiccion</option>
                <option value="CSJ">CSJ - Corte Suprema de Justicia de la Nación</option>
                <option value="CIV">CIV - Cámara Nacional de Apelaciones en lo Civil</option>
                <option value="CAF">CAF - Cámara Nacional de Apelaciones en lo Contencioso Administrativo Federal</option>
                <option value="CCF">CCF - Cámara Nacional de Apelaciones en lo Civil y Comercial Federal</option>
                <option value="CNE">CNE - Cámara Nacional Electoral</option>
                <option value="CSS">CSS - Camara Federal de la Seguridad Social</option>
                <option value="CPE">CPE - Cámara Nacional de Apelaciones en lo Penal Económico</option>
                <option value="CNT">CNT - Cámara Nacional de Apelaciones del Trabajo</option>
                <option value="CFP">CFP - Camara Criminal y Correccional Federal</option>
                <option value="CCC">CCC - Camara Nacional de Apelaciones en lo Criminal y Correccional</option>
                <option value="COM">COM - Camara Nacional de Apelaciones en lo Comercial</option>
                <option value="CPF">CPF - Camara Federal de Casación Penal</option>
                <option value="CPN">CPN - Camara Nacional Casacion Penal</option>
              </select>
            </div>

            <div className="field">
              <label className="label">Número/Año</label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <input
                  type="text"
                  placeholder="Ej: 068809"
                  value={numeroExpediente}
                  onChange={(e) => {
                    // Solo permitir números
                    const value = e.target.value.replace(/[^\d]/g, "");
                    setNumeroExpediente(value);
                  }}
                  disabled={saving}
                  className="input"
                  style={{
                    flex: 1,
                  }}
                />
                <span style={{ color: "var(--text)", fontSize: "16px", fontWeight: 500 }}>/</span>
                <input
                  type="text"
                  placeholder="2017"
                  value={añoExpediente}
                  onChange={(e) => {
                    // Solo permitir números y máximo 4 dígitos
                    const value = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                    setAñoExpediente(value);
                  }}
                  disabled={saving}
                  maxLength={4}
                  className="input"
                  style={{
                    width: "80px",
                  }}
                />
              </div>
            </div>

            <div className="field">
              <label className="label">Carátula (obligatorio)</label>
              <input
                className="input"
                type="text"
                placeholder="Ej: Pérez c/ Gómez s/ daños"
                value={caratula}
                onChange={(e) => setCaratula(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="label">Juzgado</label>
              <input
                className="input"
                type="text"
                placeholder="Opcional"
                value={juzgado}
                onChange={(e) => setJuzgado(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="field">
              <label className="label">Fecha Última Modificación (obligatorio)</label>
              <input
                className="input"
                type="text"
                placeholder="DD/MM/AAAA"
                value={fechaUltimaModificacion}
                onChange={(e) => {
                  const formatted = formatDateInput(e.target.value);
                  setFechaUltimaModificacion(formatted);
                }}
                onBlur={(e) => {
                  // Validar formato completo al salir del campo
                  const value = e.target.value.trim();
                  if (value && value.length === 10) {
                    const iso = ddmmaaaaToISO(value);
                    if (!iso) {
                      setMsg("La fecha ingresada no es válida. Use el formato DD/MM/AAAA.");
                    } else {
                      setMsg("");
                    }
                  }
                }}
                disabled={saving}
                maxLength={10}
                style={{ fontVariantNumeric: "normal" }}
              />
            </div>

            <div className="field">
              <label className="label">Observaciones</label>
              <textarea
                className="input"
                placeholder="Observaciones opcionales..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                disabled={saving}
                rows={4}
                style={{
                  resize: "vertical",
                  minHeight: "80px",
                }}
              />
            </div>

            <div className="actions">
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Cargando…" : "Cargar"}
              </button>
              <Link href="/app/expedientes" className="btn">
                Cancelar
              </Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
