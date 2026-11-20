import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/modules/accounts";
import { MAX_ATTACHMENT_FILES } from "@/modules/attachments";
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
let desktop: boolean;

const newMessage: ComposeSession = {
  key: "5b0f4e5e-0000-4000-8000-000000000002",
  mode: "new",
  accountId: "acc-1",
  to: [{ name: null, email: "daniel@okafor.example" }],
  cc: [],
  bcc: [],
  subject: "Notes",
  bodyHtml: "",
  quotedHtml: null,
  sourceMessageId: null,
  draftId: null,
  forwardAttachments: [],
};
const reply: ComposeSession = { ...newMessage, key: "5b0f4e5e-0000-4000-8000-000000000003", mode: "reply", subject: "Re: Notes", sourceMessageId: "m1" };

const sendCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/v1/emails/send");
const sentFiles = () => (sendCalls()[0]?.[1]?.body as FormData).getAll("files") as File[];

const file = (name: string, size = 5, type = "text/plain") => new File(["x".repeat(size)], name, { type });
/** What a drag from the file manager looks like to the page. */
const fileDrag = (files: File[]) => ({ dataTransfer: { types: ["Files"], files, dropEffect: "none" } });
const textDrag = () => ({ dataTransfer: { types: ["text/plain"], files: [], dropEffect: "none" } });

beforeEach(() => {
  accounts = [makeAccount("acc-1")];
  desktop = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/v1/accounts") return new Response(JSON.stringify({ items: accounts, next_cursor: null }), { status: 200 });
    if (url === "/api/v1/emails/send") {
      const result = { status: "sent", message_id: "m2", thread_id: "t1", outbox_id: null, send_at: null, undo_seconds: 0 };
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (url === "/api/v1/emails/drafts") return new Response(JSON.stringify({ id: "draft-1", updated_at: "2026-11-20T09:00:00Z" }), { status: 201 });
    return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query === "(min-width: 64rem)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderComposer(session: ComposeSession, name: string) {
  renderWithProviders(
    <TooltipProvider>
      <ComposerPanel session={session} onClose={vi.fn()} onSent={vi.fn()} />
    </TooltipProvider>,
  );
  const dialog = await screen.findByRole("dialog", { name });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/v1/accounts")).toBe(true));
  return { dialog, composer: within(dialog) };
}

describe("ComposerPanel takes files dropped on it", () => {
  it("shows a drop hint while files are dragged over it and attaches them on drop", async () => {
    const { dialog, composer } = await renderComposer(newMessage, "New message");
    const body = composer.getByRole("textbox", { name: "Message" });

    fireEvent.dragEnter(body, fileDrag([]));
    expect(screen.getByTestId("composer-drop-overlay")).toHaveTextContent("Drop files to attach them");
    fireEvent.dragOver(body, fileDrag([]));
    fireEvent.drop(body, fileDrag([file("notes.txt"), file("photo.png", 10, "image/png")]));

    expect(screen.queryByTestId("composer-drop-overlay")).not.toBeInTheDocument();
    const list = within(composer.getByRole("list", { name: "Attachments" }));
    expect(list.getByText("notes.txt")).toBeInTheDocument();
    expect(list.getByText("photo.png")).toBeInTheDocument();
    // Nothing of the file ends up in the message text.
    expect(body).not.toHaveTextContent("notes.txt");

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Send" })[0]!);
    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    expect(sentFiles().map((item) => item.name)).toEqual(["notes.txt", "photo.png"]);
  });

  it("hides the hint again when the drag leaves the composer", async () => {
    const { composer } = await renderComposer(newMessage, "New message");
    const subject = composer.getByLabelText("Subject");
    const body = composer.getByRole("textbox", { name: "Message" });

    // Crossing from one child to another must not flicker the hint off.
    fireEvent.dragEnter(subject, fileDrag([]));
    fireEvent.dragEnter(body, fileDrag([]));
    fireEvent.dragLeave(subject, fileDrag([]));
    expect(screen.getByTestId("composer-drop-overlay")).toBeInTheDocument();
    fireEvent.dragLeave(body, fileDrag([]));
    expect(screen.queryByTestId("composer-drop-overlay")).not.toBeInTheDocument();
    expect(composer.queryByRole("list", { name: "Attachments" })).not.toBeInTheDocument();
  });

  it("leaves dragged text to the editor", async () => {
    const { composer } = await renderComposer(newMessage, "New message");
    fireEvent.dragEnter(composer.getByRole("textbox", { name: "Message" }), textDrag());
    expect(screen.queryByTestId("composer-drop-overlay")).not.toBeInTheDocument();
  });

  it("refuses a drop that would go over the file limit", async () => {
    const { composer } = await renderComposer(newMessage, "New message");
    const tooMany = Array.from({ length: MAX_ATTACHMENT_FILES + 1 }, (_, index) => file(`file-${index}.txt`));
    fireEvent.drop(composer.getByRole("textbox", { name: "Message" }), fileDrag(tooMany));
    expect(toast.error).toHaveBeenCalledWith(`You can attach up to ${MAX_ATTACHMENT_FILES} files.`);
    expect(composer.queryByRole("list", { name: "Attachments" })).not.toBeInTheDocument();
  });

  it("works on the docked reply too", async () => {
    desktop = true;
    const { dialog, composer } = await renderComposer(reply, "Reply");
    expect(dialog).toHaveAttribute("data-layout", "docked");
    fireEvent.dragEnter(dialog, fileDrag([]));
    expect(screen.getByTestId("composer-drop-overlay")).toBeInTheDocument();
    fireEvent.drop(dialog, fileDrag([file("contract.pdf", 20, "application/pdf")]));
    expect(composer.getByRole("list", { name: "Attachments" })).toHaveTextContent("contract.pdf");
  });
});

describe("docked reply window", () => {
  it("lists the attached files in the small window and lets the user remove them", async () => {
    desktop = true;
    const { dialog, composer } = await renderComposer(reply, "Reply");
    fireEvent.drop(dialog, fileDrag([file("a.txt"), file("b.txt"), file("c.txt")]));

    const list = within(composer.getByRole("list", { name: "Attachments" }));
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(list.getByRole("button", { name: "Remove attachment: b.txt" }));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.queryByText("b.txt")).not.toBeInTheDocument();

    fireEvent.click(composer.getAllByRole("button", { name: "Send" })[0]!);
    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    expect(sentFiles().map((item) => item.name)).toEqual(["a.txt", "c.txt"]);
  });

  it("shows forwarded attachments in the small window as well", async () => {
    desktop = true;
    const forward: ComposeSession = {
      ...reply,
      mode: "forward",
      subject: "Fwd: Notes",
      forwardAttachments: [{ id: "att-1", filename: "chart.png", mime_type: "image/png", size: 2048, is_inline: false }],
    };
    const { composer } = await renderComposer(forward, "Forward");
    const list = within(composer.getByRole("list", { name: "Attachments" }));
    fireEvent.click(list.getByRole("button", { name: "Remove attachment: chart.png" }));
    expect(composer.queryByRole("list", { name: "Attachments" })).not.toBeInTheDocument();
  });

  describe("moving", () => {
    // The panel at its default place in a 1024 × 768 window: 520 × 380, 12px from the corner.
    const box = { left: 492, top: 376, right: 1012, bottom: 756, width: 520, height: 380, x: 492, y: 376 };

    beforeEach(() => {
      desktop = true;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const rect = this.getAttribute("role") === "dialog" ? box : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
        return { ...rect, toJSON: () => rect } as DOMRect;
      });
    });

    it("moves with the arrow keys on the grip and goes back with Home", async () => {
      const { dialog, composer } = await renderComposer(reply, "Reply");
      const grip = composer.getByRole("button", { name: "Move window" });
      expect(grip).toHaveAccessibleDescription(/arrow keys move it/);

      fireEvent.keyDown(grip, { key: "ArrowLeft" });
      expect(dialog.style.translate).toBe("-16px");
      fireEvent.keyDown(grip, { key: "ArrowUp", shiftKey: true });
      expect(dialog.style.translate).toBe("-16px -64px");
      fireEvent.keyDown(grip, { key: "Home" });
      expect(dialog.style.translate).toBe("");
    });

    it("never leaves the window", async () => {
      const { dialog, composer } = await renderComposer(reply, "Reply");
      // Already 12px from the right edge: only 4px are left before the 8px margin.
      fireEvent.keyDown(composer.getByRole("button", { name: "Move window" }), { key: "ArrowRight" });
      expect(dialog.style.translate).toBe("4px");
    });

    it("follows the pointer when the header is dragged", async () => {
      const { dialog, composer } = await renderComposer(reply, "Reply");
      const header = composer.getByRole("button", { name: "Move window" }).closest("header")!;

      fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 700, clientY: 400 });
      expect(dialog).toHaveAttribute("data-dragging", "true");
      fireEvent.pointerMove(header, { pointerId: 1, clientX: 400, clientY: 100 });
      expect(dialog.style.translate).toBe("-300px -300px");
      // Far past the top-left corner: it stops 8px from the edges.
      fireEvent.pointerMove(header, { pointerId: 1, clientX: -2000, clientY: -2000 });
      expect(dialog.style.translate).toBe("-484px -368px");
      fireEvent.pointerUp(header, { pointerId: 1 });
      expect(dialog).not.toHaveAttribute("data-dragging");

      // After the drag the pointer no longer moves it.
      fireEvent.pointerMove(header, { pointerId: 1, clientX: 900, clientY: 700 });
      expect(dialog.style.translate).toBe("-484px -368px");
    });

    it("does not start a drag from the subject field", async () => {
      const { dialog, composer } = await renderComposer(reply, "Reply");
      const subject = composer.getByLabelText("Subject");
      fireEvent.pointerDown(subject, { button: 0, pointerId: 1, clientX: 700, clientY: 400 });
      fireEvent.pointerMove(subject, { pointerId: 1, clientX: 400, clientY: 100 });
      expect(dialog).not.toHaveAttribute("data-dragging");
      expect(dialog.style.translate).toBe("");
    });
  });
});
