"use client";

import { useMemo, useState } from "react";
import SemaforoRojosModal from "@/app/components/dashboard/SemaforoRojosModal";
import CssBarChart, { type BarChartItem, formatRojosBreakdown, RojosTypeLegend } from "@/app/components/ui/CssBarChart";
import MetricCard from "@/app/components/ui/MetricCard";
import SectionCard from "@/app/components/ui/SectionCard";
import {
  filterDocumentosRojos,
  type DocumentoRojoDashboard,
} from "@/lib/semaforo-dashboard-rojos";
import { REITERATORIO_UMBRAL_DIAS } from "@/lib/reiteratorios";

export type OperationalMetrics = {
  pjnCargados: number;
  ocrPendiente: number;
  ocrError: number;
  reiteratorioCandidatos: number;
  ultimaSyncPjn: string | null;
};

export type DashboardPanelsProps = {
  metrics: {
    totalExpedientes: number;
    totalCedulas: number;
    totalOficios: number;
    totalRojas: number;
    totalAmarillas: number;
    totalVerdes: number;
    /** Cédulas + oficios abiertos */
    totalAbiertas: number;
    /** Cédulas + oficios + expedientes con semáforo */
    totalUniversoSemaforo: number;
    pctRojas: string;
    pctAmarillas: string;
    pctVerdes: string;
  };
  operational: OperationalMetrics;
  juzgadoRojos: BarChartItem[];
  responsableRojos: BarChartItem[];
  documentosRojos: DocumentoRojoDashboard[];
  monitoreoPJN: { total: number; rojos: number; amarillos: number; verdes: number };
  documentosMonitoreoRojos: DocumentoRojoDashboard[];
  antiguedadBuckets: { verde: number; amarillo: number; rojo: number };
  alertas: string[];
};

export default function SuperadminDashboardPanels({
  metrics,
  operational,
  juzgadoRojos,
  responsableRojos,
  documentosRojos,
  monitoreoPJN,
  documentosMonitoreoRojos,
  antiguedadBuckets,
  alertas,
}: DashboardPanelsProps) {
  const pctHint = (pct: string) => `${pct}% del universo semáforo (${metrics.totalUniversoSemaforo})`;

  const [drilldown, setDrilldown] = useState<{
    kind: "juzgado" | "responsable" | "monitoreo";
    key: string;
    title: string;
    subtitle?: string;
  } | null>(null);

  const drilldownItems = useMemo(() => {
    if (!drilldown) return [];
    if (drilldown.kind === "monitoreo") return documentosMonitoreoRojos;
    return filterDocumentosRojos(documentosRojos, drilldown.kind, drilldown.key);
  }, [drilldown, documentosRojos, documentosMonitoreoRojos]);

  function handleBarClick(item: BarChartItem) {
    if (!item.drilldownKind || !item.drilldownKey) return;
    const subtitle =
      item.breakdown != null ? formatRojosBreakdown(item.breakdown) : undefined;
    setDrilldown({
      kind: item.drilldownKind,
      key: item.drilldownKey,
      title:
        item.drilldownKind === "juzgado"
          ? `Rojos — ${item.label}`
          : `Rojos — ${item.label}`,
      subtitle,
    });
  }

  return (
    <div className="dashboard-panels">
      <div className="dashboard-panels__grid dashboard-panels__grid--4">
        <MetricCard title="Expedientes monitoreados" value={metrics.totalExpedientes} tone="blue" />
        <MetricCard title="Cédulas abiertas" value={metrics.totalCedulas} tone="blue" />
        <MetricCard title="Oficios abiertos" value={metrics.totalOficios} tone="blue" />
        <MetricCard
          title="Documentos en PJN"
          value={operational.pjnCargados}
          hint="Con fecha de carga PJN registrada"
          tone="green"
        />
      </div>

      <div className="dashboard-panels__grid dashboard-panels__grid--4">
        <MetricCard title="Semáforo verde" value={metrics.totalVerdes} hint={pctHint(metrics.pctVerdes)} tone="green" />
        <MetricCard title="Semáforo amarillo" value={metrics.totalAmarillas} hint={pctHint(metrics.pctAmarillas)} tone="yellow" />
        <MetricCard title="Semáforo rojo" value={metrics.totalRojas} hint={pctHint(metrics.pctRojas)} tone="red" />
        <MetricCard
          title="Candidatos reiteratorio"
          value={operational.reiteratorioCandidatos}
          hint={`Oficios en PJN ≥${REITERATORIO_UMBRAL_DIAS} días`}
          tone="orange"
        />
      </div>

      <div className="dashboard-panels__grid dashboard-panels__grid--2">
        <MetricCard title="Documentos abiertos" value={metrics.totalAbiertas} hint="Cédulas + oficios" tone="blue" />
        <MetricCard title="Universo semáforo" value={metrics.totalUniversoSemaforo} hint="Cédulas + oficios + expedientes" tone="blue" />
      </div>

      <div className="dashboard-panels__grid dashboard-panels__grid--4">
        <MetricCard title="OCR pendiente" value={operational.ocrPendiente} tone="yellow" />
        <MetricCard title="OCR con error" value={operational.ocrError} tone="red" />
        <MetricCard
          title="Última sync PJN"
          value={operational.ultimaSyncPjn ?? "—"}
          hint="Mayor fecha en favoritos PJN"
        />
      </div>

      <div className="dashboard-panels__grid dashboard-panels__grid--2">
        <SectionCard title="Distribución por antigüedad (semáforo)">
          <div className="semaforo-stack" role="img" aria-label="Distribución verde, amarillo y rojo">
            <div
              className="semaforo-stack__seg semaforo-stack__seg--verde"
              style={{ flex: antiguedadBuckets.verde }}
              title={`Verde: ${antiguedadBuckets.verde}`}
            />
            <div
              className="semaforo-stack__seg semaforo-stack__seg--amarillo"
              style={{ flex: antiguedadBuckets.amarillo }}
              title={`Amarillo: ${antiguedadBuckets.amarillo}`}
            />
            <div
              className="semaforo-stack__seg semaforo-stack__seg--rojo"
              style={{ flex: antiguedadBuckets.rojo }}
              title={`Rojo: ${antiguedadBuckets.rojo}`}
            />
          </div>
          <div className="semaforo-stack-legend">
            <span><i className="dot dot--verde" /> Verde {antiguedadBuckets.verde}</span>
            <span><i className="dot dot--amarillo" /> Amarillo {antiguedadBuckets.amarillo}</span>
            <span><i className="dot dot--rojo" /> Rojo {antiguedadBuckets.rojo}</span>
          </div>
        </SectionCard>

        <SectionCard title="Alertas críticas">
          {alertas.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No hay alertas críticas con los filtros actuales.</p>
          ) : (
            <ul className="dashboard-alerts">
              {alertas.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="dashboard-panels__grid dashboard-panels__grid--2">
        <SectionCard title="Juzgados con más rojos" actions={<RojosTypeLegend />}>
          <CssBarChart items={juzgadoRojos} onValueClick={handleBarClick} />
        </SectionCard>
        <SectionCard title="Responsables con más rojos" actions={<RojosTypeLegend />}>
          <CssBarChart items={responsableRojos} onValueClick={handleBarClick} />
        </SectionCard>
      </div>

      <SectionCard title="Monitoreo PJN">
        <p className="muted" style={{ margin: "0 0 12px 0", fontSize: 13 }}>
          Causas vigiladas vía favoritos PJN — no son trabajo del estudio. Fuera de rankings y semáforo gerencial.
        </p>
        <div className="dashboard-panels__grid dashboard-panels__grid--3">
          <MetricCard
            title="Causas en monitoreo"
            value={monitoreoPJN.total}
            hint="Favoritos PJN sin cédulas/oficios propios"
            tone="blue"
          />
          <button
            type="button"
            className="metric-card metric-card--red"
            style={{ textAlign: "left", cursor: monitoreoPJN.rojos > 0 ? "pointer" : "default", border: "none", width: "100%" }}
            disabled={monitoreoPJN.rojos === 0}
            onClick={() =>
              setDrilldown({
                kind: "monitoreo",
                key: "monitoreo",
                title: "Monitoreo PJN — rojos",
                subtitle: `${monitoreoPJN.rojos} causas vigiladas`,
              })
            }
          >
            <div className="metric-card__label">Monitoreo en rojo</div>
            <div className="metric-card__value">{monitoreoPJN.rojos}</div>
            <div className="metric-card__hint">Antigüedad PJN — informativo, no gerencial</div>
          </button>
          <MetricCard
            title="Monitoreo amarillo / verde"
            value={monitoreoPJN.amarillos + monitoreoPJN.verdes}
            hint={`${monitoreoPJN.amarillos} am · ${monitoreoPJN.verdes} ver`}
          />
        </div>
      </SectionCard>

      {drilldown && (
        <SemaforoRojosModal
          title={drilldown.title}
          subtitle={drilldown.subtitle}
          items={drilldownItems}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
