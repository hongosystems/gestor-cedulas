-- Fase 1: Casilla de correo interna (mailbox)
-- Coexiste con file_transfers legacy. NO borra tablas existentes.
-- Ejecutar en Supabase SQL Editor. Crear bucket "mailbox" (privado) en Storage si no existe.

-- ---------------------------------------------------------------------------
-- mailbox_threads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT,
  doc_type VARCHAR(20) CHECK (doc_type IS NULL OR doc_type IN ('CEDULA', 'OFICIO', 'OTROS_ESCRITOS')),
  expediente_ref TEXT,
  expediente_caratula TEXT,
  expediente_juzgado TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  legacy_transfer_id UUID UNIQUE,
  source VARCHAR(20) NOT NULL DEFAULT 'mailbox' CHECK (source IN ('mailbox', 'legacy_import')),
  document_status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (document_status IN ('open', 'pending', 'in_review', 'answered', 'closed')),
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- mailbox_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES mailbox_threads(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reply_to_message_id UUID REFERENCES mailbox_messages(id) ON DELETE SET NULL,
  forwarded_from_message_id UUID REFERENCES mailbox_messages(id) ON DELETE SET NULL,
  legacy_transfer_id UUID UNIQUE,
  is_draft BOOLEAN NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- mailbox_recipients (estado por usuario / mensaje)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES mailbox_threads(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES mailbox_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_type VARCHAR(10) NOT NULL DEFAULT 'to'
    CHECK (recipient_type IN ('to', 'cc', 'bcc', 'mention')),
  read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  folder VARCHAR(20) NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox', 'sent', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, recipient_type)
);

-- ---------------------------------------------------------------------------
-- mailbox_attachments (un archivo por mensaje, compartido por destinatarios)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES mailbox_messages(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, version)
);

-- ---------------------------------------------------------------------------
-- mailbox_thread_followers (seguidores — actualizaciones sin ser destinatario principal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mailbox_thread_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES mailbox_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thread_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mailbox_threads_last_message_at
  ON mailbox_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_threads_created_by
  ON mailbox_threads(created_by);
CREATE INDEX IF NOT EXISTS idx_mailbox_threads_legacy_transfer
  ON mailbox_threads(legacy_transfer_id) WHERE legacy_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mailbox_threads_document_status
  ON mailbox_threads(document_status);

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_thread_created
  ON mailbox_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_mailbox_messages_sender
  ON mailbox_messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_recipients_user_folder
  ON mailbox_recipients(user_id, folder, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_recipients_user_unread
  ON mailbox_recipients(user_id) WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mailbox_recipients_thread
  ON mailbox_recipients(thread_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_recipients_message
  ON mailbox_recipients(message_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_message
  ON mailbox_attachments(message_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_thread_followers_user
  ON mailbox_thread_followers(user_id);

-- Búsqueda Fase 12 (opcional: descomentar tras CREATE EXTENSION pg_trgm)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_mailbox_threads_subject_trgm ON mailbox_threads USING gin (subject gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_mailbox_messages_body_trgm ON mailbox_messages USING gin (body gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Triggers updated_at / last_message_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mailbox_threads_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailbox_threads_updated_at ON mailbox_threads;
CREATE TRIGGER trg_mailbox_threads_updated_at
  BEFORE UPDATE ON mailbox_threads
  FOR EACH ROW EXECUTE FUNCTION mailbox_threads_set_updated_at();

CREATE OR REPLACE FUNCTION mailbox_thread_touch_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE mailbox_threads
  SET last_message_at = NEW.created_at, updated_at = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailbox_messages_touch_thread ON mailbox_messages;
CREATE TRIGGER trg_mailbox_messages_touch_thread
  AFTER INSERT ON mailbox_messages
  FOR EACH ROW
  WHEN (NOT NEW.is_draft)
  EXECUTE FUNCTION mailbox_thread_touch_on_message();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE mailbox_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_thread_followers ENABLE ROW LEVEL SECURITY;

-- Helper: usuario participa en el hilo
CREATE OR REPLACE FUNCTION mailbox_user_can_access_thread(p_thread_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM mailbox_recipients r WHERE r.thread_id = p_thread_id AND r.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM mailbox_messages m
    WHERE m.thread_id = p_thread_id AND m.sender_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM mailbox_thread_followers f
    WHERE f.thread_id = p_thread_id AND f.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM mailbox_threads t
    WHERE t.id = p_thread_id AND t.created_by = p_user_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- threads
DROP POLICY IF EXISTS mailbox_threads_select ON mailbox_threads;
CREATE POLICY mailbox_threads_select ON mailbox_threads FOR SELECT
  USING (mailbox_user_can_access_thread(id, auth.uid()));

DROP POLICY IF EXISTS mailbox_threads_insert ON mailbox_threads;
CREATE POLICY mailbox_threads_insert ON mailbox_threads FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS mailbox_threads_update ON mailbox_threads;
CREATE POLICY mailbox_threads_update ON mailbox_threads FOR UPDATE
  USING (mailbox_user_can_access_thread(id, auth.uid()));

-- messages
DROP POLICY IF EXISTS mailbox_messages_select ON mailbox_messages;
CREATE POLICY mailbox_messages_select ON mailbox_messages FOR SELECT
  USING (mailbox_user_can_access_thread(thread_id, auth.uid()));

DROP POLICY IF EXISTS mailbox_messages_insert ON mailbox_messages;
CREATE POLICY mailbox_messages_insert ON mailbox_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

-- recipients
DROP POLICY IF EXISTS mailbox_recipients_select ON mailbox_recipients;
CREATE POLICY mailbox_recipients_select ON mailbox_recipients FOR SELECT
  USING (user_id = auth.uid() OR mailbox_user_can_access_thread(thread_id, auth.uid()));

DROP POLICY IF EXISTS mailbox_recipients_update_own ON mailbox_recipients;
CREATE POLICY mailbox_recipients_update_own ON mailbox_recipients FOR UPDATE
  USING (user_id = auth.uid());

-- attachments
DROP POLICY IF EXISTS mailbox_attachments_select ON mailbox_attachments;
CREATE POLICY mailbox_attachments_select ON mailbox_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mailbox_messages m
      WHERE m.id = mailbox_attachments.message_id
        AND mailbox_user_can_access_thread(m.thread_id, auth.uid())
    )
  );

-- followers
DROP POLICY IF EXISTS mailbox_followers_select ON mailbox_thread_followers;
CREATE POLICY mailbox_followers_select ON mailbox_thread_followers FOR SELECT
  USING (user_id = auth.uid() OR mailbox_user_can_access_thread(thread_id, auth.uid()));

DROP POLICY IF EXISTS mailbox_followers_insert ON mailbox_thread_followers;
CREATE POLICY mailbox_followers_insert ON mailbox_thread_followers FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS mailbox_followers_delete ON mailbox_thread_followers;
CREATE POLICY mailbox_followers_delete ON mailbox_thread_followers FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE mailbox_threads IS 'Hilos de la bandeja tipo correo interno';
COMMENT ON TABLE mailbox_messages IS 'Mensajes dentro de un hilo';
COMMENT ON TABLE mailbox_recipients IS 'Destinatarios y estado leído/archivado por usuario';
COMMENT ON TABLE mailbox_attachments IS 'Adjuntos compartidos por mensaje (una copia física)';
COMMENT ON TABLE mailbox_thread_followers IS 'Seguidores del hilo (notificaciones sin ser To/CC)';
