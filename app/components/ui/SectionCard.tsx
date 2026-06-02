import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
};

export default function SectionCard({
  title,
  children,
  className = "",
  actions,
}: SectionCardProps) {
  return (
    <section className={`section-card ${className}`.trim()}>
      {(title || actions) && (
        <div className="section-card__head">
          {title && <h2 className="section-card__title">{title}</h2>}
          {actions && <div className="section-card__actions">{actions}</div>}
        </div>
      )}
      <div className="section-card__body">{children}</div>
    </section>
  );
}
