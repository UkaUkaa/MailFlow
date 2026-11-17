# audit module

Minimal security audit trail. Stores event types and coarse context, never content.

| Layer | Contents |
|---|---|
| infrastructure | `audit_events` table, `SqlAuditLog` (own transaction per event) |

**Depends on:** implements the shared `AuditLog` port

**Tenant data:** Events are detached from the user on account deletion and expire after 180 days.
