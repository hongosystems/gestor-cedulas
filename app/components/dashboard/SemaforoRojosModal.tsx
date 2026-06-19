"use client";

import Link from "next/link";
import StatusBadge from "@/app/components/ui/StatusBadge";
import type { DocumentoRojoDashboard } from "@/lib/semaforo-dashboard-rojos";

type Props = {
  title: string;
  subtitle?: string;
  items: DocumentoRojoDashboard[];
  onClose: () => void;
};

export default function SemaforoRojosModal({ title, subtitle, items, onClose }: Props) {
  return (
    <div
      className="semaforo-rojos-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="semaforo-rojos-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="semaforo-rojos-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="semaforo-rojos-modal__header">
          <div>
            <h3 id="semaforo-rojos-modal-title">{title}</h3>
            {subtitle && <p className="semaforo-rojos-modal__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="semaforo-rojos-modal__close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No hay documentos rojos en este grupo.</p>
        ) : (
          <ul className="semaforo-rojos-modal__list">
            {items.map((doc) => (
              <li key={`${doc.tipo}-${doc.id}`} className="semaforo-rojos-modal__row">
                <div className="semaforo-rojos-modal__main">
                  <span className="semaforo-rojos-modal__tipo">{doc.tipoLabel}</span>
                  <span className="semaforo-rojos-modal__caratula">{doc.caratula}</span>
                  {doc.juzgado && (
                    <span className="semaforo-rojos-modal__juzgado">{doc.juzgado}</span>
                  )}
                </div>
                <div className="semaforo-rojos-modal__meta">
                  <StatusBadge value="ROJO" />
                  <span className="semaforo-rojos-modal__dias">
                    {typeof doc.dias === "number" ? `${doc.dias} d` : "—"}
                  </span>
                  <Link href={doc.href} className="semaforo-rojos-modal__link">
                    Ver en pantalla operativa
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
