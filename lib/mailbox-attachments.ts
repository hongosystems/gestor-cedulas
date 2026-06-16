export const MAILBOX_ALLOWED_EXT = [".docx", ".pdf", ".png", ".jpg", ".jpeg", ".zip"] as const;

/** Límite de adjuntos en bandeja (upload directo a Supabase Storage). */
export const MAX_MAILBOX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Máximo de archivos por mensaje en bandeja. */
export const MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE = 10;

export function extFromMailboxFileName(fileName: string): string | null {
  const name = (fileName || "").toLowerCase();
  return MAILBOX_ALLOWED_EXT.find((ext) => name.endsWith(ext)) ?? null;
}

export function contentTypeForMailboxExt(ext: string) {
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/zip";
}

export function assertValidMailboxFile(fileName: string, sizeBytes: number) {
  const ext = extFromMailboxFileName(fileName);
  if (!ext) {
    throw new Error("El archivo debe ser .docx, .pdf, .png, .jpg, .jpeg o .zip.");
  }
  if (sizeBytes <= 0) {
    throw new Error("El archivo adjunto está vacío.");
  }
  if (sizeBytes > MAX_MAILBOX_ATTACHMENT_BYTES) {
    throw new Error(
      `El archivo excede el límite de ${MAX_MAILBOX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`
    );
  }
  return ext;
}

export function assertValidMailboxFileList(
  files: { fileName: string; sizeBytes: number }[],
  opts?: { maxCount?: number }
) {
  const max = opts?.maxCount ?? MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE;
  if (files.length === 0) {
    throw new Error("Debés incluir al menos un archivo adjunto.");
  }
  if (files.length > max) {
    throw new Error(`Podés adjuntar hasta ${max} archivos por mensaje.`);
  }
  for (const f of files) {
    assertValidMailboxFile(f.fileName, f.sizeBytes);
  }
}

export function mailboxAttachmentStoragePath(
  messageId: string,
  attachmentId: string,
  version: number,
  ext: string
) {
  return `mailbox/${messageId}/${attachmentId}/v${version}${ext}`;
}
