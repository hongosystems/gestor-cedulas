"use client";

import { Suspense } from "react";
import BandejaView from "@/app/components/bandeja/BandejaView";

export default function NotificacionesPage() {
  return (
    <Suspense fallback={<p className="helper">Cargando…</p>}>
      <BandejaView initialTab="todas" />
    </Suspense>
  );
}
