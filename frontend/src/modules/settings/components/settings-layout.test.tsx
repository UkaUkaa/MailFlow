import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberMailLocation } from "@/shared/lib/mail-location";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { renderWithProviders } from "@/test/render";
import { SettingsLayout } from "./settings-layout";

const push = vi.hoisted(() => vi.fn());
const setNavigationInert = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ pathname: "/settings/accounts", wide: true }));

vi.mock("@/infrastructure/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => route.pathname,
  useRouter: () => ({ push }),
}));
vi.mock("@/infrastructure/authentication", () => ({
  useCurrentUser: () => ({ id: "u1", email: "olena@example.com", display_name: "Olena", email_verified: true, created_at: "" }),
}));
vi.mock("@/modules/authentication", () => ({ useLogout: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/shared/components/layout/app-shell", () => ({ useShell: () => ({ setNavigationInert }) }));

beforeEach(() => {
  push.mockReset();
  setNavigationInert.mockReset();
  route.pathname = "/settings/accounts";
  route.wide = true;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: route.wide, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  // jsdom lays nothing out; the focus trap only considers elements that have a box.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSettings() {
  return renderWithProviders(
    <TooltipProvider>
      <SettingsLayout backdrop={<p>mail behind</p>}>
        <button type="button">Section control</button>
      </SettingsLayout>
    </TooltipProvider>,
  );
}

describe("SettingsLayout as a dialog (tablet and wider)", () => {
  it("is a modal dialog over an inert mail workspace, on the section the URL names", async () => {
    renderSettings();
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("link", { name: "Connected accounts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
    const behind = screen.getByText("mail behind").parentElement;
    expect(behind).toHaveAttribute("inert");
    expect(dialog).not.toContainElement(behind);
    await waitFor(() => expect(setNavigationInert).toHaveBeenCalledWith(true));
    expect(dialog).toHaveFocus();
  });

  it("closes to the mail view the user came from, on Escape and with the close button", async () => {
    rememberMailLocation("sent", "thread-5", new URLSearchParams("account=acc-1"));
    const user = userEvent.setup();
    renderSettings();
    await user.keyboard("{Escape}");
    expect(push).toHaveBeenLastCalledWith("/mail/sent/thread-5?account=acc-1");
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the dialog in both directions", async () => {
    const user = userEvent.setup();
    renderSettings();
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const first = screen.getByRole("link", { name: "Profile" });
    const last = screen.getByRole("button", { name: "Section control" });
    last.focus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("releases the navigation when it goes away", async () => {
    const view = renderSettings();
    await waitFor(() => expect(setNavigationInert).toHaveBeenCalledWith(true));
    view.unmount();
    expect(setNavigationInert).toHaveBeenLastCalledWith(false);
  });
});

describe("SettingsLayout as pages (phone)", () => {
  it("is not a dialog, renders no workspace behind and ignores Escape", async () => {
    route.wide = false;
    renderSettings();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("mail behind")).not.toBeInTheDocument();
    expect(setNavigationInert).not.toHaveBeenCalled();
    await userEvent.setup().keyboard("{Escape}");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to settings" })).toBeInTheDocument();
  });
});
