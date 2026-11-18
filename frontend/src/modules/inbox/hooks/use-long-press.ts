"use client";

import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

const DELAY_MS = 500;
/** A finger that moves further than this is scrolling, not pressing. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Touch and pen long-press. Mouse input is ignored: pointer devices use the explicit
 * "Select" control. The click that ends a long press is swallowed (in the capture phase, so
 * it is caught even when the pressed element was replaced while the finger was down).
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, DELAY_MS);
    },
    [cancel, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const start = origin.current;
      if (timer.current === null || !start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    },
    [cancel],
  );

  const onClickCapture = useCallback((event: MouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // The system menu (iOS callout, Android context menu) would otherwise open on a long press.
  const onContextMenu = useCallback((event: MouseEvent) => {
    if (fired.current || timer.current !== null) event.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture,
    onContextMenu,
  };
}
