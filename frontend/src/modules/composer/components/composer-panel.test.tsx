import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/modules/accounts";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { makeAccount } from "@/test/accounts";
import { renderWithProviders } from "@/test/render";
import type { ComposeSession, SendResult } from "../types";
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

let sendResult: SendResult;
const sendCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/v1/emails/send");
const sentPayload = () => JSON.parse(String((sendCalls()[0]?.[1]?.body as FormData).get("payload"))) as Record<string, unknown>;

const draftCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/emails/drafts"));

beforeEach(() => {
  sendResult = { status: "sent", message_id: "m1", thread_id: "t1", outbox_id: null, send_at: null, undo_seconds: 0 };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/v1/accounts") return new Response(JSON.stringify({ items: accounts, next_cursor: null }), { status: 200 });
    if (url === "/api/v1/emails/send") return new Response(JSON.stringify(sendResult), { status: sendResult.status === "sent" ? 200 : 202 });
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
      <ComposerPanel session={session} onClose={onClose} onSent={vi.fn()} />
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
        <ComposerPanel session={value} onClose={vi.fn()} onSent={vi.fn()} />
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
        <ComposerPanel session={session} onClose={onClose} onSent={vi.fn()} />
      </TooltipProvider>,
    );
    const panel = await screen.findByRole("dialog", { name: "New message" });
    const body = await within(panel).findByRole("textbox", { name: "Message" });
    fireEvent.keyDown(body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("ComposerPanel sending", () => {
  const filled: ComposeSession = {
    ...session,
    to: [{ name: "Marta", email: "marta@example.com" }],
    subject: "Lunch",
    bodyHtml: "<p>See you at noon.</p>",
    draftId: "draft-7",
  };

  function renderFilled(value: ComposeSession = filled) {
    const onClose = vi.fn();
    const onSent = vi.fn<(result: SendResult, snapshot: ComposeSession) => void>();
    renderWithProviders(
      <TooltipProvider>
        <ComposerPanel session={value} onClose={onClose} onSent={onSent} />
      </TooltipProvider>,
    );
    return { onClose, onSent };
  }

  it("closes and hands over the server's answer with its own state, so the send can be undone", async () => {
    accounts = [makeAccount("acc-1")];
    sendResult = { status: "undoable", message_id: null, thread_id: null, outbox_id: "out-1", send_at: "2026-11-18T10:00:05Z", undo_seconds: 5 };
    const { onClose, onSent } = renderFilled();
    const composer = within(await screen.findByRole("dialog", { name: "New message" }));
    await composer.findByRole("textbox", { name: "Message" });
    fireEvent.change(composer.getByLabelText("Subject"), { target: { value: "Lunch on Thursday" } });
    fireEvent.click(composer.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendCalls()).toHaveLength(1);
    expect(sentPayload()).toMatchObject({ subject: "Lunch on Thursday", draft_id: "draft-7" });
    expect(sentPayload()).not.toHaveProperty("send_at");
    expect((sendCalls()[0]?.[1]?.headers as Record<string, string>)["Idempotency-Key"]).toBe(session.key);

    const [result, snapshot] = onSent.mock.calls[0]!;
    expect(result).toEqual(sendResult);
    expect(snapshot).toMatchObject({
      mode: "new",
      accountId: "acc-1",
      to: filled.to,
      subject: "Lunch on Thursday",
      bodyHtml: "<p>See you at noon.</p>",
      draftId: "draft-7",
      files: [],
    });
  });

  it("schedules the send for the time chosen in “Send later”", async () => {
    accounts = [makeAccount("acc-1")];
    // Phone: the choices open as a sheet.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    sendResult = { status: "scheduled", message_id: null, thread_id: null, outbox_id: "out-2", send_at: "2026-11-19T08:00:00Z", undo_seconds: 0 };
    const { onSent } = renderFilled();
    const composer = within(await screen.findByRole("dialog", { name: "New message" }));
    await composer.findByRole("textbox", { name: "Message" });

    fireEvent.click(composer.getByRole("button", { name: "Schedule for later" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Send later" }));
    fireEvent.click(sheet.getByRole("button", { name: /Tomorrow morning/ }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    const sendAt = new Date(String(sentPayload().send_at));
    expect(sendAt.getHours()).toBe(8);
    expect(sendAt.getTime()).toBeGreaterThan(Date.now());
    // Local wall-clock time; the server converts it using the time zone cookie.
    expect(String(sentPayload().send_at)).toMatch(/T08:00:00$/);
    expect(document.cookie).toContain("mf_tz=");
    expect(onSent.mock.calls[0]?.[0].status).toBe("scheduled");
  });

  it("starts with the files of a reopened send and treats its content as unsaved", async () => {
    accounts = [makeAccount("acc-1", { drafts: false }, { provider: "imap" })];
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const { onClose } = renderFilled({ ...filled, draftId: null, files: [file], unsaved: true });
    const composer = within(await screen.findByRole("dialog", { name: "New message" }));
    expect(composer.getByText("notes.txt")).toBeInTheDocument();
    await composer.findByRole("note");

    // Nothing was typed, yet closing asks: the message exists only here.
    fireEvent.click(composer.getAllByRole("button", { name: "Close" })[0]!);
    expect(await screen.findByRole("dialog", { name: "Discard this message?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("explains a rejected time and keeps the composer open", async () => {
    accounts = [makeAccount("acc-1")];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/accounts") return new Response(JSON.stringify({ items: accounts, next_cursor: null }), { status: 200 });
      return new Response(
        JSON.stringify({ error: { code: "validation_error", message: "invalid", details: [{ field: "send_at", code: "in_past" }] } }),
        { status: 422 },
      );
    });
    const { onClose, onSent } = renderFilled();
    const composer = within(await screen.findByRole("dialog", { name: "New message" }));
    await composer.findByRole("textbox", { name: "Message" });
    fireEvent.click(composer.getByRole("button", { name: "Send" }));
    expect(await composer.findByRole("alert")).toHaveTextContent("That time has already passed. Choose a later one.");
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
