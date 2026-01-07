"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_carga: string | null; // timestamptz ISO
  estado: string;
};

type Profile = { id: string; full_name: string | null; email: string | null };

// Reglas del cliente (fijas)
const UMBRAL_AMARILLO = 30; // desde 30 días => amarillo
const UMBRAL_ROJO = 60;     // desde 60 días => rojo

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

// ✅ Nunca mostramos ID. Prioridad: full_name > email > "Sin nombre"
function displayName(p?: Profile) {
  const name = (p?.full_name || "").trim();
  if (name) return name;
  const email = (p?.email || "").trim();
  if (email) return email;
  return "Sin nombre";
}

export default function SuperAdminPage() {
  const [checking, setChecking] = useState(true);
  const [msg, setMsg] = useState("");
  const [cedulas, setCedulas] = useState<Cedula[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  useEffect(() => {
    (async () => {
      // Auth guard
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { window.location.href = "/login"; return; }
      const uid = sess.session.user.id;

      // must_change_password guard
      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (pErr) { window.location.href = "/login"; return; }
      if (prof?.must_change_password) { window.location.href = "/cambiar-password"; return; }

      // superadmin guard
      const { data: ok, error: rpcErr } = await supabase.rpc("is_superadmin");
      if (rpcErr || !ok) { window.location.href = "/app"; return; }

      // profiles
      const { data: profs, error: profsErr } = await supabase
        .from("profiles")
        .select("id, full_name, email");

      if (profsErr) { setMsg(profsErr.message); setChecking(false); return; }

      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = p; });
      setProfiles(map);

      // cedulas abiertas
      const { data: cs, error: cErr } = await supabase
        .from("cedulas")
        .select("id, owner_user_id, caratula, juzgado, fecha_carga, estado")
        .neq("estado", "CERRADA")
        .order("fecha_carga", { ascending: true }); // más antiguas primero

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
      perUser[uid].maxDias = Math.max(perUser[uid].maxDias, dias); // antigüedad mayor = más crítico

      if (s === "ROJO") perUser[uid].rojos++;
      else if (s === "AMARILLO") perUser[uid].amarillos++;
      else perUser[uid].verdes++;
    }

    return Object.entries(perUser).map(([uid, v]) => ({
      uid,
      ...v,
      // ✅ acá forzamos full_name/email. Nunca ID.
      name: displayName(profiles[uid]),
    })).sort((a, b) =>
      (b.rojos - a.rojos) ||
      (b.amarillos - a.amarillos) ||
      (b.maxDias - a.maxDias) // más antigüedad primero
    );
  }, [cedulas, profiles]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (checking) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Cargando dashboard…</p></div>
        </section>
      </main>
    );
  }

  const totalAbiertas = cedulas.length;
  const totalRojas = ranking.reduce((a, r) => a + r.rojos, 0);
  const totalAmarillas = ranking.reduce((a, r) => a + r.amarillos, 0);
  const totalVerdes = ranking.reduce((a, r) => a + r.verdes, 0);

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Dashboard SuperAdmin</h1>
          <div className="spacer" />
          <Link className="btn" href="/superadmin/config">Config reportes</Link>
          <button className="btn danger" onClick={logout}>Salir</button>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="pill">Abiertas: <b>{totalAbiertas}</b></div>
            <div className="pill">Rojas: <b>{totalRojas}</b></div>
            <div className="pill">Amarillas: <b>{totalAmarillas}</b></div>
            <div className="pill">Verdes: <b>{totalVerdes}</b></div>
            <div className="pill">Amarillo desde <b>{UMBRAL_AMARILLO}</b> días</div>
            <div className="pill">Rojo desde <b>{UMBRAL_ROJO}</b> días</div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Usuario (Full Name)</th>
                  <th style={{ textAlign: "right" }}>ROJO</th>
                  <th style={{ textAlign: "right" }}>AMARILLO</th>
                  <th style={{ textAlign: "right" }}>VERDE</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Cédula más antigua (días)</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.uid}>
                    <td>{r.name}</td>
                    <td style={{ textAlign: "right" }}>{r.rojos}</td>
                    <td style={{ textAlign: "right" }}>{r.amarillos}</td>
                    <td style={{ textAlign: "right" }}>{r.verdes}</td>
                    <td style={{ textAlign: "right" }}>{r.total}</td>
                    <td style={{ textAlign: "right" }}>{r.maxDias < 0 ? "-" : r.maxDias}</td>
                  </tr>
                ))}
                {ranking.length === 0 && (
                  <tr><td colSpan={6} className="muted">No hay cédulas abiertas aún.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="helper" style={{ marginTop: 10 }}>
            Orden de prioridad: más ROJOS, luego AMARILLOS, luego mayor antigüedad desde la carga.
          </p>
        </div>
      </section>
    </main>
  );
}
