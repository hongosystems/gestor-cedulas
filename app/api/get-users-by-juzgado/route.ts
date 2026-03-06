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

/**
 * Obtiene los usuarios asignados a un juzgado específico
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { juzgado, caratula } = body;

    if (!juzgado || !juzgado.trim()) {
      return NextResponse.json(
        { error: "Falta el parámetro 'juzgado'." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Obtener todos los juzgados asignados
    const { data: allJuzgados, error: juzgadosError } = await supabase
      .from("user_juzgados")
      .select("user_id, juzgado");

    if (juzgadosError) {
      console.error("[get-users-by-juzgado] Error al obtener juzgados:", juzgadosError);
      return NextResponse.json(
        { error: "Error al buscar en la base de datos." },
        { status: 500 }
      );
    }

    // Filtrar juzgados que coinciden con el buscado
    const juzgadosCoincidentes = (allJuzgados || []).filter(uj => 
      juzgadosCoinciden(uj.juzgado, juzgado)
    );

    // Obtener IDs únicos de usuarios
    let userIds = [...new Set(juzgadosCoincidentes.map(uj => uj.user_id))];

    // Verificar si la carátula contiene "S/BENEFICIO DE LITIGAR SIN GASTOS"
    const tieneBeneficio = caratula && 
      /S\/BENEFICIO\s+DE\s+LITIGAR\s+SIN\s+GASTOS/i.test(caratula);

    if (tieneBeneficio) {
      // Buscar a Guido Querinuzzi por email
      const { data: guidoProfile, error: guidoError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .ilike("email", "victoria.estudiohisi@gmail.com")
        .maybeSingle();

      if (!guidoError && guidoProfile && guidoProfile.id) {
        // Agregar a Guido si no está ya en la lista
        if (!userIds.includes(guidoProfile.id)) {
          userIds.push(guidoProfile.id);
        }
      }
    }

    if (userIds.length === 0) {
      return NextResponse.json({
        usuarios: [],
        mensaje: "No hay usuarios asignados a este juzgado."
      });
    }

    // Obtener información de los usuarios desde profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);

    if (profilesError) {
      console.error("[get-users-by-juzgado] Error al obtener perfiles:", profilesError);
      return NextResponse.json(
        { error: "Error al obtener información de usuarios." },
        { status: 500 }
      );
    }

    // Mapear usuarios con su información
    const usuarios = (profiles || []).map(profile => ({
      id: profile.id,
      nombre: profile.full_name || profile.email || "Usuario sin nombre",
      email: profile.email || "",
      esBeneficio: tieneBeneficio && profile.email?.toLowerCase() === "victoria.estudiohisi@gmail.com"
    }));

    return NextResponse.json({
      usuarios,
      mensaje: usuarios.length === 1 
        ? "Esta cédula será recibida por:" 
        : "Esta cédula será recibida por:"
    });
  } catch (e: any) {
    console.error("[get-users-by-juzgado] Error general:", e);
    return NextResponse.json(
      { error: e?.message || "Error procesando búsqueda." },
      { status: 500 }
    );
  }
}
