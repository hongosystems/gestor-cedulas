"use client";

import React, { useState } from "react";

type Usuario = { id: string; nombre: string; email?: string };

const AVATAR_COLORS = [
  "#e53935", "#d81b60", "#8e24aa", "#5e35b1",
  "#3949ab", "#1e88e5", "#039be5", "#00acc1",
  "#00897b", "#43a047", "#7cb342", "#c0ca33",
];

function getInitials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h) + id.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

export default function ResponsableAvatars({ usuarios }: { usuarios: Usuario[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (!usuarios || usuarios.length === 0) {
    return <span className="muted" style={{ fontSize: 12 }}>—</span>;
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 28,
        verticalAlign: "middle",
      }}
    >
      {usuarios.map((u, idx) => (
        <div
          key={u.id}
          onMouseEnter={() => setHovered(u.id)}
          onMouseLeave={() => setHovered(null)}
          style={{
            position: "relative",
            marginLeft: idx > 0 ? -6 : 0,
          }}
        >
          <span
            title={u.nombre}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: colorForId(u.id),
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              border: "2px solid var(--bg, #0f1a2a)",
              cursor: "default",
              flexShrink: 0,
            }}
          >
            {getInitials(u.nombre)}
          </span>
          {hovered === u.id && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "100%",
                transform: "translateX(-50%)",
                marginBottom: 6,
                padding: "4px 8px",
                background: "rgba(15, 26, 42, 0.95)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: "nowrap",
                zIndex: 100,
                pointerEvents: "none",
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
              }}
            >
              {u.nombre}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
