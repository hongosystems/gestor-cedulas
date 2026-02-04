"use client";

import NotificationBell from "./NotificationBell";

export default function NotificationBellWrapper() {
  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 9999,
      }}
    >
      <NotificationBell />
    </div>
  );
}
