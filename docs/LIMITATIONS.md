# Known limitations

Honest list of what is missing or partial. Update whenever something here changes.

## Providers

- **Outlook / Microsoft Graph: implemented, NOT verified against a live Microsoft account.**
  The adapter, OAuth client and connection UI are covered by tests against a mocked Graph and a
  fake provider registry only. No request has ever been sent to the real service. Behaviour taken
  from Microsoft's documentation but unconfirmed in practice includes: the exact error returned
  for an expired delta token, whether `lastModifiedDateTime` moves on every read/flag change (used
  while change tracking is being established), the largest page size delta accepts, that a move
  to the folder a message is already in is harmless, where `DELETE` puts a draft, and how soon a
  sent message is readable under its draft id. Expect to fix things on the first live connection.
- Outlook specifics:
  - Disconnecting cannot revoke the grant (Microsoft has no token revocation endpoint); MailFlow
    deletes its tokens and the user removes the app from their Microsoft account.
  - Establishing change tracking walks every folder once (ids only). Until a folder has been
    walked, a read/flag change or deletion made elsewhere to an already imported message in that
    folder can be missed if Exchange does not update its modification time.
  - A removed message costs one extra request to tell a move from a deletion.
  - A folder that is permanently deleted, or an expired delta token, triggers a full re-import
    of the mailbox.
  - Restoring from trash and "not spam" move messages to the Inbox, not to their original folder.
    Archiving needs the mailbox's Archive folder to exist.
  - A reply whose original message is no longer in the mailbox is sent as a new conversation.
  - Hidden folders are not synchronized; shared and delegated mailboxes are not supported.
  - Attachment content ids are not read, so inline images cannot be matched to `cid:` references;
    message size is not available from Graph v1.0.
  - Editing a draft keeps attachments added in Outlook itself.
  - Publishing to other organizations is limited until the app registration is publisher
    verified; see `EMAIL_INTEGRATION.md`.
- **IMAP/SMTP: implemented, tested against a local test server only.** Everything was run
  against GreenMail 2.1.3 (an in-memory Java test server) and against scripted in-process
  servers. **No real-world IMAP or SMTP server has been used** — not Dovecot, Cyrus, Exchange,
  Gmail, Yahoo, iCloud or Fastmail. GreenMail offers UIDPLUS and MOVE but neither CONDSTORE,
  SPECIAL-USE nor STARTTLS, so these paths are covered only by unit tests with fakes: the
  CONDSTORE flag sync, SPECIAL-USE role detection, STARTTLS upgrade, the COPY + EXPUNGE fallback,
  `LOGIN` without `AUTH=PLAIN`. Assumptions that a real server may break:
  - `STATUS` answers `MESSAGES`, `UIDNEXT`, `UIDVALIDITY` (and `HIGHESTMODSEQ` with CONDSTORE) for
    every listed folder, also for the selected one;
  - `LIST "" "*"` returns SPECIAL-USE attributes without being asked (`LIST (SPECIAL-USE)` /
    `XLIST` are not used);
  - `UID MOVE` / `UID COPY` answer with `COPYUID` and `APPEND` with `APPENDUID` (otherwise moved
    messages are re-imported under a new id on the next sync, and the saved copy is found by a
    `Message-ID` header search);
  - a partial fetch `BODY.PEEK[]<0.N>` is accepted;
  - a failed login is a wrong password (only RFC 5530 `[UNAVAILABLE]`-style codes are treated as
    temporary) — a server that answers plain `NO` while overloaded would put the mailbox in
    *Reconnect required*;
  - folder names are modified UTF-7 without CR/LF (`UTF8=ACCEPT` is not enabled; other names are
    skipped).
- IMAP specifics:
  - No conversations: one message per conversation. No server-side search.
  - Archive / spam / drafts need a folder with that role; trash needs a Trash folder. Folder roles
    on servers without SPECIAL-USE are recognised by common English names only.
  - Without CONDSTORE, read/star changes made in another client are noticed only for the 100 most
    recent messages of each folder.
  - Every operation opens a new connection (TLS handshake + login); a user action takes as long
    as that does on the server. Servers that limit logins per minute may throttle MailFlow.
  - The first synchronization reads the UID list of every folder (up to 200 folders); a `SEARCH`
    answer longer than 1 MB (roughly 140,000 messages in one folder) fails in `imaplib`.
  - A sent message is appended to Sent by MailFlow; servers that also save it themselves (Gmail)
    end up with two copies. A message sent from a mailbox without a Sent folder is not listed.
  - A permanent SMTP rejection (relay denied, message too large, all recipients refused) is
    reported as "provider temporarily unavailable".
  - Passwords with non-ASCII characters work only where the IMAP server offers `AUTH=PLAIN`, and
    not for SMTP.
  - Restoring from trash and "not spam" move to the Inbox, not to the original folder.
  - Editing a draft changes its conversation id (the message id stays).
  - Messages over 40 MB are read truncated. Messages flagged `\Deleted` but not expunged are
    shown as normal messages.
  - Server address, port and user name cannot be edited after connecting.
  - IMAP and SMTP calls block a thread of the process's default pool for their duration; many
    slow mail servers at once can delay other IMAP users of the same process.
  - The mailbox password is stored (encrypted) because IMAP offers nothing else; OAuth2 for IMAP
    (XOAUTH2 / OAUTHBEARER) is not implemented.
- **Gmail, live:** connecting three real mailboxes (OAuth), initial import, folders and
  incremental sync and sending a new message were run against the live Gmail API. Message
  actions, reply/forward, drafts and attachment download have **not** yet been confirmed live;
  they are covered by mocked-API tests.
- Importing a mailbox is slow by design of Gmail's quota (about 50–60 messages per minute); see
  `EMAIL_INTEGRATION.md`.
- Public Gmail access requires Google OAuth verification; `gmail.modify` is a *restricted* scope
  and needs a security assessment (CASA) before unverified-app limits are lifted.

## Mail features

- Draft attachments are kept in the browser until send; they are not saved with the draft.
- Inline (`cid:`) images are listed as attachments instead of being shown in place.
- Search covers mail already synchronized into MailFlow (prefix full-text search); it does not
  query the provider for older mail.
- Initial sync imports the newest messages first and backfills up to
  `SYNC_BACKFILL_MAX_MESSAGES` (default 5000) per mailbox.
- Star and read actions on a conversation apply to all of its messages.
- Custom folders (labels) can be browsed; creating, renaming and assigning them is not available.
- Permanent deletion is intentionally not offered (scope `gmail.modify` cannot do it).
- No push notifications; mail arrives on the periodic sync (default every 2 minutes) or manual sync.
- An ambiguous network failure during send releases the idempotency key so the user can retry;
  in that rare case a duplicate is possible.

## Frontend

- Mail screens (list, reader, composer) are tested with mocked API responses; they have not been
  exercised against a live mailbox because no Google credentials were available.
- Virtual-keyboard and safe-area behaviour is verified by viewport emulation only; real iOS and
  Android devices still need a manual pass.
- No swipe gestures or keyboard-shortcut layer yet.
- Bulk "Select all" covers only the conversations loaded so far, not every match on the server.
  Long-press selection on touch is not covered by e2e (Playwright has no touch-hold gesture).
- There is no permanent delete: bulk "delete" moves conversations to trash (and back with
  Restore); emptying the trash is left to the provider.
- A reopened draft loads its quoted text in simplified form.
- The `conversation_view` setting is stored but has no UI.

- A draft inside a conversation can be edited or deleted from its card but not sent from it:
  sending needs the full composer state (recipient validation, attachments, idempotency key).
  Opening a reply does not add a draft card to the conversation until the draft is stored and
  the conversation reloads.
- Quoted history is collapsed only for `blockquote` blocks that end a message; providers that
  mark quotes with a class or a plain "On … wrote:" line are not detected (the sanitizer strips
  classes).
- Search suggestions offer no operators (`from:`, `has:` …): the search API has none.
- Sender avatars are initials on a colour; no pictures (Gravatar, provider photos) are loaded.
  Only the user's own mailboxes can have a picture, uploaded by the user.
- Account pictures are validated by file signature only; the server does not decode them. They
  are shown only in `<img>` to their owner, so a malformed file can at worst fail to render.
- The message-row wash is always on; there is no setting to turn it off.
- Navigation: the language and theme rows show "Language: English" / "Theme: System" while their
  accessible names are "Switch language to …" / "Switch theme to …" (WCAG 2.5.3 is not met
  literally). When the column is collapsed and the window is short, the views and accounts
  scroll without a visible scrollbar. A mailbox's own folders are reachable only with the menu
  expanded (or in the phone drawer). The width animation needs `@property` (Chromium, Safari
  16.4+, Firefox 128+); elsewhere the column switches instantly.
- Behind the settings dialog the list of the last mail view is shown without the open
  conversation.
- The date headings do not update at midnight until the list re-renders.
- The light theme has no reference observation; it was derived from the dark roles.
- Not visually verified on real devices or in Safari / Firefox: the new layout was reviewed in
  Chromium screenshots only. The draft card is covered by unit tests but has no screenshot.

## Accounts

- A deactivated MailFlow account cannot be reactivated through the UI.
- No two-factor authentication, no social login.

## Security

- No external penetration test or security audit.
- No malware scanning of attachments.
- Message bodies are stored sanitized but not encrypted per tenant at the application level.
- The application-wide CSP at Nginx allows inline scripts and styles (required by the current
  Next.js setup); a nonce-based policy is future hardening.
- The vault key lives in process memory; a KMS/HSM-backed envelope scheme is the upgrade path.
- Rate limiting is fixed-window and per instance of Redis; no CAPTCHA or bot detection.
- The IMAP connect endpoint returns uniform error codes, but response time still reveals whether
  a public host accepts connections on a mail port (bounded by 10 attempts/hour per user).
- TLS to user-supplied mail servers trusts the system certificate store; there is no pinning,
  no DANE, no MTA-STS.
- Provider calls run inside the request's database transaction (a slow provider holds a
  connection for the duration of the call).

## Operations

- No metrics/monitoring stack (Prometheus, Sentry) is wired; logs are structured JSON only.
- Database backups are documented, not automated.
- No admin interface for user status or sync health.
- Performance has not been benchmarked.

## Send later and undo send (D42)

- With the undo window on (default 5 s) a message leaves only when a Celery worker runs. If the
  workers are down it waits; after a minute it appears in the Scheduled view.
- A provider refusal that can only be discovered while sending (rejected recipient, revoked
  access) is reported as a failed item in the Scheduled view, not in the composer. There is no
  push notification for it.
- If a worker dies in the middle of the provider call the item fails with `outcome_unknown`: the
  message may or may not have been sent, and MailFlow does not retry it on its own.
- Cancelling a scheduled message from the Scheduled view reopens its text in the composer, but
  attachments (uploaded files and forwarded ones) are not restored and must be added again; a
  toast says so. The quoted original comes back as part of the editable body. Undo right after
  sending restores everything from memory.
- The undo timer lives in the page: after a reload during the window the message is still sent
  on time, but there is no Undo toast (cancel is not offered for undo-window items elsewhere).
  Pressing Undo while another composer is open replaces that composer.
- A scheduled message that was started from a draft keeps that draft in Drafts until it is sent.
- Scheduled times are stored as absolute instants. The time zone comes from the device (the
  `mf_tz` cookie), not from IP geolocation or a saved per-user setting, so a message scheduled
  for 08:00 goes out at 08:00 of the zone the user was in when scheduling. No recurring sends.
  Snooze is not implemented.
