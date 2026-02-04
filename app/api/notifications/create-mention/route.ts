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
      console.error("Missing Supabase env vars");
      return null;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseClient = createClient(url, anon, {
      auth: { persistSession: false },
    });

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    
    if (error || !user) {
      console.error("Auth error:", error?.message);
      return null;
    }

    return user;
  } catch (e: any) {
    console.error("Error getting user:", e?.message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { 
      user_id, 
      title, 
      body, 
      link,
      expediente_id,
      is_pjn_favorito,
      nota_context,
      metadata
    } = await req.json();

    if (!user_id || !title || !body) {
      return NextResponse.json(
        { error: "user_id, title y body son requeridos" },
        { status: 400 }
      );
    }

    // Usar service role para crear notificaciones
    const svc = supabaseService();

    // Asegurar que metadata sea un objeto JSON válido
    let metadataObj: Record<string, unknown> = {};
    if (metadata) {
      if (typeof metadata === 'string') {
        try {
          metadataObj = JSON.parse(metadata) as Record<string, unknown>;
        } catch (e) {
          console.error("Error parseando metadata string:", e);
          metadataObj = {};
        }
      } else if (typeof metadata === 'object') {
        metadataObj = metadata as Record<string, unknown>;
      }
    }

    console.log("[API create-mention] Insertando notificación con:", {
      user_id,
      title,
      expediente_id,
      is_pjn_favorito,
      nota_context: nota_context ? nota_context.substring(0, 50) + "..." : null,
      metadata: metadataObj,
      sender_id: metadataObj.sender_id,
      metadata_keys: Object.keys(metadataObj)
    });
    
    // Verificar que sender_id esté presente
    if (!metadataObj.sender_id) {
      console.warn("[API create-mention] ⚠️ sender_id no está presente en metadata!");
    } else {
      console.log("[API create-mention] ✅ sender_id presente:", metadataObj.sender_id);
    }

    // Intentar insertar con todos los campos primero
    let insertData: any = {
      user_id,
      title,
      body,
      link: link || null,
      expediente_id: expediente_id || null,
      is_pjn_favorito: is_pjn_favorito || false,
      nota_context: nota_context || null,
      metadata: metadataObj,
    };

    let data, error;
    
    try {
      const result = await svc.from("notifications").insert(insertData);
      data = result.data;
      error = result.error;
    } catch (insertError: any) {
      console.error("[API] Error en insert:", insertError);
      error = insertError;
    }

    if (error) {
      const errorMsg = error.message || String(error) || "Error desconocido";
      const errorCode = (error as any).code || "";
      const errorDetails = (error as any).details || "";
      
      console.error("[API] Error al crear notificación:", {
        message: errorMsg,
        code: errorCode,
        details: errorDetails,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });
      
      // Si el error es por columnas que no existen, intentar sin los campos nuevos
      if (errorMsg.includes("column") || 
          errorMsg.includes("does not exist") || 
          errorCode === "PGRST116" ||
          errorDetails.includes("column")) {
        console.log("[API] Campos nuevos no existen, intentando insertar sin ellos...");
        const fallbackData = {
          user_id,
          title,
          body,
          link: link || null,
        };
        
        const { data: dataFallback, error: errorFallback } = await svc.from("notifications").insert(fallbackData);
        
        if (errorFallback) {
          return NextResponse.json(
            { 
              error: errorFallback.message || "Error al crear notificación",
              originalError: errorMsg,
              code: errorCode
            },
            { status: 500 }
          );
        }
        
        return NextResponse.json({ 
          ok: true, 
          data: dataFallback, 
          warning: "⚠️ Campos nuevos no disponibles. Ejecuta la migración SQL: add_notifications_threading.sql" 
        });
      }
      
      return NextResponse.json(
        { 
          error: errorMsg,
          code: errorCode,
          details: errorDetails
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("Error en create-mention:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
