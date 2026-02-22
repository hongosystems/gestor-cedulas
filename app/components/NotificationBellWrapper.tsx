"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import NotificationBell from "./NotificationBell";

export default function NotificationBellWrapper() {
  // Solo mostrar la campanita fija si no hay sesión (páginas de login, etc.)
  // En páginas con sesión, la campanita se renderiza inline en el header
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      setHasSession(!!sess.session);
    })();
  }, []);

  // No mostrar la campanita fija si hay sesión (ya está en el header)
  if (hasSession) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 80,
        right: 20,
        zIndex: 9999,
      }}
    >
      <NotificationBell />
    </div>
  );
}
