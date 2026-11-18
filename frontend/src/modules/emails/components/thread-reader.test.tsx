import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/modules/accounts";
import { makeAccount } from "@/test/accounts";
import { renderWithProviders } from "@/test/render";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { ThreadReader } from "./thread-reader";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));
vi.mock("@/modules/composer", () => ({ useComposer: () => ({ reply: vi.fn(), editDraft: vi.fn(), compose: vi.fn(), isOpen: false }) }));
const userSettings = vi.hoisted(() => ({ data: { load_remote_images: true } as { load_remote_images: boolean } | undefined }));
vi.mock("@/modules/settings", () => ({ useSettings: () => userSettings }));
vi.mock("./message-card", () => ({
  MessageCard: ({ alwaysShowImages }: { alwaysShowImages: boolean }) => <div data-testid="message" data-images={String(alwaysShowImages)} />,
}));

const thread = {
  id: "t1",
  account_id: "acc-1",
  subject: "Quarterly numbers",
  snippet: "Hello",
  participants: [{ name: "Marta", email: "marta@example.com" }],
  message_count: 1,
  has_attachments: false,
  is_unread: false,
  is_starred: false,
  last_message_at: "2026-11-17T09:00:00Z",
  messages: [
    {
      id: "m1",
      thread_id: "t1",
      account_id: "acc-1",
      from: { name: "Marta", email: "marta@example.com" },
      to: [{ name: "Olena", email: "olena@example.com" }],
      cc: [],
      bcc: [],
      reply_to: [],
      subject: "Quarterly numbers",
      snippet: "Hello",
      sent_at: "2026-11-17T09:00:00Z",
      is_read: true,
      is_starred: false,
      is_draft: false,
      body_html: '<p>Hi <img src="https://images.example/a.png"></p>',
      body_text: "Hi",
      has_remote_images: true,
      attachments: [],
    },
  ],
};

const fetchMock = vi.fn<typeof fetch>();
let accounts: Account[];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  userSettings.data = { load_remote_images: true };
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/v1/accounts") return json({ items: accounts, next_cursor: null });
    if (url === "/api/v1/threads/t1") return json(thread);
    if (url === "/api/v1/threads/t1/actions") return json(thread);
    return json({ items: [], next_cursor: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => vi.unstubAllGlobals());

async function renderReader(view = "inbox") {
  const user = userEvent.setup();
  renderWithProviders(<TooltipProvider><ThreadReader threadId="t1" view={view} /></TooltipProvider>);
  await screen.findByRole("heading", { level: 1, name: "Quarterly numbers" });
  // Controls that do not depend on the mailbox are there once it has loaded.
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/v1/accounts")).toBe(true));
  return user;
}

async function menuItems(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More actions" }));
  return (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
}

describe("ThreadReader actions follow the mailbox capabilities", () => {
  it("offers Archive and Mark as spam for a mailbox that supports both", async () => {
    accounts = [makeAccount("acc-1")];
    const user = await renderReader();
    expect(await screen.findByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(await menuItems(user)).toEqual(["Mark as unread", "Mark as spam"]);
  });

  it("hides Archive and Mark as spam for a mailbox without those folders", async () => {
    accounts = [makeAccount("acc-1", { archive: false, spam: false }, { provider: "imap" }), makeAccount("acc-2")];
    const user = await renderReader();
    // Wait for something that proves the accounts were applied before asserting absence.
    await waitFor(() => expect(screen.getByRole("button", { name: "Move to trash" })).toBeInTheDocument());
    await waitFor(() => expect(fetchMock.mock.results.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Star" })).toBeInTheDocument();
    expect(await menuItems(user)).toEqual(["Mark as unread"]);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/v1/threads/t1/actions")).toBe(false);
  });

  it("decides each action on its own capability", async () => {
    accounts = [makeAccount("acc-1", { spam: false }, { provider: "imap" })];
    const user = await renderReader();
    expect(await screen.findByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(await menuItems(user)).toEqual(["Mark as unread"]);
  });

  it("hides the way back out of Archive and Spam as well", async () => {
    accounts = [makeAccount("acc-1", { archive: false, spam: false }, { provider: "imap" })];
    const user = await renderReader("spam");
    expect(await menuItems(user)).toEqual(["Mark as unread"]);
  });

  it("offers Move to inbox in the archive only when the mailbox can archive", async () => {
    accounts = [makeAccount("acc-1")];
    await renderReader("archive");
    expect(await screen.findByRole("button", { name: "Move to inbox" })).toBeInTheDocument();
  });

  it("does not offer capability-bound actions for a mailbox it does not know", async () => {
    accounts = [makeAccount("someone-else")];
    const user = await renderReader();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(await menuItems(user)).toEqual(["Mark as unread"]);
  });
});

describe("ThreadReader remote images", () => {
  it("shows remote images by default", async () => {
    accounts = [makeAccount("acc-1")];
    await renderReader();
    expect(await screen.findByTestId("message")).toHaveAttribute("data-images", "true");
  });

  it("keeps them hidden for a user who turned them off", async () => {
    accounts = [makeAccount("acc-1")];
    userSettings.data = { load_remote_images: false };
    await renderReader();
    expect(await screen.findByTestId("message")).toHaveAttribute("data-images", "false");
  });

  it("keeps them hidden while settings have not loaded or failed to load", async () => {
    accounts = [makeAccount("acc-1")];
    userSettings.data = undefined;
    await renderReader();
    expect(await screen.findByTestId("message")).toHaveAttribute("data-images", "false");
  });
});
