"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { z } from "zod";
import { api, listSchema, type Page } from "@/infrastructure/api-client";
import { isSystemView } from "@/modules/folders";
import { applyActionToDetail, applyActionToList } from "../lib/optimistic";
import {
  messageSchema,
  threadDetailSchema,
  threadSummarySchema,
  type ThreadAction,
  type ThreadDetail,
  type ThreadListFilter,
  type ThreadSummary,
} from "../types";

export const threadKeys = {
  all: ["threads"] as const,
  lists: () => ["threads", "list"] as const,
  list: (filter: ThreadListFilter) => ["threads", "list", filter] as const,
  detail: (threadId: string) => ["threads", "detail", threadId] as const,
};

const PAGE_SIZE = 30;
const threadPageSchema = listSchema(threadSummarySchema);

export function useThreadList(filter: ThreadListFilter, enabled = true) {
  const isSearch = filter.view === "search";
  return useInfiniteQuery({
    queryKey: threadKeys.list(filter),
    enabled: enabled && (!isSearch || Boolean(filter.query?.trim())),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: Page<ThreadSummary>) => lastPage.next_cursor,
    queryFn: ({ pageParam, signal }) =>
      isSearch
        ? api.get("/search", threadPageSchema, {
            signal,
            params: { q: filter.query?.trim(), account_id: filter.accountId, cursor: pageParam, limit: PAGE_SIZE },
          })
        : api.get("/threads", threadPageSchema, {
            signal,
            params: {
              view: filter.folderId ? undefined : isSystemView(filter.view) ? filter.view : "inbox",
              folder_id: filter.folderId,
              account_id: filter.accountId,
              unread: filter.unreadOnly ? true : undefined,
              cursor: pageParam,
              limit: PAGE_SIZE,
            },
          }),
  });
}

export function useThread(threadId: string | null) {
  return useQuery({
    queryKey: threadKeys.detail(threadId ?? ""),
    enabled: Boolean(threadId),
    queryFn: ({ signal }) => api.get(`/threads/${encodeURIComponent(threadId ?? "")}`, threadDetailSchema, { signal }),
  });
}

type ListSnapshot = [readonly unknown[], InfiniteData<Page<ThreadSummary>> | undefined][];

interface ActionVariables {
  threadIds: string[];
  action: ThreadAction;
}

/**
 * Applies an action to one or many threads. The cache is updated immediately
 * and rolled back if the server rejects the change.
 */
export function useThreadAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadIds, action }: ActionVariables) => {
      if (threadIds.length === 1) {
        await api.post(`/threads/${encodeURIComponent(threadIds[0] ?? "")}/actions`, threadSummarySchema, { action });
      } else {
        await api.post("/threads/actions", z.object({ updated: z.array(z.string()) }), {
          thread_ids: threadIds,
          action,
        });
      }
    },
    onMutate: async ({ threadIds, action }) => {
      await queryClient.cancelQueries({ queryKey: threadKeys.all });
      const ids = new Set(threadIds);
      const lists: ListSnapshot = queryClient.getQueriesData<InfiniteData<Page<ThreadSummary>>>({
        queryKey: threadKeys.lists(),
      });
      for (const [key, data] of lists) {
        const filter = key[2] as ThreadListFilter;
        queryClient.setQueryData(key, applyActionToList(data, filter, ids, action));
      }
      const details: [string, ThreadDetail | undefined][] = threadIds.map((id) => [
        id,
        queryClient.getQueryData<ThreadDetail>(threadKeys.detail(id)),
      ]);
      for (const [id, detail] of details) {
        if (detail) queryClient.setQueryData(threadKeys.detail(id), applyActionToDetail(detail, action));
      }
      return { lists, details };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const [key, data] of context.lists) queryClient.setQueryData(key, data);
      for (const [id, detail] of context.details) queryClient.setQueryData(threadKeys.detail(id), detail);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}

export function useMessageAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, action }: { messageId: string; action: "mark_read" | "mark_unread" | "star" | "unstar" }) =>
      api.post(`/emails/${encodeURIComponent(messageId)}/actions`, messageSchema, { action }),
    onSuccess: (message) => {
      queryClient.setQueryData<ThreadDetail>(threadKeys.detail(message.thread_id), (current) =>
        current
          ? { ...current, messages: current.messages.map((item) => (item.id === message.id ? message : item)) }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
    },
  });
}
