import type { Account, Capabilities } from "@/modules/accounts";

export const FULL_CAPABILITIES: Capabilities = {
  threads: true,
  labels: true,
  server_search: true,
  drafts: true,
  spam: true,
  archive: true,
  incremental_sync: true,
};

/** An account fixture for unit tests; IMAP-style capabilities are passed as overrides. */
export function makeAccount(id: string, capabilities: Partial<Capabilities> = {}, overrides: Partial<Account> = {}): Account {
  return {
    id,
    provider: "gmail",
    email_address: `${id}@example.com`,
    display_name: null,
    color: null,
    status: "active",
    status_reason: null,
    capabilities: { ...FULL_CAPABILITIES, ...capabilities },
    created_at: "2026-11-01T09:00:00Z",
    sync: { status: "idle", last_synced_at: null, last_error_code: null },
    ...overrides,
  };
}
