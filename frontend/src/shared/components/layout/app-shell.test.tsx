import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell, useShell } from "./app-shell";
import { NAV_STORAGE_KEY, navInitScript } from "./nav-state";

function Navigation({ variant }: { variant: string }) {
  const shell = useShell();
  return (
    <nav aria-label={`navigation ${variant}`}>
      <button type="button" aria-expanded={shell.pinned} onClick={shell.togglePinned}>
        {shell.pinned ? "Collapse menu" : "Expand menu"}
      </button>
      <a href="#sent" onClick={shell.closeNavigation}>
        Sent
      </a>
    </nav>
  );
}

function Opener() {
  const shell = useShell();
  return (
    <button type="button" onClick={shell.openDrawer}>
      Open navigation
    </button>
  );
}

function renderShell() {
  return render(
    <AppShell navigation={(variant) => <Navigation variant={variant} />} bottomNav={null} drawerTitle="Navigation" closeLabel="Close">
      <Opener />
    </AppShell>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.nav;
  delete document.documentElement.dataset.navReady;
});

describe("AppShell navigation column", () => {
  it("is one element in both states: toggling keeps the same nodes and the focus on the toggle", async () => {
    const user = userEvent.setup();
    renderShell();
    const column = screen.getByRole("navigation", { name: "navigation aside" });
    const aside = column.parentElement as HTMLElement;
    const toggle = screen.getByRole("button", { name: "Expand menu" });
    expect(aside).toHaveAttribute("data-pinned", "false");
    await waitFor(() => expect(document.documentElement.dataset.nav).toBe("collapsed"));

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(aside).toHaveAttribute("data-pinned", "true");
    expect(document.documentElement.dataset.nav).toBe("expanded");
    expect(window.localStorage.getItem(NAV_STORAGE_KEY)).toBe("false");
    // Same DOM nodes: nothing was swapped for another tree.
    expect(screen.getByRole("navigation", { name: "navigation aside" })).toBe(column);
    expect(screen.getByRole("button", { name: "Collapse menu" })).toBe(toggle);
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Enter}");
    expect(aside).toHaveAttribute("data-pinned", "false");
    expect(document.documentElement.dataset.nav).toBe("collapsed");
    expect(window.localStorage.getItem(NAV_STORAGE_KEY)).toBe("true");
    expect(toggle).toHaveFocus();
  });

  it("starts expanded when the stored preference says so, and only then enables the width animation", async () => {
    window.localStorage.setItem(NAV_STORAGE_KEY, "false");
    renderShell();
    expect(screen.getByRole("button", { name: "Collapse menu" })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.navReady).toBe(""));
    expect(document.documentElement.dataset.nav).toBe("expanded");
  });

  it("has a script that applies the stored state before the first paint", () => {
    const run = () => new Function(navInitScript)();
    run();
    expect(document.documentElement.dataset.nav).toBe("collapsed");
    window.localStorage.setItem(NAV_STORAGE_KEY, "false");
    run();
    expect(document.documentElement.dataset.nav).toBe("expanded");
    window.localStorage.setItem(NAV_STORAGE_KEY, "true");
    run();
    expect(document.documentElement.dataset.nav).toBe("collapsed");
  });

  it("makes the navigation inert on request", async () => {
    function Inert() {
      const shell = useShell();
      return (
        <button type="button" onClick={() => shell.setNavigationInert(true)}>
          Cover
        </button>
      );
    }
    render(
      <AppShell navigation={(variant) => <Navigation variant={variant} />} bottomNav={null} drawerTitle="Navigation" closeLabel="Close">
        <Inert />
      </AppShell>,
    );
    const aside = screen.getByRole("navigation", { name: "navigation aside" }).parentElement as HTMLElement;
    expect(aside).not.toHaveAttribute("inert");
    await userEvent.setup().click(screen.getByRole("button", { name: "Cover" }));
    expect(aside).toHaveAttribute("inert");
  });
});

describe("AppShell phone drawer", () => {
  it("opens the same navigation as a dialog, closes on a destination and returns focus", async () => {
    const user = userEvent.setup();
    renderShell();
    const opener = screen.getByRole("button", { name: "Open navigation" });
    await user.click(opener);
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(drawer).toContainElement(screen.getByRole("navigation", { name: "navigation drawer" }));
    await user.click(screen.getByRole("link", { name: "Sent" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    renderShell();
    const opener = screen.getByRole("button", { name: "Open navigation" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Navigation" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
