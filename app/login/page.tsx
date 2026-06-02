"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { redirectAfterRoleCheck } from "@/lib/post-login-redirect";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.body.classList.add("auth-login-active");
    return () => document.body.classList.remove("auth-login-active");
  }, []);

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

      // Verificar todos los roles del usuario
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado, is_admin_mediaciones, is_mediador")
        .eq("user_id", uid)
        .maybeSingle();

      if (roleErr) {
        window.location.href = "/app";
        return;
      }

      redirectAfterRoleCheck(roleData);
    })();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) {
        setMsg(error.message);
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        window.location.href = "/login";
        return;
      }

      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (pErr) {
        setMsg(pErr.message);
        return;
      }

      if (prof?.must_change_password) {
        window.location.href = "/cambiar-password";
        return;
      }

      // Verificar todos los roles del usuario
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado, is_admin_mediaciones, is_mediador")
        .eq("user_id", uid)
        .maybeSingle();

      if (roleErr) {
        window.location.href = "/app";
        return;
      }

      redirectAfterRoleCheck(roleData);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-page__center">
        <section className="auth-card" aria-labelledby="auth-login-title">
          <header className="auth-card__header">
            <img className="auth-card__logo" src="/logo.png" alt="" width={56} height={56} />
            <div className="auth-card__brand">
              <span className="auth-card__brand-name">Estudio HIF — Sistemas</span>
              <h1 id="auth-login-title" className="auth-card__title">
                Ingreso
              </h1>
              <p className="auth-card__tagline">
                Gestión de cédulas, oficios y expedientes
              </p>
            </div>
          </header>

          <form className="auth-form" onSubmit={signIn} noValidate={false}>
            {msg ? (
              <div className="auth-alert auth-alert--error" role="alert">
                {msg}
              </div>
            ) : null}

            <div className="auth-field">
              <label className="auth-label" htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                className="auth-input"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                required
                disabled={submitting}
                placeholder="tu@correo.com"
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="login-password">
                Contraseña
              </label>
              <input
                id="login-password"
                className="auth-input"
                type="password"
                name="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                required
                disabled={submitting}
                placeholder="••••••••"
              />
            </div>

            <button
              className="auth-submit btn primary"
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Ingresando…" : "Ingresar"}
            </button>

            <p className="auth-help">
              Usá las credenciales asignadas por el estudio. Si no podés acceder, contactá a
              administración.
            </p>
          </form>
        </section>

        <p className="auth-page__footnote">Gestor de Cédulas · Estudio HIF</p>
      </div>
    </main>
  );
}
