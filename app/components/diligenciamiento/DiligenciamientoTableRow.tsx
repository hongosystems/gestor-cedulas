"use client";

import React from "react";
import CopyableTextBlock from "@/app/components/ui/CopyableTextBlock";
import MasterDetailToggle from "@/app/components/ui/MasterDetailToggle";

export type DiligenciamientoRowItem = {
  id: string;
  caratula: string | null;
  ocr_exp_nro?: string | null;
  juzgado?: string | null;
  observaciones_pjn?: string | null;
};

type DiligenciamientoTableRowProps = {
  item: DiligenciamientoRowItem;
  isExpanded: boolean;
  colSpan: number;
  showPjnColumn: boolean;
  onToggleExpand: (id: string) => void;
  renderTipo: () => React.ReactNode;
  renderFecha: () => React.ReactNode;
  renderAccionesCompact: () => React.ReactNode;
  renderAccionesDetail: () => React.ReactNode;
  renderPjnEstado?: () => React.ReactNode;
};

export function getDiligenciamientoColSpan(showPjnColumn: boolean): number {
  return showPjnColumn ? 7 : 6;
}

export default function DiligenciamientoTableRow({
  item,
  isExpanded,
  colSpan,
  showPjnColumn,
  onToggleExpand,
  renderTipo,
  renderFecha,
  renderAccionesCompact,
  renderAccionesDetail,
  renderPjnEstado,
}: DiligenciamientoTableRowProps) {
  const hasObs = Boolean(item.observaciones_pjn?.trim());

  return (
    <>
      <tr className={`mj-master-row${isExpanded ? " is-expanded" : ""}`}>
        <td>{renderTipo()}</td>
        <td className="mj-col-primary">
          {item.ocr_exp_nro?.trim() ? (
            <div className="mj-expediente-num">{item.ocr_exp_nro}</div>
          ) : null}
          <div className="mj-caratula-clamp" title={(item.caratula || "").trim()}>
            {item.caratula?.trim() || <span className="muted">Sin carátula</span>}
          </div>
          {hasObs ? <span className="mj-row-hint">Observaciones PJN — expandir</span> : null}
        </td>
        <td className="col-juzgado">{item.juzgado?.trim() || <span className="muted">—</span>}</td>
        <td>{renderFecha()}</td>
        <td className="mj-col-acciones-compact">{renderAccionesCompact()}</td>
        {showPjnColumn && <td>{renderPjnEstado?.()}</td>}
        <td className="mj-col-detail">
          <MasterDetailToggle
            expanded={isExpanded}
            onClick={() => onToggleExpand(item.id)}
            hasHint={hasObs}
          />
        </td>
      </tr>
      {isExpanded && (
        <tr className="mj-detail-row">
          <td colSpan={colSpan}>
            <div className="mj-detail-panel">
              <div className="mj-caratula-full">
                <div className="mj-detail-card__label">Carátula completa</div>
                <pre className="mj-detail-card__body">
                  {(item.caratula || "").trim() || "Sin carátula"}
                </pre>
              </div>
              <div className="mj-detail-grid mj-detail-grid--stack">
                <CopyableTextBlock
                  label="Observaciones PJN"
                  text={item.observaciones_pjn}
                  emptyLabel="Sin observaciones registradas"
                />
              </div>
              <div className="mj-detail-card" style={{ marginTop: 16 }}>
                <div className="mj-detail-card__label">Acciones</div>
                <div className="mj-detail-actions">{renderAccionesDetail()}</div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
