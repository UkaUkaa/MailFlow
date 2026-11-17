"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { SheetContent } from "@/shared/components/ui/dialog";

export type SidebarMode = "auto" | "true" | "false";
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
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  sidebarMode: SidebarMode;
  toggleSidebar: () => void;
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
 * - Tablet / laptop: icon rail (user-expandable) + content.
 * - Desktop (xl+): full sidebar + content.
 * Which variant shows is decided by CSS; this component only holds the state.
 */
export function AppShell({
  sidebar,
  bottomNav,
  drawerTitle,
  closeLabel,
  children,
}: {
  closeLabel: string;
  sidebar: (variant: "sidebar" | "drawer") => ReactNode;
  bottomNav: ReactNode;
  drawerTitle: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarMode = useSyncExternalStore(subscribe, readMode, () => "auto" as const);

  const toggleSidebar = useCallback(() => {
    const current = readMode();
    const expanded = current === "false" || (current === "auto" && window.matchMedia("(min-width: 80rem)").matches);
    try {
      window.localStorage.setItem(STORAGE_KEY, expanded ? "true" : "false");
    } catch {
      // Preference is not persisted when storage is unavailable.
    }
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      sidebarMode,
      toggleSidebar,
    }),
    [drawerOpen, sidebarMode, toggleSidebar],
  );

  return (
    <ShellContext value={value}>
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background md:flex-row">
        <aside
          data-collapsed={sidebarMode}
          className="mf-sidebar hidden shrink-0 flex-col border-r border-border bg-surface pl-[env(safe-area-inset-left,0px)] md:flex"
        >
          {sidebar("sidebar")}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
        {bottomNav}
      </div>
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" aria-describedby={undefined} closeLabel={closeLabel} className="bg-surface md:hidden">
          <DialogPrimitive.Title className="sr-only">{drawerTitle}</DialogPrimitive.Title>
          <div data-variant="drawer" className="mf-sidebar flex min-h-0 flex-1 flex-col">
            {sidebar("drawer")}
          </div>
        </SheetContent>
      </DialogPrimitive.Root>
    </ShellContext>
  );
}
