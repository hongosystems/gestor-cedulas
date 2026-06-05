"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { docTypeLabel, type DocType } from "@/lib/bandeja-utils";

const DOC_TYPES: DocType[] = ["CEDULA", "OFICIO", "OTROS_ESCRITOS"];

type ComposeDocTypeSelectProps = {
  value: DocType;
  onChange: (v: DocType) => void;
  disabled?: boolean;
};

export default function ComposeDocTypeSelect({
  value,
  onChange,
  disabled = false,
}: ComposeDocTypeSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [portalRect, setPortalRect] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  const updateRect = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPortalRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPortalRect(null);
      return;
    }
    updateRect();
    const onMove = () => updateRect();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, updateRect]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || portalRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const portalMenu =
    open && portalRect && typeof document !== "undefined"
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
            <ul className="bandeja-compose-select-menu" role="listbox" id={listId}>
              {DOC_TYPES.map((t) => (
                <li key={t} role="option" aria-selected={t === value}>
                  <button
                    type="button"
                    className={`bandeja-compose-select-option${t === value ? " is-selected" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(t);
                      setOpen(false);
                    }}
                  >
                    {docTypeLabel(t)}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="bandeja-compose-select" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`bandeja-recipients-field-inner bandeja-compose-field-trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{docTypeLabel(value)}</span>
        <span className="bandeja-compose-field-chevron" aria-hidden />
      </button>
      {portalMenu}
    </div>
  );
}
