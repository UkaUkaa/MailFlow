"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/infrastructure/api-client";
import { replaceSession, sessionQueryKey, userSchema, type User } from "@/infrastructure/authentication";
import { settingsSchema, type Settings } from "../types";

export const settingsKeys = { all: ["settings"] as const };

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => api.get("/settings", settingsSchema, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch("/settings", settingsSchema, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: settingsKeys.all });
      const previous = queryClient.getQueryData<Settings>(settingsKeys.all);
      if (previous) queryClient.setQueryData<Settings>(settingsKeys.all, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(settingsKeys.all, context.previous);
    },
    onSuccess: (settings) => queryClient.setQueryData(settingsKeys.all, settings),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { display_name: string }) => api.patch("/users/me", userSchema, body),
    onSuccess: (user) => queryClient.setQueryData<User | null>(sessionQueryKey, user),
  });
}

/** ``password`` is null when a fresh Google confirmation (an HttpOnly cookie) stands in for it. */
function useAccountRemoval(request: (password: string | null) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => replaceSession(queryClient, null),
  });
}

export function useDeactivateAccount() {
  return useAccountRemoval((password) =>
    api.post("/users/me/deactivate", null, password === null ? {} : { password }, { skipAuthRedirect: true }),
  );
}

export function useDeleteAccount() {
  return useAccountRemoval((password) =>
    api.delete(
      "/users/me",
      password === null ? { confirmation: "DELETE" } : { password, confirmation: "DELETE" },
      { skipAuthRedirect: true },
    ),
  );
}
