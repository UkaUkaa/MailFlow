# Adding an email provider

1. Read `docs/architecture/PROVIDER_ARCHITECTURE.md` and the contract in
   `app/integrations/email_providers/contracts`.
2. Create `app/integrations/email_providers/<provider>/` with:
   - a mapper from provider payloads to `ProviderMessage` / `ProviderFolder` (no provider type
     may leave the package),
   - the adapter implementing `EmailProvider`,
   - an `OAuthClient` implementation, or a credential validator for password-based providers,
   - a `ProviderCapabilities` constant that reflects what really works.
3. Use `ResilientHttp` for HTTP providers; mark non-idempotent calls `idempotent=False`.
4. Map failures to the contract errors (`ProviderAuthError`, `ProviderRateLimited`,
   `ProviderNotFound`, `ProviderCursorExpired`, `ProviderUnavailable`, `ProviderUnsupported`).
5. Hosts supplied by users must go through `app.core.security.ssrf.resolve_public_endpoint` on
   every connect and reconnect; connect to the returned IP. Do not write this again: use
   `imap.transport.MailConnector`, the only module allowed to open such connections
   (`tests/architecture`).
6. Register it in `DefaultProviderRegistry`; `is_available` returns true only when it is
   implemented **and** configured.
7. Credentials go to the Token Vault with the appropriate `CredentialKind`.
8. Tests: mapper fixtures, adapter against mocked I/O (retry, rate limit, auth failure, cursor
   expiry, send not retried), and the generic sync/mail integration tests with the new kind.
9. Update `docs/EMAIL_INTEGRATION.md`, `docs/LIMITATIONS.md`, and expose the provider in the
   frontend connect dialog only after the above passes.

Never report a provider as supported before step 8 is green.
