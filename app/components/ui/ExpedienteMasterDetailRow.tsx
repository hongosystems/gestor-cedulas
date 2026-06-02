"use client";

import React from "react";
import CopyableTextBlock from "@/app/components/ui/CopyableTextBlock";
import MasterDetailToggle from "@/app/components/ui/MasterDetailToggle";

export type ExpedienteMasterDetailItem = {
  id: string;
  caratula: string | null;
  juzgado: string | null;
  numero?: string | null;
  created_by?: string | null;
  dias?: number | null;
  observaciones?: string | null;
  notas?: string | null;
};

type ExpedienteMasterDetailRowProps = {
  item: ExpedienteMasterDetailItem;
  isExpanded: boolean;
  colSpan: number;
  onToggleExpand: (id: string) => void;
  renderSemaforo: () => React.ReactNode;
  renderJuzgado: () => React.ReactNode;
  renderFecha: () => React.ReactNode;
  renderCargadoPor?: () => React.ReactNode;
  renderNotasEditor: () => React.ReactNode;
  renderTrailingCells?: () => React.ReactNode;
  rowStyle?: React.CSSProperties;
  showObservacionesNotas?: boolean;
};

export function getExpedienteMasterDetailColSpan(extraColumns = 0): number {
  return 7 + extraColumns;
}

export default function ExpedienteMasterDetailRow({
  item,
  isExpanded,
  colSpan,
  onToggleExpand,
  renderSemaforo,
  renderJuzgado,
  renderFecha,
  renderCargadoPor,
  renderNotasEditor,
  renderTrailingCells,
  rowStyle,
  showObservacionesNotas = true,
}: ExpedienteMasterDetailRowProps) {
  const hasObs = Boolean(item.observaciones?.trim());
  const hasNotas = Boolean(item.notas?.trim());

  return (
    <>
      <tr className={`mj-master-row${isExpanded ? " is-expanded" : ""}`} style={rowStyle}>
        <td>{renderSemaforo()}</td>
        <td className="mj-col-primary">
          {item.numero?.trim() ? <div className="mj-expediente-num">{item.numero}</div> : null}
          <div className="mj-caratula-clamp" title={(item.caratula || "").trim()}>
            {item.caratula?.trim() ? item.caratula : <span className="muted">Sin carátula</span>}
          </div>
          {showObservacionesNotas && (hasObs || hasNotas) ? (
            <span className="mj-row-hint">Observaciones o notas — expandir</span>
          ) : null}
        </td>
        <td className="col-juzgado">{renderJuzgado()}</td>
        <td>{renderFecha()}</td>
        <td className="mj-col-dias">
          {typeof item.dias === "number" && !Number.isNaN(item.dias) ? (
            item.dias
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="mj-col-cargado">
          {renderCargadoPor ? (
            renderCargadoPor()
          ) : item.created_by ? (
            <span>{item.created_by}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        {renderTrailingCells?.()}
        <td className="mj-col-detail">
          <MasterDetailToggle
            expanded={isExpanded}
            onClick={() => onToggleExpand(item.id)}
            hasHint={hasObs || hasNotas || showObservacionesNotas}
          />
        </td>
      </tr>
      {isExpanded && (
        <tr className="mj-detail-row">
          <td colSpan={colSpan}>
            <div className="mj-detail-panel">
              <div className="mj-detail-meta">
                {item.numero?.trim() ? (
                  <span>
                    <strong>Expediente:</strong> {item.numero}
                  </span>
                ) : null}
                {item.created_by ? (
                  <span>
                    <strong>Cargado por:</strong> {item.created_by}
                  </span>
                ) : null}
              </div>
              <div className="mj-caratula-full">
                <div className="mj-detail-card__label">Carátula completa</div>
                <pre className="mj-detail-card__body">
                  {(item.caratula || "").trim() || "Sin carátula"}
                </pre>
              </div>
              {showObservacionesNotas ? (
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
