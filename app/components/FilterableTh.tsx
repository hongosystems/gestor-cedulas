"use client";

import type { ColumnFilterOption } from "@/app/hooks/useColumnFilters";
import type { CSSProperties, MouseEvent, ThHTMLAttributes } from "react";

export type FilterableThOption = ColumnFilterOption;

/** Estilos copiados de `app/app/page.tsx` (Mis Cédulas / menú de filtro). */
const triggerButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  fontWeight: 700,
  padding: 0,
};

const sortButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  padding: 0,
};

const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  zIndex: 50,
  background: "linear-gradient(180deg, rgba(11,47,85,.98), rgba(7,28,46,.98))",
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 10,
  padding: 10,
  boxShadow: "0 10px 24px rgba(0,0,0,.45)",
};

const filterSectionTitleStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 8,
};

const filterSectionTitleStyleRightColumn: CSSProperties = {
  ...filterSectionTitleStyle,
  textAlign: "left",
};

const optionButtonStyle = (active: boolean, whiteSpaceNormal?: boolean): CSSProperties => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  marginBottom: 6,
  background: active ? "rgba(96,141,186,.25)" : "transparent",
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 7,
  color: "var(--text)",
  cursor: "pointer",
  padding: "6px 8px",
  ...(whiteSpaceNormal ? { whiteSpace: "normal" as const } : {}),
});

const clearFilterButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 7,
  color: "var(--muted)",
  cursor: "pointer",
  padding: "6px 8px",
};

export type FilterableThProps = {
  label: string;
  filterKey: string;
  options: ColumnFilterOption[];
  activeFilter: string | null;
  onFilter: (value: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  sortable?: boolean;
  sortField?: string | null;
  sortDirection?: "asc" | "desc";
  onSort?: () => void;
  /** Si no se pasa, se usa `filterKey` para comparar con `sortField`. */
  sortColumnId?: string | null;
  width?: number | string;
  align?: "left" | "right";
  /** `minWidth` del panel (ej. 170 semáforo, 190 estado, 250 juzgado, 180 tipo). */
  menuMinWidth?: number;
  /** Alineación del panel desplegable (ej. columna Cédula/Oficio: `right`). */
  menuAlign?: "left" | "right";
  /** Lista larga (ej. juzgado): `maxHeight: 280` + scroll. */
  menuScrollable?: boolean;
  /** Etiquetas largas en opciones (ej. juzgado): `whiteSpace: "normal"`. */
  optionWhiteSpaceNormal?: boolean;
  filterTitle?: string;
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, "children" | "align">;

export function FilterableTh({
  label,
  filterKey,
  options,
  activeFilter,
  onFilter,
  isOpen,
  onToggle,
  sortable = false,
  sortField = null,
  sortDirection = "desc",
  onSort,
  sortColumnId = null,
  width,
  align = "left",
  menuMinWidth = 170,
  menuAlign,
  menuScrollable = false,
  optionWhiteSpaceNormal = false,
  filterTitle,
  style,
  className,
  ...restTh
}: FilterableThProps) {
  const sortId = sortColumnId ?? filterKey;
  const isSortActive = sortField === sortId;
  const menuSide = menuAlign ?? (align === "right" ? "right" : "left");
  const title = filterTitle ?? `Filtrar por ${label}`;

  const thStyle: CSSProperties = {
    ...(width !== undefined ? { width } : {}),
    ...(align === "right" ? { textAlign: "right" as const } : {}),
    ...style,
    position: "relative",
  };

  const panelPosition: CSSProperties =
    menuSide === "right" ? { right: 0, left: "auto" } : { left: 0, right: "auto" };

  const panelStyle: CSSProperties = {
    ...dropdownPanelStyle,
    ...panelPosition,
    minWidth: menuMinWidth,
    ...(menuScrollable ? { maxHeight: 280, overflowY: "auto" as const } : {}),
  };

  const filterSectionTitle =
    menuSide === "right" ? filterSectionTitleStyleRightColumn : filterSectionTitleStyle;

  const handleFilterClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onToggle();
  };

  const handleSortClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onSort?.();
  };

  const handleSelect = (value: string | null) => {
    onFilter(value);
    if (isOpen) onToggle();
  };

  const filterTrigger = (
    <button type="button" onClick={handleFilterClick} style={triggerButtonStyle} title={title}>
      {label} {activeFilter ? "●" : ""} ▾
    </button>
  );

  const sortControl = sortable ? (
    <button
      type="button"
      className="sortable"
      onClick={handleSortClick}
      title={`Ordenar por ${label}`}
      style={sortButtonStyle}
    >
      <span style={{ opacity: isSortActive ? 1 : 0.4 }}>
        {isSortActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  ) : null;

  const headerRow =
    sortable || align === "right" ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
        }}
      >
        {filterTrigger}
        {sortControl}
      </div>
    ) : (
      filterTrigger
    );

  return (
    <th className={className} style={thStyle} {...restTh}>
      {headerRow}
      {isOpen && (
        <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
          <div style={filterSectionTitle}>Filtrar por</div>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              style={optionButtonStyle(activeFilter === opt.value, optionWhiteSpaceNormal)}
            >
              {opt.label}
            </button>
          ))}
          <button type="button" onClick={() => handleSelect(null)} style={clearFilterButtonStyle}>
            Limpiar filtro
          </button>
        </div>
      )}
    </th>
  );
}
