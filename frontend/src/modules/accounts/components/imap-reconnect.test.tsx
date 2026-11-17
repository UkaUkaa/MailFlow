import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { accountKeys } from "../api";
import type { Account } from "../types";
import { ConnectedAccounts } from "./connected-accounts";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  usePathname: () => "/settings/accounts",
  useRouter: () => ({ replace: vi.fn() }),
}));

const capabilities = { threads: false, labels: false, server_search: false, drafts: true, spam: true, archive: true, incremental_sync: true };
const base = {
  display_name: null,
  color: null,
  status_reason: null,
  capabilities,
  created_at: "2026-11-01T09:00:00Z",
  sync: { status: "error" as const, last_synced_at: null, last_error_code: "provider_auth_required" },
};
const imapAccount: Account = { ...base, id: "acc-imap", provider: "imap", email_address: "me@fastmail.example", status: "needs_reauth" };
const outlookAccount: Account = { ...base, id: "acc-outlook", provider: "outlook", email_address: "me@outlook.example", status: "needs_reauth" };
const PASSWORD = "new-app-password";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
let credentialsResponse: () => Response;
let serverImapAccount: Account;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function callsTo(path: string) {
  return fetchMock.mock.calls.filter(([url]) => url === `/api/v1${path}`);
}

beforeEach(() => {
  toastSuccess.mockReset();
  assign.mockReset();
  serverImapAccount = imapAccount;
  credentialsResponse = () => {
    serverImapAccount = { ...imapAccount, status: "active" };
    return json(serverImapAccount);
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/v1/accounts") return json({ items: [serverImapAccount, outlookAccount], next_cursor: null });
    if (url === "/api/v1/accounts/providers") return json({ items: [], next_cursor: null });
    if (url === "/api/v1/accounts/acc-imap/imap/credentials") return credentialsResponse();
    if (url === "/api/v1/accounts/acc-outlook/reconnect") return json({ authorization_url: "https://login.example/consent" });
    return json({ error: { code: "not_found", message: "x" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { ...window.location, assign });
  // jsdom has no matchMedia; report a wide, fine-pointer screen (menus render as dropdowns).
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => vi.unstubAllGlobals());

async function renderAccounts() {
  const user = userEvent.setup();
  const view = renderWithProviders(<ConnectedAccounts />);
  const imapRow = within((await screen.findByText("me@fastmail.example")).closest("li")!);
  const outlookRow = within(screen.getByText("me@outlook.example").closest("li")!);
  return { user, ...view, imapRow, outlookRow };
}

describe("reconnecting a mailbox", () => {
  it("asks an IMAP mailbox for its password only and never starts the OAuth flow", async () => {
    const { user, imapRow, queryClient } = await renderAccounts();
    expect(imapRow.getByText(/no longer accepts the saved password/)).toBeInTheDocument();
    await user.click(imapRow.getByRole("button", { name: "Reconnect" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Enter the mailbox password" }));
    expect(dialog.getByText("MailFlow will use it to sign in to me@fastmail.example again.")).toBeInTheDocument();
    const password = dialog.getByLabelText("Password");
    // The password is the only thing asked for.
    expect(screen.getByRole("dialog").querySelectorAll("input, select, textarea")).toHaveLength(1);
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");

    await user.type(password, PASSWORD);
    await user.click(dialog.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const calls = callsTo("/accounts/acc-imap/imap/credentials");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ password: PASSWORD });
    expect(callsTo("/accounts/acc-imap/reconnect")).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Mailbox reconnected");
    // The list shows the reconnected mailbox and is refreshed from the server.
    expect(queryClient.getQueryData<Account[]>(accountKeys.list())?.find((account) => account.id === "acc-imap")?.status).toBe("active");
    expect(imapRow.queryByText(/no longer accepts the saved password/)).not.toBeInTheDocument();
    await waitFor(() => expect(callsTo("/accounts").length).toBeGreaterThan(1));
    const cached = JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.variables));
    expect(cached).not.toContain(PASSWORD);
  });

  it("offers the same password dialog from the actions menu", async () => {
    const { user, imapRow } = await renderAccounts();
    await user.click(imapRow.getByRole("button", { name: "Actions for me@fastmail.example" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reconnect" }));
    expect(await screen.findByRole("dialog", { name: "Enter the mailbox password" })).toBeInTheDocument();
    expect(callsTo("/accounts/acc-imap/reconnect")).toHaveLength(0);
  });

  it("requires a password and explains a rejected one, keeping the dialog open", async () => {
    credentialsResponse = () =>
      json({ error: { code: "authentication_failed", message: "x", details: [{ field: "imap", code: "authentication_failed" }] } }, 422);
    const { user, imapRow } = await renderAccounts();
    await user.click(imapRow.getByRole("button", { name: "Reconnect" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Reconnect" }));
    expect(await dialog.findByText("This field is required.")).toBeInTheDocument();
    expect(callsTo("/accounts/acc-imap/imap/credentials")).toHaveLength(0);

    await user.type(dialog.getByLabelText("Password"), "wrong");
    await user.click(dialog.getByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(dialog.getByText("The incoming mail (IMAP) server rejected the username or password.")).toBeInTheDocument(),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("clears the password when the dialog is cancelled", async () => {
    const { user, imapRow } = await renderAccounts();
    await user.click(imapRow.getByRole("button", { name: "Reconnect" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Password"), PASSWORD);
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(imapRow.getByRole("button", { name: "Reconnect" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Password")).toHaveValue("");
    expect(callsTo("/accounts/acc-imap/imap/credentials")).toHaveLength(0);
  });

  it("keeps the OAuth redirect for an OAuth mailbox", async () => {
    const { user, outlookRow } = await renderAccounts();
    expect(outlookRow.getByText(/MailFlow lost access to this mailbox/)).toBeInTheDocument();
    await user.click(outlookRow.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example/consent"));
    expect(JSON.parse(String(callsTo("/accounts/acc-outlook/reconnect")[0]?.[1]?.body))).toEqual({ locale: "en" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
