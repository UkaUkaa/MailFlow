"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

/**
 * A `data-*` attribute of `<html>` (as a `dataset` key), kept current. Used by code that cannot
 * be restyled with CSS alone, such as the sandboxed email frame, to follow interface
 * preferences (interface-preferences.ts). `undefined` during server rendering.
 */
export function useRootDataset(key: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset[key],
    () => undefined,
  );
}
