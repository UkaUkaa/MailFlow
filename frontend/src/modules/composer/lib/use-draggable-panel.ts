"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export interface Offset {
  x: number;
  y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Gap kept between a moved panel and the window edge. */
export const EDGE_MARGIN = 8;
/** One arrow-key step; Shift moves four times as far. */
export const NUDGE_STEP = 16;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Limits a move of `box` by `delta` so the box stays inside the viewport. When the box is
 * larger than the viewport its top-left corner (the header with the window controls) wins.
 */
export function clampDelta(delta: Offset, box: Box, viewport: { width: number; height: number }, margin = EDGE_MARGIN): Offset {
  return {
    x: clamp(delta.x, margin - box.left, viewport.width - margin - box.right),
    y: clamp(delta.y, margin - box.top, viewport.height - margin - box.bottom),
  };
}

/** Elements inside the drag area that keep their own pointer behaviour. */
const INTERACTIVE = "button, input, textarea, select, a, [role=button], [contenteditable=true]";

const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * Lets the user move a floating panel anywhere in the window: by dragging its header (or the
 * grip in it) with a mouse, pen or finger, or with the arrow keys on the grip. The position is
 * an offset from where the panel's CSS puts it, applied with the `translate` property so it
 * does not fight an entrance animation on `transform`.
 */
export function useDraggablePanel(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ pointer: Offset; offset: Offset; box: Box } | null>(null);

  const moveBy = useCallback(
    (delta: Offset) => {
      const element = ref.current;
      if (!element) return;
      const allowed = clampDelta(delta, element.getBoundingClientRect(), viewportSize());
      if (allowed.x === 0 && allowed.y === 0) return;
      setOffset((current) => ({ x: current.x + allowed.x, y: current.y + allowed.y }));
    },
    [ref],
  );

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  // A smaller window must not leave the panel (or its close button) out of reach.
  useEffect(() => {
    if (!enabled) return;
    const keepInside = () => moveBy({ x: 0, y: 0 });
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
  }, [enabled, moveBy]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || !ref.current) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(INTERACTIVE) && !target.closest("[data-drag-handle]")) return;
    event.preventDefault();
    start.current = { pointer: { x: event.clientX, y: event.clientY }, offset, box: ref.current.getBoundingClientRect() };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const from = start.current;
    if (!from) return;
    const allowed = clampDelta({ x: event.clientX - from.pointer.x, y: event.clientY - from.pointer.y }, from.box, viewportSize());
    setOffset({ x: from.offset.x + allowed.x, y: from.offset.y + allowed.y });
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!start.current) return;
    start.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? NUDGE_STEP * 4 : NUDGE_STEP;
    const deltas: Record<string, Offset> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (event.key === "Home") {
      event.preventDefault();
      reset();
      return;
    }
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    moveBy(delta);
  };

  return {
    offset,
    dragging,
    reset,
    dragAreaProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
    handleProps: { onKeyDown: onHandleKeyDown, onDoubleClick: reset, "data-drag-handle": "" },
  };
}
