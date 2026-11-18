"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SheetContent } from "@/shared/components/ui/dialog";
import { NAV_STORAGE_KEY } from "./nav-state";

export type NavigationVariant = "aside" | "drawer";
const listeners = new Set<() => void>();

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(NAV_STORAGE_KEY) === "false";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `<html data-nav>` is what the style sheet sizes the column from (see `globals.css`). */
function reflect(expanded: boolean): void {
  document.documentElement.dataset.nav = expanded ? "expanded" : "collapsed";
}

interface ShellContextValue {
  /** Phone drawer. */
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** Closes the temporary navigation surface (the phone drawer) after a destination is chosen. */
  closeNavigation: () => void;
  /** The navigation column is expanded (labels visible) instead of the icon rail. */
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
 * - Phone: content + bottom navigation; the navigation lives in a slide-out drawer.
 * - Tablet and wider: one navigation column that is either collapsed (70px icon rail) or
 *   expanded (240px, labels visible). It is the same element and the same content in both
 *   states; the width comes from CSS (`--nav-width`, driven by `<html data-nav>`), which an
 *   inline script sets before first paint, so a stored choice never flashes.
 * Phone vs. wider is decided by CSS; this component only holds the state.
 */
export function AppShell({
  navigation,
  bottomNav,
  drawerTitle,
  closeLabel,
  children,
}: {
  closeLabel: string;
  navigation: (variant: NavigationVariant) => ReactNode;
  bottomNav: ReactNode;
  drawerTitle: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navigationInert, setNavigationInert] = useState(false);
  const pinned = useSyncExternalStore(subscribe, readExpanded, () => false);

  useEffect(() => {
    // Read from storage, not from `pinned`: during hydration that still holds the server's
    // value, and writing it here would undo the inline script and replay the expansion.
    reflect(readExpanded());
    // Width changes animate only from now on: nothing may slide while the page first loads.
    document.documentElement.dataset.navReady = "";
  }, []);

  // The drawer is opened from a button that is not a Radix trigger, so the element to give
  // focus back to on close is remembered here.
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocus = (event: Event) => {
    const opener = openerRef.current;
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  };

  const togglePinned = useCallback(() => {
    const next = !readExpanded();
    try {
      window.localStorage.setItem(NAV_STORAGE_KEY, next ? "false" : "true");
    } catch {
      // Preference is not persisted when storage is unavailable.
    }
    reflect(next);
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      drawerOpen,
      openDrawer: () => {
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setDrawerOpen(true);
      },
      closeDrawer: () => setDrawerOpen(false),
      closeNavigation: () => setDrawerOpen(false),
      pinned,
      togglePinned,
      setNavigationInert,
    }),
    [drawerOpen, pinned, togglePinned],
  );

  return (
    <ShellContext value={value}>
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background md:flex-row">
        <aside
          data-pinned={pinned}
          inert={navigationInert}
          className="mf-sidebar hidden shrink-0 flex-col overflow-hidden bg-rail pl-[env(safe-area-inset-left,0px)] md:flex"
        >
          {navigation("aside")}
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
          <div className="flex min-h-0 flex-1 flex-col">{navigation("drawer")}</div>
        </SheetContent>
      </DialogPrimitive.Root>
    </ShellContext>
  );
}
