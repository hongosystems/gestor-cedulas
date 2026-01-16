"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function SelectRolePage() {
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAbogado: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAbogado: false,
  });
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login");
        return;
      }

      const uid = data.session.user.id;

      // Verificar roles del usuario
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_abogado")
        .eq("user_id", uid)
        .maybeSingle();

      if (roleErr || !roleData) {
        router.push("/app");
        return;
      }

      const isSuperadmin = roleData.is_superadmin === true;
      const isAdminExpedientes = roleData.is_admin_expedientes === true;
      const isAbogado = roleData.is_abogado === true;

      // Contar cuántos roles tiene
      const roleCount = [isSuperadmin, isAdminExpedientes, isAbogado].filter(Boolean).length;

      // Si solo tiene un rol, redirigir automáticamente
      // Todos los ABOGADO son SuperAdmin y todos los SuperAdmin son ABOGADO
      if (roleCount === 1) {
        if (isSuperadmin || isAbogado) {
          router.push("/superadmin");
          return;
        }
        if (isAdminExpedientes) {
          router.push("/app/expedientes");
          return;
        }
        router.push("/app");
        return;
      }

      // Si tiene múltiples roles, mostrar selección
      setRoles({
        isSuperadmin,
        isAdminExpedientes,
        isAbogado,
      });
      setLoading(false);
    })();
  }, [router]);

  function selectRole(role: "superadmin" | "expedientes" | "abogado") {
    // Guardar rol seleccionado en localStorage
    localStorage.setItem("selectedRole", role);
    
    if (role === "superadmin" || role === "abogado") {
      router.push("/superadmin");
    } else if (role === "expedientes") {
      router.push("/app/expedientes");
    } else {
      router.push("/app");
    }
  }

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Cargando…</p>
          </div>
        </section>
      </main>
    );
  }

  const roleCount = [roles.isSuperadmin, roles.isAdminExpedientes, roles.isAbogado].filter(Boolean).length;

  if (roleCount <= 1) {
    return null; // Ya se redirigió
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <img className="logoMini" src="/logo.png" alt="Logo" />
          <h1>Seleccionar Vista</h1>
          <div className="spacer" />
        </header>

        <div className="page">
          <div style={{ marginBottom: 24 }}>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              Tienes acceso a múltiples áreas. Selecciona la vista que deseas usar:
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {roles.isSuperadmin && (
              <button
                className="btn primary"
                onClick={() => selectRole("superadmin")}
                style={{ padding: "16px 24px", fontSize: 16, textAlign: "left" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>DASHBOARD</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>Vista de Superadmin</div>
              </button>
            )}

            {roles.isAdminExpedientes && (
              <button
                className="btn primary"
                onClick={() => selectRole("expedientes")}
                style={{ padding: "16px 24px", fontSize: 16, textAlign: "left" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>EXPEDIENTES</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>Gestionar expedientes</div>
              </button>
            )}
            {roles.isAbogado && (
              <button
                className="btn primary"
                onClick={() => selectRole("superadmin")}
                style={{ padding: "16px 24px", fontSize: 16, textAlign: "left" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>DASHBOARD</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>Dashboard SuperAdmin (página principal)</div>
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
