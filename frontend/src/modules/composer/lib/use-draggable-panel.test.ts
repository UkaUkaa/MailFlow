import { describe, expect, it } from "vitest";
import { clampDelta, EDGE_MARGIN } from "./use-draggable-panel";

const viewport = { width: 1440, height: 900 };
// The docked reply at its default place: 520 × 380, 12px from the bottom-right corner.
const docked = { left: 908, top: 508, right: 1428, bottom: 888 };

describe("clampDelta", () => {
  it("allows any move that keeps the panel inside the window", () => {
    expect(clampDelta({ x: -400, y: -300 }, docked, viewport)).toEqual({ x: -400, y: -300 });
  });

  it("stops at the window edges, keeping a small margin", () => {
    expect(clampDelta({ x: -5000, y: -5000 }, docked, viewport)).toEqual({ x: EDGE_MARGIN - docked.left, y: EDGE_MARGIN - docked.top });
    expect(clampDelta({ x: 5000, y: 5000 }, docked, viewport)).toEqual({
      x: viewport.width - EDGE_MARGIN - docked.right,
      y: viewport.height - EDGE_MARGIN - docked.bottom,
    });
  });

  it("pulls a panel that ended up outside a smaller window back in", () => {
    const smaller = { width: 1100, height: 700 };
    expect(clampDelta({ x: 0, y: 0 }, docked, smaller)).toEqual({ x: 1100 - EDGE_MARGIN - 1428, y: 700 - EDGE_MARGIN - 888 });
  });

  it("keeps the top-left corner (the header) visible when the panel is larger than the window", () => {
    const tiny = { width: 400, height: 300 };
    const box = { left: 100, top: 100, right: 620, bottom: 480 };
    expect(clampDelta({ x: 0, y: 0 }, box, tiny)).toEqual({ x: EDGE_MARGIN - 100, y: EDGE_MARGIN - 100 });
  });
});
