import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tooltip, TooltipProvider } from "./tooltip";

function Harness({ disabled = false }: { disabled?: boolean }) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip label="Inbox" disabled={disabled}>
        <button type="button">target</button>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("Tooltip", () => {
  it("opens on mouse hover", async () => {
    render(<Harness />);
    fireEvent.pointerMove(screen.getByRole("button", { name: "target" }), { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Inbox");
  });

  it("does not open on focus", () => {
    render(<Harness />);
    act(() => {
      fireEvent.focus(screen.getByRole("button", { name: "target" }));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not resurface a hover that happened while it was disabled", async () => {
    const { rerender } = render(<Harness disabled />);
    const target = screen.getByRole("button", { name: "target" });

    await act(async () => {
      fireEvent.pointerMove(target, { pointerType: "mouse" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      fireEvent.pointerLeave(target, { pointerType: "mouse" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(<Harness disabled={false} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
