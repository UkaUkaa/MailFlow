"use client";

import { useQuery } from "@tanstack/react-query";
import { api, listSchema } from "@/infrastructure/api-client";
import { folderCountSchema, folderSchema } from "../types";

export const folderKeys = {
  all: ["folders"] as const,
  list: (accountId: string | null) => ["folders", "list", accountId] as const,
  counts: (accountId: string | null) => ["folders", "counts", accountId] as const,
};

export function useFolders(accountId: string | null, enabled = true) {
  return useQuery({
    queryKey: folderKeys.list(accountId),
    queryFn: ({ signal }) =>
      api.get("/folders", listSchema(folderSchema), { signal, params: { account_id: accountId } }).then((page) => page.items),
    enabled,
  });
}

export function useFolderCounts(accountId: string | null, enabled = true) {
  return useQuery({
    queryKey: folderKeys.counts(accountId),
    queryFn: ({ signal }) =>
      api
        .get("/folders/counts", listSchema(folderCountSchema), { signal, params: { account_id: accountId } })
        .then((page) => page.items),
    enabled,
    refetchInterval: 60_000,
  });
}
