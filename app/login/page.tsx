"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { data: ok } = await supabase.rpc("is_superadmin");
        window.location.href = ok ? "/superadmin" : "/app";
      }
    });
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) { setMsg(error.message); return; }

    // perfil (si existe)
    try {
      const { data: u } = await supabase.auth.getUser();
      const user = u.user;
      if (user) {
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email ?? null,
          full_name: (user.user_metadata?.full_name as string) ?? null,
        });
      }
    } catch {}

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
          <p className="helper">Accedé con tu usuario. Los SuperAdmin se redirigen automáticamente a su tablero.</p>

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
