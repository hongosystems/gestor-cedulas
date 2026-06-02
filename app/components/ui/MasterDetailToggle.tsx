"use client";

type MasterDetailToggleProps = {
  expanded: boolean;
  onClick: () => void;
  hasHint?: boolean;
};

export default function MasterDetailToggle({
  expanded,
  onClick,
  hasHint = true,
}: MasterDetailToggleProps) {
  return (
    <button
      type="button"
      className={`mj-detail-toggle${expanded ? " is-expanded" : ""}`}
      onClick={onClick}
      aria-expanded={expanded}
      title={expanded ? "Ocultar detalle" : "Ver detalle"}
    >
      <span className="mj-detail-toggle__icon" aria-hidden>
        {expanded ? "▾" : "▸"}
      </span>
      <span className="mj-detail-toggle__label">
        {expanded ? "Ocultar" : hasHint ? "Detalle" : "Ver"}
      </span>
    </button>
  );
}
