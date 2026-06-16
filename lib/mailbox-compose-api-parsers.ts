import type { MailboxFileMeta, MailboxPendingAttachment } from "@/lib/mailbox-service";

export function parseMailboxFileMetas(body: Record<string, unknown>): MailboxFileMeta[] {
  if (Array.isArray(body.files)) {
    return body.files.map((raw) => {
      const f = raw as Record<string, unknown>;
      return {
        fileName: String(f.file_name || ""),
        sizeBytes: Number(f.file_size || 0),
      };
    });
  }
  if (body.file_name) {
    return [
      {
        fileName: String(body.file_name || ""),
        sizeBytes: Number(body.file_size || 0),
      },
    ];
  }
  return [];
}

export function parseMailboxPendingAttachments(
  body: Record<string, unknown>
): MailboxPendingAttachment[] {
  const rawList = body.attachments ?? (body.attachment ? [body.attachment] : []);
  if (!Array.isArray(rawList)) return [];

  return rawList.map((raw) => {
    const a = raw as Record<string, unknown>;
    return {
      attachmentId: String(a.attachment_id || ""),
      storage_path: String(a.storage_path || ""),
      file_name: String(a.file_name || ""),
      content_type: String(a.content_type || ""),
      size_bytes: Number(a.size_bytes || 0),
      version: Number(a.version || 1),
    };
  });
}
