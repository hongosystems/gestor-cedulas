"use client";

import { useCallback, useEffect, useState } from "react";
import { useUserRoles } from "@/app/hooks/useUserRoles";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { ThemeProvider } from "./ThemeProvider";
import { PageSearchProvider } from "./PageSearchContext";

type AppShellProps = {
  children: React.ReactNode;
};

const SIDEBAR_COLLAPSED_KEY = "gestor-sidebar-collapsed";

export default function AppShell({ children }: AppShellProps) {
  const { roles, loading, userEmail, userName } = useUserRoles();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add("app-shell-active");
    return () => document.body.classList.remove("app-shell-active");
  }, []);

  const onToggleSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  if (loading) {
    return (
      <div className="app-shell app-shell--loading">
        <div className="app-shell-loading-msg">Cargando…</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <PageSearchProvider>
      <div
        className={[
          "app-shell",
          collapsed ? "sidebar-collapsed" : "",
          mobileOpen ? "sidebar-mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {mobileOpen && (
          <button
            type="button"
            className="app-shell-backdrop"
            aria-label="Cerrar menú"
            onClick={closeMobile}
          />
        )}

        <Sidebar
          roles={roles}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onNavigate={closeMobile}
        />

        <div className="app-shell-main">
          <Topbar
            sidebarCollapsed={collapsed}
            onToggleSidebar={onToggleSidebar}
            userName={userName}
            userEmail={userEmail}
          />
          <div className="app-shell-content">{children}</div>
        </div>
      </div>
      </PageSearchProvider>
    </ThemeProvider>
  );
}
