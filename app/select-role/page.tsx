"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getHomeHref, roleRowToFlags } from "@/lib/shell-nav";
import { supabase } from "@/lib/supabase";

/**
 * Ruta legacy: ya no se usa como paso obligatorio tras login.
 * Redirige al home según roles; el menú lateral muestra todos los módulos.
 */
export default function SelectRolePage() {
  const router = useRouter();
  const [homeHref, setHomeHref] = useState("/app");
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }

      const uid = data.session.user.id;
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado, is_admin_mediaciones, is_mediador")
        .eq("user_id", uid)
        .maybeSingle();

      const href =
        roleErr || !roleData ? "/app" : getHomeHref(roleRowToFlags(roleData));
      setHomeHref(href);
      router.replace(href);
      setRedirecting(false);
    })();
  }, [router]);

  return (
    <main className="auth-page">
      <div className="auth-page__center">
        <section className="auth-card" style={{ textAlign: "center" }}>
          {redirecting ? (
            <p className="helper" style={{ margin: 0 }}>
              Redirigiendo…
            </p>
          ) : (
            <>
              <h1 className="auth-card__title" style={{ marginBottom: 12 }}>
                Selección de vista
              </h1>
              <p className="auth-card__tagline" style={{ marginBottom: 24 }}>
                La elección de módulo ahora se hace desde el menú lateral. Si no fuiste
                redirigido automáticamente, usá el botón de abajo.
              </p>
              <Link href={homeHref} className="auth-submit btn primary" style={{ display: "inline-block" }}>
                Ir al inicio
              </Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
