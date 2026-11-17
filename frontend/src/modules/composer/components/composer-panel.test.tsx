import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/modules/accounts";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { makeAccount } from "@/test/accounts";
import { renderWithProviders } from "@/test/render";
import type { ComposeSession } from "../types";
import { ComposerPanel } from "./composer-panel";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// The accounts module's entry point also exports components that use locale-aware navigation.
vi.mock("@/infrastructure/i18n/navigation", () => ({}));

const fetchMock = vi.fn<typeof fetch>();
let accounts: Account[];

const session: ComposeSession = {
  key: "5b0f4e5e-0000-4000-8000-000000000001",
  mode: "new",
  accountId: "acc-1",
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  bodyHtml: "",
  quotedHtml: null,
  sourceMessageId: null,
  draftId: null,
  forwardAttachments: [],
};

const draftCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/emails/drafts"));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/v1/accounts") return new Response(JSON.stringify({ items: accounts, next_cursor: null }), { status: 200 });
    if (url === "/api/v1/emails/drafts") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "draft-1", ...body, updated_at: "2026-11-17T09:00:00Z" }), { status: 201 });
    }
    return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderComposer() {
  const onClose = vi.fn();
  renderWithProviders(
    <TooltipProvider>
      <ComposerPanel session={session} onClose={onClose} />
    </TooltipProvider>,
  );
  const composer = within(await screen.findByRole("dialog", { name: "New message" }));
  // The mailbox list has loaded once the composer knows whether drafts are possible.
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/v1/accounts")).toBe(true));
  return { composer, onClose };
}

/** Types a subject and lets the autosave delay (1.5 s) pass. */
async function typeSubjectAndWait(composer: ReturnType<typeof within>) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.change(composer.getByLabelText("Subject"), { target: { value: "Hello there" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  vi.useRealTimers();
}

describe("ComposerPanel drafts follow the mailbox capability", () => {
  it("autosaves a draft for a mailbox with a Drafts folder", async () => {
    accounts = [makeAccount("acc-1")];
    const { composer } = await renderComposer();
    expect(composer.queryByRole("note")).not.toBeInTheDocument();
    expect(composer.getAllByRole("button", { name: "Save and close" }).length).toBeGreaterThan(0);
    await typeSubjectAndWait(composer);
    await waitFor(() => expect(draftCalls()).toHaveLength(1));
    expect(await composer.findByText("Draft saved")).toBeInTheDocument();
  });

  it("does not save, and does not report a failed save, for a mailbox without one", async () => {
    accounts = [makeAccount("acc-1", { drafts: false }, { provider: "imap" })];
    const { composer, onClose } = await renderComposer();
    expect(await composer.findByRole("note")).toHaveTextContent(
      "This mailbox has no Drafts folder, so this message is not saved until you send it.",
    );
    expect(composer.queryByRole("button", { name: "Save and close" })).not.toBeInTheDocument();
    await typeSubjectAndWait(composer);
    expect(draftCalls()).toHaveLength(0);
    expect(composer.queryByText("Not saved")).not.toBeInTheDocument();
    expect(composer.queryByText("Draft saved")).not.toBeInTheDocument();

    // Closing asks before the message is lost; it is never sent to the drafts endpoint.
    fireEvent.click(composer.getAllByRole("button", { name: "Close" })[0]!);
    const confirm = within(await screen.findByRole("dialog", { name: "Discard this message?" }));
    expect(confirm.getByText("This mailbox cannot store drafts, so the message will be lost. This cannot be undone.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(confirm.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(draftCalls()).toHaveLength(0);
  });

  it("closes an untouched message without asking", async () => {
    accounts = [makeAccount("acc-1", { drafts: false }, { provider: "imap" })];
    const { composer, onClose } = await renderComposer();
    await composer.findByRole("note");
    fireEvent.click(composer.getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Discard this message?" })).not.toBeInTheDocument();
  });
});

describe("ComposerPanel presentation", () => {
  const reply: ComposeSession = { ...session, mode: "reply", subject: "Re: Hello", to: [{ name: "Marta", email: "marta@example.com" }], sourceMessageId: "m1" };
  const desktop = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

  function renderSession(value: ComposeSession) {
    renderWithProviders(
      <TooltipProvider>
        <ComposerPanel session={value} onClose={vi.fn()} />
      </TooltipProvider>,
    );
  }

  it("docks a reply on desktop, expands it to the page and docks it again without losing the text", async () => {
    accounts = [makeAccount("acc-1")];
    desktop(true);
    renderSession(reply);
    const panel = await screen.findByRole("dialog", { name: "Reply" });
    expect(panel).toHaveAttribute("data-layout", "docked");
    const composer = within(panel);
    fireEvent.change(composer.getByLabelText("Subject"), { target: { value: "Re: Hello again" } });
    expect(composer.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(composer.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();

    fireEvent.click(composer.getByRole("button", { name: "Expand" }));
    expect(panel).toHaveAttribute("data-layout", "page");
    expect(composer.getByLabelText("Subject")).toHaveValue("Re: Hello again");
    expect(composer.getByText("Marta")).toBeInTheDocument();

    fireEvent.click(composer.getByRole("button", { name: "Dock" }));
    expect(panel).toHaveAttribute("data-layout", "docked");
    expect(composer.getByLabelText("Subject")).toHaveValue("Re: Hello again");
  });

  it("uses the full composer for a reply below the desktop width", async () => {
    accounts = [makeAccount("acc-1")];
    desktop(false);
    renderSession(reply);
    const panel = await screen.findByRole("dialog", { name: "Reply" });
    expect(panel).toHaveAttribute("data-layout", "page");
    expect(within(panel).queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Dock" })).not.toBeInTheDocument();
  });

  it("never docks a new message, and shows one recipients line until it gets focus", async () => {
    accounts = [makeAccount("acc-1")];
    desktop(true);
    renderSession(session);
    const panel = await screen.findByRole("dialog", { name: "New message" });
    expect(panel).toHaveAttribute("data-layout", "page");
    const composer = within(panel);
    expect(composer.getByPlaceholderText("To, Cc, Bcc")).toBeInTheDocument();
    expect(composer.queryByLabelText("Bcc")).not.toBeInTheDocument();
    fireEvent.focus(composer.getByLabelText("To"));
    expect(composer.getByLabelText("Cc")).toBeInTheDocument();
    expect(composer.getByLabelText("Bcc")).toBeInTheDocument();
  });

  it("closes on Escape even from inside the message body", async () => {
    accounts = [makeAccount("acc-1")];
    desktop(false);
    const onClose = vi.fn();
    renderWithProviders(
      <TooltipProvider>
        <ComposerPanel session={session} onClose={onClose} />
      </TooltipProvider>,
    );
    const panel = await screen.findByRole("dialog", { name: "New message" });
    const body = await within(panel).findByRole("textbox", { name: "Message" });
    fireEvent.keyDown(body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
