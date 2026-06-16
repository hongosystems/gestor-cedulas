import { supabase } from "@/lib/supabase";
import {
  assertValidMailboxFile,
  contentTypeForMailboxExt,
  extFromMailboxFileName,
  MAX_MAILBOX_ATTACHMENT_BYTES,
  MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/mailbox-attachments";

export type MailboxSendPayload = {
  subject?: string;
  body: string;
  doc_type?: string;
  expediente_ref?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to_message_id?: string;
};

export type MailboxSendResult =
  | { ok: true; threadId: string; messageId: string; hasAttachment: boolean }
  | { ok: false; error: string };

type MailboxUploadSlot = {
  attachment_id: string;
  storage_path: string;
  content_type: string;
  version: number;
};

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function parseJson(res: Response) {
  return res.json().catch(() => ({}));
}

function normalizeFiles(files?: File | File[] | null): File[] {
  if (!files) return [];
  const list = Array.isArray(files) ? files : [files];
  return list.filter((f) => f instanceof File && f.size > 0);
}

function parseUploadSlots(initJson: Record<string, unknown>): MailboxUploadSlot[] {
  if (Array.isArray(initJson.uploads)) {
    return initJson.uploads as MailboxUploadSlot[];
  }
  if (initJson.upload && typeof initJson.upload === "object") {
    return [initJson.upload as MailboxUploadSlot];
  }
  return [];
}

/** Envía un mensaje de bandeja; con archivos usa upload directo a Supabase (evita límite Vercel 4.5 MB). */
export async function sendMailboxMessage(
  apiUrl: string,
  token: string,
  payload: MailboxSendPayload,
  files?: File | File[] | null
): Promise<MailboxSendResult> {
  const body = payload.body.trim();
  const fileList = normalizeFiles(files);
  const hasFiles = fileList.length > 0;

  if (!body && !hasFiles) {
    return { ok: false, error: "Escribí un mensaje o adjuntá un archivo." };
  }

  if (fileList.length > MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      error: `Podés adjuntar hasta ${MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE} archivos por mensaje.`,
    };
  }

  for (const file of fileList) {
    try {
      assertValidMailboxFile(file.name, file.size);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Archivo inválido." };
    }
  }

  if (!hasFiles) {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    const json = await parseJson(res);
    if (!res.ok) {
      return { ok: false, error: (json.error as string) || "No se pudo enviar." };
    }
    return {
      ok: true,
      threadId: String(json.threadId),
      messageId: String(json.messageId),
      hasAttachment: Boolean(json.hasAttachment),
    };
  }

  const initRes = await fetch(apiUrl, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      phase: "init",
      ...payload,
      files: fileList.map((f) => ({ file_name: f.name, file_size: f.size })),
    }),
  });
  const initJson = (await parseJson(initRes)) as Record<string, unknown>;
  if (!initRes.ok) {
    return { ok: false, error: (initJson.error as string) || "No se pudo iniciar el envío." };
  }

  const uploads = parseUploadSlots(initJson);
  if (!initJson.messageId || !initJson.threadId || uploads.length !== fileList.length) {
    return { ok: false, error: "Respuesta inválida al iniciar el envío." };
  }

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const upload = uploads[i];
    const ext = extFromMailboxFileName(file.name);
    if (!ext) {
      return { ok: false, error: "Tipo de archivo no permitido." };
    }

    const { error: uploadErr } = await supabase.storage
      .from("mailbox")
      .upload(upload.storage_path, file, {
        contentType: upload.content_type || contentTypeForMailboxExt(ext),
        upsert: true,
      });

    if (uploadErr) {
      return {
        ok: false,
        error: uploadErr.message || `No se pudo subir ${file.name}.`,
      };
    }
  }

  const commitRes = await fetch(apiUrl, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      phase: "commit",
      thread_id: initJson.threadId,
      message_id: initJson.messageId,
      attachments: fileList.map((file, i) => {
        const upload = uploads[i];
        const ext = extFromMailboxFileName(file.name)!;
        return {
          attachment_id: upload.attachment_id,
          storage_path: upload.storage_path,
          file_name: file.name,
          content_type: upload.content_type || contentTypeForMailboxExt(ext),
          size_bytes: file.size,
          version: upload.version ?? 1,
        };
      }),
    }),
  });
  const commitJson = await parseJson(commitRes);
  if (!commitRes.ok) {
    return { ok: false, error: (commitJson.error as string) || "No se pudo finalizar el envío." };
  }

  return {
    ok: true,
    threadId: String(commitJson.threadId || initJson.threadId),
    messageId: String(commitJson.messageId || initJson.messageId),
    hasAttachment: true,
  };
}

export { MAX_MAILBOX_ATTACHMENT_BYTES, MAX_MAILBOX_ATTACHMENTS_PER_MESSAGE };
