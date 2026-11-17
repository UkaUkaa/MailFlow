# users module

The user record: profile, deactivation and account deletion orchestration.

| Layer | Contents |
|---|---|
| domain | `User`, `UserStatus` |
| application | `UserProfileService`, `AccountLifecycleService`, ports for session revocation and mailbox disconnection |
| infrastructure | `users` table, repository |
| presentation | `/users` router |

**Depends on:** ports implemented by `authentication` and `email_accounts` at composition time

**Tenant data:** `users` is the tenant root; deleting a row cascades to everything the user owns.
