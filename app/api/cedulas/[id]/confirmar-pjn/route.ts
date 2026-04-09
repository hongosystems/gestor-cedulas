import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: cedulaId } = await context.params;
  if (!cedulaId) {
    return NextResponse.json({ error: "ID requerido" }, { status: 400 });
  }

  const svc = supabaseService();
  const body = await req.json().catch(() => ({} as { reset?: boolean }));
  const reset = body?.reset === true;
  const pjn_cargado_at = reset ? null : new Date().toISOString();

  const { error } = await svc
    .from("cedulas")
    .update({ pjn_cargado_at })
    .eq("id", cedulaId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pjn_cargado_at, reset });
}
