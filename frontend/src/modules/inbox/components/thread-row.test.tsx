import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "@/modules/emails";
import { renderWithProviders } from "@/test/render";
import { ThreadRow } from "./thread-row";

vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const thread: ThreadSummary = {
  id: "t1",
  account_id: "acc-1",
  subject: "Hello",
  snippet: "Snippet",
  participants: [{ name: "Marta", email: "marta@example.com" }],
  message_count: 1,
  has_attachments: false,
  is_unread: false,
  is_starred: false,
  last_message_at: "2026-11-17T09:00:00Z",
};

function renderRow(canArchive: boolean, view = "inbox", overrides: Partial<ThreadSummary> = {}) {
  const onAction = vi.fn();
  renderWithProviders(
    <ul>
      <ThreadRow
        thread={{ ...thread, ...overrides }}
        href="/mail/inbox/t1"
        selected={false}
        view={view}
        accountColor={null}
        showAccount={false}
        canArchive={canArchive}
        onAction={onAction}
      />
    </ul>,
  );
  return onAction;
}

describe("ThreadRow quick actions", () => {
  it("offers Archive when the mailbox can archive", async () => {
    const onAction = renderRow(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Archive" }));
    expect(onAction).toHaveBeenCalledWith("archive", "t1");
  });

  it("leaves Archive out when the mailbox cannot archive, keeping the other actions", () => {
    renderRow(false);
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to trash" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Star" })).toBeInTheDocument();
  });

  it("still leaves Archive out of the views that never had it", () => {
    renderRow(true, "archive");
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("can be reached with the keyboard: the row, its star, then the quick actions in order", async () => {
    const onAction = renderRow(true);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("link")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Star" })).toHaveFocus();
    for (const name of ["Mark as unread", "Archive", "Move to trash"]) {
      await user.tab();
      expect(screen.getByRole("button", { name })).toHaveFocus();
    }
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith("trash", "t1");
  });

  it("offers Mark as read for an unread conversation and runs it", async () => {
    const onAction = renderRow(true, "inbox", { is_unread: true });
    expect(screen.getByText("Unread")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark as read" }));
    expect(onAction).toHaveBeenCalledWith("mark_read", "t1");
  });
});

describe("ThreadRow content", () => {
  it("shows the message count as a chip with a spoken label, and the attachment mark", () => {
    renderRow(true, "inbox", { message_count: 4, has_attachments: true });
    expect(screen.getByText("4 messages")).toBeInTheDocument();
    expect(screen.getByLabelText("Has attachments")).toBeInTheDocument();
  });

  it("uses placeholders for a draft without subject or content", () => {
    renderRow(true, "drafts", { subject: "", snippet: "" });
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
    expect(screen.getByText("No content")).toBeInTheDocument();
  });
});

describe("ThreadRow selection mode", () => {
  function renderSelectable(checked: boolean) {
    const onToggleSelect = vi.fn();
    renderWithProviders(
      <ul>
        <ThreadRow
          thread={thread}
          href="/mail/inbox/t1"
          selected={false}
          view="inbox"
          accountColor={null}
          showAccount={false}
          canArchive
          onAction={vi.fn()}
          selectionMode
          checked={checked}
          onToggleSelect={onToggleSelect}
        />
      </ul>,
    );
    return onToggleSelect;
  }

  it("turns the row into a checkbox that toggles instead of opening the conversation", async () => {
    const onToggleSelect = renderSelectable(false);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    expect(box).toHaveAttribute("aria-checked", "false");
    await userEvent.setup().click(box);
    expect(onToggleSelect).toHaveBeenCalledWith("t1");
  });

  it("hides the per-row actions while selecting", () => {
    renderSelectable(true);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Star" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to trash" })).not.toBeInTheDocument();
  });
});
