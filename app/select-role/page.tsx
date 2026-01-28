"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function SelectRolePage() {
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<{
    isSuperadmin: boolean;
    isAdminExpedientes: boolean;
    isAdminCedulas: boolean;
    isAbogado: boolean;
  }>({
    isSuperadmin: false,
    isAdminExpedientes: false,
    isAdminCedulas: false,
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
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado")
        .eq("user_id", uid)
        .maybeSingle();

      if (roleErr || !roleData) {
        router.push("/app");
        return;
      }

      const isSuperadmin = roleData.is_superadmin === true;
      const isAdminExpedientes = roleData.is_admin_expedientes === true;
      const isAdminCedulas = roleData.is_admin_cedulas === true;
      const isAbogado = roleData.is_abogado === true;

      // Prioridad: si es Abogado o Superadmin, ir directo al Dashboard (sin pantalla intermedia)
      if (isSuperadmin || isAbogado) {
        router.push("/superadmin");
        return;
      }

      // Contar cuántos roles tiene
      const roleCount = [isSuperadmin, isAdminExpedientes, isAdminCedulas, isAbogado].filter(Boolean).length;

      // Si solo tiene un rol, redirigir automáticamente
      if (roleCount === 1) {
        if (isAdminExpedientes) {
          router.push("/app/expedientes");
          return;
        }
        if (isAdminCedulas) {
          router.push("/app");
          return;
        }
        router.push("/app");
        return;
      }

      // Si tiene múltiples roles, mostrar selección
      setRoles({
        isSuperadmin,
        isAdminExpedientes,
        isAdminCedulas,
        isAbogado,
      });
      setLoading(false);
    })();
  }, [router]);

  function selectRole(role: "superadmin" | "expedientes" | "cedulas" | "abogado") {
    // Guardar rol seleccionado en localStorage
    localStorage.setItem("selectedRole", role);
    
    if (role === "superadmin" || role === "abogado") {
      router.push("/superadmin");
    } else if (role === "expedientes") {
      router.push("/app/expedientes");
    } else if (role === "cedulas") {
      router.push("/app");
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

  const roleCount = [roles.isSuperadmin, roles.isAdminExpedientes, roles.isAdminCedulas, roles.isAbogado].filter(Boolean).length;

  if (roleCount <= 1) {
    return null; // Ya se redirigió
  }

  return (
    <main className="container">
      <section 
        className="card"
        style={{
          background: "linear-gradient(180deg, #0b2f55 0%, #071c2e 100%)",
          border: "1px solid rgba(255,255,255,.2)",
          boxShadow: "0 24px 48px rgba(0,0,0,.8), 0 8px 16px rgba(0,0,0,.6)",
        }}
      >
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
            {(roles.isSuperadmin || roles.isAbogado) && (
              <button
                className="btn primary"
                onClick={() => selectRole("superadmin")}
                style={{ padding: "16px 24px", fontSize: 16, textAlign: "left" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>DASHBOARD</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  {roles.isSuperadmin && roles.isAbogado 
                    ? "Vista de Superadmin / Abogado" 
                    : roles.isSuperadmin 
                    ? "Vista de Superadmin" 
                    : "Vista de Abogado"}
                </div>
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

            {roles.isAdminCedulas && (
              <button
                className="btn primary"
                onClick={() => selectRole("cedulas")}
                style={{ padding: "16px 24px", fontSize: 16, textAlign: "left" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>MIS CÉDULAS</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>Gestionar cédulas y oficios</div>
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
