-- Verificación post-migración mailbox (ejecutar antes y después de backfill)

SELECT 'file_transfers' AS tabla, COUNT(*)::bigint AS total FROM file_transfers
UNION ALL
SELECT 'file_transfer_versions', COUNT(*) FROM file_transfer_versions
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL
SELECT 'mailbox_threads', COUNT(*) FROM mailbox_threads
UNION ALL
SELECT 'mailbox_messages', COUNT(*) FROM mailbox_messages
UNION ALL
SELECT 'mailbox_recipients', COUNT(*) FROM mailbox_recipients
UNION ALL
SELECT 'mailbox_attachments', COUNT(*) FROM mailbox_attachments
UNION ALL
SELECT 'mailbox_thread_followers', COUNT(*) FROM mailbox_thread_followers;

-- Conteo no leídos por usuario (ejemplo: reemplazar UUID)
-- SELECT user_id, COUNT(*) FROM mailbox_recipients WHERE read_at IS NULL AND archived_at IS NULL GROUP BY user_id;
