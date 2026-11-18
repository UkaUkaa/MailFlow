"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { QueryProvider } from "@/infrastructure/api-client";
import { ThemeProvider, useTheme } from "@/infrastructure/theme";
import { UserTimeSync } from "@/shared/components/user-time-sync";
import { TooltipProvider } from "@/shared/components/ui/tooltip";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-center"
      offset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)" }}
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)" }}
      toastOptions={{
        style: {
          background: "var(--surface-raised)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          boxShadow: "var(--elev-sm)",
          fontFamily: "inherit",
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <TooltipProvider delayDuration={400} skipDelayDuration={200}>
          <UserTimeSync />
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
