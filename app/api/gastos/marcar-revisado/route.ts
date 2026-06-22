import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-api";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const gastoId = body?.gasto_id || body?.id;

    if (!gastoId) {
      return NextResponse.json({ error: "Falta gasto_id" }, { status: 400 });
    }

    const svc = supabaseService();
    const { data, error } = await svc
      .from("gastos_anticipo")
      .update({
        estado: "REVISADO",
        updated_at: new Date().toISOString(),
      })
      .eq("id", gastoId)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("[gastos/marcar-revisado]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
