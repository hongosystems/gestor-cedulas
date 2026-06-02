import "./globals.css";
import NotificationBellWrapper from "./components/NotificationBellWrapper";
import AppShellGate from "./components/shell/AppShellGate";
import ThemeScript from "./components/shell/ThemeScript";

export const metadata = {
  title: "Gestor de Cédulas",
  description: "Gestión de cédulas y alertas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <AppShellGate>{children}</AppShellGate>

        {/* Campanita de notificaciones fija en páginas sin sesión (login, etc.) */}
        <NotificationBellWrapper />
      </body>
    </html>
  );
}
