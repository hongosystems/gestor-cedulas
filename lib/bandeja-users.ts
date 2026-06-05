import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/bandeja-utils";

export async function fetchBandejaUsers(): Promise<Profile[]> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;

  if (token) {
    try {
      const res = await fetch("/api/users/list", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        const list = (json.users || []) as Profile[];
        if (list.length > 0) return list;
      }
    } catch {
      /* fallback abajo */
    }
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name", { ascending: true });

  return (data ?? []) as Profile[];
}
