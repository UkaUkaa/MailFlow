# settings module

Per-user preferences: language, theme, remote images, conversation view.

| Layer | Contents |
|---|---|
| domain | `UserSettings` |
| application | `SettingsService` |
| infrastructure | `user_settings` table |
| presentation | `/settings` router |

**Depends on:** nothing

**Tenant data:** `user_settings` (RLS).
