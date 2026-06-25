import type { supabaseService } from "@/lib/supabase-server";

type Svc = ReturnType<typeof supabaseService>;

/** Resuelve un id de hilo mailbox o legacy transfer_id al UUID del hilo mailbox. */
export async function findMailboxThreadId(svc: Svc, id: string): Promise<string | null> {
  const { data: byPk } = await svc.from("mailbox_threads").select("id").eq("id", id).maybeSingle();
  if (byPk?.id) return byPk.id;
  const { data: byLegacy } = await svc
    .from("mailbox_threads")
    .select("id")
    .eq("legacy_transfer_id", id)
    .maybeSingle();
  return byLegacy?.id ?? null;
}
