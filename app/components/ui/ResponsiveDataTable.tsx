import type { ReactNode } from "react";

type ResponsiveDataTableProps = {
  children: ReactNode;
  minWidth?: number;
  className?: string;
};

/**
 * Contenedor de tabla ancha: scroll horizontal dentro del área de contenido,
 * sin recortar la última columna contra el borde del viewport.
 */
export default function ResponsiveDataTable({
  children,
  minWidth = 1200,
  className = "",
}: ResponsiveDataTableProps) {
  return (
    <div
      className={`responsive-data-table ${className}`.trim()}
      style={{ ["--table-min-width" as string]: `${minWidth}px` }}
    >
      <div className="responsive-data-table__scroll">{children}</div>
    </div>
  );
}
