import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "@/infrastructure/authentication";
import { renderWithProviders } from "@/test/render";
import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
// The Google button has its own tests; here it would add a provider lookup to the fetch log.
vi.mock("./google-sign-in", () => ({ GoogleSignIn: () => null }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => vi.unstubAllGlobals());

describe("LoginForm", () => {
  it("shows translated validation errors and does not call the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("This field is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs in and stores the user as the current session", async () => {
    const user = userEvent.setup();
    const account = { id: "u1", email: "olena@example.com", display_name: "Olena", email_verified: true, created_at: "2026-01-01T00:00:00Z" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: account }), { status: 200 }));
    const { queryClient } = renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "olena@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(queryClient.getQueryData(sessionQueryKey)).toEqual(account));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/login");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "olena@example.com", password: "correct-horse-battery" });
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("token");
  });

  it("explains a rejected sign-in without revealing which field was wrong", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "invalid_credentials", message: "x" } }), { status: 401 }),
    );
    renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "olena@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The email or password is incorrect.");
  });

  it("offers to resend the verification email when the address is unverified", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "email_not_verified", message: "x" } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    renderWithProviders(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "whatever-123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: "Send a new verification email" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/resend-verification");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ email: "new@example.com" });
  });
});
