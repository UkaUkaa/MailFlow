"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SheetContent } from "@/shared/components/ui/dialog";

/** Stored preference: `"false"` = the sidebar is pinned open; anything else = icon rail. */
export type SidebarMode = "auto" | "true" | "false";
export type SidebarVariant = "pinned" | "flyout" | "drawer";
const STORAGE_KEY = "mf-sidebar";
const listeners = new Set<() => void>();

function readMode(): SidebarMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "true" || stored === "false" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface ShellContextValue {
  /** Phone drawer. */
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** Flyout sidebar next to the rail (tablet and wider). */
  flyoutOpen: boolean;
  openFlyout: () => void;
  /** Closes whichever temporary navigation surface is open. */
  closeNavigation: () => void;
  /** The user keeps the full sidebar open instead of the rail. */
  pinned: boolean;
  togglePinned: () => void;
  /** Takes the navigation out of the tab order while a modal surface covers the app. */
  setNavigationInert: (inert: boolean) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside AppShell");
  return value;
}

/**
 * Application frame.
 * - Phone: content + bottom navigation; navigation lives in a slide-out drawer.
 * - Tablet and wider: a narrow icon rail. Its "more" button opens the full navigation as a
 *   flyout over the list pane; the user can pin that sidebar open instead of the rail.
 * Phone vs. wider is decided by CSS; this component only holds the state.
 */
export function AppShell({
  rail,
  sidebar,
  bottomNav,
  drawerTitle,
  closeLabel,
  children,
}: {
  closeLabel: string;
  rail: ReactNode;
  sidebar: (variant: SidebarVariant) => ReactNode;
  bottomNav: ReactNode;
  drawerTitle: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [navigationInert, setNavigationInert] = useState(false);
  const sidebarMode = useSyncExternalStore(subscribe, readMode, () => "auto" as const);
  const pinned = sidebarMode === "false";

  // The drawer and the flyout are opened from buttons that are not Radix triggers, so the
  // element to give focus back to on close is remembered here.
  const openerRef = useRef<HTMLElement | null>(null);
  const rememberOpener = () => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = (event: Event) => {
    const opener = openerRef.current;
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  };

  const togglePinned = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, readMode() === "false" ? "true" : "false");
    } catch {
      // Preference is not persisted when storage is unavailable.
    }
    setFlyoutOpen(false);
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      drawerOpen,
      openDrawer: () => {
        rememberOpener();
        setDrawerOpen(true);
      },
      closeDrawer: () => setDrawerOpen(false),
      flyoutOpen,
      openFlyout: () => {
        rememberOpener();
        setFlyoutOpen(true);
      },
      closeNavigation: () => {
        setDrawerOpen(false);
        setFlyoutOpen(false);
      },
      pinned,
      togglePinned,
      setNavigationInert,
    }),
    [drawerOpen, flyoutOpen, pinned, togglePinned],
  );

  return (
    <ShellContext value={value}>
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background md:flex-row">
        <aside
          data-pinned={pinned}
          inert={navigationInert}
          className="mf-sidebar hidden shrink-0 flex-col pl-[env(safe-area-inset-left,0px)] md:flex data-[pinned=false]:bg-rail data-[pinned=true]:bg-surface"
        >
          {pinned ? sidebar("pinned") : rail}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
        {bottomNav}
      </div>
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          closeLabel={closeLabel}
          onCloseAutoFocus={restoreFocus}
          className="bg-surface md:hidden"
        >
          <DialogPrimitive.Title className="sr-only">{drawerTitle}</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col">{sidebar("drawer")}</div>
        </SheetContent>
      </DialogPrimitive.Root>
      {/* Modal for focus (trap, Escape, focus return) but without a backdrop: it is a panel, not a dialog box. */}
      <DialogPrimitive.Root open={flyoutOpen && !pinned} onOpenChange={setFlyoutOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            // Focus starts on the open view (or the panel itself), not on the first button:
            // a focused button would show its tooltip, and Escape would close that first.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const panel = event.currentTarget as HTMLElement;
              (panel.querySelector<HTMLElement>('nav a[aria-current="page"]') ?? panel).focus();
            }}
            onCloseAutoFocus={restoreFocus}
            // Radix gives Escape only to the topmost layer, so an open tooltip of a focused
            // button would take it and leave the panel open. Close on the key itself.
            onKeyDown={(event) => {
              if (event.key === "Escape") setFlyoutOpen(false);
            }}
            className="fixed inset-y-0 left-[var(--nav-offset)] z-50 flex w-60 max-w-[calc(100vw-var(--nav-offset))] flex-col border-r border-border bg-surface shadow-lg outline-none data-[state=open]:animate-flyout-in max-md:hidden"
          >
            <DialogPrimitive.Title className="sr-only">{drawerTitle}</DialogPrimitive.Title>
            {sidebar("flyout")}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ShellContext>
  );
}
