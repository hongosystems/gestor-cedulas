"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null;
  estado: string;
};

type Profile = { id: string; full_name: string | null; email: string | null };

const UMBRAL_AMARILLO = 30;
const UMBRAL_ROJO = 60;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
    const points = trend === "up" 
      ? "M 2 18 L 8 12 L 14 10 L 20 6 L 26 4"
      : "M 2 4 L 8 8 L 14 10 L 20 14 L 26 16";
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
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { window.location.href = "/login"; return; }
      const uid = sess.session.user.id;

      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (pErr) { window.location.href = "/login"; return; }
      if (prof?.must_change_password) { window.location.href = "/cambiar-password"; return; }

      const { data: ok, error: rpcErr } = await supabase.rpc("is_superadmin");
      if (rpcErr || !ok) { window.location.href = "/app"; return; }

      const { data: profs, error: profsErr } = await supabase
        .from("profiles")
        .select("id, full_name, email");

      if (profsErr) { setMsg(profsErr.message); setChecking(false); return; }

      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = p; });
      setProfiles(map);

      const { data: cs, error: cErr } = await supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado")
        .neq("estado", "CERRADA")
        .order("fecha_carga", { ascending: true });

      if (cErr) { setMsg(cErr.message); setChecking(false); return; }

      setCedulas((cs ?? []) as Cedula[]);
      setChecking(false);
    })();
  }, []);

  const ranking = useMemo(() => {
    const perUser: Record<string, { rojos: number; amarillos: number; verdes: number; total: number; maxDias: number }> = {};

    for (const c of cedulas) {
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

    return Object.entries(perUser).map(([uid, v]) => ({
      uid,
      ...v,
      name: displayName(profiles[uid]),
    })).sort((a, b) =>
      (b.rojos - a.rojos) ||
      (b.amarillos - a.amarillos) ||
      (b.maxDias - a.maxDias)
    );
  }, [cedulas, profiles]);

  const metrics = useMemo(() => {
    const totalAbiertas = cedulas.length;
    const totalRojas = ranking.reduce((a, r) => a + r.rojos, 0);
    const totalAmarillas = ranking.reduce((a, r) => a + r.amarillos, 0);
    const totalVerdes = ranking.reduce((a, r) => a + r.verdes, 0);
    const totalUsuarios = ranking.length;
    const promedioPorUsuario = totalUsuarios > 0 ? (totalAbiertas / totalUsuarios).toFixed(1) : "0";
    
    const pctRojas = totalAbiertas > 0 ? ((totalRojas / totalAbiertas) * 100).toFixed(1) : "0";
    const pctAmarillas = totalAbiertas > 0 ? ((totalAmarillas / totalAbiertas) * 100).toFixed(1) : "0";
    const pctVerdes = totalAbiertas > 0 ? ((totalVerdes / totalAbiertas) * 100).toFixed(1) : "0";
    
    const maxDias = ranking.length > 0 ? Math.max(...ranking.map(r => r.maxDias)) : 0;
    
    return {
      totalAbiertas,
      totalRojas,
      totalAmarillas,
      totalVerdes,
      totalUsuarios,
      promedioPorUsuario,
      pctRojas,
      pctAmarillas,
      pctVerdes,
      maxDias,
    };
  }, [cedulas, ranking]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
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
        flexWrap: "wrap"
      }}>
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link 
            href="/superadmin/config" 
            style={{
              padding: "10px 16px",
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.16)",
              borderRadius: 10,
              color: "var(--text)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
              transition: "all 0.2s ease",
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
            ⚙️ Config reportes
          </Link>
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

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ 
            margin: "0 0 20px 0", 
            fontSize: 18, 
            fontWeight: 600, 
            color: "var(--text)",
            letterSpacing: "0.3px"
          }}>
            Métricas generales
          </h2>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20
          }}>
            <KPICard
              title="Cédulas Abiertas"
              value={metrics.totalAbiertas}
              color="blue"
              trend={metrics.totalAbiertas > 0 ? "up" : undefined}
            />
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
            <KPICard
              title="Total de Usuarios"
              value={metrics.totalUsuarios}
              color="blue"
            />
            <KPICard
              title="Promedio por Usuario"
              value={metrics.promedioPorUsuario}
              subValue="cédulas"
              color="orange"
            />
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
