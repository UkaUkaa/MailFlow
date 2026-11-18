import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { GoogleSignIn } from "./google-sign-in";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  usePathname: () => "/login",
  useRouter: () => ({ replace: vi.fn() }),
}));

const fetchMock = vi.fn<typeof fetch>();

function providers(google: boolean) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ google }), { status: 200 }));
}

beforeEach(() => {
  search = new URLSearchParams();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GoogleSignIn", () => {
  it("links to the backend start endpoint with the locale and a safe return path", async () => {
    search = new URLSearchParams({ next: "/settings/accounts" });
    providers(true);
    renderWithProviders(<GoogleSignIn />);
    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute("href", "/api/v1/auth/oauth/google/start?locale=en&next=%2Fsettings%2Faccounts");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/providers");
  });

  it("drops an unsafe return path", async () => {
    search = new URLSearchParams({ next: "//evil.example" });
    providers(true);
    renderWithProviders(<GoogleSignIn />);
    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute("href", "/api/v1/auth/oauth/google/start?locale=en");
  });

  it("shows no button when Google sign-in is not configured", async () => {
    providers(false);
    const { container } = renderWithProviders(<GoogleSignIn />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("explains a failed sign-in, mapping unknown codes to a generic message", async () => {
    search = new URLSearchParams({ oauth_error: "email_not_verified" });
    providers(false);
    renderWithProviders(<GoogleSignIn />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your Google account email is not verified.");
  });

  it("never echoes an arbitrary error code", async () => {
    search = new URLSearchParams({ oauth_error: "<script>" });
    providers(false);
    renderWithProviders(<GoogleSignIn />);
    expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in failed. Please try again.");
  });
});
