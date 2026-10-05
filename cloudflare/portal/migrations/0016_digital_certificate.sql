ALTER TABLE tickets ADD COLUMN certificate_code TEXT;
ALTER TABLE tickets ADD COLUMN certificate_email_sent_at INTEGER;
ALTER TABLE tickets ADD COLUMN certificate_email_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN certificate_email_next_attempt_at INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX tickets_certificate_code
ON tickets(certificate_code);

CREATE INDEX tickets_certificate_email_pending
ON tickets(certificate_email_sent_at, certificate_email_attempts, certificate_email_next_attempt_at)
WHERE certificate_code IS NOT NULL;
