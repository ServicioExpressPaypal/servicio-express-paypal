ALTER TABLE notifications ADD COLUMN whatsapp_delivered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN whatsapp_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN whatsapp_next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN whatsapp_message_id TEXT;

CREATE INDEX notifications_whatsapp_pending
ON notifications(whatsapp_delivered, whatsapp_attempts, whatsapp_next_attempt_at);
