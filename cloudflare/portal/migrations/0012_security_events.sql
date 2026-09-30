CREATE TABLE security_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  subject_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX security_events_created ON security_events(created_at);
CREATE TABLE security_alerts (id TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
