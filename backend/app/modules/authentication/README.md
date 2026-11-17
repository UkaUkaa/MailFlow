# authentication module

MailFlow sign-in: registration, email verification, login, logout, sessions, password reset and change. Also provides `require_auth`, the single gate that establishes the acting user and binds the request transaction to the tenant.

| Layer | Contents |
|---|---|
| domain | `AuthContext`, `Session`, password policy |
| application | `RegistrationService`, `SessionService`, `PasswordService`, ports |
| infrastructure | session and one-time-token tables, repositories, email notifier |
| presentation | `/auth` router, schemas, dependency wiring |

**Depends on:** `users` (application), shared ports

**Tenant data:** Tables here are consulted before a tenant is known and are not under RLS; they are reached only by hashed-token lookups.
