import type { ReactNode } from "react";

type DataTableShellProps = {
  children: ReactNode;
  minWidth?: number;
  className?: string;
};

/** Contenedor scroll horizontal para tablas anchas. */
export default function DataTableShell({
  children,
  minWidth = 1100,
  className = "",
}: DataTableShellProps) {
  return (
    <div
      className={`data-table-shell ${className}`.trim()}
      style={{ ["--table-min-width" as string]: `${minWidth}px` }}
    >
      {children}
    </div>
  );
}
