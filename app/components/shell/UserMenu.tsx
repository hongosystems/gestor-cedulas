"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type UserMenuProps = {
  userName: string | null;
  userEmail: string | null;
};

export default function UserMenu({ userName, userEmail }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const displayName = userName || userEmail?.split("@")[0] || "Usuario";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="shell-user-menu" ref={ref}>
      <button
        type="button"
        className="shell-user-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="shell-user-avatar" aria-hidden>
          {initials}
        </span>
        <span className="shell-user-name">{displayName}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="shell-user-dropdown" role="menu">
          <div className="shell-user-dropdown-header">
            <strong>{userName || displayName}</strong>
            {userEmail && <span>{userEmail}</span>}
          </div>
          <Link href="/cambiar-password" className="shell-user-dropdown-item" onClick={() => setOpen(false)}>
            <span aria-hidden>👤</span> Perfil / contraseña
          </Link>
          <div className="shell-user-dropdown-divider" />
          <Link href="/logout" className="shell-user-dropdown-item shell-user-dropdown-item--danger" onClick={() => setOpen(false)}>
            <span aria-hidden>⎋</span> Salir
          </Link>
        </div>
      )}
    </div>
  );
}
