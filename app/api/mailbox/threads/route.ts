import { NextResponse } from "next/server";
import { composeMailboxMessage } from "@/lib/mailbox-service";
import { requireMailboxUser, mailboxError } from "@/lib/mailbox-api";
import type { MailboxDocType } from "@/lib/mailbox-types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { user, error } = await requireMailboxUser(req);
    if (error) return error;

    const form = await req.formData();
    const body = String(form.get("body") || "").trim();
    const subject = String(form.get("subject") || "").trim();
    const docType = String(form.get("doc_type") || "") as MailboxDocType;
    const expedienteRef = String(form.get("expediente_ref") || "").trim() || null;
    const file = form.get("file");

    const parseIds = (key: string) => {
      const raw = form.get(key);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return String(raw)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    };

    const result = await composeMailboxMessage(
      user!.id,
      {
        subject,
        body,
        docType: docType || undefined,
        expedienteRef,
        to: parseIds("to"),
        cc: parseIds("cc"),
        bcc: parseIds("bcc"),
        followerIds: parseIds("followers"),
      },
      file instanceof File ? file : null
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mailboxError(e, 400);
  }
}
