import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import type { Provider } from "../types";
import { ConnectSection } from "./connect-section";

const mutate = vi.fn();
let providersResult: { isPending: boolean; isError: boolean; data?: Provider[] };

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  useProviders: () => providersResult,
  useStartOAuth: () => ({ mutate, isPending: false, variables: undefined }),
}));

const capabilities = {
  threads: true,
  labels: false,
  server_search: true,
  drafts: true,
  spam: true,
  archive: true,
  incremental_sync: true,
};

function providers(availability: Record<string, boolean>): Provider[] {
  return Object.entries(availability).map(([kind, available]) => ({ kind, available, capabilities }));
}

beforeEach(() => {
  mutate.mockReset();
  providersResult = { isPending: false, isError: false, data: providers({ gmail: true, outlook: true, imap: false }) };
});

describe("ConnectSection", () => {
  it("offers Gmail and Outlook and starts the OAuth flow for the chosen provider", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectSection />);
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect Outlook" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ provider: "outlook", locale: "en" });
    expect(screen.getByText("Connecting other mailboxes by IMAP is not available on this server.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect another mail account (IMAP)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says Outlook is not configured instead of offering it", () => {
    providersResult.data = providers({ gmail: true, outlook: false, imap: false });
    renderWithProviders(<ConnectSection />);
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Outlook" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Outlook is not configured on this server yet.");
  });

  it("treats a provider the server does not list as not configured", () => {
    providersResult.data = providers({ outlook: true });
    renderWithProviders(<ConnectSection />);
    expect(screen.getByRole("button", { name: "Connect Outlook" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Gmail" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gmail is not configured on this server yet.");
  });

  it("offers IMAP through a password dialog, never through OAuth, when the server marks it available", async () => {
    const user = userEvent.setup();
    providersResult.data = providers({ gmail: false, outlook: false, imap: true });
    renderWithProviders(<ConnectSection />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.queryByText("Connecting other mailboxes by IMAP is not available on this server.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect another mail account (IMAP)" }));
    expect(await screen.findByRole("dialog", { name: "Connect a mail account" })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not offer IMAP when the server does not list it", () => {
    providersResult.data = providers({ gmail: true, outlook: true });
    renderWithProviders(<ConnectSection />);
    expect(screen.queryByRole("button", { name: "Connect another mail account (IMAP)" })).not.toBeInTheDocument();
  });

  it("reports a failed provider lookup", () => {
    providersResult = { isPending: false, isError: true };
    renderWithProviders(<ConnectSection />);
    expect(screen.getByText("Could not load the available providers.")).toBeInTheDocument();
  });
});
