"use client";

import React from "react";
import CopyableTextBlock from "@/app/components/ui/CopyableTextBlock";

export type MisJuzgadosTableItem = {
  id: string;
  caratula: string | null;
  juzgado: string | null;
  fecha: string | null;
  fecha_ultima_carga?: string | null;
  numero: string | null;
  created_by?: string | null;
  dias: number | null;
  semaforo: string;
  observaciones?: string | null;
  notas?: string | null;
  estado?: string;
  pdf_path?: string | null;
  tipo_documento?: string | null;
  read_by_name?: string | null;
  is_pjn_favorito?: boolean;
};

type MisJuzgadosTableRowsProps = {
  item: MisJuzgadosTableItem;
  activeTab: "expedientes" | "cedulas" | "oficios";
  isAbogado: boolean;
  isExpanded: boolean;
  colSpan: number;
  onToggleExpand: (id: string) => void;
  renderSemaforo: () => React.ReactNode;
  renderJuzgado: () => React.ReactNode;
  renderResponsable: () => React.ReactNode;
  renderFecha: () => React.ReactNode;
  renderEstado?: () => React.ReactNode;
  renderAccion?: () => React.ReactNode;
  renderNotasEditor: () => React.ReactNode;
  formatCaratulaFull: (text: string | null) => string;
};

function DetailToggle({
  expanded,
  onClick,
  hasDetail,
}: {
  expanded: boolean;
  onClick: () => void;
  hasDetail: boolean;
}) {
  return (
    <button
      type="button"
      className={`mj-detail-toggle${expanded ? " is-expanded" : ""}`}
      onClick={onClick}
      aria-expanded={expanded}
      title={expanded ? "Ocultar detalle" : "Ver detalle"}
    >
      <span className="mj-detail-toggle__icon" aria-hidden>
        {expanded ? "▾" : "▸"}
      </span>
      <span className="mj-detail-toggle__label">{expanded ? "Ocultar" : hasDetail ? "Detalle" : "Ver"}</span>
    </button>
  );
}

export default function MisJuzgadosTableRows({
  item,
  activeTab,
  isAbogado,
  isExpanded,
  colSpan,
  onToggleExpand,
  renderSemaforo,
  renderJuzgado,
  renderResponsable,
  renderFecha,
  renderEstado,
  renderAccion,
  renderNotasEditor,
  formatCaratulaFull,
}: MisJuzgadosTableRowsProps) {
  const hasObs = Boolean(item.observaciones?.trim());
  const hasNotas = Boolean(item.notas?.trim());
  const showNotasBlock = activeTab === "expedientes";
  const hasDetail = showNotasBlock && (hasObs || hasNotas || true);

  return (
    <>
      <tr className={`mj-master-row${isExpanded ? " is-expanded" : ""}`}>
        <td>{renderSemaforo()}</td>
        <td className="mj-col-primary">
          {activeTab === "expedientes" && item.numero?.trim() ? (
            <div className="mj-expediente-num">{item.numero}</div>
          ) : null}
          <div className="mj-caratula-clamp" title={formatCaratulaFull(item.caratula)}>
            {item.caratula?.trim() ? item.caratula : <span className="muted">Sin carátula</span>}
          </div>
          {showNotasBlock && (hasObs || hasNotas) ? (
            <span className="mj-row-hint">Observaciones o notas — expandir</span>
          ) : null}
        </td>
        <td className="col-juzgado">{renderJuzgado()}</td>
        <td className="mj-col-responsable">{renderResponsable()}</td>
        <td>{renderFecha()}</td>
        <td className="mj-col-dias">
          {typeof item.dias === "number" && !Number.isNaN(item.dias) ? (
            item.dias
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        {(activeTab === "cedulas" || activeTab === "oficios") && (
          <td>{renderEstado?.()}</td>
        )}
        <td className="mj-col-cargado">
          {item.created_by ? (
            <span>{item.created_by}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        {isAbogado && (activeTab === "cedulas" || activeTab === "oficios") && (
          <td className="mj-col-accion">{renderAccion?.()}</td>
        )}
        <td className="mj-col-detail">
          <DetailToggle
            expanded={isExpanded}
            hasDetail={hasDetail}
            onClick={() => onToggleExpand(item.id)}
          />
        </td>
      </tr>
      {isExpanded && (
        <tr className="mj-detail-row">
          <td colSpan={colSpan}>
            <div className="mj-detail-panel">
              {activeTab === "expedientes" && item.numero?.trim() ? (
                <div className="mj-detail-meta">
                  <span>
                    <strong>Expediente:</strong> {item.numero}
                  </span>
                  {item.created_by ? (
                    <span>
                      <strong>Cargado por:</strong> {item.created_by}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="mj-detail-meta">
                  {item.created_by ? (
                    <span>
                      <strong>Cargado por:</strong> {item.created_by}
                    </span>
                  ) : null}
                </div>
              )}
              <div className="mj-caratula-full">
                <div className="mj-detail-card__label">Carátula completa</div>
                <pre className="mj-detail-card__body">
                  {formatCaratulaFull(item.caratula) || "Sin carátula"}
                </pre>
              </div>
              {showNotasBlock ? (
                <div className="mj-detail-grid">
                  <CopyableTextBlock
                    label="Observaciones"
                    text={item.observaciones}
                    emptyLabel="Sin observaciones"
                  />
                  <div className="mj-detail-card mj-detail-card--notas">
                    <div className="mj-detail-card__head">
                      <span className="mj-detail-card__label">Notas</span>
                    </div>
                    <div className="mj-detail-card__notas-editor">{renderNotasEditor()}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function getMisJuzgadosTableColSpan(
  activeTab: "expedientes" | "cedulas" | "oficios",
  isAbogado: boolean
): number {
  let cols = 8;
  if (activeTab === "cedulas" || activeTab === "oficios") cols += 1;
  if (isAbogado && activeTab !== "expedientes") cols += 1;
  return cols;
}
