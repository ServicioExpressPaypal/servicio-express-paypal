ALTER TABLE tickets ADD COLUMN data_erased_at INTEGER;
CREATE TABLE registration_consents (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE INDEX tickets_pending_erasure ON tickets(data_erased_at, expires_at);
