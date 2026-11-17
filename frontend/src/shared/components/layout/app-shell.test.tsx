import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell, useShell } from "./app-shell";

function Rail() {
  const shell = useShell();
  return (
    <button type="button" aria-expanded={shell.flyoutOpen} onClick={shell.openFlyout}>
      More
    </button>
  );
}

function Sidebar({ variant }: { variant: string }) {
  const shell = useShell();
  return (
    <nav aria-label={`sidebar ${variant}`}>
      <button type="button" onClick={shell.togglePinned}>
        {shell.pinned ? "Unpin" : "Pin"}
      </button>
      <a href="#sent" aria-current="page" onClick={shell.closeNavigation}>
        Sent
      </a>
      <a href="#trash" onClick={shell.closeNavigation}>
        Trash
      </a>
    </nav>
  );
}

function renderShell() {
  return render(
    <AppShell rail={<Rail />} sidebar={(variant) => <Sidebar variant={variant} />} bottomNav={null} drawerTitle="Navigation" closeLabel="Close">
      <p>content</p>
    </AppShell>,
  );
}

afterEach(() => window.localStorage.clear());

describe("AppShell rail and flyout", () => {
  it("shows the rail by default and opens the navigation as a dialog with focus inside", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    await user.keyboard("{Enter}");
    const flyout = await screen.findByRole("dialog", { name: "Navigation" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    // Focus starts on the open view, not on a button with a tooltip.
    await waitFor(() => expect(screen.getByRole("link", { name: "Sent" })).toHaveFocus());
    expect(flyout).toContainElement(document.activeElement as HTMLElement);
  });

  it("keeps Tab inside the flyout", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "More" }));
    const flyout = await screen.findByRole("dialog", { name: "Navigation" });
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(flyout).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes on Escape and gives focus back to the button that opened it", async () => {
    const user = userEvent.setup();
    renderShell();
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    await screen.findByRole("dialog", { name: "Navigation" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when a destination is chosen", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("link", { name: "Trash" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("pins the sidebar in place of the rail and remembers it", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("button", { name: "Pin" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: "sidebar pinned" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("mf-sidebar")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Unpin" }));
    expect(await screen.findByRole("button", { name: "More" })).toBeInTheDocument();
    expect(window.localStorage.getItem("mf-sidebar")).toBe("true");
  });

  it("starts pinned when the stored preference says so", () => {
    window.localStorage.setItem("mf-sidebar", "false");
    renderShell();
    expect(screen.getByRole("navigation", { name: "sidebar pinned" })).toBeInTheDocument();
  });
});
