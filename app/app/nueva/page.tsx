"use client";
import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function NuevaCedula() {
  const [caratula, setCaratula] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [notif, setNotif] = useState("");
  const [vto, setVto] = useState("");
  const [msg, setMsg] = useState("");

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) { window.location.href = "/login"; return; }

    const { error } = await supabase.from("cedulas").insert({
      owner_user_id: uid,
      caratula,
      juzgado: juzgado || null,
      fecha_notificacion: notif || null,
      fecha_vencimiento: vto,
      estado: "NUEVA",
    });

    if (error) { setMsg(error.message); return; }
    window.location.href = "/app";
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Nueva cédula</h1>
          <div className="spacer" />
          <Link className="btn" href="/app">Volver</Link>
        </header>

        <div className="page">
          <p className="helper">Completá los datos principales. El semáforo se calcula por días restantes.</p>

          <form className="form" onSubmit={crear}>
            <div className="grid2">
              <div className="field">
                <div className="label">Carátula</div>
                <input
                  className="input"
                  value={caratula}
                  onChange={(e) => setCaratula(e.target.value)}
                  placeholder="Ej: Pérez c/ Gómez s/ daños"
                  required
                />
              </div>

              <div className="field">
                <div className="label">Juzgado</div>
                <input
                  className="input"
                  value={juzgado}
                  onChange={(e) => setJuzgado(e.target.value)}
                  placeholder="Ej: Juzgado Civil y Comercial N° 3"
                />
              </div>
            </div>

            <div className="grid2">
              <div className="field">
                <div className="label">Fecha notificación</div>
                <input
                  className="input"
                  type="date"
                  value={notif}
                  onChange={(e) => setNotif(e.target.value)}
                />
              </div>

              <div className="field">
                <div className="label">Vencimiento</div>
                <input
                  className="input"
                  type="date"
                  value={vto}
                  onChange={(e) => setVto(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="actions">
              <button className="btn primary" type="submit">Guardar</button>
              <Link className="btn" href="/app">Cancelar</Link>
            </div>

            {msg && <div className="error">{msg}</div>}
          </form>
        </div>
      </section>
    </main>
  );
}
