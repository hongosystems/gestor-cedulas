import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  try {
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    if (!url || !anon) {
      return null;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }

    return user;
  } catch (e: any) {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      console.error("[ordenes-medicas/list] No autorizado - usuario no encontrado");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[ordenes-medicas/list] Usuario autenticado:", user.id);

    const svc = supabaseService();

    // Verificar si es superadmin o admin
    const { data: roleData } = await svc
      .from("user_roles")
      .select("is_superadmin, is_admin_expedientes")
      .eq("user_id", user.id)
      .maybeSingle();

    const isSuperadmin = roleData?.is_superadmin === true;
    const isAdminExp = roleData?.is_admin_expedientes === true;

    // Obtener órdenes médicas (con filtros según permisos)
    let ordenesQuery = svc
      .from("ordenes_medicas")
      .select(`
        id,
        case_ref,
        expediente_id,
        filename,
        estado,
        created_at,
        updated_at,
        emitida_por_user_id,
        expedientes:expediente_id (
          id,
          caratula,
          juzgado,
          numero_expediente,
          owner_user_id
        )
      `)
      .order("created_at", { ascending: false });

    // Si no es admin, primero obtener todas las órdenes y filtrar después
    // (porque Supabase no permite OR con relaciones anidadas en un solo query)
    let ordenes: any[] = [];
    let ordenesError: any = null;

    if (!isSuperadmin && !isAdminExp) {
      // Obtener todas las órdenes sin filtro de relaciones
      const { data: allOrdenes, error: allError } = await ordenesQuery;
      
      if (allError) {
        ordenesError = allError;
      } else {
        // Filtrar en memoria: órdenes propias o de expedientes propios
        ordenes = (allOrdenes || []).filter((orden: any) => {
          // Si es el emisor, incluir
          if (orden.emitida_por_user_id === user.id) {
            return true;
          }
          // Si tiene expediente y el expediente es del usuario, incluir
          if (orden.expedientes && orden.expedientes.owner_user_id === user.id) {
            return true;
          }
          return false;
        });
      }
    } else {
      // Si es admin, obtener todas sin filtrar
      const result = await ordenesQuery;
      ordenes = result.data || [];
      ordenesError = result.error;
    }

    if (ordenesError) {
      console.error("Error obteniendo órdenes:", ordenesError);
      
      // Si la tabla no existe, retornar array vacío en lugar de error
      if (ordenesError.message?.includes("does not exist") || 
          ordenesError.message?.includes("relation") ||
          ordenesError.code === "PGRST116") {
        console.warn("Tabla ordenes_medicas no existe. Ejecutar migración SQL.");
        return NextResponse.json({
          ok: true,
          data: [],
          warning: "Tabla ordenes_medicas no existe. Ejecutar migración: migrations/create_ordenes_medicas_tables.sql"
        });
      }
      
      return NextResponse.json(
        { error: "Error al obtener órdenes: " + ordenesError.message },
        { status: 500 }
      );
    }

    // Si no hay órdenes, retornar array vacío
    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({
        ok: true,
        data: [],
      });
    }

    // Obtener gestiones para cada orden
    const ordenIds = ordenes.map((o: any) => o.id);
    
    let gestiones: any[] = [];
    let gestionesError: any = null;

    if (ordenIds.length > 0) {
      let gestionesQuery = svc
        .from("gestiones_estudio")
        .select(`
          id,
          orden_id,
          estado,
          centro_medico,
          turno_fecha_hora,
          fecha_estudio_realizado,
          responsable_user_id,
          created_at,
          updated_at
        `)
        .in("orden_id", ordenIds);

      const result = await gestionesQuery;
      gestiones = result.data || [];
      gestionesError = result.error;

      // Cargar perfiles de responsables manualmente
      if (gestiones.length > 0) {
        const responsableIds = [...new Set(gestiones.map((g: any) => g.responsable_user_id).filter(Boolean))];
        if (responsableIds.length > 0) {
          const { data: responsables } = await svc
            .from("profiles")
            .select("id, full_name, email")
            .in("id", responsableIds);

          // Mapear responsables a gestiones
          gestiones = gestiones.map((g: any) => {
            const responsable = responsables?.find((r: any) => r.id === g.responsable_user_id);
            return {
              ...g,
              responsable: responsable || null,
            };
          });
        }
      }

      if (gestionesError) {
        console.error("[list] Error obteniendo gestiones:", gestionesError);
        // Continuar sin gestiones si la tabla no existe
        if (gestionesError.message?.includes("does not exist") || 
            gestionesError.message?.includes("relation") ||
            gestionesError.code === "PGRST116") {
          console.warn("[list] Tabla gestiones_estudio no existe.");
        }
      } else {
        console.log("[list] Gestiones obtenidas:", gestiones.length);
      }
    }

    // Obtener comunicaciones para cada gestión Y orden
    const gestionIds = (gestiones || []).map((g: any) => g.id);
    
    let comunicaciones: any[] = [];
    let comunicacionesError: any = null;

    // Construir lista de IDs para buscar comunicaciones (gestiones + órdenes)
    const entidadIds: string[] = [];
    if (gestionIds.length > 0) {
      entidadIds.push(...gestionIds);
    }
    if (ordenIds.length > 0) {
      entidadIds.push(...ordenIds);
    }

    if (entidadIds.length > 0) {
      let comunicacionesQuery = svc
        .from("comunicaciones")
        .select(`
          id,
          entidad_tipo,
          entidad_id,
          canal,
          resultado,
          motivo_falla,
          detalle,
          realizado_por_user_id,
          created_at
        `)
        .in("entidad_id", entidadIds)
        .order("created_at", { ascending: false });

      const result = await comunicacionesQuery;
      comunicaciones = result.data || [];
      comunicacionesError = result.error;

      // Cargar perfiles de realizadores manualmente
      if (comunicaciones.length > 0) {
        const realizadorIds = [...new Set(comunicaciones.map((c: any) => c.realizado_por_user_id).filter(Boolean))];
        if (realizadorIds.length > 0) {
          const { data: realizadores } = await svc
            .from("profiles")
            .select("id, full_name, email")
            .in("id", realizadorIds);

          // Mapear realizadores a comunicaciones
          comunicaciones = comunicaciones.map((c: any) => {
            const realizadoPor = realizadores?.find((r: any) => r.id === c.realizado_por_user_id);
            return {
              ...c,
              realizado_por: realizadoPor || null,
            };
          });
        }
      }
    }

    if (comunicacionesError) {
      console.error("Error obteniendo comunicaciones:", comunicacionesError);
      // Continuar sin comunicaciones si la tabla no existe
      if (comunicacionesError.message?.includes("does not exist") || 
          comunicacionesError.message?.includes("relation") ||
          comunicacionesError.code === "PGRST116") {
        console.warn("Tabla comunicaciones no existe.");
      }
    }

    // Obtener archivos para cada orden
    const ordenIdsParaArchivos = ordenes.map((o: any) => o.id);
    let archivos: any[] = [];
    
    if (ordenIdsParaArchivos.length > 0) {
      const { data: archivosData } = await svc
        .from("ordenes_medicas_archivos")
        .select("id, orden_id, storage_path, filename, mime, size, orden_archivo")
        .in("orden_id", ordenIdsParaArchivos)
        .order("orden_archivo", { ascending: true });
      
      archivos = archivosData || [];
    }

    // Combinar datos
    const ordenesConGestiones = (ordenes || []).map((orden: any) => {
      const gestion = (gestiones || []).find((g: any) => g.orden_id === orden.id);
      const comunicacionesGestion = (comunicaciones || []).filter(
        (c: any) => c.entidad_tipo === "GESTION" && c.entidad_id === gestion?.id
      );
      const comunicacionesOrden = (comunicaciones || []).filter(
        (c: any) => c.entidad_tipo === "ORDEN" && c.entidad_id === orden.id
      );
      const archivosOrden = archivos.filter((a: any) => a.orden_id === orden.id);

      return {
        ...orden,
        archivos: archivosOrden.length > 0 ? archivosOrden : null, // Si no hay archivos en la nueva tabla, null
        gestion: gestion ? {
          ...gestion,
          comunicaciones: comunicacionesGestion,
        } : null,
        comunicaciones: comunicacionesOrden,
      };
    });

    // Calcular semáforo SLA interno (horas sin contacto / turno vencido)
    // Rangos: 0-24hrs (VERDE), 24-48hrs (AMARILLO), 48-72hrs+ (ROJO)
    const ahora = new Date();
    const ordenesConSemaforo = ordenesConGestiones.map((item: any) => {
      let semaforo = "VERDE";
      let horasSinContacto = null;
      let diasSinContacto = null; // Mantener para compatibilidad con frontend
      let turnoVencido = false;

      if (item.gestion) {
        // Calcular horas desde última comunicación
        const ultimaComunicacion = item.gestion.comunicaciones?.[0];
        if (ultimaComunicacion) {
          const fechaComunicacion = new Date(ultimaComunicacion.created_at);
          const horas = Math.floor((ahora.getTime() - fechaComunicacion.getTime()) / (1000 * 60 * 60));
          horasSinContacto = horas;
          diasSinContacto = Math.floor(horas / 24); // Convertir a días para mostrar
          
          // Semáforo interno basado en horas: 0-24hrs (VERDE), 24-48hrs (AMARILLO), 48-72hrs+ (ROJO)
          if (horas >= 48) semaforo = "ROJO";
          else if (horas >= 24) semaforo = "AMARILLO";
          else semaforo = "VERDE";
        } else {
          // Sin comunicaciones, calcular desde creación de gestión
          const fechaGestion = new Date(item.gestion.created_at);
          const horas = Math.floor((ahora.getTime() - fechaGestion.getTime()) / (1000 * 60 * 60));
          horasSinContacto = horas;
          diasSinContacto = Math.floor(horas / 24); // Convertir a días para mostrar
          
          // Semáforo interno basado en horas: 0-24hrs (VERDE), 24-48hrs (AMARILLO), 48-72hrs+ (ROJO)
          if (horas >= 48) semaforo = "ROJO";
          else if (horas >= 24) semaforo = "AMARILLO";
          else semaforo = "VERDE";
        }

        // Verificar si turno está vencido
        if (item.gestion.turno_fecha_hora) {
          const fechaTurno = new Date(item.gestion.turno_fecha_hora);
          if (fechaTurno < ahora && item.gestion.estado !== "ESTUDIO_REALIZADO") {
            turnoVencido = true;
            semaforo = "ROJO"; // Turno vencido siempre es ROJO
          }
        }
      }

      return {
        ...item,
        semaforo,
        horas_sin_contacto: horasSinContacto,
        dias_sin_contacto: diasSinContacto,
        turno_vencido: turnoVencido,
      };
    });

    return NextResponse.json({
      ok: true,
      data: ordenesConSemaforo,
    });
  } catch (e: any) {
    console.error("[ordenes-medicas/list] Error en catch:", e);
    console.error("[ordenes-medicas/list] Error stack:", e?.stack);
    return NextResponse.json(
      { 
        error: e?.message || "Error desconocido",
        details: process.env.NODE_ENV === "development" ? String(e) : undefined
      },
      { status: 500 }
    );
  }
}
