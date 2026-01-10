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

      const { data: ok, error: superadminErr } = await supabase.rpc("is_superadmin");
      if (!superadminErr && ok) {
        window.location.href = "/superadmin";
        return;
      }
      
      // Verificar si es admin_expedientes (intentar función RPC primero, si falla verificar directamente)
      let isAdminExp = false;
      const { data: rpcResult, error: adminExpErr } = await supabase.rpc("is_admin_expedientes");
      
      if (adminExpErr) {
        // Si la función RPC no existe o falla, verificar directamente en la tabla
        const { data: roleData, error: roleErr } = await supabase
          .from("user_roles")
          .select("is_admin_expedientes")
          .eq("user_id", uid)
          .maybeSingle();
        
        if (!roleErr && roleData) {
          isAdminExp = roleData.is_admin_expedientes === true;
        }
      } else {
        isAdminExp = rpcResult === true;
      }
      
      if (isAdminExp) {
        window.location.href = "/app/expedientes";
        return;
      }
      
      window.location.href = "/app";
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

    const { data: ok, error: superadminErr } = await supabase.rpc("is_superadmin");
    if (!superadminErr && ok) {
      window.location.href = "/superadmin";
      return;
    }
    
    // Verificar si es admin_expedientes (intentar función RPC primero, si falla verificar directamente)
    let isAdminExp = false;
    const { data: rpcResult, error: adminExpErr } = await supabase.rpc("is_admin_expedientes");
    
    if (adminExpErr) {
      // Si la función RPC no existe o falla, verificar directamente en la tabla
      console.warn("Función is_admin_expedientes falló, verificando directamente en tabla:", adminExpErr.message);
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_admin_expedientes")
        .eq("user_id", uid)
        .maybeSingle();
      
      if (!roleErr && roleData) {
        isAdminExp = roleData.is_admin_expedientes === true;
      }
    } else {
      isAdminExp = rpcResult === true;
    }
    
    if (isAdminExp) {
      window.location.href = "/app/expedientes";
      return;
    }
    
    window.location.href = "/app";
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <img className="logoLogin" src="/logo.png" alt="Estudio" />
          <div>
            <h1 style={{ marginBottom: 2 }}>Ingreso</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              Accedé a tu tablero de cédulas y vencimientos
            </div>
          </div>
          <div className="spacer" />
        </header>

        <div className="page">
          <form className="form narrow" onSubmit={signIn}>
            <div className="field">
              <div className="label">Email</div>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>

            <div className="field">
              <div className="label">Contraseña</div>
              <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
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
