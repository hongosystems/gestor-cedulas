"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Cedula = {
  id: string;
  owner_user_id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_vencimiento: string; // YYYY-MM-DD
  estado: string;
};

type Profile = { id: string; full_name: string | null; email: string | null };

function daysBetweenToday(vtoISO: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(vtoISO); d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function semaforo(dias: number, umbralAmarillo: number, umbralRojo: number) {
  if (dias <= umbralRojo) return "ROJO";
  if (dias <= umbralAmarillo) return "AMARILLO";
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
  const [umbralAmarillo, setUmbralAmarillo] = useState(3);
  const [umbralRojo, setUmbralRojo] = useState(0);

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

      // thresholds
      const { data: st } = await supabase
        .from("settings")
        .select("umbral_amarillo, umbral_rojo")
        .eq("id", 1)
        .single();

      setUmbralAmarillo(st?.umbral_amarillo ?? 3);
      setUmbralRojo(st?.umbral_rojo ?? 0);

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
        .select("id, owner_user_id, caratula, juzgado, fecha_vencimiento, estado")
        .neq("estado", "CERRADA")
        .order("fecha_vencimiento", { ascending: true });

      if (cErr) { setMsg(cErr.message); setChecking(false); return; }

      setCedulas((cs ?? []) as Cedula[]);
      setChecking(false);
    })();
  }, []);

  const ranking = useMemo(() => {
    const perUser: Record<string, { rojos: number; amarillos: number; verdes: number; total: number; minDias: number }> = {};

    for (const c of cedulas) {
      const dias = daysBetweenToday(c.fecha_vencimiento);
      const s = semaforo(dias, umbralAmarillo, umbralRojo);
      const uid = c.owner_user_id;

      perUser[uid] ||= { rojos: 0, amarillos: 0, verdes: 0, total: 0, minDias: 9999 };
      perUser[uid].total++;
      perUser[uid].minDias = Math.min(perUser[uid].minDias, dias);

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
      (a.minDias - b.minDias)
    );
  }, [cedulas, profiles, umbralAmarillo, umbralRojo]);

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
            <div className="pill">Umbral Amarillo ≤ <b>{umbralAmarillo}</b> días</div>
            <div className="pill">Umbral Rojo ≤ <b>{umbralRojo}</b> días</div>
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
                  <th style={{ textAlign: "right" }}>Vto más cercano (días)</th>
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
                    <td style={{ textAlign: "right" }}>{r.minDias === 9999 ? "-" : r.minDias}</td>
                  </tr>
                ))}
                {ranking.length === 0 && (
                  <tr><td colSpan={6} className="muted">No hay cédulas abiertas aún.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="helper" style={{ marginTop: 10 }}>
            Orden de prioridad: más ROJOS, luego AMARILLOS, luego vencimiento más cercano.
          </p>
        </div>
      </section>
    </main>
  );
}
