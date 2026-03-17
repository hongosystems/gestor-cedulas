"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Logout() {
  useEffect(() => {
    (async () => {
      // Limpiar estado de conexión PJN
      try {
        localStorage.removeItem("pjnConnected");
        localStorage.removeItem("pjnConnectedTimestamp");
      } catch (e) {
        // Ignorar errores de localStorage
      }
      
      await supabase.auth.signOut();

      // Limpiar keys de auth de Supabase explícitamente para evitar race condition
      // (la sesión puede no borrarse antes del redirect y causar re-login automático)
      try {
        localStorage.removeItem("sb-auth-token");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (supabaseUrl) {
          const projectId = supabaseUrl.split("//")[1]?.split(".")[0];
          if (projectId) {
            localStorage.removeItem(`sb-${projectId}-auth-token`);
          }
        }
      } catch (e) {
        // Ignorar errores de localStorage
      }

      window.location.href = "/login";
    })();
  }, []);
  return null;
}
