import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

const NOTIFY_USER_IDS = [
  "90b5283f-27bf-4494-8562-be631f9b42f7", // Gustavo Hisi
  "6bda05cd-4223-4dc3-9320-ab6571e43763", // Jorge Ifran
];

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) return null;

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error,
    } = await supabaseClient.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { case_ref, orden_id, razon, caratula } = await req.json();

    if (!case_ref || typeof case_ref !== "string" || !case_ref.trim()) {
      return NextResponse.json({ error: "case_ref es requerido" }, { status: 400 });
    }
    if (!razon || typeof razon !== "string" || !razon.trim()) {
      return NextResponse.json({ error: "razon es requerida" }, { status: 400 });
    }

    const svc = supabaseService();
    const caseRef = case_ref.trim();
    const razonTrim = razon.trim();
    const observacionesRenuncia = `RENUNCIADO: ${razonTrim}`;
    const nowIso = new Date().toISOString();

    const { data: roleData } = await svc
      .from("user_roles")
      .select("is_superadmin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleData?.is_superadmin !== true) {
      return NextResponse.json(
        { error: "Solo superadmin puede renunciar" },
        { status: 403 }
      );
    }

    // Órdenes médicas a actualizar
    let ordenesQuery = svc
      .from("ordenes_medicas")
      .select("id, case_ref, expediente_id")
      .eq("case_ref", caseRef);

    if (orden_id) {
      ordenesQuery = svc
        .from("ordenes_medicas")
        .select("id, case_ref, expediente_id")
        .eq("id", orden_id);
    }

    const { data: ordenes, error: ordenesErr } = await ordenesQuery;
    if (ordenesErr) {
      return NextResponse.json(
        { error: "Error al buscar órdenes: " + ordenesErr.message },
        { status: 500 }
      );
    }

    const ordenIds = (ordenes || []).map((o) => o.id);

    if (ordenIds.length > 0) {
      const { error: omErr } = await svc
        .from("ordenes_medicas")
        .update({ estado: "RENUNCIADO" })
        .in("id", ordenIds);

      if (omErr) {
        return NextResponse.json(
          { error: "Error al actualizar ordenes_medicas: " + omErr.message },
          { status: 500 }
        );
      }

      const { error: geErr } = await svc
        .from("gestiones_estudio")
        .update({
          estado: "RENUNCIADO",
          semaforo_congelado: true,
          fecha_semaforo_congelado: nowIso,
        })
        .in("orden_id", ordenIds);

      if (geErr) {
        return NextResponse.json(
          { error: "Error al actualizar gestiones_estudio: " + geErr.message },
          { status: 500 }
        );
      }
    }

    // Expedientes por numero_expediente (coincidencia exacta o sin prefijo jurisdicción)
    const { error: expErr } = await svc
      .from("expedientes")
      .update({
        observaciones: observacionesRenuncia,
        semaforo_congelado: true,
        fecha_semaforo_congelado: nowIso,
      })
      .eq("numero_expediente", caseRef);

    if (expErr) {
      return NextResponse.json(
        { error: "Error al actualizar expedientes: " + expErr.message },
        { status: 500 }
      );
    }

    // Variante: case_ref "CIV 123/2024" vs numero_expediente "123/2024"
    const matchSlash = caseRef.match(/^[A-Z]+\s+(\d+\/\d{4})$/i);
    if (matchSlash) {
      await svc
        .from("expedientes")
        .update({
          observaciones: observacionesRenuncia,
          semaforo_congelado: true,
          fecha_semaforo_congelado: nowIso,
        })
        .eq("numero_expediente", matchSlash[1]);
    }

    let caratulaDisplay =
      typeof caratula === "string" && caratula.trim() ? caratula.trim() : "";

    if (!caratulaDisplay) {
      const { data: expRow } = await svc
        .from("expedientes")
        .select("caratula")
        .eq("numero_expediente", caseRef)
        .maybeSingle();
      caratulaDisplay = expRow?.caratula?.trim() || "";
    }
    if (!caratulaDisplay) {
      caratulaDisplay = "Sin carátula";
    }

    const notifRows = NOTIFY_USER_IDS.map((userId) => ({
      user_id: userId,
      title: `RENUNCIA - Exp ${caseRef}`,
      body: `Se renunció al expediente ${caseRef} - ${caratulaDisplay}. Razón: ${razonTrim}`,
      link: "/prueba-pericia",
      metadata: {
        source: "renuncia_pericia",
        case_ref: caseRef,
        razon: razonTrim,
      },
    }));

    const { error: notifErr } = await svc.from("notifications").insert(notifRows);
    if (notifErr) {
      console.error("[renunciar] Error creando notificaciones:", notifErr);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("[renunciar] error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
