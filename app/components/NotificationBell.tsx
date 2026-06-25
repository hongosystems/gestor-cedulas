"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchUnreadBadgeCounts } from "@/lib/unread-notifications-client";
import type { UnreadBadgeCounts } from "@/lib/unread-notifications";

type NotificationBellProps = {
  /** inline = campana en páginas legacy; topbar = shell global */
  variant?: "inline" | "topbar";
};

export default function NotificationBell({ variant = "inline" }: NotificationBellProps) {
  const [counts, setCounts] = useState<UnreadBadgeCounts>({
    total: 0,
    mailbox: 0,
    app: 0,
    workflow: false,
  });

  const refreshCounts = useCallback(async () => {
    try {
      const next = await fetchUnreadBadgeCounts();
      setCounts(next);
    } catch {
      /* sin sesión o API no disponible */
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const load = async () => {
      if (!mounted) return;
      await refreshCounts();
    };

    const onFocus = () => {
      void load();
    };

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      await load();

      channel = supabase
        .channel("notif-badge")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          () => load()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "mailbox_recipients", filter: `user_id=eq.${uid}` },
          () => load()
        )
        .subscribe();
    })();

    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refreshCounts]);

  const handleBellClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let href = "/app/bandeja?tab=recibidos";
    if (counts.workflow) {
      // Menciones y alertas de sistema: priorizar Alertas (responder ahí).
      if (counts.app > 0) href = "/app/bandeja?tab=alertas";
      else if (counts.mailbox > 0) href = "/app/bandeja?tab=no-leidas";
    } else if (counts.total > 0) {
      href = "/app/bandeja?tab=no-leidas";
    }

    window.location.href = href;
  };

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

  const unread = counts.total;

  return (
    <div style={{ position: "relative" }} data-notification-bell={variant}>
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
