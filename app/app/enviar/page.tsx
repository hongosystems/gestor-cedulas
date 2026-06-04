"use client";

import { Suspense } from "react";
import BandejaView from "@/app/components/bandeja/BandejaView";

export default function EnviarPage() {
  return (
    <Suspense fallback={<p className="helper">Cargando…</p>}>
      <BandejaView initialTab="nuevo" />
    </Suspense>
  );
}
