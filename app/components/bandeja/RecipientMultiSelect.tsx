"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { displayName, type Profile } from "@/lib/bandeja-utils";

const MAX_VISIBLE_CHIPS = 3;

type RecipientMultiSelectProps = {
  users: Profile[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  excludeUserId?: string;
  /** Campo compacto tipo Gmail (chips + input en una sola caja) */
  variant?: "default" | "field";
  /** Renderiza el dropdown en document.body (evita recortes por overflow) */
  usePortal?: boolean;
};

export function formatRecipientsSummary(
  ids: string[],
  users: Profile[],
  maxVisible = MAX_VISIBLE_CHIPS
): string {
  if (ids.length === 0) return "—";
  const names = ids
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => displayName(u!));
  if (names.length <= maxVisible) return names.join(", ");
  const shown = names.slice(0, maxVisible).join(", ");
  return `${shown} +${names.length - maxVisible} más`;
}

type DropdownRect = {
  top: number;
  left: number;
  width: number;
};

function RecipientsDropdown({
  available,
  query,
  users,
  value,
  onPick,
}: {
  available: Profile[];
  query: string;
  users: Profile[];
  value: string[];
  onPick: (id: string) => void;
}) {
  if (available.length > 0) {
    return (
      <ul className="bandeja-recipients-dropdown" role="listbox">
        {available.slice(0, 12).map((u) => (
          <li key={u.id} role="option">
            <button
              type="button"
              className="bandeja-recipients-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(u.id)}
            >
              <span className="bandeja-recipients-option-name">{displayName(u)}</span>
              {u.email ? (
                <span className="bandeja-recipients-option-email">{u.email}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    );
  }
  if (query.trim().length > 0) {
    return (
      <div className="bandeja-recipients-dropdown bandeja-recipients-dropdown--empty">
        Sin usuarios para “{query.trim()}”
      </div>
    );
  }
  if (users.length > 0) {
    return (
      <div className="bandeja-recipients-dropdown bandeja-recipients-dropdown--empty">
        Todos los usuarios visibles ya están seleccionados
      </div>
    );
  }
  return (
    <div className="bandeja-recipients-dropdown bandeja-recipients-dropdown--empty">
      Cargando usuarios…
    </div>
  );
}

export default function RecipientMultiSelect({
  users,
  value,
  onChange,
  disabled = false,
  excludeUserId,
  variant = "default",
  usePortal = false,
}: RecipientMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [portalRect, setPortalRect] = useState<DropdownRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  const available = useMemo(() => {
    const selected = new Set(value);
    return users.filter((u) => {
      if (excludeUserId && u.id === excludeUserId) return false;
      if (selected.has(u.id)) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const name = displayName(u).toLowerCase();
      const email = (u.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, value, query, excludeUserId]);

  const selectedProfiles = useMemo(
    () => value.map((id) => users.find((u) => u.id === id)).filter(Boolean) as Profile[],
    [value, users]
  );

  const visibleChips = selectedProfiles.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = Math.max(0, selectedProfiles.length - MAX_VISIBLE_CHIPS);

  const updatePortalRect = useCallback(() => {
    const el = inputWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPortalRect({
      top: r.bottom + 6,
      left: r.left,
      width: r.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || !usePortal) {
      setPortalRect(null);
      return;
    }
    updatePortalRect();
    const onScrollOrResize = () => updatePortalRect();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, usePortal, updatePortalRect, query, value.length]);

  function addRecipient(id: string) {
    if (value.includes(id)) return;
    onChange([...value, id]);
    setQuery("");
    setOpen(false);
  }

  function removeRecipient(id: string) {
    onChange(value.filter((x) => x !== id));
  }

  const showDropdown = open && (available.length > 0 || query.trim().length > 0 || users.length > 0);

  const dropdownContent = showDropdown ? (
    <RecipientsDropdown
      available={available}
      query={query}
      users={users}
      value={value}
      onPick={addRecipient}
    />
  ) : null;

  const portalDropdown =
    usePortal && showDropdown && portalRect && typeof document !== "undefined"
      ? createPortal(
          <div
            className="bandeja-recipients-portal"
            style={{
              position: "fixed",
              top: portalRect.top,
              left: portalRect.left,
              width: portalRect.width,
              zIndex: 10000,
            }}
          >
            {dropdownContent}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      className={`bandeja-recipients${variant === "field" ? " bandeja-recipients--field" : ""}${usePortal ? " bandeja-recipients--portal" : ""}`}
      ref={wrapRef}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
          const portalEl = document.querySelector(".bandeja-recipients-portal");
          if (portalEl?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }
      }}
    >
      <div className="bandeja-recipients-field-inner">
        <div className="bandeja-recipients-chips" aria-label="Destinatarios seleccionados">
          {selectedProfiles.length === 0 && variant !== "field" && (
            <span className="bandeja-recipients-empty">Sin destinatarios</span>
          )}
          {visibleChips.map((u) => (
            <span key={u.id} className="bandeja-recipient-chip">
              <span className="bandeja-recipient-chip-label">{displayName(u)}</span>
              <button
                type="button"
                className="bandeja-recipient-chip-remove"
                aria-label={`Quitar ${displayName(u)}`}
                disabled={disabled}
                onClick={() => removeRecipient(u.id)}
              >
                ×
              </button>
            </span>
          ))}
          {hiddenCount > 0 && (
            <span
              className="bandeja-recipient-chip bandeja-recipient-chip--more"
              title={formatRecipientsSummary(value, users, 99)}
            >
              +{hiddenCount} más
            </span>
          )}

          <div className="bandeja-recipients-input-wrap" ref={inputWrapRef}>
            <input
              className="input bandeja-recipients-search"
              type="text"
              value={query}
              disabled={disabled}
              placeholder={
                value.length ? "Agregar otro destinatario…" : "Buscar por nombre o email…"
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
                if (e.key === "Backspace" && !query && value.length > 0) {
                  onChange(value.slice(0, -1));
                }
                if (e.key === "Enter" && open && available.length === 1) {
                  e.preventDefault();
                  addRecipient(available[0].id);
                }
              }}
              aria-autocomplete="list"
              aria-expanded={showDropdown}
            />
            {showDropdown && !usePortal && dropdownContent}
          </div>
        </div>
      </div>
      {portalDropdown}
    </div>
  );
}
