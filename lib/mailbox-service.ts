import { supabaseService } from "@/lib/supabase-server";
import {
  assertValidMailboxFile,
  assertValidMailboxFileList,
  contentTypeForMailboxExt,
  extFromMailboxFileName,
  mailboxAttachmentStoragePath,
  MAILBOX_ALLOWED_EXT,
} from "@/lib/mailbox-attachments";
import type {
  ComposeMailboxInput,
  MailboxDocType,
  MailboxInboxItem,
  MailboxRecipientInput,
  MailboxRecipientType,
  MailboxThreadDetail,
} from "@/lib/mailbox-types";

export type MailboxFileMeta = {
  fileName: string;
  sizeBytes: number;
};

export type MailboxPendingAttachment = {
  attachmentId: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  version: number;
};

export function parseMentionUserIds(body: string, profiles: { id: string; email: string | null; full_name: string | null }[]): string[] {
  const found = new Set<string>();
  const re = /@\[([0-9a-f-]{36})\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    found.add(m[1].toLowerCase());
  }
  const lower = body.toLowerCase();
  for (const p of profiles) {
    const name = (p.full_name || "").trim().toLowerCase();
    const email = (p.email || "").trim().toLowerCase();
    if (name && lower.includes(`@${name}`)) found.add(p.id);
    if (email && lower.includes(`@${email.split("@")[0]}`)) found.add(p.id);
  }
  return [...found];
}

function dedupeRecipients(list: MailboxRecipientInput[]): MailboxRecipientInput[] {
  const seen = new Set<string>();
  const out: MailboxRecipientInput[] = [];
  for (const r of list) {
    const key = `${r.userId}:${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function resolveExpediente(
  svc: ReturnType<typeof supabaseService>,
  expedienteRef: string | null | undefined,
  caratula?: string | null,
  juzgado?: string | null
) {
  if (caratula || juzgado || !expedienteRef) {
    return { expedienteRef: expedienteRef || null, caratula: caratula || null, juzgado: juzgado || null };
  }
  const parts = expedienteRef.split("/");
  if (parts.length !== 2) return { expedienteRef, caratula: null, juzgado: null };
  const [numero, anio] = parts;
  const { data } = await svc
    .from("pjn_favoritos")
    .select("caratula, juzgado")
    .eq("numero", numero.trim())
    .eq("anio", anio.trim())
    .limit(1)
    .maybeSingle();
  return {
    expedienteRef,
    caratula: data?.caratula ?? null,
    juzgado: data?.juzgado ?? null,
  };
}

async function getProfileMap(svc: ReturnType<typeof supabaseService>, ids: string[]) {
  const map = new Map<string, { full_name: string | null; email: string | null }>();
  if (ids.length === 0) return map;
  const { data } = await svc.from("profiles").select("id, full_name, email").in("id", ids);
  for (const p of data || []) {
    map.set(p.id, { full_name: p.full_name, email: p.email });
  }
  return map;
}

function displayName(p?: { full_name: string | null; email: string | null } | null) {
  const n = (p?.full_name || "").trim();
  if (n) return n;
  return (p?.email || "").trim() || "Usuario";
}

/** Destinatarios para responder en un hilo existente (incluye envío a sí mismo). */
async function resolveReplyRecipients(
  svc: ReturnType<typeof supabaseService>,
  threadId: string,
  senderId: string,
  replyToMessageId?: string
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: recips } = await svc
    .from("mailbox_recipients")
    .select("user_id")
    .eq("thread_id", threadId);
  const { data: senders } = await svc
    .from("mailbox_messages")
    .select("sender_id")
    .eq("thread_id", threadId);

  for (const r of recips || []) ids.add(r.user_id);
  for (const s of senders || []) ids.add(s.sender_id);

  if (replyToMessageId) {
    const { data: msgRecips } = await svc
      .from("mailbox_recipients")
      .select("user_id")
      .eq("message_id", replyToMessageId);
    const { data: msg } = await svc
      .from("mailbox_messages")
      .select("sender_id")
      .eq("id", replyToMessageId)
      .maybeSingle();
    for (const r of msgRecips || []) ids.add(r.user_id);
    if (msg?.sender_id) ids.add(msg.sender_id);
  }

  ids.delete(senderId);
  let to = [...ids];

  if (to.length === 0) {
    const { data: followers } = await svc
      .from("mailbox_thread_followers")
      .select("user_id")
      .eq("thread_id", threadId);
    for (const f of followers || []) {
      if (f.user_id !== senderId) to.push(f.user_id);
    }
  }

  if (to.length === 0) {
    to = [senderId];
  }

  return to;
}

type ComposeContext = {
  body: string;
  recipients: MailboxRecipientInput[];
  exp: {
    expedienteRef: string | null;
    caratula: string | null;
    juzgado: string | null;
  };
};

async function prepareComposeContext(
  svc: ReturnType<typeof supabaseService>,
  senderId: string,
  input: ComposeMailboxInput,
  opts?: { allowEmptyBodyWithFile?: boolean }
): Promise<ComposeContext> {
  const body = (input.body || "").trim();
  if (!body && !opts?.allowEmptyBodyWithFile) {
    throw new Error("Debés incluir un mensaje o un archivo adjunto");
  }

  const { data: allProfiles } = await svc.from("profiles").select("id, full_name, email");
  const profiles = allProfiles || [];

  const mentionIds = parseMentionUserIds(body, profiles);
  let to = [...(input.to || [])];
  const cc = [...(input.cc || [])];
  const bcc = [...(input.bcc || [])];

  if (input.threadId && to.length === 0 && !input.forwardedFromMessageId) {
    to = await resolveReplyRecipients(
      svc,
      input.threadId,
      senderId,
      input.replyToMessageId
    );
  }

  const recipientRows: MailboxRecipientInput[] = [
    ...to.map((userId) => ({ userId, type: "to" as const })),
    ...cc.map((userId) => ({ userId, type: "cc" as const })),
    ...bcc.map((userId) => ({ userId, type: "bcc" as const })),
    ...mentionIds.map((userId) => ({ userId, type: "mention" as const })),
  ];

  const recipients = dedupeRecipients(recipientRows);
  if (recipients.length === 0) {
    throw new Error("Debés indicar al menos un destinatario");
  }

  const exp = await resolveExpediente(
    svc,
    input.expedienteRef,
    input.expedienteCaratula,
    input.expedienteJuzgado
  );

  return { body, recipients, exp };
}

async function createMailboxMessageRecords(
  svc: ReturnType<typeof supabaseService>,
  senderId: string,
  input: ComposeMailboxInput,
  ctx: ComposeContext
): Promise<{ threadId: string; messageId: string }> {
  const { body, recipients, exp } = ctx;
  let threadId = input.threadId;

  if (!threadId) {
    const { data: thread, error: tErr } = await svc
      .from("mailbox_threads")
      .insert({
        subject: (input.subject || "").trim() || null,
        doc_type: input.docType || null,
        expediente_ref: exp.expedienteRef,
        expediente_caratula: exp.caratula,
        expediente_juzgado: exp.juzgado,
        created_by: senderId,
        source: "mailbox",
      })
      .select("id")
      .single();
    if (tErr || !thread?.id) throw new Error(tErr?.message || "No se pudo crear el hilo");
    threadId = thread.id;
  } else {
    const canAccess = await userCanAccessThread(svc, senderId, threadId);
    if (!canAccess) throw new Error("No tenés acceso a este hilo");
  }

  const { data: message, error: mErr } = await svc
    .from("mailbox_messages")
    .insert({
      thread_id: threadId,
      sender_id: senderId,
      body: body || "(sin texto)",
      reply_to_message_id: input.replyToMessageId || null,
      forwarded_from_message_id: input.forwardedFromMessageId || null,
    })
    .select("id")
    .single();

  if (mErr || !message?.id) throw new Error(mErr?.message || "No se pudo crear el mensaje");

  const messageId = message.id as string;

  const recipientInserts = recipients.map((r) => ({
    thread_id: threadId,
    message_id: messageId,
    user_id: r.userId,
    recipient_type: r.type,
    folder: "inbox" as const,
    read_at: r.userId === senderId ? new Date().toISOString() : null,
  }));

  const { error: rErr } = await svc.from("mailbox_recipients").insert(recipientInserts);
  if (rErr) throw new Error(rErr.message);

  if (input.followerIds?.length) {
    const followers = [...new Set(input.followerIds)].map((user_id) => ({
      thread_id: threadId,
      user_id,
    }));
    await svc.from("mailbox_thread_followers").upsert(followers, {
      onConflict: "thread_id,user_id",
      ignoreDuplicates: true,
    });
  }

  return { threadId: threadId!, messageId };
}

async function uploadMailboxAttachmentFromBuffer(
  svc: ReturnType<typeof supabaseService>,
  messageId: string,
  senderId: string,
  file: File
) {
  const name = file.name.toLowerCase();
  const ext = MAILBOX_ALLOWED_EXT.find((e) => name.endsWith(e));
  if (!ext) throw new Error("Tipo de archivo no permitido");

  const attachmentId = crypto.randomUUID();
  const version = 1;
  const storage_path = mailboxAttachmentStoragePath(messageId, attachmentId, version, ext);
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await svc.storage.from("mailbox").upload(storage_path, buf, {
    contentType: contentTypeForMailboxExt(ext),
    upsert: true,
  });
  if (upErr) throw new Error(`No se pudo subir el adjunto: ${upErr.message}`);

  const { error: aErr } = await svc.from("mailbox_attachments").insert({
    id: attachmentId,
    message_id: messageId,
    storage_path,
    file_name: file.name,
    content_type: contentTypeForMailboxExt(ext),
    size_bytes: file.size,
    version,
    uploaded_by: senderId,
  });
  if (aErr) throw new Error(aErr.message);
}

async function verifyMailboxStorageObject(
  svc: ReturnType<typeof supabaseService>,
  storage_path: string
) {
  const parts = storage_path.split("/");
  if (parts.length < 2) return false;
  const fileName = parts[parts.length - 1];
  const folder = parts.slice(0, -1).join("/");
  const { data, error } = await svc.storage.from("mailbox").list(folder);
  if (error || !data) return false;
  return data.some((f) => f.name === fileName);
}

export async function initMailboxComposeWithAttachments(
  senderId: string,
  input: ComposeMailboxInput,
  fileMetas: MailboxFileMeta[]
) {
  assertValidMailboxFileList(fileMetas);
  const svc = supabaseService();
  const ctx = await prepareComposeContext(svc, senderId, input, {
    allowEmptyBodyWithFile: true,
  });
  const { threadId, messageId } = await createMailboxMessageRecords(svc, senderId, input, ctx);

  const uploads = fileMetas.map((fileMeta) => {
    const ext = extFromMailboxFileName(fileMeta.fileName)!;
    const attachmentId = crypto.randomUUID();
    const version = 1;
    const storage_path = mailboxAttachmentStoragePath(messageId, attachmentId, version, ext);
    return {
      attachment_id: attachmentId,
      storage_path,
      content_type: contentTypeForMailboxExt(ext),
      version,
      file_name: fileMeta.fileName,
      size_bytes: fileMeta.sizeBytes,
    };
  });

  return { threadId, messageId, uploads };
}

export async function initMailboxComposeWithAttachment(
  senderId: string,
  input: ComposeMailboxInput,
  fileMeta: MailboxFileMeta
) {
  const result = await initMailboxComposeWithAttachments(senderId, input, [fileMeta]);
  return { ...result, upload: result.uploads[0] };
}

export async function commitMailboxAttachments(
  senderId: string,
  threadId: string,
  messageId: string,
  attachments: MailboxPendingAttachment[],
  _input?: ComposeMailboxInput
) {
  assertValidMailboxFileList(
    attachments.map((a) => ({ fileName: a.file_name, sizeBytes: a.size_bytes }))
  );

  const svc = supabaseService();

  const { data: message, error: mErr } = await svc
    .from("mailbox_messages")
    .select("id, sender_id, body, thread_id")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .single();

  if (mErr || !message) throw new Error("Mensaje no encontrado");
  if (message.sender_id !== senderId) throw new Error("Forbidden");

  const { data: existing } = await svc
    .from("mailbox_attachments")
    .select("id")
    .eq("message_id", messageId);

  if (existing && existing.length > 0) {
    throw new Error("Este mensaje ya tiene adjuntos registrados");
  }

  for (const attachment of attachments) {
    const ext = extFromMailboxFileName(attachment.file_name);
    if (!ext) throw new Error("Tipo de archivo no permitido");

    const expectedPath = mailboxAttachmentStoragePath(
      messageId,
      attachment.attachmentId,
      attachment.version,
      ext
    );
    if (attachment.storage_path !== expectedPath) {
      throw new Error("Ruta de adjunto inválida");
    }

    const exists = await verifyMailboxStorageObject(svc, attachment.storage_path);
    if (!exists) {
      throw new Error("No se encontró el archivo en storage. Volvé a intentar subirlo.");
    }
  }

  const rows = attachments.map((attachment) => ({
    id: attachment.attachmentId,
    message_id: messageId,
    storage_path: attachment.storage_path,
    file_name: attachment.file_name,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
    version: attachment.version,
    uploaded_by: senderId,
  }));

  const { error: aErr } = await svc.from("mailbox_attachments").insert(rows);
  if (aErr) throw new Error(aErr.message);

  return { threadId, messageId, hasAttachment: true };
}

export async function commitMailboxAttachment(
  senderId: string,
  threadId: string,
  messageId: string,
  attachment: MailboxPendingAttachment,
  input?: ComposeMailboxInput
) {
  return commitMailboxAttachments(senderId, threadId, messageId, [attachment], input);
}

export async function composeMailboxMessage(
  senderId: string,
  input: ComposeMailboxInput,
  file?: File | null
) {
  const svc = supabaseService();
  const hasFile = file instanceof File && file.size > 0;
  const ctx = await prepareComposeContext(svc, senderId, input, {
    allowEmptyBodyWithFile: hasFile,
  });

  const { threadId, messageId } = await createMailboxMessageRecords(svc, senderId, input, ctx);

  let hasAttachment = false;
  if (hasFile && file) {
    await uploadMailboxAttachmentFromBuffer(svc, messageId, senderId, file);
    hasAttachment = true;
  }

  return { threadId, messageId, hasAttachment };
}

export async function userCanAccessThread(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  threadId: string
) {
  const { data } = await svc.rpc("mailbox_user_can_access_thread", {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (typeof data === "boolean") return data;

  const [{ data: rec }, { data: msg }, { data: fol }] = await Promise.all([
    svc
      .from("mailbox_recipients")
      .select("id")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .limit(1),
    svc
      .from("mailbox_messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("sender_id", userId)
      .limit(1),
    svc
      .from("mailbox_thread_followers")
      .select("id")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .limit(1),
  ]);
  return Boolean((rec && rec.length > 0) || (msg && msg.length > 0) || (fol && fol.length > 0));
}

export async function listMailboxInbox(
  userId: string,
  opts: {
    folder: "inbox" | "sent" | "archived" | "unread" | "all" | "action";
    q?: string;
    limit?: number;
  }
): Promise<MailboxInboxItem[]> {
  const svc = supabaseService();
  const limit = opts.limit ?? 80;
  const items: MailboxInboxItem[] = [];

  if (opts.folder === "sent") {
    const latestByThread = new Map<
      string,
      { id: string; thread_id: string; body: string; created_at: string; sender_id: string }
    >();
    const pageSize = 200;
    let offset = 0;
    const maxScan = 5000;

    while (latestByThread.size < limit && offset < maxScan) {
      const { data: msgs, error } = await svc
        .from("mailbox_messages")
        .select("id, thread_id, body, created_at, sender_id")
        .eq("sender_id", userId)
        .eq("is_draft", false)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(error.message);
      if (!msgs?.length) break;

      for (const m of msgs) {
        if (!latestByThread.has(m.thread_id)) {
          latestByThread.set(m.thread_id, m);
          if (latestByThread.size >= limit) break;
        }
      }

      if (msgs.length < pageSize) break;
      offset += pageSize;
    }

    const sortedMsgs = [...latestByThread.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const threadIds = sortedMsgs.map((m) => m.thread_id);
    if (threadIds.length) {
      const { data: threads } = await svc
        .from("mailbox_threads")
        .select("*")
        .in("id", threadIds);
      const threadMap = new Map((threads || []).map((t) => [t.id, t]));
      const msgIds = sortedMsgs.map((m) => m.id);
      const { data: allRecips } = msgIds.length
        ? await svc.from("mailbox_recipients").select("user_id, message_id").in("message_id", msgIds)
        : { data: [] as { user_id: string; message_id: string }[] };
      const profileMap = await getProfileMap(svc, [
        ...new Set([
          ...sortedMsgs.map((m) => m.sender_id),
          ...(allRecips || []).map((r) => r.user_id),
        ]),
      ]);

      for (const lastMsg of sortedMsgs) {
        const t = threadMap.get(lastMsg.thread_id);
        if (!t) continue;
        const { data: atts } = await svc
          .from("mailbox_attachments")
          .select("id, file_name")
          .eq("message_id", lastMsg.id);
        const recips = (allRecips || []).filter((r) => r.message_id === lastMsg.id);
        const peerId = recips.find((r) => r.user_id !== userId)?.user_id || userId;
        items.push({
          id: t.id,
          source: "mailbox",
          threadId: t.id,
          subject: t.subject || lastMsg.body?.slice(0, 60) || "Sin asunto",
          preview: (lastMsg.body || "").slice(0, 120),
          lastMessageAt: lastMsg.created_at,
          unread: false,
          hasAttachment: Boolean(atts?.length),
          docType: t.doc_type,
          expedienteRef: t.expediente_ref,
          expedienteCaratula: t.expediente_caratula,
          expedienteJuzgado: t.expediente_juzgado,
          attachmentNames: (atts || []).map((a) => a.file_name).filter(Boolean),
          peerLabel: displayName(profileMap.get(peerId)),
          peerUserId: peerId,
          documentStatus: t.document_status,
        });
      }
    }
  } else {
    let q = svc
      .from("mailbox_recipients")
      .select("id, thread_id, message_id, read_at, archived_at, folder, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit * 3);

    if (opts.folder === "inbox") q = q.eq("folder", "inbox").is("archived_at", null);
    if (opts.folder === "archived") q = q.not("archived_at", "is", null);
    if (opts.folder === "unread" || opts.folder === "action") {
      q = q.eq("folder", "inbox").is("read_at", null).is("archived_at", null);
    }

    const { data: rows } = await q;
    const seen = new Set<string>();
    for (const row of rows || []) {
      if (seen.has(row.thread_id)) continue;
      seen.add(row.thread_id);

      const { data: thread } = await svc
        .from("mailbox_threads")
        .select("*")
        .eq("id", row.thread_id)
        .single();
      if (!thread) continue;

      const { data: msg } = await svc
        .from("mailbox_messages")
        .select("body, sender_id")
        .eq("id", row.message_id)
        .single();

      const senderId = msg?.sender_id || "";
      const profileMap = await getProfileMap(svc, [senderId]);
      const { data: atts } = await svc
        .from("mailbox_attachments")
        .select("id, file_name")
        .eq("message_id", row.message_id);

      items.push({
        id: thread.id,
        source: "mailbox",
        threadId: thread.id,
        subject: thread.subject || (msg?.body || "").slice(0, 60) || "Sin asunto",
        preview: (msg?.body || "").slice(0, 120),
        lastMessageAt: thread.last_message_at || row.created_at,
        unread: !row.read_at,
        hasAttachment: Boolean(atts?.length),
        docType: thread.doc_type,
        expedienteRef: thread.expediente_ref,
        expedienteCaratula: thread.expediente_caratula,
        expedienteJuzgado: thread.expediente_juzgado,
        attachmentNames: (atts || []).map((a) => a.file_name).filter(Boolean),
        peerLabel: displayName(profileMap.get(senderId)),
        peerUserId: senderId,
        documentStatus: thread.document_status,
      });
      if (items.length >= limit) break;
    }
  }

  const migratedLegacyIds = await getMigratedLegacyTransferIds(svc);
  const legacy = await listLegacyInbox(userId, opts.folder, opts.q, migratedLegacyIds);
  const merged = [...items, ...legacy]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, limit);

  if (opts.q?.trim()) {
    const needle = opts.q.trim().toLowerCase();
    return merged.filter(
      (i) =>
        i.subject.toLowerCase().includes(needle) ||
        i.preview.toLowerCase().includes(needle) ||
        i.peerLabel.toLowerCase().includes(needle) ||
        (i.expedienteRef || "").toLowerCase().includes(needle)
    );
  }
  return merged;
}

async function getMigratedLegacyTransferIds(
  svc: ReturnType<typeof supabaseService>
): Promise<Set<string>> {
  const { data } = await svc
    .from("mailbox_threads")
    .select("legacy_transfer_id")
    .not("legacy_transfer_id", "is", null);
  return new Set(
    (data || []).map((row) => row.legacy_transfer_id as string).filter(Boolean)
  );
}

async function listLegacyInbox(
  userId: string,
  folder: string,
  q?: string,
  excludeTransferIds: Set<string> = new Set()
): Promise<MailboxInboxItem[]> {
  // Legacy no tiene read_at: solo inbox/sent/all. Evita inflar no-leídas/requieren-acción.
  if (folder === "unread" || folder === "action" || folder === "archived") {
    return [];
  }

  const svc = supabaseService();
  let query = svc
    .from("file_transfers")
    .select(
      "id, sender_user_id, recipient_user_id, doc_type, title, message, expediente_ref, expediente_caratula, expediente_juzgado, created_at, file_transfer_versions(storage_path)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (folder === "sent") {
    query = query.eq("sender_user_id", userId);
  } else if (folder === "inbox" || folder === "unread" || folder === "action" || folder === "all") {
    query = query.eq("recipient_user_id", userId);
  } else {
    return [];
  }

  const { data } = await query;
  const profileMap = await getProfileMap(
    svc,
    [...new Set((data || []).flatMap((t) => [t.sender_user_id, t.recipient_user_id]))]
  );

  return (data || [])
    .filter((t) => !excludeTransferIds.has(t.id))
    .map((t) => {
    const isSent = t.sender_user_id === userId;
    const peerId = isSent ? t.recipient_user_id : t.sender_user_id;
    const versions = t.file_transfer_versions as { storage_path: string }[] | null;
    return {
      id: t.id,
      source: "legacy" as const,
      threadId: t.id,
      subject: t.title || (t.message || "").slice(0, 60) || t.doc_type || "Documento",
      preview: (t.message || "").slice(0, 120),
      lastMessageAt: t.created_at,
      unread: false,
      hasAttachment: Boolean(versions?.length),
      docType: t.doc_type,
      expedienteRef: t.expediente_ref,
      expedienteCaratula: t.expediente_caratula,
      expedienteJuzgado: t.expediente_juzgado,
      attachmentNames: (versions || [])
        .map((v) => v.storage_path?.split("/").pop())
        .filter(Boolean) as string[],
      peerLabel: displayName(profileMap.get(peerId)),
      peerUserId: peerId,
    };
  });
}

export async function findMailboxThreadId(
  svc: ReturnType<typeof supabaseService>,
  id: string
): Promise<string | null> {
  const { data: byPk } = await svc.from("mailbox_threads").select("id").eq("id", id).maybeSingle();
  if (byPk?.id) return byPk.id;
  const { data: byLegacy } = await svc
    .from("mailbox_threads")
    .select("id")
    .eq("legacy_transfer_id", id)
    .maybeSingle();
  return byLegacy?.id ?? null;
}

/** Convierte un file_transfer en hilo mailbox (idempotente) para poder responder en el mismo hilo. */
export async function ensureMailboxThreadFromLegacy(userId: string, transferId: string): Promise<string> {
  const svc = supabaseService();
  const existing = await findMailboxThreadId(svc, transferId);
  if (existing) {
    if (!(await userCanAccessThread(svc, userId, existing))) {
      throw new Error("No tenés acceso a este hilo");
    }
    return existing;
  }

  const { data: t } = await svc.from("file_transfers").select("*").eq("id", transferId).single();
  if (!t || (t.sender_user_id !== userId && t.recipient_user_id !== userId)) {
    throw new Error("Transferencia no encontrada");
  }

  const { data: thread, error: tErr } = await svc
    .from("mailbox_threads")
    .insert({
      subject: t.title,
      doc_type: t.doc_type,
      expediente_ref: t.expediente_ref,
      expediente_caratula: t.expediente_caratula,
      expediente_juzgado: t.expediente_juzgado,
      created_by: t.sender_user_id,
      legacy_transfer_id: transferId,
      source: "legacy_import",
      last_message_at: t.created_at,
    })
    .select("id")
    .single();
  if (tErr || !thread?.id) throw new Error(tErr?.message || "No se pudo crear el hilo");

  const threadId = thread.id as string;

  const { data: message, error: mErr } = await svc
    .from("mailbox_messages")
    .insert({
      thread_id: threadId,
      sender_id: t.sender_user_id,
      body: (t.message || "").trim() || "(sin texto)",
      legacy_transfer_id: transferId,
      created_at: t.created_at,
    })
    .select("id")
    .single();
  if (mErr || !message?.id) throw new Error(mErr?.message || "No se pudo importar el mensaje");

  const messageId = message.id as string;
  const sentAt = new Date().toISOString();

  await svc.from("mailbox_recipients").insert([
    {
      thread_id: threadId,
      message_id: messageId,
      user_id: t.recipient_user_id,
      recipient_type: "to",
      folder: "inbox",
      read_at: null,
    },
    {
      thread_id: threadId,
      message_id: messageId,
      user_id: t.sender_user_id,
      recipient_type: "to",
      folder: "inbox",
      read_at: sentAt,
    },
  ]);

  const { data: versions } = await svc
    .from("file_transfer_versions")
    .select("*")
    .eq("transfer_id", transferId)
    .order("version", { ascending: false })
    .limit(1);

  const v = versions?.[0];
  if (v?.storage_path) {
    const ext = v.storage_path.match(/\.(\w+)$/)?.[0] || "";
    const baseName =
      (t.title || "").trim() ||
      v.storage_path.split("/").pop() ||
      `adjunto${ext || ".pdf"}`;
    await svc.from("mailbox_attachments").insert({
      id: crypto.randomUUID(),
      message_id: messageId,
      storage_path: v.storage_path,
      file_name: baseName.includes(".") ? baseName : `${baseName}${ext || ".pdf"}`,
      content_type: null,
      size_bytes: null,
      version: v.version ?? 1,
      uploaded_by: t.sender_user_id,
    });
  }

  return threadId;
}

export async function resolveMailboxThreadId(userId: string, id: string): Promise<string> {
  const svc = supabaseService();
  const mailboxId = await findMailboxThreadId(svc, id);
  if (mailboxId) {
    if (!(await userCanAccessThread(svc, userId, mailboxId))) {
      throw new Error("No tenés acceso a este hilo");
    }
    return mailboxId;
  }
  return ensureMailboxThreadFromLegacy(userId, id);
}

export async function getMailboxThread(
  userId: string,
  threadId: string,
  source?: string
): Promise<MailboxThreadDetail | null> {
  const svc = supabaseService();
  const mailboxId = await findMailboxThreadId(svc, threadId);
  if (mailboxId) {
    const ok = await userCanAccessThread(svc, userId, mailboxId);
    if (!ok) return null;
    return loadMailboxThreadDetail(svc, userId, mailboxId);
  }

  if (source === "legacy") {
    return getLegacyThreadDetail(userId, threadId);
  }

  const ok = await userCanAccessThread(svc, userId, threadId);
  if (!ok) return null;

  return loadMailboxThreadDetail(svc, userId, threadId);
}

async function loadMailboxThreadDetail(
  svc: ReturnType<typeof supabaseService>,
  userId: string,
  threadId: string
): Promise<MailboxThreadDetail | null> {
  const { data: thread } = await svc.from("mailbox_threads").select("*").eq("id", threadId).single();
  if (!thread) return null;

  const { data: messages } = await svc
    .from("mailbox_messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("is_draft", false)
    .order("created_at", { ascending: true });

  const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
  const profileMap = await getProfileMap(svc, senderIds);

  const enriched = [];
  for (const m of messages || []) {
    const { data: atts } = await svc
      .from("mailbox_attachments")
      .select("*")
      .eq("message_id", m.id)
      .order("version", { ascending: false });
    enriched.push({
      id: m.id,
      senderId: m.sender_id,
      senderName: displayName(profileMap.get(m.sender_id)),
      body: m.body,
      createdAt: m.created_at,
      replyToMessageId: m.reply_to_message_id,
      forwardedFromMessageId: m.forwarded_from_message_id,
      attachments: (atts || []).map((a) => ({
        id: a.id,
        fileName: a.file_name,
        contentType: a.content_type,
        sizeBytes: a.size_bytes,
        version: a.version,
      })),
    });
  }

  const { data: allRecips } = await svc
    .from("mailbox_recipients")
    .select("user_id, recipient_type")
    .eq("thread_id", threadId);

  const partMap = new Map<string, MailboxRecipientType[]>();
  for (const r of allRecips || []) {
    const types = partMap.get(r.user_id) || [];
    if (!types.includes(r.recipient_type)) types.push(r.recipient_type);
    partMap.set(r.user_id, types);
  }
  const partProfileMap = await getProfileMap(svc, [...partMap.keys()]);
  const participants = [...partMap.entries()].map(([userId, types]) => ({
    userId,
    name: displayName(partProfileMap.get(userId)),
    types,
  }));

  const { data: followers } = await svc
    .from("mailbox_thread_followers")
    .select("user_id")
    .eq("thread_id", threadId);
  const folMap = await getProfileMap(svc, (followers || []).map((f) => f.user_id));

  const { data: myRec } = await svc
    .from("mailbox_recipients")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  return {
    thread: {
      id: thread.id,
      subject: thread.subject,
      docType: thread.doc_type,
      expedienteRef: thread.expediente_ref,
      expedienteCaratula: thread.expediente_caratula,
      expedienteJuzgado: thread.expediente_juzgado,
      documentStatus: thread.document_status,
      createdAt: thread.created_at,
      lastMessageAt: thread.last_message_at,
      source: thread.source,
      legacyTransferId: thread.legacy_transfer_id,
    },
    messages: enriched,
    participants,
    followers: (followers || []).map((f) => ({
      userId: f.user_id,
      name: displayName(folMap.get(f.user_id)),
    })),
    myRecipientId: myRec?.[0]?.id || null,
  };
}

async function getLegacyThreadDetail(userId: string, transferId: string): Promise<MailboxThreadDetail | null> {
  const svc = supabaseService();
  const { data: t } = await svc
    .from("file_transfers")
    .select("*")
    .eq("id", transferId)
    .single();
  if (!t || (t.sender_user_id !== userId && t.recipient_user_id !== userId)) return null;

  const { data: versions } = await svc
    .from("file_transfer_versions")
    .select("*")
    .eq("transfer_id", transferId)
    .order("version", { ascending: false });

  const profileMap = await getProfileMap(svc, [t.sender_user_id, t.recipient_user_id]);

  return {
    thread: {
      id: t.id,
      subject: t.title,
      docType: t.doc_type,
      expedienteRef: t.expediente_ref,
      expedienteCaratula: t.expediente_caratula,
      expedienteJuzgado: t.expediente_juzgado,
      documentStatus: "open",
      createdAt: t.created_at,
      lastMessageAt: t.created_at,
      source: "legacy",
      legacyTransferId: t.id,
    },
    messages: [
      {
        id: t.id,
        senderId: t.sender_user_id,
        senderName: displayName(profileMap.get(t.sender_user_id)),
        body: t.message || "",
        createdAt: t.created_at,
        replyToMessageId: null,
        forwardedFromMessageId: null,
        attachments: (versions || []).map((v) => ({
          id: v.id,
          fileName: v.storage_path.split("/").pop() || "archivo",
          contentType: null,
          sizeBytes: null,
          version: v.version,
        })),
      },
    ],
    participants: [
      {
        userId: t.sender_user_id,
        name: displayName(profileMap.get(t.sender_user_id)),
        types: ["to"],
      },
      {
        userId: t.recipient_user_id,
        name: displayName(profileMap.get(t.recipient_user_id)),
        types: ["to"],
      },
    ],
    followers: [],
    myRecipientId: null,
  };
}

export async function markRecipientRead(
  userId: string,
  recipientId: string,
  read: boolean
) {
  const svc = supabaseService();
  const { data: row } = await svc
    .from("mailbox_recipients")
    .select("id, user_id")
    .eq("id", recipientId)
    .single();
  if (!row || row.user_id !== userId) throw new Error("Forbidden");

  await svc
    .from("mailbox_recipients")
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq("id", recipientId);
}

export async function markThreadRead(userId: string, threadId: string) {
  const svc = supabaseService();
  await svc
    .from("mailbox_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .is("read_at", null);

  await svc
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .filter("metadata->>mailbox_thread_id", "eq", threadId);
}

export async function archiveRecipient(userId: string, recipientId: string, archive: boolean) {
  const svc = supabaseService();
  const { data: row } = await svc
    .from("mailbox_recipients")
    .select("user_id")
    .eq("id", recipientId)
    .single();
  if (!row || row.user_id !== userId) throw new Error("Forbidden");
  await svc
    .from("mailbox_recipients")
    .update({
      archived_at: archive ? new Date().toISOString() : null,
      folder: archive ? "archived" : "inbox",
    })
    .eq("id", recipientId);
}

export async function countUnreadMailbox(userId: string) {
  const svc = supabaseService();
  const { data } = await svc
    .from("mailbox_recipients")
    .select("thread_id")
    .eq("user_id", userId)
    .is("read_at", null)
    .is("archived_at", null)
    .eq("folder", "inbox");
  return new Set((data || []).map((row) => row.thread_id).filter(Boolean)).size;
}

export async function searchMailbox(userId: string, q: string, limit = 30) {
  const needle = `%${q.trim().replace(/%/g, "")}%`;
  if (!q.trim()) return [];

  const svc = supabaseService();
  const { data: threads } = await svc
    .from("mailbox_threads")
    .select("id, subject, expediente_ref, expediente_caratula, expediente_juzgado, last_message_at")
    .or(
      `subject.ilike.${needle},expediente_ref.ilike.${needle},expediente_caratula.ilike.${needle},expediente_juzgado.ilike.${needle}`
    )
    .order("last_message_at", { ascending: false })
    .limit(limit);

  const results = [];
  for (const t of threads || []) {
    if (!(await userCanAccessThread(svc, userId, t.id))) continue;
    results.push({ type: "thread", id: t.id, subject: t.subject, lastMessageAt: t.last_message_at });
  }

  const { data: messages } = await svc
    .from("mailbox_messages")
    .select("id, thread_id, body, created_at")
    .ilike("body", needle)
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const m of messages || []) {
    if (!(await userCanAccessThread(svc, userId, m.thread_id))) continue;
    results.push({ type: "message", id: m.id, threadId: m.thread_id, preview: m.body.slice(0, 120) });
  }

  const { data: attachments } = await svc
    .from("mailbox_attachments")
    .select("id, message_id, file_name, mailbox_messages(thread_id)")
    .ilike("file_name", needle)
    .limit(limit);

  for (const a of attachments || []) {
    const rel = a.mailbox_messages as { thread_id: string } | { thread_id: string }[] | null;
    const threadId = Array.isArray(rel) ? rel[0]?.thread_id : rel?.thread_id;
    if (!threadId || !(await userCanAccessThread(svc, userId, threadId))) continue;
    results.push({ type: "attachment", id: a.id, threadId, fileName: a.file_name });
  }

  return results.slice(0, limit);
}

export async function signMailboxAttachmentDownload(userId: string, attachmentId: string) {
  const svc = supabaseService();
  const { data: att } = await svc
    .from("mailbox_attachments")
    .select("*, mailbox_messages(thread_id)")
    .eq("id", attachmentId)
    .single();
  if (!att) throw new Error("Adjunto no encontrado");
  const rel = att.mailbox_messages as { thread_id: string } | { thread_id: string }[] | null;
  const threadId = Array.isArray(rel) ? rel[0]?.thread_id : rel?.thread_id;
  if (!threadId || !(await userCanAccessThread(svc, userId, threadId))) {
    throw new Error("Forbidden");
  }
  const bucket = att.storage_path?.startsWith("transfers/") ? "transfers" : "mailbox";
  const { data: signed, error } = await svc.storage
    .from(bucket)
    .createSignedUrl(att.storage_path, 120);
  if (error || !signed?.signedUrl) throw new Error(error?.message || "No se pudo firmar URL");
  return { url: signed.signedUrl, fileName: att.file_name, version: att.version };
}

export async function uploadMailboxAttachmentVersion(
  userId: string,
  attachmentId: string,
  file: File
) {
  const svc = supabaseService();
  const name = file.name.toLowerCase();
  if (!name.endsWith(".docx")) throw new Error("Solo .docx para nueva versión");

  const { data: prev } = await svc
    .from("mailbox_attachments")
    .select("*, mailbox_messages(thread_id, sender_id)")
    .eq("id", attachmentId)
    .single();
  if (!prev) throw new Error("Adjunto no encontrado");
  const relPrev = prev.mailbox_messages as { thread_id: string } | { thread_id: string }[] | null;
  const prevThreadId = Array.isArray(relPrev) ? relPrev[0]?.thread_id : relPrev?.thread_id;
  if (!prevThreadId || !(await userCanAccessThread(svc, userId, prevThreadId))) {
    throw new Error("Forbidden");
  }

  const nextVersion = (prev.version || 1) + 1;
  const newId = crypto.randomUUID();
  const storage_path = `mailbox/${prev.message_id}/${newId}/v${nextVersion}.docx`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await svc.storage.from("mailbox").upload(storage_path, buf, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await svc.from("mailbox_attachments").insert({
    id: newId,
    message_id: prev.message_id,
    storage_path,
    file_name: file.name,
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: file.size,
    version: nextVersion,
    uploaded_by: userId,
  });
  if (insErr) throw new Error(insErr.message);
  return { attachmentId: newId, version: nextVersion };
}

export async function getMailboxMetrics() {
  const svc = supabaseService();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: threads },
    { count: messages },
    { count: unread },
    { count: attachments },
    { count: followers },
    { count: messagesWeek },
  ] = await Promise.all([
    svc.from("mailbox_threads").select("id", { count: "exact", head: true }),
    svc.from("mailbox_messages").select("id", { count: "exact", head: true }).eq("is_draft", false),
    svc
      .from("mailbox_recipients")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .is("archived_at", null),
    svc.from("mailbox_attachments").select("id", { count: "exact", head: true }),
    svc.from("mailbox_thread_followers").select("id", { count: "exact", head: true }),
    svc
      .from("mailbox_messages")
      .select("id", { count: "exact", head: true })
      .eq("is_draft", false)
      .gte("created_at", weekAgo),
  ]);

  const { data: topSenders } = await svc
    .from("mailbox_messages")
    .select("sender_id")
    .eq("is_draft", false)
    .gte("created_at", weekAgo);

  const counts = new Map<string, number>();
  for (const m of topSenders || []) {
    counts.set(m.sender_id, (counts.get(m.sender_id) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => ({ userId, count }));

  const profileMap = await getProfileMap(svc, top.map((t) => t.userId));

  return {
    threads: threads ?? 0,
    messages: messages ?? 0,
    unread: unread ?? 0,
    attachments: attachments ?? 0,
    followers: followers ?? 0,
    messagesLast7Days: messagesWeek ?? 0,
    topUsersLast7Days: top.map((t) => ({
      userId: t.userId,
      name: displayName(profileMap.get(t.userId)),
      count: t.count,
    })),
  };
}
