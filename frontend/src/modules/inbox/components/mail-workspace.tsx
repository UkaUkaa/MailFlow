"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { ThreadList } from "./thread-list";

/**
 * List + reader. Below the `split` breakpoint (900px) only one of them is
 * visible at a time, chosen by whether a conversation is open; from `split`
 * upwards they sit side by side. The switch is CSS-only.
 */
export function MailWorkspace({ children }: { children: ReactNode }) {
  const params = useParams<{ threadId?: string }>();
  const threadOpen = Boolean(params.threadId);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div
        className={cn(
          "min-h-0 min-w-0 flex-col border-border split:flex split:w-[340px] split:shrink-0 split:border-r xl:w-[clamp(340px,28vw,420px)]",
          threadOpen ? "hidden" : "flex w-full",
        )}
      >
        <ThreadList />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col split:flex", threadOpen ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}
