import "./globals.css";
import NotificationBellWrapper from "./components/NotificationBellWrapper";
import ChatWidget from "./components/ChatWidget";

export const metadata = {
  title: "Gestor de Cédulas",
  description: "Gestión de cédulas y alertas",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}

        {/* Campanita de notificaciones fija en todas las páginas */}
        <NotificationBellWrapper />

        {/* Widget de chat interno */}
        <ChatWidget />

        {/* watermark sutil en toda la app */}
        <div className="watermark" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </div>
      </body>
    </html>
  );
}
