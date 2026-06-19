export type SemaforoRojosBreakdown = { exp: number; ced: number; of: number };

export type BarChartItem = {
  label: string;
  value: number;
  tone?: "green" | "yellow" | "red" | "blue" | "default";
  breakdown?: SemaforoRojosBreakdown;
  drilldownKind?: "juzgado" | "responsable";
  drilldownKey?: string;
  muted?: boolean;
};

const ROJOS_COL = { exp: "#e24b4a", ced: "#f09595", of: "#f7c1c1" } as const;

export function formatRojosBreakdown(b: SemaforoRojosBreakdown): string {
  return `(${b.exp} exp · ${b.ced} céd · ${b.of} of)`;
}

export function formatRojosBreakdownChips(b: SemaforoRojosBreakdown): string {
  return (
    [
      ["exp", b.exp],
      ["céd", b.ced],
      ["of", b.of],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${t}`)
    .join(" · ");
}

export function RojosTypeLegend() {
  return (
    <div className="rojos-bars-legend" aria-hidden>
      <span>
        <i className="rojos-bars-legend__swatch rojos-bars-legend__swatch--exp" />
        exp
      </span>
      <span>
        <i className="rojos-bars-legend__swatch rojos-bars-legend__swatch--ced" />
        céd
      </span>
      <span>
        <i className="rojos-bars-legend__swatch rojos-bars-legend__swatch--of" />
        of
      </span>
    </div>
  );
}

export default function CssBarChart({
  items,
  maxItems = 8,
  onValueClick,
}: {
  items: BarChartItem[];
  maxItems?: number;
  onValueClick?: (item: BarChartItem) => void;
}) {
  const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, maxItems);
  const max = Math.max(1, ...sorted.map((i) => i.value));

  if (sorted.length === 0) {
    return <p className="muted" style={{ margin: 0, fontSize: 13 }}>Sin datos para mostrar.</p>;
  }

  return (
    <div className="rojos-bars">
      {sorted.map((item) => {
        const b = item.breakdown ?? { exp: 0, ced: 0, of: 0 };
        const total = item.value;
        const barW = Math.max((total / max) * 100, 1.5);
        const segs = (["exp", "ced", "of"] as const).filter((k) => b[k] > 0);
        const chips = formatRojosBreakdownChips(b);
        const clickable = Boolean(onValueClick && item.drilldownKey);

        return (
          <div
            key={`${item.drilldownKey ?? item.label}`}
            className={`rojos-bars__row${clickable ? " rojos-bars__row--clickable" : ""}${item.muted ? " rojos-bars__row--muted" : ""}`}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={() => {
              if (clickable) onValueClick!(item);
            }}
            onKeyDown={(e) => {
              if (clickable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onValueClick!(item);
              }
            }}
          >
            <div className="rojos-bars__label" title={item.label}>
              {item.label}
            </div>
            <div className="rojos-bars__main">
              <div className="rojos-bars__track">
                <div className="rojos-bars__bar" style={{ width: `${barW}%` }}>
                  {segs.map((k) => (
                    <div
                      key={k}
                      className="rojos-bars__seg"
                      style={{
                        width: `${(b[k] / total) * 100}%`,
                        background: ROJOS_COL[k],
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="rojos-bars__meta">
                {chips ? <span className="rojos-bars__chips">{chips}</span> : null}
                <span className="rojos-bars__total">{total}</span>
              </div>
            </div>
            {clickable ? <span className="rojos-bars__chevron">›</span> : null}
          </div>
        );
      })}
    </div>
  );
}
