"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Cedula = {
  id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha_vencimiento: string;
  estado: string;
  owner_user_id: string;
};

export default function MisCedulasPage() {
  const [checking, setChecking] = useState(true);
  const [rows, setRows] = useState<Cedula[]>([]);
  const [msg, setMsg] = useState("");

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

      const { data, error } = await supabase
        .from("cedulas")
        .select("id, caratula, juzgado, fecha_vencimiento, estado, owner_user_id")
        .eq("owner_user_id", uid)
        .order("fecha_vencimiento", { ascending: true });

      if (error) setMsg(error.message);
      else setRows((data ?? []) as Cedula[]);

      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Cargando…</p></div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Mis cédulas</h1>
          <div className="spacer" />
          <Link className="btn primary" href="/app/nueva">Nueva</Link>
          <Link className="btn danger" href="/logout">Salir</Link>
        </header>

        <div className="tableWrap">
          {msg && <div className="error">{msg}</div>}

          <table className="table">
            <thead>
              <tr>
                <th>Carátula</th>
                <th>Juzgado</th>
                <th>Vencimiento</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.caratula ?? "-"}</td>
                  <td className="muted">{r.juzgado ?? "-"}</td>
                  <td>{r.fecha_vencimiento}</td>
                  <td className="muted">{r.estado}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="muted">No hay cédulas todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
