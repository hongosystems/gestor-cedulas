import { NextResponse } from "next/server";
import { uploadMailboxAttachmentVersion } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;
    const { id } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta archivo" }, { status: 400 });
    }
    const result = await uploadMailboxAttachmentVersion(user!.id, id, file);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
