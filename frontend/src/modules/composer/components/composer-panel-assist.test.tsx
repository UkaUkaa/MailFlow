import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { makeAccount } from "@/test/accounts";
import { renderWithProviders } from "@/test/render";
import type { ComposeSession } from "../types";
import { ComposerPanel } from "./composer-panel";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// jsdom has no layout: the editor scrolls the caret into view after text is inserted.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const fetchMock = vi.fn<typeof fetch>();
let configured: boolean;

const settings = () => ({
  locale: "en",
  theme: "system",
  load_remote_images: true,
  conversation_view: true,
  list_density: "comfortable",
  list_preview_lines: 1,
  show_avatars: true,
  account_tint: "subtle",
  accent_color: "blue",
  reader_text_size: "default",
  undo_send_seconds: 5,
});

const assistant = () =>
  configured
    ? { configured: true, provider: "anthropic", model: "claude-opus-5-5", key_hint: "abcd", models: ["claude-opus-5-5"] }
    : { configured: false, provider: null, model: null, key_hint: null, models: [] };

const template = {
  id: "tpl-1",
  name: "Follow-up",
  subject: "Checking in, {{first_name}}",
  body_html: "<p>Hi {{first_name}}, any news? {{unknown}}</p>",
  created_at: "2026-11-18T09:00:00Z",
  updated_at: "2026-11-18T09:00:00Z",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url) === path);

beforeEach(() => {
  configured = true;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/v1/accounts") return json({ items: [makeAccount("acc-1")], next_cursor: null });
    if (url === "/api/v1/assistant") return json(assistant());
    if (url === "/api/v1/settings") return json(settings());
    if (url === "/api/v1/assistant/reply") return json({ language: "uk", body_html: "<p>Привіт, Марто!</p><p>Так, четвер підходить.</p>" });
    if (url === "/api/v1/templates") return json({ items: [template] });
    if (url === "/api/v1/emails/drafts") return json({ id: "draft-1", updated_at: "2026-11-18T09:00:00Z" }, 201);
    return json({ items: [], next_cursor: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  // Phone: menus open as sheets.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => vi.unstubAllGlobals());

const base: ComposeSession = {
  key: "5b0f4e5e-0000-4000-8000-000000000002",
  mode: "reply",
  accountId: "acc-1",
  to: [{ name: "Marta Shevchenko", email: "marta@example.com" }],
  cc: [],
  bcc: [],
  subject: "",
  bodyHtml: "",
  quotedHtml: null,
  sourceMessageId: "msg-1",
  draftId: null,
  forwardAttachments: [],
};

async function open(session: ComposeSession = base) {
  renderWithProviders(
    <TooltipProvider>
      <ComposerPanel session={session} onClose={vi.fn()} onSent={vi.fn()} />
    </TooltipProvider>,
  );
  const composer = within(await screen.findByRole("dialog", { name: session.mode === "new" ? "New message" : "Reply" }));
  await composer.findByRole("textbox", { name: "Message" });
  return composer;
}

describe("Write with AI", () => {
  it("drafts a reply from a short note and puts it in the editor", async () => {
    const composer = await open();
    fireEvent.click((await composer.findAllByRole("button", { name: "Write with AI" }))[0]!);
    const note = await composer.findByRole("textbox", { name: "Write with AI" });
    fireEvent.change(note, { target: { value: "yes, thursday" } });
    fireEvent.keyDown(note, { key: "Enter" });

    await waitFor(() => expect(composer.getByRole("textbox", { name: "Message" })).toHaveTextContent("Так, четвер підходить."));
    const [, init] = calls("/api/v1/assistant/reply")[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ source_message_id: "msg-1", instruction: "yes, thursday" });
    expect(composer.getByText("Written in Ukrainian. Undo brings your text back.")).toBeInTheDocument();
    expect(composer.getByRole("button", { name: "Rewrite" })).toBeInTheDocument();
  });

  it("shows which AI service writes the reply", async () => {
    const composer = await open();
    fireEvent.click((await composer.findAllByRole("button", { name: "Write with AI" }))[0]!);
    expect(await composer.findByText("Claude (Anthropic)")).toBeInTheDocument();
  });

  it("explains how to connect a key and sends nothing without one", async () => {
    configured = false;
    const composer = await open();
    fireEvent.click((await composer.findAllByRole("button", { name: "Write with AI" }))[0]!);
    expect(await composer.findByRole("link", { name: "Connect AI" })).toHaveAttribute("href", "/settings/assistant");
    expect(composer.queryByRole("textbox", { name: "Write with AI" })).not.toBeInTheDocument();
    expect(calls("/api/v1/assistant/reply")).toHaveLength(0);
  });

  it("is not offered for a new message", async () => {
    const composer = await open({ ...base, mode: "new", sourceMessageId: null });
    expect(composer.queryByRole("button", { name: "Write with AI" })).not.toBeInTheDocument();
  });
});

describe("Templates in the composer", () => {
  it("inserts a template with the recipient's name filled in", async () => {
    const composer = await open();
    fireEvent.click(composer.getAllByRole("button", { name: "Templates" })[0]!);
    const sheet = within(await screen.findByRole("dialog", { name: "Templates" }));
    fireEvent.click(await sheet.findByRole("button", { name: /Follow-up/ }));

    await waitFor(() => expect(composer.getByRole("textbox", { name: "Message" })).toHaveTextContent("Hi Marta, any news? {{unknown}}"));
    expect(composer.getByLabelText("Subject")).toHaveValue("Checking in, Marta");
  });
});
