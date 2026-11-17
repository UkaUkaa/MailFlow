# attachments module

Attachment metadata and authorized download. Bytes are streamed from the provider and never stored.

| Layer | Contents |
|---|---|
| application | `AttachmentService`, ports |
| infrastructure | `attachments` table, repository, filename/MIME normalizer |
| presentation | `/attachments/{id}/download` |

**Depends on:** `email_accounts`, provider contract

**Tenant data:** `attachments` (RLS).
