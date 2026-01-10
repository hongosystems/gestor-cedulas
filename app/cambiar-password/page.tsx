"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function CambiarPasswordPage() {
  const [checking, setChecking] = useState(true);
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/login";
        return;
      }

      const uid = sess.session.user.id;

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", uid)
        .single();

      if (error) {
        window.location.href = "/login";
        return;
      }

      // Si ya no necesita cambio, lo mandamos a su dashboard según su rol
      if (!prof?.must_change_password) {
        const { data: ok, error: superadminErr } = await supabase.rpc("is_superadmin");
        if (!superadminErr && ok) {
          window.location.href = "/superadmin";
          return;
        }
        
        // Verificar si es admin_expedientes (intentar función RPC primero, si falla verificar directamente)
        let isAdminExp = false;
        // Usar consulta directa para evitar errores 400
        const { data: roleData, error: roleErr } = await supabase
          .from("user_roles")
          .select("is_admin_expedientes")
          .eq("user_id", uid)
          .maybeSingle();
        
        isAdminExp = !roleErr && roleData?.is_admin_expedientes === true;
        
        if (isAdminExp) {
          window.location.href = "/app/expedientes";
          return;
        }
        
        window.location.href = "/app";
        return;
      }

      setChecking(false);
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (pass1.length < 8) {
      setMsg("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (pass1 !== pass2) {
      setMsg("Las contraseñas no coinciden.");
      return;
    }

    // 1) Cambiar password en Supabase Auth
    const { error: upErr } = await supabase.auth.updateUser({ password: pass1 });
    if (upErr) {
      setMsg(upErr.message);
      return;
    }

    // 2) Bajar el flag
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", uid);

      if (pErr) {
        setMsg(pErr.message);
        return;
      }
    }

    // 3) Forzar re-login
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (checking) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Validando sesión…</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <h1>Cambiar contraseña</h1>
          <div className="spacer" />
        </header>

        <div className="page">
          <p className="helper">
            Por seguridad, debés cambiar tu contraseña la primera vez que ingresás.
          </p>

          <form className="form narrow" onSubmit={save}>
            <div className="field">
              <div className="label">Nueva contraseña</div>
              <input
                className="input"
                type="password"
                value={pass1}
                onChange={(e) => setPass1(e.target.value)}
              />
            </div>

            <div className="field">
              <div className="label">Repetir nueva contraseña</div>
              <input
                className="input"
                type="password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
              />
            </div>

            <div className="actions">
              <button className="btn primary" type="submit">Guardar</button>
            </div>

            {msg && <div className="error">{msg}</div>}
          </form>
        </div>
      </section>
    </main>
  );
}
