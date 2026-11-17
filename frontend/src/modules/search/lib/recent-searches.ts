"use client";

import { useSyncExternalStore } from "react";

/**
 * Recent queries of this browser tab. Deliberately in memory only: search terms can be
 * sensitive, so they are never written to localStorage and disappear on reload or sign-out.
 */
const MAX_RECENT = 6;
let recent: readonly string[] = [];
const listeners = new Set<() => void>();
const EMPTY: readonly string[] = [];

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function addRecentSearch(query: string): void {
  const value = query.trim();
  if (!value) return;
  recent = [value, ...recent.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, MAX_RECENT);
  emit();
}

export function clearRecentSearches(): void {
  recent = [];
  emit();
}

export function getRecentSearches(): readonly string[] {
  return recent;
}

export function useRecentSearches(): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRecentSearches,
    () => EMPTY,
  );
}
