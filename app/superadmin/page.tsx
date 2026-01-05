"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SuperAdminPage() {
  const [checking, setChecking] = useState(true);
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

      const { data: ok, error: rpcErr } = await supabase.rpc("is_superadmin");
      if (rpcErr || !ok) { window.location.href = "/app"; return; }

      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <main className="container">
        <section className="card">
          <div className="page"><p className="helper">Validando SuperAdmin…</p></div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Dashboard SuperAdmin</h1>
          <div className="spacer" />
          <Link className="btn" href="/superadmin/config">Config reportes</Link>
          <Link className="btn danger" href="/logout">Salir</Link>
        </header>

        <div className="page">
          {msg && <div className="error">{msg}</div>}
          <p className="helper">Acá vamos a mostrar el ranking por rojos/amarillos/verdes por usuario.</p>
        </div>
      </section>
    </main>
  );
}
