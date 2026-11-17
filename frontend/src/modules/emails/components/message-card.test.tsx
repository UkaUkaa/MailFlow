import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { renderWithProviders } from "@/test/render";
import type { Message } from "../types";
import { MessageCard } from "./message-card";

const composer = vi.hoisted(() => ({ reply: vi.fn(), editDraft: vi.fn(), compose: vi.fn(), isOpen: false }));
const deleteDraft = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/modules/composer", () => ({
  useComposer: () => composer,
  useDeleteDraft: () => ({
    isPending: false,
    mutate: (id: string, options: { onSuccess: () => void }) => {
      deleteDraft(id);
      options.onSuccess();
    },
  }),
}));
vi.mock("./email-frame", () => ({ EmailFrame: () => <div data-testid="frame" /> }));

const message: Message = {
  id: "m1",
  thread_id: "t1",
  account_id: "acc-1",
  from: { name: "Marta", email: "marta@example.com" },
  to: [{ name: "Olena", email: "olena@example.com" }],
  cc: [{ name: null, email: "team@example.com" }],
  bcc: [],
  reply_to: [],
  subject: "Hello",
  snippet: "A short preview",
  sent_at: "2026-11-17T09:00:00Z",
  is_read: true,
  is_starred: false,
  is_draft: false,
  body_html: "<p>Hi</p>",
  body_text: "Hi",
  has_remote_images: false,
  attachments: [],
};

function renderCard(overrides: Partial<Message> = {}, onDraftDeleted?: () => void) {
  return renderWithProviders(
    <TooltipProvider>
      <MessageCard message={{ ...message, ...overrides }} defaultExpanded alwaysShowImages={false} onDraftDeleted={onDraftDeleted} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  for (const mock of [composer.reply, composer.editDraft, deleteDraft]) mock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("MessageCard", () => {
  it("is a card with sender, recipients and its own reply and forward buttons", async () => {
    renderCard();
    const card = within(screen.getByRole("article", { name: "Message from Marta" }));
    expect(card.getByText("Olena, team@example.com")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(card.getByRole("button", { name: "Reply" }));
    expect(composer.reply).toHaveBeenLastCalledWith(expect.objectContaining({ id: "m1" }), "reply");
    await user.click(card.getByRole("button", { name: "Reply all" }));
    expect(composer.reply).toHaveBeenLastCalledWith(expect.objectContaining({ id: "m1" }), "reply_all");
    await user.click(card.getByRole("button", { name: "Forward" }));
    expect(composer.reply).toHaveBeenLastCalledWith(expect.objectContaining({ id: "m1" }), "forward");
  });

  it("leaves Reply all out when there is a single recipient", () => {
    renderCard({ cc: [] });
    expect(screen.queryByRole("button", { name: "Reply all" })).not.toBeInTheDocument();
  });

  it("renders a draft as a compact card with Edit and Delete, and no Send", async () => {
    renderCard({ is_draft: true });
    const card = within(screen.getByRole("article", { name: "Draft" }));
    expect(card.getByText("A short preview")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("frame")).not.toBeInTheDocument();
    await userEvent.setup().click(card.getByRole("button", { name: "Edit" }));
    expect(composer.editDraft).toHaveBeenCalledWith("m1");
  });

  it("deletes a draft only after confirmation", async () => {
    const onDeleted = vi.fn();
    renderCard({ is_draft: true, snippet: "", to: [], cc: [] }, onDeleted);
    expect(screen.getByText("No recipients yet")).toBeInTheDocument();
    expect(screen.getByText("This message has no content.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteDraft).not.toHaveBeenCalled();
    const confirm = within(await screen.findByRole("dialog", { name: "Delete this draft?" }));
    await user.click(confirm.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("m1"));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
