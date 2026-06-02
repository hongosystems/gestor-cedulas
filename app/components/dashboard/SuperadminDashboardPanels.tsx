"use client";

import CssBarChart, { type BarChartItem } from "@/app/components/ui/CssBarChart";
import MetricCard from "@/app/components/ui/MetricCard";
import SectionCard from "@/app/components/ui/SectionCard";

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
    totalAbiertas: number;
  };
  operational: OperationalMetrics;
  juzgadoRojos: BarChartItem[];
  responsableRojos: BarChartItem[];
  antiguedadBuckets: { verde: number; amarillo: number; rojo: number };
  alertas: string[];
};

export default function SuperadminDashboardPanels({
  metrics,
  operational,
  juzgadoRojos,
  responsableRojos,
  antiguedadBuckets,
  alertas,
}: DashboardPanelsProps) {
  const totalSemaforo =
    metrics.totalVerdes + metrics.totalAmarillas + metrics.totalRojas || 1;

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
        <MetricCard title="Semáforo verde" value={metrics.totalVerdes} hint={`${((metrics.totalVerdes / totalSemaforo) * 100).toFixed(0)}% del total`} tone="green" />
        <MetricCard title="Semáforo amarillo" value={metrics.totalAmarillas} hint={`${((metrics.totalAmarillas / totalSemaforo) * 100).toFixed(0)}%`} tone="yellow" />
        <MetricCard title="Semáforo rojo" value={metrics.totalRojas} hint={`${((metrics.totalRojas / totalSemaforo) * 100).toFixed(0)}%`} tone="red" />
        <MetricCard
          title="Candidatos reiteratorio"
          value={operational.reiteratorioCandidatos}
          hint="Oficios en PJN ≥14 días"
          tone="orange"
        />
      </div>

      <div className="dashboard-panels__grid dashboard-panels__grid--4">
        <MetricCard title="OCR pendiente" value={operational.ocrPendiente} tone="yellow" />
        <MetricCard title="OCR con error" value={operational.ocrError} tone="red" />
        <MetricCard
          title="Última sync PJN"
          value={operational.ultimaSyncPjn ?? "—"}
          hint="Mayor fecha en favoritos PJN"
        />
        <MetricCard title="Total documentos" value={metrics.totalAbiertas} />
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
        <SectionCard title="Juzgados con más rojos">
          <CssBarChart items={juzgadoRojos} />
        </SectionCard>
        <SectionCard title="Responsables con más rojos">
          <CssBarChart items={responsableRojos} />
        </SectionCard>
      </div>
    </div>
  );
}
