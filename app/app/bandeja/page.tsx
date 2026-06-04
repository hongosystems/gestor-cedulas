"use client";

import { Suspense } from "react";
import BandejaView from "@/app/components/bandeja/BandejaView";

function BandejaPageInner() {
  return <BandejaView />;
}

export default function BandejaPage() {
  return (
    <Suspense fallback={<p className="helper">Cargando bandeja…</p>}>
      <BandejaPageInner />
    </Suspense>
  );
}
