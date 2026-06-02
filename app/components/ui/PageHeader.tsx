import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: ReactNode;
};

export default function PageHeader({ title, subtitle, actions, meta }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        <div>
          <h1 className="page-header__title">{title}</h1>
          {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
        </div>
        {meta && <div className="page-header__meta">{meta}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
