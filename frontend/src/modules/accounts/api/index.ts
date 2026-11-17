"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";
import { api, listSchema } from "@/infrastructure/api-client";
import type { ImapConnectPayload } from "../lib/imap";
import { accountSchema, providerSchema, syncStateSchema, type Account } from "../types";

export const accountKeys = {
  all: ["accounts"] as const,
  list: () => ["accounts", "list"] as const,
  providers: () => ["accounts", "providers"] as const,
  sync: () => ["accounts", "sync"] as const,
};

const authorizationSchema = z.object({ authorization_url: z.string().url() });

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.list(),
    queryFn: ({ signal }) => api.get("/accounts", listSchema(accountSchema), { signal }).then((page) => page.items),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: accountKeys.providers(),
    queryFn: ({ signal }) =>
      api.get("/accounts/providers", listSchema(providerSchema), { signal }).then((page) => page.items),
    staleTime: 5 * 60_000,
  });
}

/** Starts an OAuth connection and leaves the app for the provider's consent screen. */
export function useStartOAuth() {
  return useMutation({
    mutationFn: async ({ provider, locale }: { provider: string; locale: string }) => {
      const result = await api.post(`/accounts/oauth/${encodeURIComponent(provider)}/start`, authorizationSchema, { locale });
      window.location.assign(result.authorization_url);
    },
  });
}

export function useReconnectAccount() {
  return useMutation({
    mutationFn: async ({ accountId, locale }: { accountId: string; locale: string }) => {
      const result = await api.post(`/accounts/${encodeURIComponent(accountId)}/reconnect`, authorizationSchema, { locale });
      window.location.assign(result.authorization_url);
    },
  });
}

/**
 * Connects a mailbox by IMAP/SMTP credentials. A plain function on purpose: a mutation would
 * keep its variables, and with them the mailbox password, in the query client's mutation cache.
 */
export function connectImapAccount(payload: ImapConnectPayload): Promise<Account> {
  return api.post("/accounts/imap", accountSchema, payload);
}

/** Replaces the password of an IMAP mailbox. OAuth mailboxes use `useReconnectAccount` instead. */
export function updateImapCredentials(accountId: string, password: string): Promise<Account> {
  return api.post(`/accounts/${encodeURIComponent(accountId)}/imap/credentials`, accountSchema, { password });
}

/** Puts a freshly connected or reconnected mailbox into the cache and refreshes what depends on it. */
export function useAccountConnected() {
  const queryClient = useQueryClient();
  return useCallback(
    (connected: Account) => {
      queryClient.setQueryData<Account[]>(accountKeys.list(), (current) =>
        current
          ? current.some((account) => account.id === connected.id)
            ? current.map((account) => (account.id === connected.id ? connected : account))
            : [...current, connected]
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: accountKeys.list() });
      void queryClient.invalidateQueries({ queryKey: accountKeys.sync() });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
    [queryClient],
  );
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, ...body }: { accountId: string; display_name?: string; color?: string }) =>
      api.patch(`/accounts/${encodeURIComponent(accountId)}`, accountSchema, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<Account[]>(accountKeys.list(), (current) =>
        current?.map((account) => (account.id === updated.id ? updated : account)),
      );
    },
  });
}

export function useDisconnectAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.delete(`/accounts/${encodeURIComponent(accountId)}`),
    onSuccess: (_result, accountId) => {
      queryClient.setQueryData<Account[]>(accountKeys.list(), (current) =>
        current?.filter((account) => account.id !== accountId),
      );
      // Everything derived from the removed mailbox is now stale.
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
      void queryClient.invalidateQueries({ queryKey: accountKeys.sync() });
    },
  });
}

export function useSyncStatus(enabled = true) {
  return useQuery({
    queryKey: accountKeys.sync(),
    queryFn: ({ signal }) => api.get("/sync/status", listSchema(syncStateSchema), { signal }).then((page) => page.items),
    enabled,
    // Poll quickly only while something is in flight.
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "queued" || item.status === "running") ? 3_000 : 60_000,
  });
}

export function useSyncNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string | null) =>
      accountId
        ? api.post(`/sync/accounts/${encodeURIComponent(accountId)}`, null)
        : api.post("/sync/all", null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.sync() });
    },
  });
}
