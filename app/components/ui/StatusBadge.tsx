type Semaforo = "VERDE" | "AMARILLO" | "ROJO" | "GRIS";

const LABELS: Record<Semaforo, string> = {
  VERDE: "Verde",
  AMARILLO: "Amarillo",
  ROJO: "Rojo",
  GRIS: "Sin dato",
};

export default function StatusBadge({
  value,
  label,
}: {
  value: Semaforo;
  label?: string;
}) {
  const mod =
    value === "ROJO"
      ? "rojo"
      : value === "AMARILLO"
        ? "amarillo"
        : value === "VERDE"
          ? "verde"
          : "gris";
  return (
    <span className={`badge badge--${mod}`}>
      <span className="badgeDot" aria-hidden />
      {label ?? LABELS[value]}
    </span>
  );
}
