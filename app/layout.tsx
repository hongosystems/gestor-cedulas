import "./globals.css";

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

        {/* watermark sutil en toda la app */}
        <div className="watermark" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </div>
      </body>
    </html>
  );
}
