CREATE TABLE document_deletions (
  user_id TEXT PRIMARY KEY,
  document_keys TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
