import { supabase } from "@/lib/supabase";

export async function mediacionesAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sin sesión");
  return { Authorization: `Bearer ${token}` };
}

/** fetch con reintento tras refrescar sesión si el token expiró (401). */
export async function mediacionesFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = await mediacionesAuthHeaders();
  headers.set("Authorization", auth.Authorization);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    const newToken = refreshed.session?.access_token;
    if (!error && newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      res = await fetch(input, { ...init, headers });
    }
  }

  return res;
}
