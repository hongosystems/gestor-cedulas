-- Consolidación del estado de lectura de bandeja (mailbox = fuente de verdad).
-- Ejecutar en Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Backfill: mailbox_recipients.read_at desde notifications ya leídas
-- ---------------------------------------------------------------------------
UPDATE mailbox_recipients mr
SET read_at = sub.read_at
FROM (
  SELECT
    n.user_id,
    mt.id AS thread_id,
    MAX(n.created_at) AS read_at
  FROM notifications n
  INNER JOIN mailbox_threads mt
    ON mt.legacy_transfer_id = (n.metadata->>'transfer_id')::uuid
  WHERE n.is_read = true
    AND n.metadata->>'transfer_id' IS NOT NULL
  GROUP BY n.user_id, mt.id
) sub
WHERE mr.user_id = sub.user_id
  AND mr.thread_id = sub.thread_id
  AND mr.read_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Sync inverso: notifications leídas cuando mailbox ya no tiene pendientes
-- ---------------------------------------------------------------------------
UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.metadata->>'mailbox_thread_id' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM mailbox_recipients mr
    WHERE mr.user_id = n.user_id
      AND mr.thread_id = (n.metadata->>'mailbox_thread_id')::uuid
      AND mr.read_at IS NULL
      AND mr.archived_at IS NULL
      AND mr.folder = 'inbox'
  );

UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.metadata->>'transfer_id' IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM mailbox_threads mt
    WHERE mt.legacy_transfer_id = (n.metadata->>'transfer_id')::uuid
      AND NOT EXISTS (
        SELECT 1
        FROM mailbox_recipients mr
        WHERE mr.user_id = n.user_id
          AND mr.thread_id = mt.id
          AND mr.read_at IS NULL
          AND mr.archived_at IS NULL
          AND mr.folder = 'inbox'
      )
  );

-- ---------------------------------------------------------------------------
-- 3. Contador de alertas de sistema (sin duplicar bandeja)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_app_notifications_unread(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM notifications n
  WHERE n.user_id = p_user_id
    AND n.is_read = false
    AND (n.metadata IS NULL OR n.metadata->>'mailbox_thread_id' IS NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM mailbox_threads mt
      WHERE mt.legacy_transfer_id = (n.metadata->>'transfer_id')::uuid
    );
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_mailbox_thread_id
  ON notifications ((metadata->>'mailbox_thread_id'))
  WHERE metadata->>'mailbox_thread_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_transfer_id
  ON notifications ((metadata->>'transfer_id'))
  WHERE metadata->>'transfer_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_recipients_user_unread_thread
  ON mailbox_recipients (user_id, thread_id)
  WHERE read_at IS NULL AND archived_at IS NULL AND folder = 'inbox';

COMMENT ON FUNCTION public.count_app_notifications_unread IS
  'Alertas de sistema sin duplicar envíos ya en mailbox';
