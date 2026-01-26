"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pjnScraperSupabase } from "@/lib/pjn-scraper-supabase";
import { daysSince } from "@/lib/semaforo";

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
};

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

type SortField = "semaforo" | "fecha" | "dias" | null;
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
  const [juzgadoFilter, setJuzgadoFilter] = useState<"mis_juzgados" | "todos">("mis_juzgados");
  const [userJuzgados, setUserJuzgados] = useState<string[]>([]);
  const [isAbogado, setIsAbogado] = useState(false);

  const loadData = async () => {
    try {
      setMsg("");

      const session = await requireSessionOrRedirect();
      if (!session) return;

      const uid = session.user.id;

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

      // Obtener juzgados asignados al usuario
      const { data: juzgadosData, error: juzgadosErr } = await supabase
        .from("user_juzgados")
        .select("juzgado")
        .eq("user_id", uid);
      
      const juzgadosAsignados = juzgadosData && juzgadosData.length > 0 
        ? juzgadosData.map(j => j.juzgado)
        : [];
      
      setUserJuzgados(juzgadosAsignados);
      
      // Normalizar juzgados solo si el filtro es "mis_juzgados"
      let juzgadosNormalizados: string[] = [];
      if (juzgadoFilter === "mis_juzgados") {
        // Si no hay juzgados asignados y el filtro es "mis_juzgados", mostrar mensaje
        if (juzgadosAsignados.length === 0) {
          setMsg("No tienes juzgados asignados. Contacta al administrador o selecciona 'Todos los Juzgados'.");
          setLoading(false);
          return;
        }
        
        // Normalizar juzgados (eliminar espacios extra, normalizar a mayúsculas)
        juzgadosNormalizados = juzgadosAsignados.map(j => 
          j?.trim().replace(/\s+/g, " ").toUpperCase()
        );
        
        // Debug: mostrar juzgados asignados
        console.log(`[Mis Juzgados] Juzgados asignados (${juzgadosNormalizados.length}):`, juzgadosNormalizados);
      } else {
        console.log(`[Mis Juzgados] Filtro: "Todos los Juzgados" - Mostrando todos los datos sin filtrar por juzgados`);
      }

      // Función para normalizar juzgado para comparación
      const normalizarJuzgado = (j: string | null) => {
        if (!j) return "";
        return j.trim().replace(/\s+/g, " ").toUpperCase();
      };

      // Cargar todos los expedientes abiertos y filtrar por juzgados asignados
      // Intentar primero con todas las columnas (observaciones y created_by_user_id)
      let queryExps = supabase
        .from("expedientes")
        .select("id, owner_user_id, caratula, juzgado, numero_expediente, fecha_ultima_modificacion, estado, observaciones, created_by_user_id")
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
        const { data: favoritosData, error: favoritosErr } = await supabase
          .from("pjn_favoritos")
          .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga, observaciones")
          .order("updated_at", { ascending: false });
        
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
                      juzgado: c.dependencia || null,
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
      if (juzgadoFilter === "mis_juzgados" && juzgadosNormalizados.length > 0) {
        console.log(`[Mis Juzgados] Filtrando ${pjnFavoritos.length} favoritos por ${juzgadosNormalizados.length} juzgados asignados...`);
        
        favoritosFiltrados = pjnFavoritos.filter((f: PjnFavorito) => {
          if (!f.juzgado) {
            return false;
          }
          
          const juzgadoNormalizado = normalizarJuzgado(f.juzgado);
          
          const matched = juzgadosNormalizados.some(jAsignado => {
            // Comparación exacta normalizada
            if (juzgadoNormalizado === jAsignado) {
              return true;
            }
            
            // Comparación por número de juzgado (más flexible)
            const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
            const numFavorito = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
            
            if (numAsignado && numFavorito && numAsignado === numFavorito) {
              // Si ambos tienen el mismo número y contienen "Juzgado", considerarlos iguales
              if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
                return true;
              }
            }
            
            // Comparación más flexible: buscar si el juzgado asignado está contenido en el favorito o viceversa
            if (juzgadoNormalizado.includes(jAsignado) || jAsignado.includes(juzgadoNormalizado)) {
              // Verificar que ambos tengan al menos "JUZGADO" en común
              if (juzgadoNormalizado.includes("JUZGADO") && jAsignado.includes("JUZGADO")) {
                return true;
              }
            }
            
            return false;
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
          const juzgadoNormalizado = normalizarJuzgado(e.juzgado);
          return juzgadosNormalizados.some(jAsignado => {
            // Comparación exacta normalizada
            if (juzgadoNormalizado === jAsignado) return true;
            // Comparación parcial (por si hay pequeñas diferencias en formato)
            const numAsignado = jAsignado.match(/N[°º]\s*(\d+)/i)?.[1];
            const numExpediente = juzgadoNormalizado.match(/N[°º]\s*(\d+)/i)?.[1];
            if (numAsignado && numExpediente && numAsignado === numExpediente) {
              // Verificar que ambos contengan "Juzgado Nacional" y el mismo número
              if (jAsignado.includes("JUZGADO") && juzgadoNormalizado.includes("JUZGADO")) {
                return true;
              }
            }
            return false;
          }) ?? false;
        }) ?? [];
        console.log(`[Mis Juzgados] Expedientes filtrados por juzgados: ${exps.length} de ${allExpsData?.length || 0}`);
      } else if (juzgadoFilter === "todos") {
        // No filtrar, mostrar todos los expedientes
        exps = allExpsData ?? [];
        console.log(`[Mis Juzgados] Mostrando TODOS los expedientes: ${exps.length}`);
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

  const cedulasFiltered = useMemo(() => {
    return cedulas.filter(c => !c.tipo_documento || c.tipo_documento === "CEDULA");
  }, [cedulas]);

  const oficiosFiltered = useMemo(() => {
    return cedulas.filter(c => c.tipo_documento === "OFICIO");
  }, [cedulas]);

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
          observaciones: e.observaciones,
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
          pdf_path: o.pdf_path,
          tipo_documento: o.tipo_documento,
          observaciones: null,
          dias: o.fecha_carga ? daysSince(o.fecha_carga) : null,
          semaforo: o.fecha_carga ? semaforoByAge(daysSince(o.fecha_carga)) : "VERDE" as Semaforo,
        }));
    
    // Preparar items para mostrar (agregar observaciones si faltan)
    const itemsWithObservations = itemsToShow.map(item => ({
      ...item,
      observaciones: 'observaciones' in item ? item.observaciones : null
    }));

    // Ordenar items
    const sorted = [...itemsWithObservations];
    
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
      } else {
        return 0;
      }

      const diff = compareA - compareB;
      return currentSortDirection === "asc" ? diff : -diff;
    });

    return sorted;
  }, [activeTab, expedientes, cedulasFiltered, oficiosFiltered, sortField, sortDirection]);

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
    <main className="container">
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

            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "0.2px" }}>
                Mis Juzgados
              </h1>
              <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "rgba(234,243,255,.65)", fontWeight: 400 }}>
                Expedientes, cédulas y oficios de mis juzgados asignados
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
              opacity: loading ? 0.6 : 1
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
            <SemaforoChip value="VERDE" />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>0–29</span>
            <SemaforoChip value="AMARILLO" />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>30–59</span>
            <SemaforoChip value="ROJO" />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>60+ días</span>
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
            <table className="table">
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
                  <th>Juzgado</th>
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
                    <th style={{ width: 400 }}>Observaciones</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item: any) => {
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
                        <td style={{ fontSize: 13, maxWidth: 400 }}>
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
                              letterSpacing: "0.01em"
                            }}>
                              {item.observaciones}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {sortedItems.length === 0 && (
                  <tr>
                    <td colSpan={
                      activeTab === "expedientes" 
                        ? 8 
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
        </div>
      </section>
    </main>
  );
}
