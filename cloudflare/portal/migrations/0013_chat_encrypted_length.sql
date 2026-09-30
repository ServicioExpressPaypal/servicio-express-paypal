-- Chat bodies are stored as AES-GCM ciphertext (base64 with an "enc:v1:" prefix),
-- which is about 1.4x longer than the plaintext. The original CHECK (1..1000)
-- rejected encrypted messages longer than ~716 bytes with a database error.
-- The API still limits plaintext to 1000 characters (at most 3000 UTF-8 bytes,
-- about 4050 characters once encrypted), so the column allows up to 4096.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt. Nothing
-- references ticket_messages, and existing rows and their order are preserved.
CREATE TABLE ticket_messages_new (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES user(id),
  author_role TEXT NOT NULL CHECK(author_role IN ('customer','admin')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4096),
  created_at INTEGER NOT NULL
);

INSERT INTO ticket_messages_new(id,ticket_id,author_id,author_role,body,created_at)
SELECT id,ticket_id,author_id,author_role,body,created_at FROM ticket_messages;

DROP TABLE ticket_messages;

ALTER TABLE ticket_messages_new RENAME TO ticket_messages;

CREATE INDEX ticket_messages_ticket_created
ON ticket_messages(ticket_id, created_at, id);
