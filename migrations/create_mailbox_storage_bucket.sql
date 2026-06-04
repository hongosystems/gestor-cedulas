-- Políticas storage bucket "mailbox" (crear bucket privado en Dashboard igual que "transfers")
-- Path: mailbox/{message_id}/{attachment_id}/v{version}{ext}

CREATE OR REPLACE FUNCTION get_mailbox_message_id_from_path(path text)
RETURNS uuid AS $$
DECLARE
  parts text[];
BEGIN
  parts := string_to_array(path, '/');
  IF array_length(parts, 1) >= 2 AND parts[1] = 'mailbox' THEN
    RETURN parts[2]::uuid;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP POLICY IF EXISTS "mailbox storage read" ON storage.objects;
CREATE POLICY "mailbox storage read"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'mailbox'
  AND EXISTS (
    SELECT 1 FROM mailbox_messages m
    WHERE m.id = get_mailbox_message_id_from_path(name)
      AND mailbox_user_can_access_thread(m.thread_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "mailbox storage insert" ON storage.objects;
CREATE POLICY "mailbox storage insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'mailbox' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "mailbox storage update" ON storage.objects;
CREATE POLICY "mailbox storage update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'mailbox' AND auth.uid() IS NOT NULL);
