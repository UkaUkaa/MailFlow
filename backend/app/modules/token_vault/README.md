# token_vault module

The only place provider credentials are encrypted, stored, decrypted and rotated.

| Layer | Contents |
|---|---|
| domain | `CredentialKind`, `UserSecretKind`, `SealedSecret`, `VaultError` |
| application | `TokenVault` (mailbox credentials), `UserSecretVault` (user-level secrets such as the user's own AI key), `Cipher` and repository ports |
| infrastructure | `AesGcmKeyring`, `account_credentials` and `user_secrets` tables |

**Depends on:** nothing

**Tenant data:** `account_credentials`, `user_secrets` (RLS). Ciphertext is bound through AAD to
user, account and kind (mailbox credentials) or to user and kind (user secrets).
