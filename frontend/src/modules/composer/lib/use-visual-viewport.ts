"use client";

import { useEffect, type RefObject } from "react";

/**
 * Publishes the visual viewport (the area not covered by the on-screen
 * keyboard) as CSS variables on the element, so a full-screen sheet can size
 * itself to the visible area and keep its controls above the keyboard.
 */
export function useVisualViewportVars(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = ref.current;
    if (!viewport || !element) return;
    const update = () => {
      element.style.setProperty("--vvh", `${viewport.height}px`);
      element.style.setProperty("--vvt", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [ref]);
}
