import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-api";
import { supabaseService } from "@/lib/supabase-server";
import { notificarGastoAnticipo } from "@/lib/gastos-notificar";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const gastoId = body?.gasto_id || body?.id;
    const force = body?.force === true;

    if (!gastoId) {
      return NextResponse.json({ error: "Falta gasto_id" }, { status: 400 });
    }

    const svc = supabaseService();
    const result = await notificarGastoAnticipo(svc, gastoId, { force });

    if (!result.ok && result.reason !== "ya_notificado") {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      notificados: result.notificados,
      reason: result.reason,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("[gastos/notificar]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
