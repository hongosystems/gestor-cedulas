import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Faltan variables de entorno de Supabase");
  }
  
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Normaliza un juzgado para comparación
 */
function normalizarJuzgado(j: string | null): string {
  if (!j) return "";
  const normalized = j.trim().replace(/\s+/g, " ").toUpperCase();
  
  // Intentar extraer número de juzgado civil
  const matchCivil = normalized.match(/JUZGADO\s+(?:NACIONAL\s+EN\s+LO\s+)?CIVIL\s+(?:N[°º]?\s*)?(\d+)/i);
  if (matchCivil && matchCivil[1]) {
    return `JUZGADO CIVIL ${matchCivil[1]}`;
  }
  
  // Si no es civil, intentar extraer cualquier número después de "JUZGADO"
  const matchGeneric = normalized.match(/JUZGADO[^0-9]*?(\d+)/i);
  if (matchGeneric && matchGeneric[1]) {
    if (normalized.includes("CIVIL")) {
      return `JUZGADO CIVIL ${matchGeneric[1]}`;
    }
    return normalized;
  }
  
  return normalized;
}

/**
 * Compara si dos juzgados coinciden
 */
function juzgadosCoinciden(j1: string, j2: string): boolean {
  const n1 = normalizarJuzgado(j1);
  const n2 = normalizarJuzgado(j2);
  
  if (n1 === n2) return true;
  
  const num1 = n1.match(/(\d+)/)?.[1];
  const num2 = n2.match(/(\d+)/)?.[1];
  
  if (num1 && num2 && num1 === num2) {
    if (n1.includes("JUZGADO") && n2.includes("JUZGADO") && 
        n1.includes("CIVIL") && n2.includes("CIVIL")) {
      return true;
    }
  }
  
  return false;
}

function getCacheKey(juzgado: string | null, caratula: string | null): string {
  return `${juzgado?.trim() || ""}|||${caratula?.trim() || ""}`;
}

async function getUsuariosPorJuzgado(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  juzgado: string,
  caratula: string | null
): Promise<{ id: string; nombre: string; email: string; esBeneficio: boolean }[]> {
  const tieneBeneficio = caratula && 
    /S\/BENEFICIO\s+DE\s+LITIGAR\s+SIN\s+GASTOS/i.test(caratula);

  const { data: allJuzgados, error: juzgadosError } = await supabase
    .from("user_juzgados")
    .select("user_id, juzgado");

  if (juzgadosError) return [];

  const juzgadosCoincidentes = (allJuzgados || []).filter(uj => 
    juzgadosCoinciden(uj.juzgado, juzgado)
  );

  let userIds = [...new Set(juzgadosCoincidentes.map(uj => uj.user_id))];

  if (tieneBeneficio) {
    const { data: guidoProfile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", "victoria.estudiohisi@gmail.com")
      .maybeSingle();

    if (guidoProfile?.id && !userIds.includes(guidoProfile.id)) {
      userIds.push(guidoProfile.id);
    }
  }

  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  if (profilesError) return [];

  return (profiles || []).map(profile => ({
    id: profile.id,
    nombre: profile.full_name || profile.email || "Usuario sin nombre",
    email: profile.email || "",
    esBeneficio: Boolean(tieneBeneficio && profile.email?.toLowerCase() === "victoria.estudiohisi@gmail.com")
  }));
}

/**
 * Obtiene los usuarios asignados a un juzgado (o varios en batch)
 * Body: { juzgado, caratula } para un solo juzgado
 * Body: { items: [{ juzgado, caratula }] } para batch
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { juzgado, caratula, items } = body;

    // Modo batch
    if (Array.isArray(items) && items.length > 0) {
      const supabase = getSupabaseAdmin();
      const keys = [...new Set(items.map((i: { juzgado?: string; caratula?: string }) => 
        getCacheKey(i.juzgado || "", i.caratula || null)
      ))];
      const map: Record<string, { id: string; nombre: string; email: string; esBeneficio: boolean }[]> = {};

      for (const key of keys) {
        const [j, c] = key.split("|||");
        if (j?.trim()) {
          map[key] = await getUsuariosPorJuzgado(supabase, j, c || null);
        } else {
          map[key] = [];
        }
      }

      return NextResponse.json({ map });
    }

    // Modo single (retrocompatible)
    if (!juzgado || !juzgado.trim()) {
      return NextResponse.json(
        { error: "Falta el parámetro 'juzgado'." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const usuarios = await getUsuariosPorJuzgado(supabase, juzgado, caratula || null);

    return NextResponse.json({
      usuarios,
      mensaje: usuarios.length >= 1 ? "Esta cédula será recibida por:" : "No hay usuarios asignados."
    });
  } catch (e: any) {
    console.error("[get-users-by-juzgado] Error general:", e);
    return NextResponse.json(
      { error: e?.message || "Error procesando búsqueda." },
      { status: 500 }
    );
  }
}
