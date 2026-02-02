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

function fmtTime(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
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

  async function markRead(id: string, link: string | null) {
    await supabase.rpc("mark_notification_read", { p_id: id });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setOpen(false);
    if (link) window.location.href = link;
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificaciones"
        style={{ position: "relative" }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              borderRadius: 999,
              padding: "0 6px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--brand, #0ea5e9)",
              color: "white",
            }}
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 44,
            width: 360,
            maxWidth: "80vw",
            zIndex: 50,
            background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
            border: "1px solid rgba(255,255,255,.2)",
            borderRadius: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.1) inset",
            backdropFilter: "blur(20px)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <b style={{ color: "var(--text)", fontSize: 16 }}>Notificaciones</b>
              <div className="spacer" />
              <button 
                className="btn" 
                onClick={() => setOpen(false)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: "rgba(255,255,255,.1)",
                  border: "1px solid rgba(255,255,255,.2)",
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={{ display: "grid", gap: 10, maxHeight: "400px", overflowY: "auto" }}>
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id, n.link)}
                  style={{
                    textAlign: "left",
                    border: n.is_read 
                      ? "1px solid rgba(255,255,255,.15)" 
                      : "1px solid rgba(96,141,186,.4)",
                    borderRadius: 12,
                    padding: 12,
                    background: n.is_read 
                      ? "rgba(255,255,255,.04)" 
                      : "rgba(96,141,186,.15)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    color: "var(--text)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = n.is_read 
                      ? "rgba(255,255,255,.08)" 
                      : "rgba(96,141,186,.25)";
                    e.currentTarget.style.borderColor = n.is_read 
                      ? "rgba(255,255,255,.25)" 
                      : "rgba(96,141,186,.5)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = n.is_read 
                      ? "rgba(255,255,255,.04)" 
                      : "rgba(96,141,186,.15)";
                    e.currentTarget.style.borderColor = n.is_read 
                      ? "rgba(255,255,255,.15)" 
                      : "rgba(96,141,186,.4)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(234,243,255,.85)", marginBottom: 6 }}>
                    {n.body}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(234,243,255,.6)" }}>
                    {fmtTime(n.created_at)}
                  </div>
                </button>
              ))}
              {items.length === 0 && (
                <div style={{ 
                  padding: 20, 
                  textAlign: "center", 
                  color: "rgba(234,243,255,.6)",
                  fontSize: 13 
                }}>
                  No hay notificaciones.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
