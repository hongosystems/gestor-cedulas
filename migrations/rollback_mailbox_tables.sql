-- ROLLBACK MANUAL — solo si se acepta perder datos mailbox
-- NO afecta file_transfers ni notifications

DROP TABLE IF EXISTS mailbox_thread_followers CASCADE;
DROP TABLE IF EXISTS mailbox_attachments CASCADE;
DROP TABLE IF EXISTS mailbox_recipients CASCADE;
DROP TABLE IF EXISTS mailbox_messages CASCADE;
DROP TABLE IF EXISTS mailbox_threads CASCADE;

DROP FUNCTION IF EXISTS mailbox_user_can_access_thread(UUID, UUID);
DROP FUNCTION IF EXISTS mailbox_thread_touch_on_message();
DROP FUNCTION IF EXISTS mailbox_threads_set_updated_at();
