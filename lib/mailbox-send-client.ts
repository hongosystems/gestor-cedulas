import { supabase } from "@/lib/supabase";
import {
  assertValidMailboxFile,
  contentTypeForMailboxExt,
  extFromMailboxFileName,
  MAX_MAILBOX_ATTACHMENT_BYTES,
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

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function parseJson(res: Response) {
  return res.json().catch(() => ({}));
}

/** Envía un mensaje de bandeja; con archivo usa upload directo a Supabase (evita límite Vercel 4.5 MB). */
export async function sendMailboxMessage(
  apiUrl: string,
  token: string,
  payload: MailboxSendPayload,
  file?: File | null
): Promise<MailboxSendResult> {
  const body = payload.body.trim();
  const hasFile = Boolean(file && file.size > 0);

  if (!body && !hasFile) {
    return { ok: false, error: "Escribí un mensaje o adjuntá un archivo." };
  }

  if (file) {
    try {
      assertValidMailboxFile(file.name, file.size);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Archivo inválido." };
    }
  }

  if (!hasFile) {
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

  const ext = extFromMailboxFileName(file!.name);
  if (!ext) {
    return { ok: false, error: "Tipo de archivo no permitido." };
  }

  const initRes = await fetch(apiUrl, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      phase: "init",
      ...payload,
      file_name: file!.name,
      file_size: file!.size,
    }),
  });
  const initJson = await parseJson(initRes);
  if (!initRes.ok) {
    return { ok: false, error: (initJson.error as string) || "No se pudo iniciar el envío." };
  }

  const upload = initJson.upload as
    | {
        attachment_id: string;
        storage_path: string;
        content_type: string;
        version: number;
      }
    | undefined;

  if (!initJson.messageId || !initJson.threadId || !upload?.storage_path) {
    return { ok: false, error: "Respuesta inválida al iniciar el envío." };
  }

  const { error: uploadErr } = await supabase.storage
    .from("mailbox")
    .upload(upload.storage_path, file!, {
      contentType: upload.content_type || contentTypeForMailboxExt(ext),
      upsert: true,
    });

  if (uploadErr) {
    return {
      ok: false,
      error: uploadErr.message || "No se pudo subir el archivo adjunto.",
    };
  }

  const commitRes = await fetch(apiUrl, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      phase: "commit",
      thread_id: initJson.threadId,
      message_id: initJson.messageId,
      attachment: {
        attachment_id: upload.attachment_id,
        storage_path: upload.storage_path,
        file_name: file!.name,
        content_type: upload.content_type || contentTypeForMailboxExt(ext),
        size_bytes: file!.size,
        version: upload.version ?? 1,
      },
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

export { MAX_MAILBOX_ATTACHMENT_BYTES };
