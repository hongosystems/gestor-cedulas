export type MailboxDocType = "CEDULA" | "OFICIO" | "OTROS_ESCRITOS";
export type MailboxRecipientType = "to" | "cc" | "bcc" | "mention";
export type MailboxFolder = "inbox" | "sent" | "archived";
export type MailboxDocumentStatus =
  | "open"
  | "pending"
  | "in_review"
  | "answered"
  | "closed";

export type MailboxRecipientInput = {
  userId: string;
  type: MailboxRecipientType;
};

export type ComposeMailboxInput = {
  subject?: string;
  body: string;
  docType?: MailboxDocType;
  expedienteRef?: string | null;
  expedienteCaratula?: string | null;
  expedienteJuzgado?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  threadId?: string;
  replyToMessageId?: string;
  forwardedFromMessageId?: string;
  followerIds?: string[];
};

export type MailboxInboxItem = {
  id: string;
  source: "mailbox" | "legacy";
  threadId: string;
  subject: string;
  preview: string;
  lastMessageAt: string;
  unread: boolean;
  hasAttachment: boolean;
  docType: string | null;
  expedienteRef: string | null;
  expedienteCaratula?: string | null;
  expedienteJuzgado?: string | null;
  attachmentNames?: string[];
  peerLabel: string;
  /** Para búsqueda por email del remitente/destinatario */
  peerUserId?: string;
  documentStatus?: string | null;
};

export type MailboxThreadDetail = {
  thread: {
    id: string;
    subject: string | null;
    docType: string | null;
    expedienteRef: string | null;
    expedienteCaratula: string | null;
    expedienteJuzgado: string | null;
    documentStatus: string;
    createdAt: string;
    lastMessageAt: string;
    source: string;
    legacyTransferId: string | null;
  };
  messages: Array<{
    id: string;
    senderId: string;
    senderName: string;
    body: string;
    createdAt: string;
    replyToMessageId: string | null;
    forwardedFromMessageId: string | null;
    attachments: Array<{
      id: string;
      fileName: string;
      contentType: string | null;
      sizeBytes: number | null;
      version: number;
    }>;
  }>;
  participants: Array<{
    userId: string;
    name: string;
    types: MailboxRecipientType[];
  }>;
  followers: Array<{ userId: string; name: string }>;
  myRecipientId: string | null;
};
