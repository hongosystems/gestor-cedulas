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
      window.location.href = "/login";
    })();
  }, []);
  return null;
}
