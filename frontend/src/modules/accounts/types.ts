import { z } from "zod";

export const capabilitiesSchema = z.object({
  threads: z.boolean().default(false),
  labels: z.boolean().default(false),
  server_search: z.boolean().default(false),
  drafts: z.boolean().default(false),
  spam: z.boolean().default(false),
  archive: z.boolean().default(false),
  incremental_sync: z.boolean().default(false),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const accountStatusSchema = z.enum(["active", "needs_reauth", "error", "disabled"]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const syncStatusSchema = z.enum(["idle", "queued", "running", "error"]);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const accountSchema = z.object({
  id: z.string(),
  provider: z.string(),
  email_address: z.string(),
  display_name: z.string().nullable(),
  color: z.string().nullable(),
  status: accountStatusSchema,
  status_reason: z.string().nullable().optional(),
  capabilities: capabilitiesSchema,
  created_at: z.string(),
  sync: z.object({
    status: syncStatusSchema,
    last_synced_at: z.string().nullable(),
    last_error_code: z.string().nullable(),
  }),
});
export type Account = z.infer<typeof accountSchema>;

export const providerSchema = z.object({
  kind: z.string(),
  available: z.boolean(),
  capabilities: capabilitiesSchema,
});
export type Provider = z.infer<typeof providerSchema>;

export const syncStateSchema = z.object({
  account_id: z.string(),
  status: syncStatusSchema,
  last_synced_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
  initial_sync_complete: z.boolean(),
});
export type SyncState = z.infer<typeof syncStateSchema>;

export function accountLabel(account: Account): string {
  return account.display_name?.trim() || account.email_address;
}
