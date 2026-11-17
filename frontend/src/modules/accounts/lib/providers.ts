/** Provider kinds the interface has a name for; anything else is shown as a generic mailbox. */
export const KNOWN_PROVIDERS = ["gmail", "outlook", "imap"] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];
export type ProviderLabelKey = KnownProvider | "other";

/** Providers connected through an OAuth consent screen, in the order they are offered. */
export const OAUTH_PROVIDERS = ["gmail", "outlook"] as const satisfies readonly KnownProvider[];
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function providerLabelKey(provider: string): ProviderLabelKey {
  return KNOWN_PROVIDERS.find((kind) => kind === provider) ?? "other";
}

/** Providers connected with a server address and password instead of an OAuth consent screen. */
export const PASSWORD_PROVIDERS = ["imap"] as const satisfies readonly KnownProvider[];
export type PasswordProvider = (typeof PASSWORD_PROVIDERS)[number];

export function isPasswordProvider(provider: string): provider is PasswordProvider {
  return PASSWORD_PROVIDERS.some((kind) => kind === provider);
}
