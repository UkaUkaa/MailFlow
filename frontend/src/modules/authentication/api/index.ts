"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, listSchema, statusSchema } from "@/infrastructure/api-client";
import { replaceSession, userSchema } from "@/infrastructure/authentication";
import { authSessionSchema } from "../schemas";

const userEnvelope = z.object({ user: userSchema });

export const authKeys = { sessions: () => ["auth", "sessions"] as const };

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post("/auth/login", userEnvelope, body, { skipAuthRedirect: true }),
    onSuccess: ({ user }) => replaceSession(queryClient, user),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (body: { email: string; password: string; display_name: string; locale: string }) =>
      api.post("/auth/register", statusSchema, body, { skipAuthRedirect: true }),
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (token: string) => api.post("/auth/verify-email", statusSchema, { token }, { skipAuthRedirect: true }),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: (email: string) => api.post("/auth/resend-verification", null, { email }, { skipAuthRedirect: true }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => api.post("/auth/password/forgot", null, { email }, { skipAuthRedirect: true }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (body: { token: string; new_password: string }) =>
      api.post("/auth/password/reset", null, body, { skipAuthRedirect: true }),
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.post("/auth/password/change", null, body, { skipAuthRedirect: true }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authKeys.sessions() }),
  });
}

/** Ends the session server-side, then drops every cached tenant resource. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout", null, undefined, { skipAuthRedirect: true }),
    onSettled: () => replaceSession(queryClient, null),
  });
}

export function useAuthSessions() {
  return useQuery({
    queryKey: authKeys.sessions(),
    queryFn: ({ signal }) => api.get("/auth/sessions", listSchema(authSessionSchema), { signal }).then((page) => page.items),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authKeys.sessions() }),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/sessions/revoke-others", null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authKeys.sessions() }),
  });
}
