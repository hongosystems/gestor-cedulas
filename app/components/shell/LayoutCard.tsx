import type { ReactNode } from "react";

type LayoutCardProps = {
  children: ReactNode;
  className?: string;
};

/** Contenedor de página dentro del shell — reutiliza estilos .card existentes. */
export default function LayoutCard({ children, className = "" }: LayoutCardProps) {
  return <section className={`card layout-card ${className}`.trim()}>{children}</section>;
}
