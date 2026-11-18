import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/infrastructure/api-client";
import { useThreadActions } from "./use-thread-actions";

const post = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/infrastructure/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/api-client")>()),
  api: { post, get: vi.fn() },
}));
vi.mock("@/infrastructure/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

function renderActions() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
  return renderHook(() => useThreadActions(), { wrapper }).result;
}

describe("useThreadActions errors", () => {
  afterEach(() => vi.clearAllMocks());

  it("says the mailbox must be reconnected, with a way to do it, when bulk trash hits a revoked mailbox", async () => {
    post.mockRejectedValue(new ApiError(409, "provider_auth_required", "The mailbox must be reconnected."));
    renderActions().current.run("trash", ["t1", "t2"]);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [string, { action?: { label: string; onClick: () => void } }];
    expect(message).toBe("This mailbox needs to be reconnected.");
    expect(options.action?.label).toBe("Reconnect");
    options.action?.onClick();
    expect(push).toHaveBeenCalledWith("/settings/accounts");
  });

  it("names a provider outage instead of a generic failure", async () => {
    post.mockRejectedValue(new ApiError(503, "provider_unavailable", "down"));
    renderActions().current.run("trash", ["t1", "t2"]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe("The mail provider is not responding. Try again later.");
  });

  it("keeps the generic message for unknown failures", async () => {
    post.mockRejectedValue(new Error("boom"));
    renderActions().current.run("archive", ["t1"]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe("The action could not be completed.");
  });
});
