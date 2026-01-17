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

// GET: Listar todos los usuarios
export async function GET(req: NextRequest) {
  try {
    const userId = await verifySuperAdmin(req);
    if (!userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Obtener todos los usuarios con sus perfiles y roles
    const { data: users, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    // Obtener perfiles
    const userIds = users.users.map(u => u.id);
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, must_change_password")
      .in("id", userIds);

    // Obtener roles
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado")
      .in("user_id", userIds);

    // Obtener juzgados asignados para abogados
    const { data: juzgados, error: juzgadosError } = await supabaseAdmin
      .from("user_juzgados")
      .select("user_id, juzgado")
      .in("user_id", userIds);

    // Combinar datos
    const profilesMap = new Map((profiles || []).map(p => [p.id, p]));
    const rolesMap = new Map((roles || []).map(r => [r.user_id, r]));
    const juzgadosMap = new Map<string, string[]>();
    
    (juzgados || []).forEach(j => {
      const existing = juzgadosMap.get(j.user_id) || [];
      existing.push(j.juzgado);
      juzgadosMap.set(j.user_id, existing);
    });

    const usersWithData = users.users.map(u => {
      const profile = profilesMap.get(u.id);
      const role = rolesMap.get(u.id);
      const userJuzgados = juzgadosMap.get(u.id) || [];

      return {
        id: u.id,
        email: u.email || profile?.email || "",
        full_name: profile?.full_name || "",
        created_at: u.created_at,
        is_superadmin: role?.is_superadmin || false,
        is_admin_expedientes: role?.is_admin_expedientes || false,
        is_admin_cedulas: role?.is_admin_cedulas || false,
        is_abogado: role?.is_abogado || false,
        must_change_password: profile?.must_change_password || false,
        juzgados: userJuzgados,
      };
    });

    return NextResponse.json({ users: usersWithData });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Crear nuevo usuario
export async function POST(req: NextRequest) {
  try {
    const userId = await verifySuperAdmin(req);
    if (!userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { email, password, full_name, is_superadmin, is_admin_expedientes, is_admin_cedulas, is_abogado, juzgados } = body;

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: "Faltan campos requeridos: email, password, full_name" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Crear usuario en auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const newUserId = authData.user.id;

    // Crear perfil
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: newUserId,
        email,
        full_name,
        must_change_password: true,
      }, { onConflict: "id" });

    if (profileError) {
      // Si falla el perfil, intentar eliminar el usuario creado
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: `Error al crear perfil: ${profileError.message}` }, { status: 500 });
    }

    // Crear/actualizar roles
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({
        user_id: newUserId,
        is_superadmin: is_superadmin || false,
        is_admin_expedientes: is_admin_expedientes || false,
        is_admin_cedulas: is_admin_cedulas || false,
        is_abogado: is_abogado || false,
      }, { onConflict: "user_id" });

    if (roleError) {
      return NextResponse.json({ error: `Error al crear roles: ${roleError.message}` }, { status: 500 });
    }

    // Asignar juzgados si es abogado
    if (is_abogado && juzgados && Array.isArray(juzgados) && juzgados.length > 0) {
      const juzgadosToInsert = juzgados.map((j: string) => ({
        user_id: newUserId,
        juzgado: j.trim().toUpperCase(),
      }));

      const { error: juzgadosError } = await supabaseAdmin
        .from("user_juzgados")
        .upsert(juzgadosToInsert, { onConflict: "user_id,juzgado" });

      if (juzgadosError) {
        console.error("Error al asignar juzgados:", juzgadosError);
        // No fallar si los juzgados fallan, solo reportarlo
      }
    }

    return NextResponse.json({ 
      success: true,
      user: {
        id: newUserId,
        email,
        full_name,
        is_superadmin: is_superadmin || false,
        is_admin_expedientes: is_admin_expedientes || false,
        is_admin_cedulas: is_admin_cedulas || false,
        is_abogado: is_abogado || false,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
