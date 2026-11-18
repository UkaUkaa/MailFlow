import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/shared/components/layout/app-shell";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { makeAccount } from "@/test/accounts";
import { renderWithProviders } from "@/test/render";
import { Navigation } from "./navigation";

const compose = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ view: "inbox" }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string | { pathname: string }; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : href.pathname} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/mail/inbox",
  useRouter: () => ({ replace }),
}));
vi.mock("@/modules/composer", () => ({ useComposer: () => ({ compose, reply: vi.fn(), editDraft: vi.fn(), isOpen: false }) }));
vi.mock("@/infrastructure/theme", () => ({ useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme: vi.fn() }) }));

const fetchMock = vi.fn<typeof fetch>();
let scheduled: Record<string, unknown>[];
const scheduledSend = (id: string, accountId: string) => ({
  id,
  account_id: accountId,
  status: "pending",
  send_at: "2099-01-01T08:00:00Z",
  created_at: "2026-11-18T09:00:00Z",
  subject: "Later",
  to: [],
  cc: [],
  bcc: [],
  snippet: "",
  attachment_count: 0,
  mode: "new",
  error_code: null,
});

beforeEach(() => {
  compose.mockReset();
  scheduled = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    const items = url.startsWith("/api/v1/outbox")
      ? scheduled
      : url.startsWith("/api/v1/accounts")
      ? [makeAccount("acc-1", {}, { display_name: "Personal" })]
      : url.startsWith("/api/v1/folders/counts")
        ? [{ role: "inbox", unread_count: 3 }]
        : [];
    return new Response(JSON.stringify({ items, next_cursor: null }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderNavigation() {
  return renderWithProviders(
    <TooltipProvider delayDuration={0}>
      <AppShell navigation={(variant) => <Navigation variant={variant} />} bottomNav={null} drawerTitle="Navigation" closeLabel="Close">
        <p>content</p>
      </AppShell>
    </TooltipProvider>,
  );
}

/** Accessible names of every control of the column, top to bottom. */
function elements(): HTMLElement[] {
  return Array.from((document.querySelector("aside") as HTMLElement).querySelectorAll<HTMLElement>("a, button"));
}
function controls(): string[] {
  return elements().map((element) => element.getAttribute("aria-label") ?? element.textContent ?? "");
}

describe("Navigation column", () => {
  it("has the same controls, in the same order and with the same names, collapsed and expanded", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await screen.findByRole("link", { name: "Personal" });
    await screen.findByRole("link", { name: "Inbox, 3 unread" });
    const collapsed = controls();
    expect(collapsed).toEqual([
      "Expand menu",
      "Compose",
      "Inbox, 3 unread",
      "Starred",
      "Sent",
      "Scheduled",
      "Drafts",
      "Archive",
      "Trash",
      "Spam",
      "All accounts",
      "Personal",
      "Switch language to Українська",
      "Switch theme to Light",
      "Settings",
    ]);
    const nodes = elements();

    await user.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(controls()).toEqual(["Collapse menu", ...collapsed.slice(1)]);
    // The very same elements: expanding re-labels the toggle and reveals text, nothing else.
    expect(elements()).toEqual(nodes);
  });

  it("keeps focus on the toggle and flips aria-expanded", async () => {
    const user = userEvent.setup();
    renderNavigation();
    const toggle = screen.getByRole("button", { name: "Expand menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Collapse menu");
    await user.keyboard(" ");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows every row's label text in the row itself, with the current language and theme", async () => {
    renderNavigation();
    const aside = within(document.querySelector("aside") as HTMLElement);
    expect(aside.getByRole("button", { name: "Compose" })).toHaveTextContent("Compose");
    expect(aside.getByRole("link", { name: "Settings" })).toHaveTextContent("Settings");
    expect(aside.getByRole("button", { name: "Switch language to Українська" })).toHaveTextContent("Language: English");
    expect(aside.getByRole("button", { name: "Switch theme to Light" })).toHaveTextContent("Theme: System");
    expect(await aside.findByRole("link", { name: "Inbox, 3 unread" })).toHaveTextContent("Inbox3");
  });

  it("has tooltips only while collapsed", async () => {
    const user = userEvent.setup();
    renderNavigation();
    const settings = screen.getByRole("link", { name: "Settings" });
    await user.hover(settings);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Settings");
    await user.unhover(settings);

    await user.click(screen.getByRole("button", { name: "Expand menu" }));
    await user.hover(settings);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("counts the scheduled sends on the Scheduled row", async () => {
    scheduled = [scheduledSend("out-1", "acc-1"), scheduledSend("out-2", "acc-2")];
    renderNavigation();
    const row = await screen.findByRole("link", { name: "Scheduled, 2 messages" });
    expect(row).toHaveAttribute("href", "/mail/scheduled");
    expect(row).toHaveTextContent("Scheduled2");
  });

  it("composes from its row", async () => {
    renderNavigation();
    await userEvent.setup().click(screen.getByRole("button", { name: "Compose" }));
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(1));
  });
});
