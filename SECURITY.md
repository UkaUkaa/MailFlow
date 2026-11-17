# Security

The full security model — threat model, authentication, tenant isolation, OAuth, encryption,
email content handling, SSRF, retention and known limitations — is in
[`docs/SECURITY.md`](docs/SECURITY.md).

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainers; do not open a public issue.
Include reproduction steps and the affected version or commit.

## Status

No independent security assessment or penetration test has been performed. The automated tests
cover the controls described in `docs/SECURITY.md`; they do not prove the absence of
vulnerabilities. A professional review is required before a public production launch.
