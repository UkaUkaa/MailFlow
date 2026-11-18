# Security model

No claim of "zero vulnerabilities" is made. This document states what is defended, how, and what
is not yet covered. No external security assessment has been performed.

## Threat model

Assets: provider credentials (OAuth tokens, IMAP/SMTP passwords), mail content and attachments, MailFlow account
credentials and sessions.

| Adversary | Goal | Main defences |
|---|---|---|
| Another tenant | Read or modify someone else's mail, accounts, settings | Ownership filter in every query, 404 for foreign objects, PostgreSQL RLS, composite foreign keys |
| Anonymous attacker | Take over accounts | Argon2id, uniform errors, rate limits, hashed single-use tokens, session revocation |
| Malicious email sender | Run script in the reader, track opens, break layout | Server-side sanitization, sandboxed iframe, CSP, remote images off by default |
| Malicious web page | Act with the user's session | CSRF token + Origin allowlist + SameSite cookies |
| Database reader (backup leak, SQL access) | Use stored provider tokens | AES-256-GCM, keys outside the database, AAD binding to user/account |
| Insider / operator | Read users' mail | No admin mail access exists; no impersonation feature; logs carry no content |
| Attacker supplying a mail host | Reach internal services (SSRF), scan ports | Resolve-and-validate guard, port allowlist, connect to validated IP, uniform errors, rate limit |
| Network attacker between MailFlow and a mail server | Read mailbox passwords or mail | TLS mandatory with certificate and host name verification; no plaintext fallback |

Out of scope today: a compromised application host (it holds the vault key in memory), denial of
service beyond basic rate limits, malware inside attachments.

## Authentication

- Passwords: Argon2id (`argon2-cffi` defaults, RFC 9106 low-memory profile), 10–128 characters.
  Hashes are upgraded on login when parameters change.
- Unknown-user logins verify against a dummy hash so timing does not reveal account existence.
  Registration, resend and forgot-password respond identically for existing and unknown addresses.
- Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (on HTTPS) cookie.
  Only the SHA-256 digest is stored. Absolute lifetime 14 days, idle timeout 7 days (configurable).
  Sessions can be listed and revoked; password reset revokes all, password change revokes others.
- Verification and reset tokens: random, stored hashed, single use (atomic `UPDATE … RETURNING`),
  time-limited, and replaced when a new one is issued.
- CSRF: `mf_csrf` cookie must match the `X-CSRF-Token` header on every state-changing request,
  and a present `Origin` must be allowlisted. The CSRF token is rotated at login.
- Rate limits (Redis): per IP on auth endpoints, per identity on login (10 / 15 min), reset and
  resend (3 / hour), OAuth start (20 / hour), send (60 / hour), manual sync; plus Nginx edge limits.
- Nothing authentication-related is stored in `localStorage`.

## Tenant isolation

See `architecture/DATA_OWNERSHIP.md`. In short:

1. The acting user comes only from the session (`require_auth`). Request schemas reject unknown
   fields, so a forged `user_id` is a validation error.
2. Every repository call takes `user_id`; foreign objects are 404.
3. RLS on all tenant tables with a transaction-local setting; the application role owns nothing
   and has no `BYPASSRLS`. Cross-tenant operational work is limited to two `SECURITY DEFINER`
   functions that return IDs or delete expired rows.
4. Composite foreign keys `(account_id, user_id)` prevent a row from referencing another tenant's
   account even through a bug.
5. Workers receive `(user_id, account_id)` only and re-check ownership and active status.

Tests: `backend/tests/security/test_tenant_isolation.py` (IDOR on every resource type, forged
identifiers, mixed own/foreign references, RLS without context, cross-tenant writes, pooled
connection reuse, concurrent transactions and requests).

## OAuth (Gmail)

- Authorization-code flow with PKCE (S256) and offline access.
- `state`: 256-bit random, stored hashed, bound to the initiating user, single use, 10-minute
  lifetime. The callback requires the user's session and a state issued to that same user.
- The redirect URI is fixed server configuration; the post-callback redirect target is built
  from server configuration only.
- Scope: `gmail.modify` only. The mailbox address is read from the Gmail profile.
- Reconnect must return the same mailbox, otherwise the new grant is revoked.
- Passwords for Google accounts are never requested or stored.

## Token Vault

- AES-256-GCM (`cryptography`), fresh 96-bit nonce per write.
- AAD = `mailflow:v1|user_id|account_id|kind`; ciphertext copied to another account or tenant
  fails authentication.
- Keys come from `VAULT_KEYS` (environment / secrets manager), never from the database or source
  control. Production refuses to start without them.
- Rotation: add a new key to `VAULT_KEYS`, set `VAULT_PRIMARY_KEY_ID`, restart, then re-encrypt
  with `TokenVault.rotate_user` (per user); remove the old key once no row references it.
- Password-based mailboxes (IMAP/SMTP): the password, the user name and both server addresses
  are stored together as **one** secret of kind `imap_password`. No plain column says which
  server a mailbox uses. The request model holds the password as `SecretStr`; the in-memory
  `ServerCredentials` excludes password and user name from `repr`. The password is never echoed
  by the API, written to the audit trail, or passed to Celery. There is no way to read a stored
  password back; reconnecting replaces it. Disconnecting deletes it.
- MailFlow has to store the mailbox password itself (IMAP has no token to store instead), so a
  vault-key compromise exposes those passwords. Users should prefer app passwords, which can be
  revoked individually.
- Plaintext credentials exist only in memory during a provider call. They are never returned by
  the API, logged, placed in Celery arguments or sent to the browser. `Credentials.__repr__`
  omits token fields; the logger redacts sensitive keys.

## Email content and attachments

- All HTML is sanitized on ingestion with `nh3` (allowlisted tags, attributes, CSS properties and
  URL schemes; scripts, forms, frames, SVG, MathML, comments and `style` blocks removed). Raw
  provider HTML is never stored.
- The client renders the sanitized HTML inside a sandboxed iframe with its own CSP. Scripts cannot
  run even if a sanitizer bypass existed.
- Remote images are blocked by the frame's CSP unless the user opts in. There is no image proxy.
- Links open in a new tab with `rel="noopener noreferrer nofollow"`.
- Attachments: bytes are streamed from the provider on demand and never stored. File names are
  stripped of paths, control characters and reserved names; MIME types are validated. Downloads
  are always `application/octet-stream` with `Content-Disposition: attachment`, `nosniff` and a
  sandbox CSP. Limits: 25 MB and 20 files per message.
- Account pictures (`PUT /accounts/{id}/avatar`): at most 128 KB; the type is recognised from the
  file's signature and only PNG, JPEG and WebP are kept (SVG and GIF are refused), so nothing
  scriptable is stored. The browser re-encodes the image to 96×96 before upload, which also drops
  EXIF metadata such as location. They are served only to their owner, with the recognised type,
  `nosniff` and `sandbox; default-src 'none'`, and shown only in `<img>`.
- **Malware scanning is not implemented.** Production must add scanning (for example ClamAV) for
  uploads and downloads or clearly warn users.

## SSRF

`app.core.security.ssrf.resolve_public_endpoint` resolves a host, rejects the whole host if any
resolved address is loopback, private, link-local, CGNAT, multicast, reserved, metadata, or an
IPv6 form embedding such an address, restricts ports to 143/993/465/587, and returns the validated
IPs so the caller connects to an IP (defeating DNS rebinding) and re-validates on reconnect.
Provider HTTP calls go only to fixed Google and Microsoft hosts with redirects disabled.

The IMAP/SMTP adapter is the guard's one consumer, and
`app/integrations/email_providers/imap/transport.py` is the only module allowed to open a
connection to a user-supplied host (enforced by an architecture test). On **every** connect and
reconnect it:

1. calls the guard (IMAP hosts may use 143/993 only, SMTP hosts 465/587 only);
2. opens the TCP socket to one of the returned IP addresses — the socket creation of
   `imaplib.IMAP4(_SSL)` and `smtplib.SMTP(_SSL)` is overridden, so the host name is never
   resolved a second time;
3. negotiates TLS with `ssl.create_default_context()` (certificate chain and host name verified,
   TLS 1.2 minimum) and `server_hostname` set to the host name the user entered;
4. authenticates only when the socket is a TLS socket. With STARTTLS, a server that does not
   advertise it is refused before any credential is sent.

Connect and read timeouts are explicit (10 s / 30 s). Neither library follows referrals. The
adapter logs nothing — no banner, user name, password or message content can reach the log.
`EHLO` announces `[127.0.0.1]`, not the application server's host name.

When a mailbox is connected, both destinations are validated before either is contacted, both
logins are tried, and the API answers with one of four codes — `blocked_destination`,
`authentication_failed`, `tls_required`, `connection_failed` — the last covering closed ports,
timeouts, other protocols and invalid certificates alike, with identical text. Attempts are
limited to 10 per hour per user and 20 per IP address. Residual: response *time* still differs
between a refused connection and a timeout, so within those limits the endpoint can tell an
attacker whether a public host answers on one of four mail ports — and nothing about anything
that is not publicly routable.

**Test-only switches.** `SSRF_ALLOW_PRIVATE_NETWORKS` and `MAIL_TLS_CA_FILE` let the integration
tests reach the loopback test server and trust its certificate. `Settings` refuses to load with
either set unless `ENVIRONMENT=test`; they are read in one place (the provider registry); and
they never disable TLS or verification. The key in `infra/greenmail/` is a throwaway committed
for that server only — it must not be trusted anywhere else.

## Transport and infrastructure

- Nginx is the only published service; PostgreSQL and Redis are on an internal Docker network.
- TLS 1.2/1.3 and HSTS in the production Nginx configuration.
- Security headers at Nginx and API; trusted-host validation; request body limits at both layers.
- Containers run as non-root, read-only root filesystem, all capabilities dropped,
  `no-new-privileges`.
- Redis requires a password; dangerous commands are disabled.

## Logging and audit

Structured JSON logs with a request ID. Keys that look like secrets or content are redacted.
Email bodies, attachment content, tokens, cookies and passwords are never logged.
`audit_events` stores security-relevant event types (login, failed login, password change,
account connect/disconnect, deletion) with coarse context; entries are detached from the user on
account deletion and expire after 180 days.

## Data retention and deletion

- Stored per mailbox: headers, snippet, sanitized body, attachment metadata. Not stored:
  attachment bytes, raw HTML.
- Disconnecting a mailbox revokes the Google grant (best effort), deletes credentials and all its
  mail data in one transaction. Credentials are deleted even when revocation fails.
- Deleting a MailFlow account: password + typed confirmation → status `deleting` (blocks workers
  and scheduler) → sessions revoked → every mailbox disconnected as above → Redis keys purged →
  user row deleted (cascade) → audit entries detached. Safe to repeat.
- Provider revocation can fail (network, already revoked). The user can always revoke access in
  their Google account; this is noted in the UI documentation.

## Administrative access

There is no admin interface, no impersonation and no API that returns another user's mail.
Operators with direct database access see sanitized mail content (not provider tokens, which are
encrypted). Encrypting message bodies at rest per tenant is a possible future hardening.

## Known limitations

See `LIMITATIONS.md` (security section).
