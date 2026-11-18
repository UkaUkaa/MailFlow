"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/infrastructure/api-client";
import { templateListSchema, templateSchema, type TemplateInput } from "../types";

export const templateKeys = { all: ["templates"] as const };

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templateKeys.all,
    queryFn: ({ signal }) => api.get("/templates", templateListSchema, { signal }).then((page) => page.items),
    enabled,
    staleTime: 60_000,
  });
}

function useInvalidating<V>(mutationFn: (variables: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: templateKeys.all }),
  });
}

export function useCreateTemplate() {
  return useInvalidating((input: TemplateInput) => api.post("/templates", templateSchema, input));
}

export function useUpdateTemplate() {
  return useInvalidating(({ id, input }: { id: string; input: TemplateInput }) =>
    api.patch(`/templates/${encodeURIComponent(id)}`, templateSchema, input),
  );
}

export function useDeleteTemplate() {
  return useInvalidating((id: string) => api.delete(`/templates/${encodeURIComponent(id)}`));
}
