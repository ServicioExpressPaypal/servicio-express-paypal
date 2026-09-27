ALTER TABLE tickets ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;

UPDATE tickets
SET expires_at = created_at + 86400000
WHERE expires_at = 0;

CREATE INDEX tickets_expiry ON tickets(expires_at);

CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES user(id),
  author_role TEXT NOT NULL CHECK(author_role IN ('customer','admin')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL
);

CREATE INDEX ticket_messages_ticket_created
ON ticket_messages(ticket_id, created_at, id);
