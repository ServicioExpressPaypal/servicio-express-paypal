CREATE TABLE account_notices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  status TEXT NOT NULL CHECK(status IN ('correction','active','suspended','closed')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 300),
  delivered INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX account_notices_pending
ON account_notices(delivered, attempts, next_attempt_at);
