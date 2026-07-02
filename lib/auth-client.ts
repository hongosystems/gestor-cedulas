import { supabase } from "@/lib/supabase";

const TOKEN_REFRESH_SKEW_SEC = 60;

function sessionNeedsRefresh(expiresAt: number | undefined): boolean {
  if (!expiresAt) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAt - nowSec <= TOKEN_REFRESH_SKEW_SEC;
}

/**
 * Devuelve un access_token válido para APIs server-side.
 * Solo refresca la sesión si el token está por vencer (Supabase ya auto-refresca al volver a la pestaña).
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const { data: current } = await supabase.auth.getSession();
  if (!current.session) return null;

  if (!sessionNeedsRefresh(current.session.expires_at)) {
    return current.session.access_token;
  }

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
