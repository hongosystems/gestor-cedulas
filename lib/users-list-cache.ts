import { supabase } from "@/lib/supabase";

export type MentionUser = {
  id: string;
  email: string;
  full_name: string | null;
  username: string;
};

let cache: MentionUser[] | null = null;
let inflight: Promise<MentionUser[]> | null = null;

async function fetchUsers(): Promise<MentionUser[]> {
  const { data: session } = await supabase.auth.getSession();
  if (session.session?.access_token) {
    const res = await fetch("/api/users/list", {
      headers: { Authorization: `Bearer ${session.session.access_token}` },
    });
    if (res.ok) {
      const { users: usersList } = await res.json();
      return (usersList ?? []) as MentionUser[];
    }
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .order("full_name", { ascending: true });

  return (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email || "",
    full_name: p.full_name,
    username: (p.email || "").split("@")[0].toLowerCase(),
  }));
}

/** Una sola carga compartida para menciones en notas (evita N requests y loops por remount). */
export function loadMentionUsersOnce(): Promise<MentionUser[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetchUsers()
      .then((users) => {
        cache = users;
        return users;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function clearMentionUsersCache() {
  cache = null;
  inflight = null;
}
