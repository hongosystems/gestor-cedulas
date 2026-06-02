"use client";

import React from "react";
import CopyableTextBlock from "@/app/components/ui/CopyableTextBlock";
import type { MisJuzgadosTableItem } from "./MisJuzgadosTableRows";

type MisJuzgadosMobileCardsProps = {
  items: MisJuzgadosTableItem[];
  activeTab: "expedientes" | "cedulas" | "oficios";
  isAbogado: boolean;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  renderSemaforo: (item: MisJuzgadosTableItem) => React.ReactNode;
  renderJuzgado: (item: MisJuzgadosTableItem) => React.ReactNode;
  renderResponsable: (item: MisJuzgadosTableItem) => React.ReactNode;
  renderFecha: (item: MisJuzgadosTableItem) => React.ReactNode;
  renderEstado?: (item: MisJuzgadosTableItem) => React.ReactNode;
  renderAccion?: (item: MisJuzgadosTableItem) => React.ReactNode;
  renderNotasEditor: (item: MisJuzgadosTableItem) => React.ReactNode;
  formatCaratulaFull: (text: string | null) => string;
};

export default function MisJuzgadosMobileCards({
  items,
  activeTab,
  isAbogado,
  expandedId,
  onToggleExpand,
  renderSemaforo,
  renderJuzgado,
  renderResponsable,
  renderFecha,
  renderEstado,
  renderAccion,
  renderNotasEditor,
  formatCaratulaFull,
}: MisJuzgadosMobileCardsProps) {
  const showNotasBlock = activeTab === "expedientes";

  if (items.length === 0) {
    return (
      <div className="mj-mobile-cards">
        <p className="muted" style={{ padding: "16px 4px", textAlign: "center", fontSize: 13 }}>
          No hay resultados con los filtros actuales.
        </p>
      </div>
    );
  }

  return (
    <div className="mj-mobile-cards">
      {items.map((item) => {
        const isExpanded = expandedId === item.id;
        return (
          <article key={item.id} className={`mj-record-card${isExpanded ? " is-expanded" : ""}`}>
            <div className="mj-record-card__head">
              {renderSemaforo(item)}
              <div className="mj-record-card__title">
                {activeTab === "expedientes" && item.numero?.trim() ? (
                  <div className="mj-expediente-num">{item.numero}</div>
                ) : null}
                <div className="mj-caratula-clamp">{item.caratula?.trim() || "Sin carátula"}</div>
              </div>
              <button
                type="button"
                className="mj-detail-toggle"
                onClick={() => onToggleExpand(item.id)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? "▾" : "▸"}
              </button>
            </div>
            <dl className="mj-record-card__meta">
              <div>
                <dt>Juzgado</dt>
                <dd>{renderJuzgado(item)}</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{renderFecha(item)}</dd>
              </div>
              <div>
                <dt>Días</dt>
                <dd>{typeof item.dias === "number" ? item.dias : "—"}</dd>
              </div>
              <div>
                <dt>Responsable</dt>
                <dd>{renderResponsable(item)}</dd>
              </div>
              {(activeTab === "cedulas" || activeTab === "oficios") && (
                <div>
                  <dt>Estado</dt>
                  <dd>{renderEstado?.(item)}</dd>
                </div>
              )}
              <div>
                <dt>Cargado por</dt>
                <dd>{item.created_by || "—"}</dd>
              </div>
            </dl>
            {isAbogado && (activeTab === "cedulas" || activeTab === "oficios") && renderAccion?.(item) ? (
              <div className="mj-record-card__actions">{renderAccion(item)}</div>
            ) : null}
            {isExpanded && (
              <div className="mj-detail-panel mj-detail-panel--card">
                <div className="mj-caratula-full">
                  <div className="mj-detail-card__label">Carátula completa</div>
                  <pre className="mj-detail-card__body">
                    {formatCaratulaFull(item.caratula) || "Sin carátula"}
                  </pre>
                </div>
                {showNotasBlock ? (
                  <div className="mj-detail-grid mj-detail-grid--stack">
                    <CopyableTextBlock
                      label="Observaciones"
                      text={item.observaciones}
                      emptyLabel="Sin observaciones"
                    />
                    <div className="mj-detail-card mj-detail-card--notas">
                      <div className="mj-detail-card__label">Notas</div>
                      <div className="mj-detail-card__notas-editor">{renderNotasEditor(item)}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
