-- Sincroniza notifications legacy de bandeja con el estado real del mailbox.
-- Ejecutar en Supabase SQL Editor.

-- Contador eficiente: alertas de sistema (excluye duplicados de mailbox y transfers importados).
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

-- Índice parcial para limpiar/marcar notifications vinculadas a bandeja.
CREATE INDEX IF NOT EXISTS idx_notifications_mailbox_thread_id
  ON notifications ((metadata->>'mailbox_thread_id'))
  WHERE metadata->>'mailbox_thread_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_transfer_id
  ON notifications ((metadata->>'transfer_id'))
  WHERE metadata->>'transfer_id' IS NOT NULL;

-- Marcar como leídas las notifications de bandeja cuyo hilo ya no tiene pendientes en mailbox.
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

-- Marcar como leídas las notifications de transfer ya atendidas en mailbox.
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
