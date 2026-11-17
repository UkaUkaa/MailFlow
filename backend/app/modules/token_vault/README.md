# token_vault module

The only place provider credentials are encrypted, stored, decrypted and rotated.

| Layer | Contents |
|---|---|
| domain | `CredentialKind`, `SealedSecret`, `VaultError` |
| application | `TokenVault`, `Cipher` and repository ports |
| infrastructure | `AesGcmKeyring`, `account_credentials` table |

**Depends on:** nothing

**Tenant data:** `account_credentials` (RLS). Ciphertext is bound to user, account and kind through AAD.
