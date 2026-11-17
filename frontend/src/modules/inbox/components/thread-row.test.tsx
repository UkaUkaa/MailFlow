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

function renderRow(canArchive: boolean, view = "inbox") {
  const onAction = vi.fn();
  renderWithProviders(
    <ul>
      <ThreadRow
        thread={thread}
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
});
