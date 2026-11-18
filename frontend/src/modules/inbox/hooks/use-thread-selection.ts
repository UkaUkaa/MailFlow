"use client";

import { useCallback, useMemo, useState } from "react";
import type { ThreadSummary } from "@/modules/emails";

/**
 * Multi-selection over the loaded conversations. `resetKey` identifies the list (view,
 * mailbox, filter): changing it drops the selection. Ids that are no longer loaded (the
 * conversation was archived or moved by sync) are ignored, so `selected` is always a subset of
 * `threads`.
 */
export function useThreadSelection(threads: readonly ThreadSummary[], resetKey: string) {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    // Adjusting state during render (not in an effect) avoids a frame with the old selection.
    setKey(resetKey);
    setActive(false);
    setIds(new Set());
  }

  const selected = useMemo(() => threads.filter((thread) => ids.has(thread.id)), [threads, ids]);

  const start = useCallback((threadId?: string) => {
    setActive(true);
    setIds(threadId ? new Set([threadId]) : new Set());
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setIds(new Set());
  }, []);

  const toggle = useCallback(
    (threadId: string) => {
      setIds((current) => {
        const next = new Set(current);
        if (next.has(threadId)) next.delete(threadId);
        else next.add(threadId);
        return next;
      });
    },
    [],
  );

  const allSelected = threads.length > 0 && selected.length === threads.length;
  const toggleAll = useCallback(() => {
    setIds(allSelected ? new Set() : new Set(threads.map((thread) => thread.id)));
  }, [allSelected, threads]);

  return { active, ids, selected, allSelected, start, stop, toggle, toggleAll };
}
