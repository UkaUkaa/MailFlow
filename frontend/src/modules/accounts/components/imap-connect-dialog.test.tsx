import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { accountKeys } from "../api";
import type { Account } from "../types";
import { ImapConnectDialog } from "./imap-connect-dialog";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();
const PASSWORD = "app-password-1234";

const connected: Account = {
  id: "acc-imap",
  provider: "imap",
  email_address: "me@example.com",
  display_name: "Work",
  color: null,
  status: "active",
  status_reason: null,
  capabilities: { threads: false, labels: false, server_search: false, drafts: true, spam: false, archive: false, incremental_sync: true },
  created_at: "2026-11-17T09:00:00Z",
  sync: { status: "queued", last_synced_at: null, last_error_code: null },
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <ImapConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  const view = renderWithProviders(<Harness />);
  await user.click(screen.getByRole("button", { name: "open" }));
  const dialog = await screen.findByRole("dialog", { name: "Connect a mail account" });
  const incoming = within(within(dialog).getByRole("group", { name: "Incoming mail (IMAP)" }));
  const outgoing = within(within(dialog).getByRole("group", { name: "Outgoing mail (SMTP)" }));
  return { user, ...view, dialog: within(dialog), incoming, outgoing };
}

type Opened = Awaited<ReturnType<typeof openDialog>>;
async function fillRequired({ user, dialog, incoming, outgoing }: Opened) {
  await user.type(dialog.getByLabelText("Email address"), "me@example.com");
  await user.type(incoming.getByLabelText("Server"), "imap.example.com");
  await user.type(outgoing.getByLabelText("Server"), "smtp.example.com");
  await user.type(dialog.getByLabelText("Password"), PASSWORD);
}

function errorResponse(status: number, code: string, details?: { field: string; code: string }[], headers?: Record<string, string>) {
  return new Response(JSON.stringify({ error: { code, message: "x", ...(details ? { details } : {}) } }), { status, headers });
}

beforeEach(() => {
  fetchMock.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = "mf_csrf=token; Path=/";
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("ImapConnectDialog", () => {
  it("starts with IMAP 993/SSL and SMTP 587/STARTTLS and offers only the allowed ports", async () => {
    const { dialog, incoming, outgoing } = await openDialog();
    expect(incoming.getByLabelText("Port")).toHaveValue("993");
    expect(incoming.getByLabelText("Encryption")).toHaveValue("ssl");
    expect(outgoing.getByLabelText("Port")).toHaveValue("587");
    expect(outgoing.getByLabelText("Encryption")).toHaveValue("starttls");
    const options = (select: HTMLElement) => within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options(incoming.getByLabelText("Port"))).toEqual(["993", "143"]);
    expect(options(outgoing.getByLabelText("Port"))).toEqual(["587", "465"]);
    expect(options(incoming.getByLabelText("Encryption"))).toEqual(["SSL/TLS", "STARTTLS"]);
    const password = dialog.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(dialog.getByText(/require an app-specific password/)).toBeInTheDocument();
  });

  it("moves the port with the encryption unless the user picked a different port", async () => {
    const { user, incoming, outgoing } = await openDialog();
    await user.selectOptions(incoming.getByLabelText("Encryption"), "starttls");
    expect(incoming.getByLabelText("Port")).toHaveValue("143");
    await user.selectOptions(incoming.getByLabelText("Encryption"), "ssl");
    expect(incoming.getByLabelText("Port")).toHaveValue("993");
    await user.selectOptions(outgoing.getByLabelText("Encryption"), "ssl");
    expect(outgoing.getByLabelText("Port")).toHaveValue("465");

    // A port chosen against the default stays when the encryption changes.
    await user.selectOptions(incoming.getByLabelText("Port"), "143");
    await user.selectOptions(incoming.getByLabelText("Encryption"), "starttls");
    expect(incoming.getByLabelText("Port")).toHaveValue("143");
    await user.selectOptions(outgoing.getByLabelText("Port"), "587");
    await user.selectOptions(outgoing.getByLabelText("Encryption"), "starttls");
    expect(outgoing.getByLabelText("Port")).toHaveValue("587");
  });

  it("mirrors the email into the username until the username is edited", async () => {
    const { user, dialog } = await openDialog();
    const email = dialog.getByLabelText("Email address");
    const username = dialog.getByLabelText("Username");
    await user.type(email, "me@example.com");
    expect(username).toHaveValue("me@example.com");
    await user.clear(username);
    await user.type(username, "login-name");
    await user.type(email, ".ua");
    expect(email).toHaveValue("me@example.com.ua");
    expect(username).toHaveValue("login-name");
  });

  it("shows translated validation errors and does not call the API", async () => {
    const { user, dialog, incoming, outgoing } = await openDialog();
    await user.type(dialog.getByLabelText("Email address"), "nope");
    await user.type(incoming.getByLabelText("Server"), "imap://imap.example.com");
    await user.click(dialog.getByRole("button", { name: "Connect" }));
    expect(await dialog.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(dialog.getByText("Enter only the server name, for example mail.example.com.")).toBeInTheDocument();
    // SMTP server and password are missing.
    expect(dialog.getAllByText("This field is required.")).toHaveLength(2);
    expect(outgoing.getByLabelText("Server")).toHaveAttribute("aria-invalid", "true");
    expect(dialog.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits exactly the contract's body, then closes, confirms and refreshes the accounts", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(connected), { status: 201 }));
    const opened = await openDialog();
    const { user, dialog, incoming, queryClient } = opened;
    queryClient.setQueryData<Account[]>(accountKeys.list(), []);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await fillRequired(opened);
    await user.type(dialog.getByLabelText("Display name (optional)"), "Work");
    await user.selectOptions(incoming.getByLabelText("Encryption"), "starttls");
    await user.click(dialog.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/accounts/imap");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("token");
    expect(JSON.parse(String(init?.body))).toEqual({
      email_address: "me@example.com",
      display_name: "Work",
      imap: { host: "imap.example.com", port: 143, security: "starttls" },
      smtp: { host: "smtp.example.com", port: 587, security: "starttls" },
      username: "me@example.com",
      password: PASSWORD,
    });
    expect(toastSuccess).toHaveBeenCalledWith("Mailbox connected. Synchronization has started.");
    expect(queryClient.getQueryData(accountKeys.list())).toEqual([connected]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accountKeys.list() });
  });

  it("leaves out the display name when it is empty", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(connected), { status: 200 }));
    const opened = await openDialog();
    await fillRequired(opened);
    await opened.user.click(opened.dialog.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty("display_name");
  });

  it("never keeps the password: not after success, not in storage, not in the query client", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(connected), { status: 201 }));
    const opened = await openDialog();
    const { user, queryClient } = opened;
    await fillRequired(opened);
    await user.click(opened.dialog.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const cached = JSON.stringify([
      queryClient.getQueryCache().getAll().map((query) => [query.queryKey, query.state.data]),
      queryClient.getMutationCache().getAll().map((mutation) => [mutation.state.variables, mutation.state.data]),
    ]);
    expect(cached).not.toContain(PASSWORD);
    expect(JSON.stringify({ ...localStorage })).not.toContain(PASSWORD);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PASSWORD);
    expect(window.location.href).not.toContain(PASSWORD);

    // Reopening starts from an empty form.
    await user.click(screen.getByRole("button", { name: "open" }));
    const reopened = within(await screen.findByRole("dialog"));
    expect(reopened.getByLabelText("Password")).toHaveValue("");
    expect(reopened.getByLabelText("Email address")).toHaveValue("");
    expect(reopened.getByLabelText("Username")).toHaveValue("");
  });

  it.each(["Cancel", "Close"])("clears the password and the rest of the form when closed with %s", async (name) => {
    const opened = await openDialog();
    const { user } = opened;
    await fillRequired(opened);
    await user.selectOptions(opened.incoming.getByLabelText("Encryption"), "starttls");
    await user.click(opened.dialog.getByRole("button", { name }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "open" }));
    const reopened = within(await screen.findByRole("dialog"));
    expect(reopened.getByLabelText("Password")).toHaveValue("");
    expect(reopened.getByLabelText("Email address")).toHaveValue("");
    expect(reopened.getByLabelText("Username")).toHaveValue("");
    expect(within(reopened.getByRole("group", { name: "Incoming mail (IMAP)" })).getByLabelText("Port")).toHaveValue("993");
    // The username follows the email again.
    await user.type(reopened.getByLabelText("Email address"), "new@example.com");
    expect(reopened.getByLabelText("Username")).toHaveValue("new@example.com");
  });

  it("clears the password when dismissed with Escape", async () => {
    const opened = await openDialog();
    await fillRequired(opened);
    await opened.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await opened.user.click(screen.getByRole("button", { name: "open" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Password")).toHaveValue("");
  });

  it.each([
    ["authentication_failed", "smtp", "The outgoing mail (SMTP) server rejected the username or password."],
    ["authentication_failed", "imap", "The incoming mail (IMAP) server rejected the username or password."],
    ["tls_required", "smtp", "The outgoing mail (SMTP) server does not offer an encrypted connection, so MailFlow will not connect to it."],
    ["connection_failed", "imap", "Could not connect to the incoming mail (IMAP) server. Check the server name, port and encryption."],
    ["blocked_destination", "imap", "The incoming mail (IMAP) server address is not allowed. Use the public server name and one of the offered ports."],
  ])("explains %s for the %s server and keeps the form open", async (code, field, message) => {
    fetchMock.mockResolvedValueOnce(errorResponse(422, code, [{ field, code }]));
    const opened = await openDialog();
    await fillRequired(opened);
    await opened.user.click(opened.dialog.getByRole("button", { name: "Connect" }));
    expect(await opened.dialog.findByRole("alert")).toHaveTextContent(message);
    // Nothing is lost: the user can correct the form and retry.
    expect(opened.dialog.getByLabelText("Email address")).toHaveValue("me@example.com");
    expect(opened.dialog.getByLabelText("Password")).toHaveValue(PASSWORD);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("explains a blocked destination without details, the account limit and the rate limit", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(422, "blocked_destination"))
      .mockResolvedValueOnce(errorResponse(409, "account_limit_reached"))
      .mockResolvedValueOnce(errorResponse(429, "rate_limited", undefined, { "Retry-After": "1500" }))
      .mockResolvedValueOnce(errorResponse(500, "internal_error"));
    const opened = await openDialog();
    const submit = () => opened.user.click(opened.dialog.getByRole("button", { name: "Connect" }));
    await fillRequired(opened);
    await submit();
    expect(await opened.dialog.findByRole("alert")).toHaveTextContent("This server address is not allowed.");
    await submit();
    await waitFor(() => expect(opened.dialog.getByRole("alert")).toHaveTextContent("You have reached the limit of connected mailboxes."));
    await submit();
    await waitFor(() => expect(opened.dialog.getByRole("alert")).toHaveTextContent("Too many connection attempts. Try again in 25 minutes."));
    await submit();
    await waitFor(() => expect(opened.dialog.getByRole("alert")).toHaveTextContent("The mailbox could not be connected. Please try again."));
  });

  it("marks the fields a server-side validation error names", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(422, "validation_error", [{ field: "imap.host", code: "invalid" }]));
    const opened = await openDialog();
    await fillRequired(opened);
    await opened.user.click(opened.dialog.getByRole("button", { name: "Connect" }));
    expect(await opened.dialog.findByText("Some of the details are not valid. Check the form and try again.")).toBeInTheDocument();
    expect(opened.incoming.getByLabelText("Server")).toHaveAttribute("aria-invalid", "true");
    expect(opened.incoming.getByText("The server did not accept this value.")).toBeInTheDocument();
    expect(opened.outgoing.getByLabelText("Server")).toHaveAttribute("aria-invalid", "false");
  });
});
