import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import en from "@/messages/en.json";

/** Renders with the providers every component expects (English messages, fresh query cache). */
export function renderWithProviders(ui: ReactElement): RenderResult & { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { ...result, queryClient };
}
