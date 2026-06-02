"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getActiveNavItemId,
  getShellNavItems,
  isActive,
  type UserRoleFlags,
} from "@/lib/shell-nav";

type SidebarProps = {
  roles: UserRoleFlags;
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate?: () => void;
};

const GROUP_LABELS: Record<string, string> = {
  menu: "Menú",
  modulos: "Módulos",
  operaciones: "Envíos y carga",
  admin: "Administración",
};

export default function Sidebar({
  roles,
  collapsed,
  mobileOpen,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const items = getShellNavItems(roles);
  const activeNavId = getActiveNavItemId(items, pathname);

  const groups = ["menu", "modulos", "operaciones", "admin"] as const;

  return (
    <aside
      className={[
        "app-shell-sidebar",
        collapsed ? "is-collapsed" : "",
        mobileOpen ? "is-mobile-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Navegación principal"
    >
      <div className="app-shell-brand">
        <img className="logoMini" src="/logo.png" alt="" />
        {!collapsed && (
          <div className="app-shell-brand-text">
            <span className="app-shell-brand-title">Estudio HIF</span>
            <span className="app-shell-brand-sub">Sistemas</span>
          </div>
        )}
      </div>

      <nav className="app-shell-nav">
        {groups.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="app-shell-nav-group">
              {!collapsed && (
                <div className="app-shell-nav-group-label">{GROUP_LABELS[group]}</div>
              )}
              <ul className="app-shell-nav-list">
                {groupItems.map((item) => {
                  const active = isActive(item, pathname, activeNavId);
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className={`app-shell-nav-link${active ? " is-active" : ""}`}
                        title={collapsed ? item.label : undefined}
                        onClick={onNavigate}
                      >
                        <span className="app-shell-nav-dot" aria-hidden />
                        {!collapsed && <span>{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
