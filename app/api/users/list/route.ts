import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = supabaseService();

    // Obtener todos los usuarios de auth.users usando service role (con paginación)
    let allUsers: any[] = [];
    let page = 1;
    const perPage = 1000; // Máximo por página
    
    while (true) {
      const response = await svc.auth.admin.listUsers({
        page,
        perPage,
      });
      
      if (response.error) {
        console.error("Error al obtener usuarios de auth:", response.error);
        return NextResponse.json(
          { error: response.error.message || "Error al obtener usuarios" },
          { status: 500 }
        );
      }
      
      const authUsersPage = response.data;
      
      if (!authUsersPage?.users || authUsersPage.users.length === 0) {
        break; // No hay más usuarios
      }
      
      allUsers = [...allUsers, ...authUsersPage.users];
      
      // Si hay menos usuarios que el límite por página, ya obtuvimos todos
      if (authUsersPage.users.length < perPage) {
        break;
      }
      
      page++;
    }
    
    console.log(`[API Users] Total usuarios obtenidos: ${allUsers.length}`);

    // Obtener perfiles para complementar información
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, email, full_name");

    const profilesMap = new Map();
    if (profiles) {
      profiles.forEach((p: any) => {
        profilesMap.set(p.id, p);
      });
    }

    // Combinar datos de auth.users con profiles
    const usersList = allUsers.map((authUser: any) => {
      const profile = profilesMap.get(authUser.id);
      const email = authUser.email || "";
      const username = email.split("@")[0].toLowerCase();
      
      return {
        id: authUser.id,
        email: email,
        full_name: profile?.full_name || authUser.user_metadata?.full_name || null,
        username: username,
      };
    }).filter((u: any) => u.email && u.email.trim() !== ""); // Solo usuarios con email válido
    
    console.log(`[API Users] Usuarios con email válido: ${usersList.length} de ${allUsers.length}`);
    console.log(`[API Users] Emails de usuarios:`, usersList.map((u: any) => u.email).join(", "));

    // Ordenar por nombre completo o email
    usersList.sort((a: any, b: any) => {
      const nameA = (a.full_name || a.email || "").toLowerCase();
      const nameB = (b.full_name || b.email || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });

    console.log(`[API Users] Total usuarios finales: ${usersList.length}`);
    console.log(`[API Users] Primeros 5 usuarios:`, usersList.slice(0, 5).map((u: any) => `${u.full_name || u.email} (${u.username})`));

    return NextResponse.json({ users: usersList });
  } catch (e: any) {
    console.error("Error en list users:", e);
    return NextResponse.json(
      { error: e?.message || "Error desconocido" },
      { status: 500 }
    );
  }
}
