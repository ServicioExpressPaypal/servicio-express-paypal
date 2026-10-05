-- Payment-proof images attached to ticket chat messages. The image bytes are
-- encrypted by the Worker and deleted together with the message (cascade) when
-- the ticket expires, closes or the account is deleted.
CREATE TABLE ticket_images (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES ticket_messages(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX ticket_images_ticket ON ticket_images(ticket_id);
