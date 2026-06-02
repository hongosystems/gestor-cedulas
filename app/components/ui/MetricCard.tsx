type MetricCardProps = {
  title: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "green" | "yellow" | "red" | "blue" | "orange";
};

const TONE_CLASS = {
  default: "",
  green: "metric-card--green",
  yellow: "metric-card--yellow",
  red: "metric-card--red",
  blue: "metric-card--blue",
  orange: "metric-card--orange",
} as const;

export default function MetricCard({
  title,
  value,
  hint,
  tone = "default",
}: MetricCardProps) {
  return (
    <div className={`metric-card ${TONE_CLASS[tone]}`.trim()}>
      <div className="metric-card__label">{title}</div>
      <div className="metric-card__value">{value}</div>
      {hint && <div className="metric-card__hint">{hint}</div>}
    </div>
  );
}
