import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Variables de entorno de Supabase no configuradas");
  }
  
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function verifySuperAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);

  if (!user) {
    return null;
  }

  // Verificar que es superadmin
  const supabaseAdmin = getSupabaseAdmin();
  const { data: roleData } = await supabaseAdmin
    .from("user_roles")
    .select("is_superadmin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!roleData || roleData.is_superadmin !== true) {
    return null;
  }

  return user.id;
}

// PUT: Actualizar usuario
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const userId = await verifySuperAdmin(req);
    if (!userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { userId: targetUserId } = await params;
    const body = await req.json();
    const { email, full_name, password, is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado, juzgados } = body;

    const supabaseAdmin = getSupabaseAdmin();

    // Actualizar email si cambió
    if (email) {
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUserId,
        { email }
      );

      if (emailError) {
        return NextResponse.json({ error: `Error al actualizar email: ${emailError.message}` }, { status: 400 });
      }
    }

    // Actualizar password si se proporciona
    if (password) {
      const { error: passError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUserId,
        { password }
      );

      if (passError) {
        return NextResponse.json({ error: `Error al actualizar contraseña: ${passError.message}` }, { status: 400 });
      }
    }

    // Actualizar perfil
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: targetUserId,
        email: email || undefined,
        full_name: full_name || undefined,
      }, { onConflict: "id" });

    if (profileError) {
      return NextResponse.json({ error: `Error al actualizar perfil: ${profileError.message}` }, { status: 500 });
    }

    // Actualizar roles
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({
        user_id: targetUserId,
        is_superadmin: is_superadmin !== undefined ? is_superadmin : undefined,
        is_admin_expedientes: is_admin_expedientes !== undefined ? is_admin_expedientes : undefined,
        is_admin_cedulas: is_admin_cedulas !== undefined ? is_admin_cedulas : undefined,
        is_abogado: is_abogado !== undefined ? is_abogado : undefined,
      }, { onConflict: "user_id" });

    if (roleError) {
      return NextResponse.json({ error: `Error al actualizar roles: ${roleError.message}` }, { status: 500 });
    }

    // Actualizar juzgados si es abogado
    if (is_abogado !== undefined) {
      // Eliminar todos los juzgados actuales
      const { error: deleteError } = await supabaseAdmin
        .from("user_juzgados")
        .delete()
        .eq("user_id", targetUserId);

      if (deleteError) {
        console.error("Error al eliminar juzgados:", deleteError);
      }

      // Insertar nuevos juzgados si es abogado
      if (is_abogado && juzgados && Array.isArray(juzgados) && juzgados.length > 0) {
        const juzgadosToInsert = juzgados
          .filter((j: string) => j && j.trim())
          .map((j: string) => ({
            user_id: targetUserId,
            juzgado: j.trim().toUpperCase(),
          }));

        if (juzgadosToInsert.length > 0) {
          const { error: juzgadosError } = await supabaseAdmin
            .from("user_juzgados")
            .upsert(juzgadosToInsert, { onConflict: "user_id,juzgado" });

          if (juzgadosError) {
            console.error("Error al asignar juzgados:", juzgadosError);
            // No fallar si los juzgados fallan
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Eliminar usuario
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const userId = await verifySuperAdmin(req);
    if (!userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { userId: targetUserId } = await params;

    // No permitir auto-eliminación
    if (userId === targetUserId) {
      return NextResponse.json({ error: "No puedes eliminar tu propio usuario" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Eliminar usuario (esto eliminará en cascada perfiles, roles y juzgados por las foreign keys)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
