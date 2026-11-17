"use client";

import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import { api, isApiError } from "@/infrastructure/api-client";

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  email_verified: z.boolean(),
  created_at: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const sessionQueryKey = ["session"] as const;

/** `null` data means "definitely signed out". */
export function useSession(): UseQueryResult<User | null> {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async ({ signal }) => {
      try {
        const body = await api.get("/auth/me", z.object({ user: userSchema }), { signal, skipAuthRedirect: true });
        return body.user;
      } catch (error) {
        if (isApiError(error) && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Switches the cached identity and drops every other cached resource, so data
 * of a previous user can never be shown to the next one. The session query
 * itself is updated in place to keep its observers subscribed.
 */
export function replaceSession(queryClient: QueryClient, user: User | null): void {
  queryClient.setQueryData<User | null>(sessionQueryKey, user);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKey[0] });
}
