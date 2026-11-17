# email_accounts module

Connected mailboxes: OAuth connect / reconnect, listing, renaming, disconnecting, and `ProviderSessionFactory`, which turns an account into an authenticated provider adapter.

| Layer | Contents |
|---|---|
| domain | `EmailAccount`, `AccountStatus`, `OAuthState` |
| application | `ConnectAccountService`, `AccountService`, `ProviderSessionFactory`, ports |
| infrastructure | `email_accounts`, `oauth_states` tables, repositories, independent status marker |
| presentation | `/accounts` router |

**Depends on:** `token_vault`, provider contract, a `SyncRequester` port (implemented by `synchronization`)

**Tenant data:** `email_accounts`, `oauth_states` (RLS).
