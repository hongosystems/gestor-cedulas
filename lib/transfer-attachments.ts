export {
  MAILBOX_ALLOWED_EXT as TRANSFER_ALLOWED_EXT,
  MAX_MAILBOX_ATTACHMENT_BYTES as MAX_TRANSFER_ATTACHMENT_BYTES,
  assertValidMailboxFile as assertValidTransferFile,
  contentTypeForMailboxExt as contentTypeForTransferExt,
  extFromMailboxFileName as extFromTransferFileName,
} from "@/lib/mailbox-attachments";

/** Máximo de archivos por envío en Envío de documentos. */
export const MAX_TRANSFER_ATTACHMENTS = 5;

function sanitizeFileBaseName(name: string): string {
  const base = name.replace(/\.[^/.]+$/, "").trim() || "archivo";
  return base.replace(/[^\w.-]+/g, "_").slice(0, 100);
}

export function transferAttachmentStoragePath(
  transferId: string,
  version: number,
  fileName: string,
  ext: string
) {
  const base = sanitizeFileBaseName(fileName);
  return `transfers/${transferId}/v${version}-${base}${ext}`;
}

/** Nombre legible a partir del path en storage (soporta paths legacy v1.ext). */
export function displayNameFromTransferStoragePath(storagePath: string): string {
  const leaf = storagePath.split("/").pop() || storagePath;
  const withBase = leaf.match(/^v\d+-(.+)$/);
  if (withBase) return withBase[1];
  return leaf;
}
