"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Prefs = {
  enabled: boolean;
  frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  weekday: number;
  hour: number;
  timezone: string;
  email_to: string;
};

const weekdays = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

export default function SuperAdminConfigPage() {
  const [checking, setChecking] = useState(true);
  const [msg, setMsg] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({
    enabled: true,
    frequency: "WEEKLY",
    weekday: 1,
    hour: 8,
    timezone: "America/Argentina/Buenos_Aires",
    email_to: "",
  });

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { window.location.href = "/login"; return; }

      const { data: ok, error: rpcErr } = await supabase.rpc("is_superadmin");
      if (rpcErr || !ok) { window.location.href = "/app"; return; }

      const { data, error } = await supabase
        .from("admin_digest_prefs")
        .select("enabled,frequency,weekday,hour,timezone,email_to")
        .maybeSingle();

      if (error) {
        setMsg("Todavía no existe la tabla admin_digest_prefs en Supabase. (Falta crear DB)");
      } else if (data) {
        setPrefs(data as any);
      }

      setChecking(false);
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) { window.location.href = "/login"; return; }

    const { error } = await supabase.from("admin_digest_prefs").upsert({
      user_id: user.id,
      ...prefs,
    });

    if (error) { setMsg(error.message); return; }
    setMsg("Guardado.");
  }

  if (checking) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Validando acceso…</p></div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>SuperAdmin · Configuración de reportes</h1>
          <div className="spacer" />
          <Link className="btn" href="/superadmin">Volver</Link>
          <Link className="btn danger" href="/logout">Salir</Link>
        </header>

        <div className="page">
          <p className="helper">
            Definí a quién se envían reportes y cada cuánto. (Luego lo conectamos con Cron + Resend para que llegue por mail.)
          </p>

          <form className="form" onSubmit={save}>
            <div className="field">
              <div className="label">Email destino (varios separados por coma)</div>
              <input
                className="input"
                value={prefs.email_to}
                onChange={(e) => setPrefs({ ...prefs, email_to: e.target.value })}
                placeholder="admin@estudio.com, socio@estudio.com"
              />
              <div className="note">Separá con comas. Ej: admin@..., socio@...</div>
            </div>

            <div className="grid2">
              <div className="field">
                <div className="label">Enviar reportes</div>
                <select
                  className="select"
                  value={prefs.enabled ? "on" : "off"}
                  onChange={(e) => setPrefs({ ...prefs, enabled: e.target.value === "on" })}
                >
                  <option value="on">Activado</option>
                  <option value="off">Desactivado</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Frecuencia</div>
                <select
                  className="select"
                  value={prefs.frequency}
                  onChange={(e) => setPrefs({ ...prefs, frequency: e.target.value as any })}
                >
                  <option value="WEEKLY">Semanal</option>
                  <option value="BIWEEKLY">Quincenal</option>
                  <option value="MONTHLY">Mensual</option>
                </select>
              </div>
            </div>

            <div className="grid2">
              <div className="field">
                <div className="label">Día de envío (semanal/quincenal)</div>
                <select
                  className="select"
                  value={prefs.weekday}
                  onChange={(e) => setPrefs({ ...prefs, weekday: Number(e.target.value) })}
                >
                  {weekdays.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                </select>
              </div>

              <div className="field">
                <div className="label">Hora (0–23)</div>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={23}
                  value={prefs.hour}
                  onChange={(e) => setPrefs({ ...prefs, hour: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field">
              <div className="label">Timezone</div>
              <input
                className="input"
                value={prefs.timezone}
                onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
              />
            </div>

            <div className="actions">
              <button className="btn primary" type="submit">Guardar</button>
            </div>

            {msg && (
              <div className={msg === "Guardado." ? "success" : "error"}>
                {msg}
              </div>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
