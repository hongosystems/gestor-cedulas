"use client";

import NotificationBell from "@/app/components/NotificationBell";

export default function NotificationButton() {
  return (
    <div className="shell-icon-btn shell-notification-btn" data-notification-bell="topbar">
      <NotificationBell variant="topbar" />
    </div>
  );
}
