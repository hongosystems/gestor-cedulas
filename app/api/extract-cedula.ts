// app/api/extract-cedula/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  // Stub: ya NO intentamos leer PDF acá.
  return NextResponse.json({ ok: true });
}
