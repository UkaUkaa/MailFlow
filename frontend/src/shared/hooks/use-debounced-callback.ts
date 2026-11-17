"use client";

import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
): { run: (...args: A) => void; cancel: () => void; flush: () => void } {
  const callbackRef = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const args = pending.current;
    pending.current = null;
    if (args) callbackRef.current(...args);
  }, []);

  const run = useCallback(
    (...args: A) => {
      pending.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );

  useEffect(() => cancel, [cancel]);

  return { run, cancel, flush };
}
