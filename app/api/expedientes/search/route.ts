import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/auth-api";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

export type ExpedienteSearchItem = {
  id: string;
  source: "pjn_favoritos" | "expedientes";
  ref: string;
  label: string;
  caratula: string | null;
  juzgado: string | null;
  fecha: string | null;
};

function sanitizeQuery(raw: string) {
  return raw.replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

function buildOrIlike(fields: string[], pattern: string) {
  const escaped = pattern.replace(/"/g, '\\"');
  return fields.map((f) => `${f}.ilike."${escaped}"`).join(",");
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = sanitizeQuery(req.nextUrl.searchParams.get("q") || "");
    if (q.length < 3) {
      return NextResponse.json({ results: [] as ExpedienteSearchItem[] });
    }

    const pattern = `%${q}%`;
    const svc = supabaseService();
    const results: ExpedienteSearchItem[] = [];
    const seen = new Set<string>();

    const push = (item: ExpedienteSearchItem) => {
      const key = `${item.source}:${item.ref}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(item);
    };

    const { data: pjnRows, error: pjnErr } = await svc
      .from("pjn_favoritos")
      .select("id, jurisdiccion, numero, anio, caratula, juzgado, fecha_ultima_carga")
      .or(buildOrIlike(["numero", "caratula", "juzgado"], pattern))
      .order("updated_at", { ascending: false })
      .limit(12);

    if (pjnErr) {
      console.error("[expedientes/search] pjn_favoritos:", pjnErr.message);
    } else {
      for (const row of pjnRows ?? []) {
        const numero = String(row.numero ?? "").trim();
        const anio = row.anio;
        if (!numero || anio == null) continue;
        const juris = String(row.jurisdiccion ?? "CIV").trim();
        const ref = `${numero}/${anio}`;
        push({
          id: String(row.id),
          source: "pjn_favoritos",
          ref,
          label: `${juris} ${numero}/${anio}`,
          caratula: row.caratula ?? null,
          juzgado: row.juzgado ?? null,
          fecha: row.fecha_ultima_carga ?? null,
        });
      }
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (url && anon && token) {
      const userDb = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });

      const { data: expRows, error: expErr } = await userDb
        .from("expedientes")
        .select("id, numero_expediente, caratula, juzgado, fecha_ultima_modificacion")
        .or(buildOrIlike(["numero_expediente", "caratula", "juzgado"], pattern))
        .order("updated_at", { ascending: false })
        .limit(12);

      if (expErr) {
        console.error("[expedientes/search] expedientes:", expErr.message);
      } else {
        for (const row of expRows ?? []) {
          const num = String(row.numero_expediente ?? "").trim();
          const ref = num || String(row.id);
          push({
            id: String(row.id),
            source: "expedientes",
            ref,
            label: num || (row.caratula ? row.caratula.slice(0, 60) : "Expediente"),
            caratula: row.caratula ?? null,
            juzgado: row.juzgado ?? null,
            fecha: row.fecha_ultima_modificacion ?? null,
          });
        }
      }
    }

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("[expedientes/search]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
