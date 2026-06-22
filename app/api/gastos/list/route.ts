import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-api";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const BUCKET = "gastos-pericia";

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const estado = req.nextUrl.searchParams.get("estado");
    const juzgado = req.nextUrl.searchParams.get("juzgado");

    const svc = supabaseService();
    let query = svc
      .from("gastos_anticipo")
      .select("*")
      .order("created_at", { ascending: false });

    if (estado) query = query.eq("estado", estado);
    if (juzgado) query = query.ilike("juzgado", `%${juzgado}%`);

    const { data, error } = await query;

    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({
          ok: true,
          data: [],
          warning: "Tabla gastos_anticipo no existe. Ejecutar migración.",
        });
      }
      throw error;
    }

    const rows = await Promise.all(
      (data || []).map(async (row) => {
        let pdf_signed_url: string | null = null;
        if (row.pdf_storage_path) {
          const { data: signed } = await svc.storage
            .from(BUCKET)
            .createSignedUrl(row.pdf_storage_path, 3600);
          pdf_signed_url = signed?.signedUrl || null;
        }
        return { ...row, pdf_signed_url };
      })
    );

    return NextResponse.json({ ok: true, data: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("[gastos/list]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
