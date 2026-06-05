import { displayName, docTypeLabel, snippet, type DocType, type Profile } from "@/lib/bandeja-utils";

export type TransferSearchRow = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  doc_type: DocType;
  title: string | null;
  message: string | null;
  expediente_ref: string | null;
  expediente_caratula: string | null;
  expediente_juzgado: string | null;
  file_transfer_versions?: { storage_path: string }[] | null;
};

/** Colapsa espacios/saltos de línea; minúsculas sin acentos (lopez = López). */
export function normalizeSearchText(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter((p) => p.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function textMatchesQuery(haystack: string, needle: string): boolean {
  const h = normalizeSearchText(haystack);
  const n = normalizeSearchText(needle);
  if (!n) return true;
  if (h.includes(n)) return true;
  const tokens = n.split(" ").filter((t) => t.length > 0);
  if (tokens.length <= 1) return false;
  return tokens.every((tok) => h.includes(tok));
}

function normalizeVersions(raw: unknown): { storage_path: string }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is { storage_path: string } => Boolean(v && typeof v === "object"));
  }
  if (typeof raw === "object" && raw !== null && "storage_path" in raw) {
    return [raw as { storage_path: string }];
  }
  return [];
}

/** Asegura message y campos de búsqueda aunque el row venga parcial del API */
export function normalizeTransferRow(row: Record<string, unknown>): TransferSearchRow {
  const msg = row.message;
  return {
    id: String(row.id ?? ""),
    sender_user_id: String(row.sender_user_id ?? ""),
    recipient_user_id: String(row.recipient_user_id ?? ""),
    doc_type: (row.doc_type as DocType) || "CEDULA",
    title: row.title != null ? String(row.title) : null,
    message: typeof msg === "string" ? msg : msg != null ? String(msg) : null,
    expediente_ref: row.expediente_ref != null ? String(row.expediente_ref) : null,
    expediente_caratula:
      row.expediente_caratula != null ? String(row.expediente_caratula) : null,
    expediente_juzgado:
      row.expediente_juzgado != null ? String(row.expediente_juzgado) : null,
    file_transfer_versions: normalizeVersions(row.file_transfer_versions),
  };
}

export function transferHasAttachment(t: TransferSearchRow) {
  return (t.file_transfer_versions?.length ?? 0) > 0;
}

export function transferSubject(t: TransferSearchRow) {
  const title = (t.title || "").trim();
  if (title) return title;
  const msg = (t.message || "").trim();
  if (msg) return snippet(msg, 80);
  return docTypeLabel(t.doc_type);
}

export function getTransferSearchText(
  t: TransferSearchRow,
  mode: "recibidos" | "enviados",
  profiles: Record<string, Profile>
): string {
  const peerId = mode === "recibidos" ? t.sender_user_id : t.recipient_user_id;
  const peer = displayName(profiles[peerId]);
  const sender = displayName(profiles[t.sender_user_id]);
  const recipient = displayName(profiles[t.recipient_user_id]);
  const attachmentNames = (t.file_transfer_versions ?? [])
    .map((v) => v.storage_path?.split("/").pop())
    .filter(Boolean) as string[];

  return normalizeSearchText(
    t.title,
    t.message,
    t.expediente_ref,
    t.expediente_caratula,
    t.expediente_juzgado,
    docTypeLabel(t.doc_type),
    peer,
    sender,
    recipient,
    attachmentNames.join(" "),
    transferHasAttachment(t) ? "adjunto archivo" : ""
  );
}

export function transferMatchesQuery(
  t: TransferSearchRow,
  q: string,
  mode: "recibidos" | "enviados",
  profiles: Record<string, Profile>
) {
  const needle = q.trim();
  if (!needle) return true;

  const haystack = getTransferSearchText(t, mode, profiles);
  if (textMatchesQuery(haystack, needle)) return true;

  const attachTerms = ["adjunto", "archivo", ".docx", ".pdf", ".zip", ".png", ".jpg"];
  const n = needle.toLowerCase();
  if (attachTerms.some((term) => n.includes(term)) && transferHasAttachment(t)) {
    return true;
  }

  return false;
}

export type NotificationSearchBits = {
  title?: string | null;
  body?: string | null;
  nota_context?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function getNotificationSearchText(n: NotificationSearchBits): string {
  const meta = (n.metadata || {}) as Record<string, unknown>;
  return normalizeSearchText(
    n.title,
    n.body,
    n.nota_context,
    String(meta.message ?? ""),
    String(meta.title ?? ""),
    String(meta.caratula ?? ""),
    String(meta.juzgado ?? ""),
    String(meta.case_ref ?? meta.numero ?? meta.expediente_ref ?? ""),
    meta.has_attachment === true ? "adjunto archivo" : ""
  );
}
