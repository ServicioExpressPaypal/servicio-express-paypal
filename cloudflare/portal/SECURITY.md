# Security remediation - 2026-09-29

Scope: portal.saldoexpressnicaragua.com, its Cloudflare Worker, repository and
deployment pipeline. These controls reduce risk; they are not a guarantee of
invulnerability or a legal/compliance certification.

## Controls and evidence

1. Private API credentials live in Worker Secrets. No service credentials in
   browser assets. The Turnstile site key is intentionally public.
2. Gitleaks scans full Git history in CI. One exact exception is a historical
   Supabase `anon` client JWT (not a privileged service-role key), from commit
   66f1507ebe5a578bd0bd797124a30da57195ebc4. The associated legacy project
   vwsrjsaeizmttitnbgnz was confirmed INACTIVE through Supabase on 2026-09-29.
   The current application does not use Supabase. Before any reactivation,
   audit its policies and rotate/revoke obsolete credentials. Do not rewrite
   shared history to conceal this finding. No broad token-scanner exclusions.
3. A public database API key is not applicable: D1 is a private Worker binding.
   Never expose Cloudflare tokens or build a browser-to-database gateway.
4. PostgreSQL RLS is not applicable to D1. Worker queries enforce ownership and
   verified admin authorization on every protected endpoint; tests exercise
   cross-user and cross-role access. R2 objects are private.
5. AES-256-GCM protects profile name/phone, beneficiary name, account number and
   ticket messages. Unique random IVs and record/field-bound AAD prevent swapping
   encrypted fields. Email, bank label, currency and operational metadata remain
   queryable; provider storage encryption is additional, not a substitute.
6. Server-side session and verified-email checks cannot be replaced by UI state.
7. Admin access additionally requires TOTP/recovery code and a 15-minute grant.
8. Amounts, ownership, statuses, estimates and transition versions are validated
   on the server; clients cannot approve themselves or change calculated values.
9. Sessions use Secure, HttpOnly cookies, trusted origins and no browser caching.
10. Better Auth hashes passwords and revokes sessions on reset. Change/reset
    notifications are sent without passwords or tokens in security logs.
11. Atomic D1 counters enforce three attempts per IP and five per account/action
    per 15 minutes. Account counters use HMAC identifiers and limit distributed
    guessing. Shared IPs can still experience temporary lockouts.
12. Turnstile is verified server-side (hostname/action included), and a coarse
    edge limiter rejects excessive requests before D1. These are not a capacity
    guarantee or a replacement for Cloudflare DDoS protection.
13. Custom request metrics record query count, duration and failures, not SQL
    parameters. Security events last 30 days. The cron sends threshold alerts
    with a one-hour cooldown; delivery errors allow retry after five minutes.
    Automatic traces/invocation logs stay off to avoid reset tokens and SQL
    parameters. Restrict Cloudflare dashboard access to trusted operators.
14. Payload sizes, types, money precision and allowed state transitions are
    validated. D1 user values use parameter binding.
15. User content is escaped in the UI. CSP restricts scripts to local assets and
    Cloudflare's challenge service. No unsafe-inline or eval authorization.
16. New document uploads remain disabled. Legacy downloads require admin access,
    use attachment disposition and sandbox CSP with nosniff.
17. API responses are scoped and bounded. Customer history is paginated. Admin
    lists are still capped at 100 newest rows: add pagination before exceeding
    that operational capacity. This does not widen record permissions.
18. CSP, frame denial, nosniff, no-referrer and restrictive permissions headers
    are applied to success and error responses.
19. HTTPS redirect, 180-day HSTS and TLS >=1.2 are enabled in the Cloudflare zone.
    Worker also redirects HTTP to its canonical HTTPS host. No HSTS preload.
20. Exact dependency versions, npm audit in CI, weekly Dependabot and pinned
    workflow action SHAs. Current audit must be rerun at each release; absence
    of known advisories does not prove a dependency is safe.

## Safe rollout

The resources named `saldo-express-staging` (D1) and `saldo-express-kyc-staging`
(R2) are **production** resources. Their historic names do not indicate test
data. Do not rename, replace, reset or seed them during deployment. Miniflare
tests are isolated and use test-only credentials.

Before rollout, verify `wrangler secret list`. For the initial encryption
deployment only:

```sh
node scripts/security-data.mjs prepare
npx wrangler secret bulk .wrangler/security/data-encryption.json
npx wrangler d1 migrations apply DB --remote
npm run deploy
node scripts/security-data.mjs verify-production saldo-express-portal
```

The prepare command generates a protected ignored file (0700 directory, 0600
file), never prints the key, and preserves an existing local key. Place an
encrypted backup in the operator's approved secret store. Do not replace an
existing Worker key with a newly generated value: encrypted records become
unreadable. Normal releases do not run `prepare` or change this secret.

Legacy plaintext rows remain readable while the idempotent bounded migration
encrypts them inside the Worker cron, every 15 minutes, without downloading
customer records to an operator's computer. Compare-and-update conditions
prevent overwriting concurrent changes; erasure rules run first. Verification
queries only aggregate counts. If any count is nonzero, keep registration closed,
wait for a cron cycle and verify again; inspect cron failures if counts persist.
Older provider backups can still contain plaintext until backup retention ends.
Restore only with access closed, preserving the matching encryption key, then
run retention and encryption migration before reopening. Rollback after migration
must retain the encryption-aware reader, not a pre-encryption Worker version.

Registration is now open after confirming that the existing owner has a verified
email and enabled MFA in production. New customers still require email
verification and manual account approval before creating tickets. For future
rollouts or recovery, keep `REGISTRATION_OPEN=false` until the owner has enrolled
MFA. Never generate an OTP for the owner, collect their recovery codes, or
silently disable MFA to bypass setup.
Public home remains in construction. Release readiness also requires review of
business/legal obligations outside this technical audit.
