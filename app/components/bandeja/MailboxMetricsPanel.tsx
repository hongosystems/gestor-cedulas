"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Metrics = {
  threads: number;
  messages: number;
  unread: number;
  attachments: number;
  followers: number;
  messagesLast7Days: number;
  topUsersLast7Days: Array<{ userId: string; name: string; count: number }>;
};

export default function MailboxMetricsPanel() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/mailbox/metrics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Sin acceso");
        setLoading(false);
        return;
      }
      setMetrics(json);
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="helper">Cargando métricas de bandeja…</p>;
  if (error) return null;
  if (!metrics) return null;

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Bandeja (mailbox)</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {[
          ["Hilos", metrics.threads],
          ["Mensajes", metrics.messages],
          ["No leídos", metrics.unread],
          ["Adjuntos", metrics.attachments],
          ["Seguidores", metrics.followers],
          ["Msgs 7 días", metrics.messagesLast7Days],
        ].map(([label, val]) => (
          <div key={String(label)} style={{ padding: 10, background: "var(--surface-2, #f4f4f5)", borderRadius: 8 }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{val}</div>
          </div>
        ))}
      </div>
      {metrics.topUsersLast7Days.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 8px" }}>Top usuarios (7 días)</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {metrics.topUsersLast7Days.map((u) => (
              <li key={u.userId}>
                {u.name}: {u.count} mensajes
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
