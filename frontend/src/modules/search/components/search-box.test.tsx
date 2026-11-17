import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rememberMailLocation } from "@/shared/lib/mail-location";
import { renderWithProviders } from "@/test/render";
import { clearRecentSearches, getRecentSearches } from "../lib/recent-searches";
import { SearchBox } from "./search-box";
import { SearchSuggestions } from "./search-suggestions";

const push = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.query) }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  push.mockReset();
  route.query = "";
  clearRecentSearches();
});

describe("search mode", () => {
  it("puts the query in the URL, keeps the mailbox filter and remembers the query for this session", async () => {
    route.query = "account=acc-1";
    renderWithProviders(<SearchBox />);
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Search mail" }), "  invoice {Enter}");
    expect(push).toHaveBeenCalledWith("/mail/search?q=invoice&account=acc-1");
    expect(getRecentSearches()).toEqual(["invoice"]);
  });

  it("does not search for nothing", async () => {
    renderWithProviders(<SearchBox />);
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Search mail" }), "   {Enter}");
    expect(push).not.toHaveBeenCalled();
  });

  it("returns to the list the user came from on Escape", async () => {
    rememberMailLocation("sent", undefined, new URLSearchParams("account=acc-2"));
    rememberMailLocation("search", undefined, new URLSearchParams("q=old&account=acc-2"));
    renderWithProviders(<SearchBox />);
    screen.getByRole("searchbox", { name: "Search mail" }).focus();
    await userEvent.setup().keyboard("{Escape}");
    expect(push).toHaveBeenCalledWith("/mail/sent?account=acc-2");
  });

  it("clears back to the suggestions and keeps typing possible", async () => {
    route.query = "q=invoice";
    renderWithProviders(<SearchBox />);
    const input = screen.getByRole("searchbox", { name: "Search mail" });
    expect(input).toHaveValue("invoice");
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear search" }));
    expect(push).toHaveBeenCalledWith("/mail/search");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("suggests only what works: recent queries and a description, no operators", async () => {
    renderWithProviders(
      <>
        <SearchBox />
        <SearchSuggestions />
      </>,
    );
    expect(screen.queryByRole("region", { name: "Recent searches" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Search by words" })).toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Search mail" }), "planning{Enter}");
    const link = await screen.findByRole("link", { name: "Search for planning" });
    expect(link).toHaveAttribute("href", "/mail/search?q=planning");
    expect(screen.queryByRole("link", { name: /from:|has:|subject:|is:/ })).not.toBeInTheDocument();
  });
});
