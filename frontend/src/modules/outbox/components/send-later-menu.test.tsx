import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatScheduleDate } from "@/shared/utils/format";
import { renderWithProviders } from "@/test/render";
import { SendLaterMenu } from "./send-later-menu";

// Wednesday 18 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 18, 10, 0);
const local = (day: number, hour: number) => new Date(2026, 10, day, hour, 0);

function viewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

function renderMenu() {
  const onSelect = vi.fn<(sendAt: Date) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  renderWithProviders(
    <SendLaterMenu
      title="Send later"
      confirmLabel="Schedule send"
      onSelect={onSelect}
      onOpenChange={onOpenChange}
      trigger={<button type="button">Schedule for later</button>}
    />,
  );
  return { onSelect, onOpenChange };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SendLaterMenu", () => {
  it("lists the presets with their local date and time in a bottom sheet on phones", async () => {
    viewport(true);
    const user = userEvent.setup();
    const { onSelect } = renderMenu();
    await user.click(screen.getByRole("button", { name: "Schedule for later" }));

    const sheet = within(screen.getByRole("dialog", { name: "Send later" }));
    const rows = sheet.getAllByRole("button").map((row) => row.textContent);
    expect(rows).toEqual([
      `Later today${formatScheduleDate(local(18, 18), "en", NOW)}`,
      `Tomorrow morning${formatScheduleDate(local(19, 8), "en", NOW)}`,
      `Monday morning${formatScheduleDate(local(23, 8), "en", NOW)}`,
      "Pick date & time",
    ]);

    await user.click(sheet.getByRole("button", { name: /Tomorrow morning/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(local(19, 8));
    expect(screen.queryByRole("dialog", { name: "Send later" })).not.toBeInTheDocument();
  });

  it("uses a menu from tablet up", async () => {
    viewport(false);
    const user = userEvent.setup();
    const { onSelect } = renderMenu();
    await user.click(screen.getByRole("button", { name: "Schedule for later" }));

    const menu = within(await screen.findByRole("menu"));
    expect(menu.getAllByRole("menuitem")).toHaveLength(4);
    await user.click(menu.getByRole("menuitem", { name: /Monday morning/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(local(23, 8));
  });

  it("hides the presets that make no sense at this hour", async () => {
    viewport(true);
    // Sunday evening: no "Later today", and Monday morning is tomorrow morning.
    vi.setSystemTime(new Date(2026, 10, 22, 20, 0));
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Schedule for later" }));
    const sheet = within(screen.getByRole("dialog", { name: "Send later" }));
    expect(sheet.queryByRole("button", { name: /Later today/ })).not.toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: /Monday morning/ })).not.toBeInTheDocument();
    expect(sheet.getByRole("button", { name: /Tomorrow morning/ })).toBeInTheDocument();
  });

  it("asks for an exact time, refuses the past and the far future, and reports one open state", async () => {
    viewport(true);
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = renderMenu();
    await user.click(screen.getByRole("button", { name: "Schedule for later" }));
    await user.click(screen.getByRole("button", { name: "Pick date & time" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Pick date & time" }));
    const input = dialog.getByLabelText("Date and time");
    expect(input).toHaveAttribute("type", "datetime-local");
    expect(input).toHaveAttribute("min", "2026-11-18T10:00");
    expect(input).toHaveAttribute("max", "2027-11-18T10:00");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(dialog.getByRole("button", { name: "Schedule send" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Choose a date and time.");

    fireEvent.change(input, { target: { value: "2026-11-18T09:00" } });
    await user.click(dialog.getByRole("button", { name: "Schedule send" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Choose a time in the future.");
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(input, { target: { value: "2028-01-01T09:00" } });
    await user.click(dialog.getByRole("button", { name: "Schedule send" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Choose a time within one year from now.");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "2026-12-24T07:30" } });
    await user.click(dialog.getByRole("button", { name: "Schedule send" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(new Date(2026, 11, 24, 7, 30));
    expect(screen.queryByRole("dialog", { name: "Pick date & time" })).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
