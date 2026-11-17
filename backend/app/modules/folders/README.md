# folders module

System and custom folders (labels) of each mailbox.

| Layer | Contents |
|---|---|
| application | `Folder`, `FolderService`, repository port |
| infrastructure | `email_folders` table, repository |
| presentation | `/folders` router (uses `emails` for unread counts) |

**Depends on:** provider contract

**Tenant data:** `email_folders` (RLS).
