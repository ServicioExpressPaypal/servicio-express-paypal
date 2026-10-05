CREATE TABLE admin_pin_credentials (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL CHECK(iterations BETWEEN 100000 AND 1000000),
  updated_at INTEGER NOT NULL
);
