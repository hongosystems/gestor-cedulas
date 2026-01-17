"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function WebMasterLoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;

      const uid = data.session.user.id;

      // Verificar que es superadmin
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin")
        .eq("user_id", uid)
        .maybeSingle();

      if (!roleErr && roleData?.is_superadmin === true) {
        window.location.href = "/webmaster";
        return;
      }
    })();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      setMsg(error.message);
      setLoading(false);
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) {
      setMsg("No se pudo obtener la sesión");
      setLoading(false);
      window.location.href = "/webmaster/login";
      return;
    }

    // Verificar que es superadmin
    const { data: roleData, error: roleErr } = await supabase
      .from("user_roles")
      .select("is_superadmin")
      .eq("user_id", uid)
      .maybeSingle();

    if (roleErr || !roleData || roleData.is_superadmin !== true) {
      await supabase.auth.signOut();
      setMsg("Acceso denegado. Solo usuarios con rol de SuperAdmin pueden acceder al Backoffice.");
      setLoading(false);
      return;
    }

    window.location.href = "/webmaster";
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <div>
            <h1 style={{ marginBottom: 2 }}>Backoffice - WebMaster</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              Acceso exclusivo para administradores
            </div>
          </div>
          <div className="spacer" />
        </header>

        <div className="page">
          <form className="form narrow" onSubmit={signIn}>
            <div className="field">
              <div className="label">Email</div>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="field">
              <div className="label">Contraseña</div>
              <input
                className="input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            <div className="actions">
              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? "Ingresando..." : "Ingresar"}
              </button>
            </div>

            {msg && <div className="error">{msg}</div>}
          </form>
        </div>
      </section>
    </main>
  );
}
