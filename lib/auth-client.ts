import { supabase } from "@/lib/supabase";

/**
 * Devuelve un access_token válido para APIs server-side.
 * Refresca la sesión de Supabase antes de usar el token en cache.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const { data: current } = await supabase.auth.getSession();
  if (!current.session) return null;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (!error && refreshed.session?.access_token) {
    return refreshed.session.access_token;
  }

  return current.session.access_token;
}

export async function getAuthHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string> | null> {
  const token = await getFreshAccessToken();
  if (!token) return null;
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
  };
}
