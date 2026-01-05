"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { daysBetweenToday, semaforo } from "@/lib/semaforo";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string;
  juzgado: string | null;
  fecha_vencimiento: string;
  estado: "NUEVA" | "EN_CURSO" | "CERRADA";
};

type Profile = { id: string; full_name: string | null; email: string | null };

function badgeClass(sem: string) {
  if (sem === "ROJO") return "badge rojo";
  if (sem === "AMARILLO") return "badge amarillo";
  return "badge verde";
}

export default function SuperAdminPage() {
  const [ready, setReady] = useState(false);
  const [cfg, setCfg] = useState({ umbral_amarillo: 3, umbral_rojo: 0 });
  const [cedulas, setCedulas] = useState<Cedula[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [selectedUser, setSelectedUser] = useState<string>("");

  async function load() {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) { window.location.href = "/login"; return; }

    const { data: ok, error: rpcErr } = await supabase.rpc("is_superadmin");
    if (rpcErr || !ok) { window.location.href = "/app"; return; }

    const { data: st } = await supabase
      .from("settings")
      .select("umbral_amarillo, umbral_rojo")
      .eq("id", 1)
      .single();

    setCfg({
      umbral_amarillo: st?.umbral_amarillo ?? 3,
      umbral_rojo: st?.umbral_rojo ?? 0
    });

    const { data: ps } = await supabase.from("profiles").select("id,full_name,email");
    const map: Record<string, Profile> = {};
    (ps as any[] | null)?.forEach(p => map[p.id] = p);
    setProfiles(map);

    const { data: cs, error: cErr } = await supabase
      .from("cedulas")
      .select("id,owner_user_id,caratula,juzgado,fecha_vencimiento,estado")
      .neq("estado", "CERRADA");

    if (cErr) { alert(cErr.message); return; }
    setCedulas((cs as any) ?? []);
    setReady(true);
  }

  useEffect(() => { load(); }, []);

  const computed = useMemo(() => {
    const rows = cedulas.map(c => {
      const dias = daysBetweenToday(c.fecha_vencimiento);
      const sem = semaforo(dias, cfg.umbral_amarillo, cfg.umbral_rojo);
      return { ...c, dias, sem };
    });

    const byUser: Record<string, any> = {};
    for (const r of rows) {
      const u = r.owner_user_id;
      byUser[u] ||= { rojos: 0, amarillos: 0, verdes: 0, minDias: 9999, total: 0 };
      byUser[u].total++;
      byUser[u].minDias = Math.min(byUser[u].minDias, r.dias);
      if (r.sem === "ROJO") byUser[u].rojos++;
      else if (r.sem === "AMARILLO") byUser[u].amarillos++;
      else byUser[u].verdes++;
    }

    const ranking = Object.entries(byUser).map(([uid, v]) => ({
      uid,
      ...v,
      name: profiles[uid]?.full_name || profiles[uid]?.email || uid.slice(0, 8),
    })).sort((a: any, b: any) =>
      (b.rojos - a.rojos) ||
      (b.amarillos - a.amarillos) ||
      (a.minDias - b.minDias)
    );

    const filtered = selectedUser ? rows.filter(r => r.owner_user_id === selectedUser) : rows;

    filtered.sort((a: any, b: any) => {
      const rank = (s: string) => s === "ROJO" ? 0 : s === "AMARILLO" ? 1 : 2;
      return rank(a.sem) - rank(b.sem) || a.dias - b.dias;
    });

    return { ranking, filtered };
  }, [cedulas, profiles, cfg, selectedUser]);

  if (!ready) {
    return (
      <main className="container">
        <section className="card"><div className="form">Cargando…</div></section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>SuperAdmin · Tablero global</h1>
          <div className="spacer" />
          <Link className="btn" href="/superadmin/config">Config reportes</Link>
          <Link className="btn danger" href="/logout">Salir</Link>
        </header>

        <div className="tableWrap">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
              Ranking por prioridad: más ROJOS primero, luego AMARILLOS, luego vencimiento más cercano.
            </span>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>ROJO</th>
                <th>AMARILLO</th>
                <th>VERDE</th>
                <th>Total</th>
                <th>Vto más cercano (días)</th>
                <th>Ver detalle</th>
              </tr>
            </thead>
            <tbody>
              {computed.ranking.map((u: any) => (
                <tr key={u.uid}>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.rojos}</td>
                  <td>{u.amarillos}</td>
                  <td>{u.verdes}</td>
                  <td>{u.total}</td>
                  <td>{u.minDias === 9999 ? <span className="muted">—</span> : u.minDias}</td>
                  <td>
                    <button className="btn" type="button" onClick={() => setSelectedUser(u.uid)}>
                      Ver cédulas
                    </button>
                  </td>
                </tr>
              ))}
              {computed.ranking.length === 0 && (
                <tr><td colSpan={7} className="muted">No hay cédulas abiertas.</td></tr>
              )}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 14, marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>
              Detalle {selectedUser ? "del usuario" : "de todos"} (ordenado por riesgo)
            </h2>
            <div className="spacer" />
            {selectedUser && (
              <button className="btn" type="button" onClick={() => setSelectedUser("")}>
                Ver todos
              </button>
            )}
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Semáforo</th>
                <th>Usuario</th>
                <th>Carátula</th>
                <th>Juzgado</th>
                <th>Vencimiento</th>
                <th>Días</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {computed.filtered.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <span className={badgeClass(r.sem)}>
                      <span className="dot" />
                      {r.sem}
                    </span>
                  </td>
                  <td className="muted">
                    {(profiles[r.owner_user_id]?.full_name || profiles[r.owner_user_id]?.email || r.owner_user_id.slice(0, 8))}
                  </td>
                  <td><strong>{r.caratula}</strong></td>
                  <td>{r.juzgado ?? <span className="muted">—</span>}</td>
                  <td>{r.fecha_vencimiento}</td>
                  <td>{r.dias}</td>
                  <td>{r.estado}</td>
                </tr>
              ))}
              {computed.filtered.length === 0 && (
                <tr><td colSpan={7} className="muted">No hay filas para mostrar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
