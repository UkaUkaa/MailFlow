# templates module

Reusable message templates (name, subject, body) the user inserts into the composer.

| Layer | Contents |
|---|---|
| domain | `Template`, `TemplateContent`, limits, supported placeholders |
| application | `TemplateService` (list, create, update, delete; validation; body sanitized on save) |
| infrastructure | `message_templates` table and repository |
| presentation | `/templates` router |

Placeholders (`{{first_name}}`, `{{name}}`, `{{email}}`, `{{my_name}}`, `{{date}}`) are stored as
written and filled in by the composer when a template is inserted; unknown ones stay as text.

**Depends on:** `emails` (the `HtmlSanitizer` port).

**Tenant data:** `message_templates` (RLS).
