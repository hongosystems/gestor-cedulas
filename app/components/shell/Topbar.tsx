"use client";

import ThemeToggle from "./ThemeToggle";
import NotificationButton from "./NotificationButton";
import UserMenu from "./UserMenu";
import GlobalSearch from "./GlobalSearch";

type TopbarProps = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  userName: string | null;
  userEmail: string | null;
};

export default function Topbar({
  sidebarCollapsed,
  onToggleSidebar,
  userName,
  userEmail,
}: TopbarProps) {
  return (
    <header className="app-shell-topbar">
      <div className="app-shell-topbar-left">
        <button
          type="button"
          className="shell-icon-btn"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Expandir menú" : "Colapsar menú"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <GlobalSearch />
      </div>

      <div className="app-shell-topbar-right">
        <ThemeToggle />
        <NotificationButton />
        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
