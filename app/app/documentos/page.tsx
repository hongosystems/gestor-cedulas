"use client";

import { Suspense } from "react";
import TransfersView from "@/app/components/bandeja/TransfersView";

export default function DocumentosPage() {
  return (
    <Suspense fallback={<p className="helper">Cargando…</p>}>
      <TransfersView />
    </Suspense>
  );
}
