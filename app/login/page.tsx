"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;

      const uid = data.session.user.id;
      const { data: prof } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (prof?.must_change_password) {
        window.location.href = "/cambiar-password";
        return;
      }

      const { data: ok } = await supabase.rpc("is_superadmin");
      window.location.href = ok ? "/superadmin" : "/app";
    })();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) { setMsg(error.message); return; }

    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { window.location.href = "/login"; return; }

    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", uid)
      .single();

    if (pErr) { setMsg(pErr.message); return; }

    if (prof?.must_change_password) {
      window.location.href = "/cambiar-password";
      return;
    }

    const { data: ok, error: rpcErr } = await supabase.rpc("is_superadmin");
    if (rpcErr) { window.location.href = "/app"; return; }

    window.location.href = ok ? "/superadmin" : "/app";
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Ingresar</h1>
          <div className="spacer" />
        </header>

        <div className="page">
          <p className="helper">Ingresá con tu usuario. Si es tu primera vez, se te pedirá cambiar la contraseña.</p>

          <form className="form narrow" onSubmit={signIn}>
            <div className="field">
              <div className="label">Email</div>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
              />
            </div>

            <div className="field">
              <div className="label">Contraseña</div>
              <input
                className="input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            <div className="actions">
              <button className="btn primary" type="submit">Ingresar</button>
            </div>

            {msg && <div className="error">{msg}</div>}
          </form>
        </div>
      </section>
    </main>
  );
}
