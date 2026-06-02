export type BarChartItem = {
  label: string;
  value: number;
  tone?: "green" | "yellow" | "red" | "blue" | "default";
};

export default function CssBarChart({
  items,
  maxItems = 8,
}: {
  items: BarChartItem[];
  maxItems?: number;
}) {
  const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, maxItems);
  const max = Math.max(1, ...sorted.map((i) => i.value));

  if (sorted.length === 0) {
    return <p className="muted" style={{ margin: 0, fontSize: 13 }}>Sin datos para mostrar.</p>;
  }

  return (
    <ul className="css-bar-chart" role="list">
      {sorted.map((item) => (
        <li key={item.label} className="css-bar-chart__row">
          <div className="css-bar-chart__label" title={item.label}>
            {item.label}
          </div>
          <div className="css-bar-chart__track" aria-hidden>
            <div
              className={`css-bar-chart__fill css-bar-chart__fill--${item.tone || "default"}`}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
          <div className="css-bar-chart__value">{item.value}</div>
        </li>
      ))}
    </ul>
  );
}
