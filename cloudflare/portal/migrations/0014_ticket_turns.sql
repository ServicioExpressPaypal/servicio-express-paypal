ALTER TABLE tickets ADD COLUMN queue_at INTEGER;
ALTER TABLE tickets ADD COLUMN turn_started_at INTEGER;
CREATE INDEX tickets_queue ON tickets(status, queue_at);
