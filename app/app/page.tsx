"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { daysBetweenToday, semaforo } from "@/lib/semaforo";

type Cedula = {
  id: string;
  caratula: string;
  juzgado: string | null;
  fecha_vencimiento: string;
  estado: "NUEVA" | "EN_CURSO" | "CERRADA";
  storage_path: string | null;
};

function badgeClass(sem: string) {
  if (sem === "ROJO") return "badge rojo";
  if (sem === "AMARILLO") return "badge amarillo";
  return "badge verde";
}

export default function MisCedulas() {
  const [cfg, setCfg] = useState({ umbral_amarillo: 3, umbral_rojo: 0 });
  const [cedulas, setCedulas] = useState<Cedula[]>([]);

  async function load() {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) { window.location.href = "/login"; return; }

    // Si es superadmin, no usa este dashboard
    try {
      const { data: ok } = await supabase.rpc("is_superadmin");
      if (ok) { window.location.href = "/superadmin"; return; }
    } catch {}

    const { data: st } = await supabase
      .from("settings")
      .select("umbral_amarillo, umbral_rojo")
      .eq("id", 1)
      .single();

    setCfg({
      umbral_amarillo: st?.umbral_amarillo ?? 3,
      umbral_rojo: st?.umbral_rojo ?? 0
    });

    const { data, error } = await supabase
      .from("cedulas")
      .select("id,caratula,juzgado,fecha_vencimiento,estado,storage_path")
      .order("fecha_vencimiento", { ascending: true });

    if (error) { alert(error.message); return; }
    setCedulas((data as any) ?? []);
  }

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => cedulas.map(c => {
    const dias = daysBetweenToday(c.fecha_vencimiento);
    return { ...c, dias, sem: semaforo(dias, cfg.umbral_amarillo, cfg.umbral_rojo) };
  }), [cedulas, cfg]);

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Mis cédulas</h1>
          <div className="spacer" />
          <Link className="btn primary" href="/app/nueva">+ Nueva</Link>
          <Link className="btn danger" href="/logout">Salir</Link>
        </header>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Semáforo</th>
                <th>Carátula</th>
                <th>Juzgado</th>
                <th>Vencimiento</th>
                <th>Días</th>
                <th>Estado</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <span className={badgeClass(r.sem)}>
                      <span className="dot" />
                      {r.sem}
                    </span>
                  </td>
                  <td>
                    <strong>{r.caratula}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      ID: {r.id.slice(0, 8)}
                    </div>
                  </td>
                  <td>{r.juzgado ?? <span className="muted">—</span>}</td>
                  <td>{r.fecha_vencimiento}</td>
                  <td>{r.dias}</td>
                  <td>{r.estado}</td>
                  <td>{r.storage_path ? "OK" : <span className="muted">—</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">No hay cédulas todavía. Tocá “Nueva”.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
