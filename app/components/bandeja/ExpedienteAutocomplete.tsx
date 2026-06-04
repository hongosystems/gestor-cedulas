"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
};

export default function ExpedienteAutocomplete({
  value,
  onChange,
  disabled,
}: ExpedienteAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExpedienteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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

  if (value) {
    return (
      <div className="bandeja-exp-selected">
        <div className="bandeja-exp-selected-main">
          <div className="bandeja-exp-selected-label">{value.label}</div>
          {value.caratula && (
            <div className="bandeja-exp-selected-meta">{value.caratula}</div>
          )}
          <div className="bandeja-exp-selected-meta">
            {[value.juzgado, value.fecha ? `Últ. act: ${value.fecha}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button
          type="button"
          className="btn"
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={clearSelection}
          disabled={disabled}
        >
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div className="bandeja-exp-autocomplete" ref={rootRef}>
      <div className="bandeja-exp-input-wrap">
        <span className="bandeja-exp-search-icon" aria-hidden>
          🔍
        </span>
        <input
          className="input bandeja-exp-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar por número, carátula o juzgado…"
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {open && query.trim().length >= 3 && (
        <div className="bandeja-exp-dropdown" role="listbox">
          {loading && (
            <div className="bandeja-exp-dropdown-msg bandeja-exp-dropdown-msg--loading">Buscando…</div>
          )}
          {!loading && error && (
            <div className="bandeja-exp-dropdown-msg bandeja-exp-dropdown-msg--error">{error}</div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="bandeja-exp-dropdown-msg">Sin resultados</div>
          )}
          {!loading && !error && results.length > 0 && (
            <div className="bandeja-exp-dropdown-scroll">
              {results.map((item) => (
                <button
                  key={`${item.source}-${item.id}`}
                  type="button"
                  className="bandeja-exp-option"
                  role="option"
                  onClick={() => {
                    onChange(item);
                    setQuery("");
                    setOpen(false);
                    setResults([]);
                  }}
                >
                  <span className="bandeja-exp-option-label">{item.label}</span>
                  {item.caratula && (
                    <span className="bandeja-exp-option-caratula">{item.caratula}</span>
                  )}
                  <span className="bandeja-exp-option-footer">
                    {[item.juzgado, item.fecha ? `Últ. act: ${item.fecha}` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {query.trim().length > 0 && query.trim().length < 3 && (
        <p className="bandeja-exp-hint">Escribí al menos 3 caracteres para buscar.</p>
      )}
    </div>
  );
}
