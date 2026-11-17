import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/modules/accounts";
import { makeAccount } from "@/test/accounts";
import { renderWithProviders } from "@/test/render";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { FolderNav } from "./folder-nav";

const route = vi.hoisted(() => ({ view: "inbox", account: null as string | null }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ view: route.view }),
  useSearchParams: () => new URLSearchParams(route.account ? { account: route.account } : {}),
}));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: { pathname: string }; children: React.ReactNode }) => (
    <a href={href.pathname} {...props}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn<typeof fetch>();
let accounts: Account[];
const gmail = makeAccount("gmail");
const bareImap = makeAccount("imap", { archive: false, spam: false, drafts: false }, { provider: "imap" });

beforeEach(() => {
  route.view = "inbox";
  route.account = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const items = String(input).startsWith("/api/v1/accounts") ? accounts : [];
    return new Response(JSON.stringify({ items, next_cursor: null }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const names = () => screen.getAllByRole("link").map((link) => link.textContent);
const ALL = ["Inbox", "Starred", "Sent", "Drafts", "Archive", "Trash", "Spam"];

describe("FolderNav", () => {
  it("lists every view when the selected mailbox has all folders", async () => {
    accounts = [gmail, bareImap];
    route.account = "gmail";
    renderWithProviders(<TooltipProvider><FolderNav /></TooltipProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(names()).toEqual(ALL);
  });

  it("leaves out Drafts, Archive and Spam for a mailbox without those folders", async () => {
    accounts = [gmail, bareImap];
    route.account = "imap";
    renderWithProviders(<TooltipProvider><FolderNav /></TooltipProvider>);
    await waitFor(() => expect(names()).toEqual(["Inbox", "Starred", "Sent", "Trash"]));
  });

  it("keeps a view in the unified inbox while any mailbox has it", async () => {
    accounts = [gmail, bareImap];
    renderWithProviders(<TooltipProvider><FolderNav /></TooltipProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(names()).toEqual(ALL);
  });

  it("hides a view in the unified inbox when no mailbox has it, but never the open one", async () => {
    accounts = [bareImap];
    route.view = "archive";
    renderWithProviders(<TooltipProvider><FolderNav /></TooltipProvider>);
    await waitFor(() => expect(names()).toEqual(["Inbox", "Starred", "Sent", "Archive", "Trash"]));
  });
});
