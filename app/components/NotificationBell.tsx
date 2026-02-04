"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Notif = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const unread = items.filter((n) => !n.is_read).length;

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      const load = async () => {
        const { data } = await supabase
          .from("notifications")
          .select("id, title, body, link, is_read, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10);
        if (mounted) setItems((data ?? []) as Notif[]);
      };

      await load();

      // Realtime: suscripción a cambios
      channel = supabase
        .channel("notif")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => load()
        )
        .subscribe();
    })();

    return () => {
      mounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const handleBellClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Redirigir al inbox para TODOS los usuarios usando window.location para asegurar que funcione
    window.location.href = "/app/notificaciones";
  };

  // No mostrar la campanita si no hay sesión (página de login, etc.)
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      setHasSession(!!sess.session);
    })();
  }, []);

  if (!hasSession) {
    return null;
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={handleBellClick}
        aria-label="Notificaciones"
        style={{
          position: "relative",
          cursor: "pointer",
          background: "rgba(11,47,85,.95)",
          border: "1px solid rgba(255,255,255,.2)",
          borderRadius: 12,
          width: 48,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          color: "rgba(234,243,255,.95)",
          transition: "all 0.2s ease",
          boxShadow: "0 4px 12px rgba(0,0,0,.2)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(11,47,85,.98)";
          e.currentTarget.style.borderColor = "rgba(96,141,186,.5)";
          e.currentTarget.style.transform = "scale(1.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(11,47,85,.95)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,.2)";
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              borderRadius: 999,
              padding: "0 6px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              background: "var(--brand-red, #e13940)",
              color: "white",
              boxShadow: "0 2px 8px rgba(225,57,64,.5)",
              border: "2px solid rgba(11,47,85,.95)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
