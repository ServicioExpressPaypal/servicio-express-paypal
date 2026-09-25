CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK(status IN ('incomplete','pending','correction','active','suspended','closed')),
  full_name TEXT NOT NULL DEFAULT '',
  dossier TEXT,
  reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  request_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  mode TEXT NOT NULL CHECK(mode IN ('express','international')),
  bank TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('USD','NIO')),
  estimate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','reviewing','quoted','closed','cancelled')),
  quote TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, request_key)
);
CREATE INDEX tickets_owner_created ON tickets(user_id, created_at DESC);
CREATE INDEX tickets_status_created ON tickets(status, created_at DESC);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES user(id),
  target_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_target_created ON audit_events(target_id, created_at);
CREATE TABLE admin_grants (
  session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id),
  delivered INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);
