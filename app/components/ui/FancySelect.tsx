"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type FancyItem =
  | { kind: "group"; label: string }
  | {
      kind: "option";
      value: string;
      label: string;
      badge?: string | number;
      disabled?: boolean;
    };

type FancySelectProps = {
  value: string;
  onChange: (v: string) => void;
  items: FancyItem[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  width?: string | number;
  disabled?: boolean;
};

export function FancySelect({
  value,
  onChange,
  items,
  placeholder = "Seleccionar…",
  searchable = true,
  searchPlaceholder = "Buscar…",
  width = "100%",
  disabled = false,
}: FancySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () =>
      items.filter(
        (i): i is Extract<FancyItem, { kind: "option" }> => i.kind === "option"
      ),
    [items]
  );
  const selected = options.find((o) => o.value === value);

  const visible = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    const out: FancyItem[] = [];
    let pendingGroup: FancyItem | null = null;
    for (const it of items) {
      if (it.kind === "group") {
        pendingGroup = it;
        continue;
      }
      if (it.label.toLowerCase().includes(q)) {
        if (pendingGroup) {
          out.push(pendingGroup);
          pendingGroup = null;
        }
        out.push(it);
      }
    }
    return out;
  }, [items, query]);

  const visibleOptions = useMemo(
    () =>
      visible.filter(
        (i): i is Extract<FancyItem, { kind: "option" }> => i.kind === "option"
      ),
    [visible]
  );

  const selectableOptions = useMemo(
    () => visibleOptions.filter((o) => !o.disabled),
    [visibleOptions]
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (open) setActive(0);
    else setQuery("");
  }, [open]);

  const choose = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange]
  );

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && (e.key === "Enter" || e.key === "ArrowDown")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, selectableOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = selectableOptions[active];
      if (o) choose(o.value);
    }
  }

  return (
    <div
      ref={rootRef}
      className="fancy-select"
      style={{ position: "relative", width }}
      onKeyDown={onKey}
    >
      <button
        type="button"
        className="fancy-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
      >
        <span className="fancy-select__trigger-label">
          {selected ? selected.label : placeholder}
        </span>
        <span className={`fancy-select__chevron${open ? " fancy-select__chevron--open" : ""}`}>
          ▾
        </span>
      </button>

      {open && !disabled && (
        <div className="fancy-select__panel">
          {searchable && (
            <div className="fancy-select__search-wrap">
              <input
                autoFocus
                className="fancy-select__search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
          <ul role="listbox" className="fancy-scroll fancy-select__list">
            {visible.map((it, idx) => {
              if (it.kind === "group") {
                return (
                  <li key={`g-${idx}`} className="fancy-select__group">
                    {it.label}
                  </li>
                );
              }
              const isSel = it.value === value;
              const selIdx = selectableOptions.findIndex((o) => o.value === it.value);
              const isActive = selIdx >= 0 && selectableOptions[active]?.value === it.value;
              return (
                <li
                  key={`${it.value}-${idx}`}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={it.disabled || undefined}
                  className={[
                    "fancy-select__option",
                    isSel ? "fancy-select__option--selected" : "",
                    isActive ? "fancy-select__option--active" : "",
                    it.disabled ? "fancy-select__option--disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => {
                    if (!it.disabled && selIdx >= 0) setActive(selIdx);
                  }}
                  onClick={() => {
                    if (!it.disabled) choose(it.value);
                  }}
                >
                  <span>{it.label}</span>
                  {it.badge != null ? (
                    <span className="fancy-select__badge">{it.badge}</span>
                  ) : isSel ? (
                    <span className="fancy-select__check">✓</span>
                  ) : null}
                </li>
              );
            })}
            {visibleOptions.length === 0 && (
              <li className="fancy-select__empty">Sin resultados</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
