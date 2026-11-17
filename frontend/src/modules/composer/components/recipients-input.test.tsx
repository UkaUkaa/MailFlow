import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "@/shared/types/address";
import { RecipientsInput } from "./recipients-input";

function Harness({ initial = [], onChange }: { initial?: Address[]; onChange?: (value: Address[]) => void }) {
  const [value, setValue] = useState<Address[]>(initial);
  return (
    <RecipientsInput
      label="To"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      removeLabel={(email) => `Remove ${email}`}
      invalidLabel="Invalid email address"
    />
  );
}

describe("RecipientsInput", () => {
  it("turns typed addresses into chips on Enter and comma", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("To");
    await user.type(input, "a@example.com{Enter}b@example.com,");
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith([
      { name: null, email: "a@example.com" },
      { name: null, email: "b@example.com" },
    ]);
  });

  it("commits the pending text on blur", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("To"), "late@example.com");
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove late@example.com" })).toBeInTheDocument();
  });

  it("splits a pasted list and ignores duplicates", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ name: null, email: "a@example.com" }]} />);
    await user.click(screen.getByLabelText("To"));
    await user.paste("a@example.com, Jane Doe <jane@example.com>");
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("flags invalid addresses instead of dropping them silently", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("To"), "not-an-email{Enter}");
    expect(screen.getByText("not-an-email")).toBeInTheDocument();
    expect(screen.getByText("Invalid email address")).toBeInTheDocument();
  });

  it("removes chips with the button and with Backspace", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ name: null, email: "a@example.com" }, { name: null, email: "b@example.com" }]} />);
    await user.click(screen.getByRole("button", { name: "Remove a@example.com" }));
    expect(screen.queryByText("a@example.com")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("To"));
    await user.keyboard("{Backspace}");
    expect(screen.queryByText("b@example.com")).not.toBeInTheDocument();
  });
});
