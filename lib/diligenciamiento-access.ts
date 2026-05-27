import { supabaseService } from "@/lib/supabase-server";

/**
 * Roles que pueden ver Diligenciamiento y operar carga PJN.
 */
export async function requireDiligenciamientoAccess(
  userId: string,
  svc: ReturnType<typeof supabaseService>
): Promise<boolean> {
  const { data } = await svc
    .from("user_roles")
    .select("is_abogado, is_superadmin, is_admin_cedulas")
    .eq("user_id", userId)
    .maybeSingle();
  return (
    data?.is_abogado === true ||
    data?.is_superadmin === true ||
    data?.is_admin_cedulas === true
  );
}

export const DILIGENCIAMIENTO_FORBIDDEN_MSG =
  "No tienes permiso para acceder a Diligenciamiento";
