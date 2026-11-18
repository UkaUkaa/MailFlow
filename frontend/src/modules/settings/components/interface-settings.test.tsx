import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INTERFACE } from "@/shared/lib/interface-preferences";
import { renderWithProviders } from "@/test/render";
import { InterfaceSettings } from "./interface-settings";

const server = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  patches: [] as Record<string, unknown>[],
}));

// The settings API module reaches the session helpers, which import the locale-aware router.
vi.mock("@/infrastructure/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/infrastructure/api-client", () => ({
  api: {
    get: vi.fn(async () => ({ ...server.settings })),
    patch: vi.fn(async (_path: string, _schema: unknown, body: Record<string, unknown>) => {
      server.patches.push(body);
      Object.assign(server.settings, body);
      return { ...server.settings };
    }),
  },
}));

beforeEach(() => {
  server.patches = [];
  server.settings = { locale: "en", theme: "system", load_remote_images: false, conversation_view: true, ...DEFAULT_INTERFACE };
});

describe("InterfaceSettings", () => {
  it("shows the stored choices and saves each change", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InterfaceSettings />);

    const comfortable = await screen.findByRole("button", { name: "Comfortable" });
    await waitFor(() => expect(comfortable).toHaveAttribute("aria-pressed", "true"));

    await user.click(screen.getByRole("button", { name: "Compact" }));
    await user.click(screen.getByRole("button", { name: "2 lines" }));
    await user.click(screen.getByRole("switch", { name: "Sender pictures" }));
    await user.click(screen.getByRole("button", { name: "Strong" }));
    await user.click(screen.getByRole("button", { name: "Green" }));
    await user.click(screen.getByRole("button", { name: "Large" }));

    expect(server.patches).toEqual([
      { list_density: "compact" },
      { list_preview_lines: 2 },
      { show_avatars: false },
      { account_tint: "strong" },
      { accent_color: "green" },
      { reader_text_size: "large" },
    ]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Green" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  });

  it("resets everything to the defaults, and only when something differs", async () => {
    const user = userEvent.setup();
    server.settings = { ...server.settings, accent_color: "pink", list_density: "compact" };
    renderWithProviders(<InterfaceSettings />);

    const reset = await screen.findByRole("button", { name: "Reset to defaults" });
    await waitFor(() => expect(reset).toBeEnabled());
    await user.click(reset);

    expect(server.patches).toEqual([DEFAULT_INTERFACE]);
    await waitFor(() => expect(reset).toBeDisabled());
  });
});
