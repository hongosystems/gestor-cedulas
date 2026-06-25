import { NextResponse } from "next/server";
import { canWorkflowCedulas } from "@/lib/bandeja-utils";
import { syncLegacyTransfersForUser } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";
import { supabaseService } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Reconciliación de bandeja: importa transfers legacy pendientes y alinea
 * mailbox_recipients.read_at con el historial de notifications.
 */
export async function POST(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;

    const svc = supabaseService();
    const { data: role } = await svc
      .from("user_roles")
      .select("is_superadmin, is_abogado, is_admin_expedientes, is_admin_cedulas")
      .eq("user_id", user!.id)
      .maybeSingle();

    const workflow = canWorkflowCedulas({
      isSuperadmin: role?.is_superadmin === true,
      isAbogado: role?.is_abogado === true,
      isAdminExpedientes: role?.is_admin_expedientes === true,
      isAdminCedulas: role?.is_admin_cedulas === true,
    });

    if (!workflow) {
      return NextResponse.json({ imported: 0, backfilled: 0, notificationsSynced: 0 });
    }

    const result = await syncLegacyTransfersForUser(user!.id);
    return NextResponse.json(result);
  } catch (e) {
    return mailboxError(e);
  }
}
