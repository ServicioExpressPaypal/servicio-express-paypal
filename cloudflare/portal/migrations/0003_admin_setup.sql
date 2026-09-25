CREATE TABLE admin_setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER
);
