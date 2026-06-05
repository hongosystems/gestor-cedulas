"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";

export type ExpedienteOption = {
  id: string;
  source: "pjn_favoritos" | "expedientes";
  ref: string;
  label: string;
  caratula: string | null;
  juzgado: string | null;
  fecha: string | null;
};

type ExpedienteAutocompleteProps = {
  value: ExpedienteOption | null;
  onChange: (next: ExpedienteOption | null) => void;
  disabled?: boolean;
  /** Misma caja visual que destinatarios en Redactar */
  variant?: "default" | "field";
};

export default function ExpedienteAutocomplete({
  value,
  onChange,
  disabled,
  variant = "default",
}: ExpedienteAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExpedienteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const fieldRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  const usePortal = variant === "field";
  const [portalRect, setPortalRect] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  const updatePortalRect = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPortalRect({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!open || !usePortal) {
      setPortalRect(null);
      return;
    }
    updatePortalRect();
    const onMove = () => updatePortalRect();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, usePortal, updatePortalRect, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (fieldRef.current?.contains(t) || portalRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (q.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;

      const res = await fetch(`/api/expedientes/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "No se pudo buscar.");
        setResults([]);
        return;
      }
      setResults((json.results ?? []) as ExpedienteOption[]);
    } catch {
      setError("Error de conexión al buscar.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (value) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, 320);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, value, runSearch]);

  function clearSelection() {
    onChange(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  const showDropdown =
    open && !value && (query.trim().length >= 3 || loading || error);

  const dropdownBody = showDropdown ? (
    <>
      {loading && (
        <div className="bandeja-recipients-dropdown bandeja-recipients-dropdown--empty">
          Buscando…
        </div>
      )}
      {!loading && error && (
        <div className="bandeja-recipients-dropdown bandeja-recipients-dropdown--empty">{error}</div>
      )}
      {!loading && !error && results.length === 0 && query.trim().length >= 3 && (
        <div className="bandeja-recipients-dropdown bandeja-recipients-dropdown--empty">
          Sin resultados
        </div>
      )}
      {!loading && !error && results.length > 0 && (
        <ul className="bandeja-recipients-dropdown bandeja-exp-dropdown-list" role="listbox" id={listId}>
          {results.map((item) => (
            <li key={`${item.source}-${item.id}`} role="option">
              <button
                type="button"
                className="bandeja-recipients-option bandeja-exp-option-in-list"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(item);
                  setQuery("");
                  setOpen(false);
                  setResults([]);
                }}
              >
                <span className="bandeja-recipients-option-name">{item.label}</span>
                {item.caratula ? (
                  <span className="bandeja-recipients-option-email">{item.caratula}</span>
                ) : null}
                <span className="bandeja-exp-option-footer-inline">
                  {[item.juzgado, item.fecha ? `Últ. act: ${item.fecha}` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  ) : null;

  const portalDropdown =
    usePortal && showDropdown && portalRect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={portalRef}
            className="bandeja-compose-dropdown-portal"
            style={{
              position: "fixed",
              top: portalRect.top,
              left: portalRect.left,
              width: portalRect.width,
              zIndex: 10050,
            }}
          >
            {dropdownBody}
          </div>,
          document.body
        )
      : null;

  if (value && variant === "field") {
    return (
      <div className="bandeja-recipients-field-inner bandeja-exp-field-inner--filled">
        <span className="bandeja-recipient-chip bandeja-exp-chip">
          <span className="bandeja-recipient-chip-label" title={value.label}>
            {value.label}
          </span>
          <button
            type="button"
            className="bandeja-recipient-chip-remove"
            aria-label="Quitar expediente"
            disabled={disabled}
            onClick={clearSelection}
          >
            ×
          </button>
        </span>
        {value.caratula ? (
          <span className="bandeja-exp-chip-meta">{value.caratula}</span>
        ) : null}
      </div>
    );
  }

  if (value && variant !== "field") {
    return (
      <div className="bandeja-exp-selected">
        <div className="bandeja-exp-selected-main">
          <div className="bandeja-exp-selected-label">{value.label}</div>
          {value.caratula && <div className="bandeja-exp-selected-meta">{value.caratula}</div>}
          <div className="bandeja-exp-selected-meta">
            {[value.juzgado, value.fecha ? `Últ. act: ${value.fecha}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button type="button" className="bandeja-cc-toggle" onClick={clearSelection} disabled={disabled}>
          Quitar
        </button>
      </div>
    );
  }

  const isField = variant === "field";

  return (
    <div className={isField ? "bandeja-exp-autocomplete bandeja-exp-autocomplete--field" : "bandeja-exp-autocomplete"}>
      <div
        ref={fieldRef}
        className={isField ? "bandeja-recipients-field-inner" : "bandeja-exp-input-wrap"}
      >
        {!isField && (
          <span className="bandeja-exp-search-icon" aria-hidden>
            🔍
          </span>
        )}
        <input
          className={isField ? "bandeja-recipients-search" : "input bandeja-exp-input"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            isField
              ? "Buscar por número, carátula o juzgado…"
              : "Buscar por número, carátula o juzgado…"
          }
          disabled={disabled}
          autoComplete="off"
          aria-expanded={!!showDropdown}
          aria-controls={showDropdown ? listId : undefined}
        />
        {showDropdown && !usePortal && (
          <div className="bandeja-exp-dropdown" role="presentation">
            {dropdownBody}
          </div>
        )}
      </div>
      {portalDropdown}
      {!isField && query.trim().length > 0 && query.trim().length < 3 && (
        <p className="bandeja-exp-hint">Escribí al menos 3 caracteres para buscar.</p>
      )}
      {isField && query.trim().length > 0 && query.trim().length < 3 && !value && (
        <p className="bandeja-compose-field-hint">Escribí al menos 3 caracteres para buscar.</p>
      )}
    </div>
  );
}
