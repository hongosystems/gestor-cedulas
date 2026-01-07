// app/api/extract-juzgado/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  // Stub: ya NO intentamos leer PDF/DOC aquí para evitar pdfjs/canvas/DOMMatrix.
  return NextResponse.json({ juzgado: null });
}
