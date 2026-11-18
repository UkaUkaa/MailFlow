import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { AppearancePicker, type AvatarChange } from "./appearance-picker";

function Harness({ onColor, imageUrl = null }: { onColor: (color: string) => void; imageUrl?: string | null }) {
  const [color, setColor] = useState("#3355e0");
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  return (
    <>
      <AppearancePicker
        color={color}
        onColorChange={(value) => {
          setColor(value);
          onColor(value);
        }}
        currentImageUrl={imageUrl}
        avatar={avatar}
        onAvatarChange={setAvatar}
        previewLabel="Work"
      />
      <output data-testid="avatar">{avatar.kind}</output>
    </>
  );
}

describe("AppearancePicker", () => {
  it("takes a preset, any RGB colour and a typed hex code", async () => {
    const onColor = vi.fn();
    renderWithProviders(<Harness onColor={onColor} />);
    await userEvent.click(screen.getByRole("button", { name: "Colour 3" }));
    expect(onColor).toHaveBeenLastCalledWith("#1f8a4c");
    expect(screen.getByRole("button", { name: "Colour 3" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.input(screen.getByLabelText("Custom colour"), { target: { value: "#FF8800" } });
    expect(onColor).toHaveBeenLastCalledWith("#ff8800");
    expect(screen.getByLabelText("Hex code")).toHaveValue("#ff8800");

    const hex = screen.getByLabelText("Hex code");
    await userEvent.clear(hex);
    await userEvent.type(hex, "#12ab");
    expect(screen.getByText("Enter a colour such as #3355e0.")).toBeInTheDocument();
    await userEvent.type(hex, "ef");
    expect(onColor).toHaveBeenLastCalledWith("#12abef");
    expect(screen.queryByText("Enter a colour such as #3355e0.")).not.toBeInTheDocument();
  });

  it("offers to remove an existing picture", async () => {
    renderWithProviders(<Harness onColor={vi.fn()} imageUrl="/api/v1/accounts/a1/avatar?v=1" />);
    expect(screen.getByRole("button", { name: "Replace picture" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove picture" }));
    expect(screen.getByTestId("avatar")).toHaveTextContent("remove");
    expect(screen.getByRole("button", { name: "Choose picture" })).toBeInTheDocument();
  });
});
