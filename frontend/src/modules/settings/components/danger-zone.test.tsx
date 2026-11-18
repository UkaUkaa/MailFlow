import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { DangerZone } from "./danger-zone";

const state = vi.hoisted(() => ({
  google: true,
  search: "",
  replace: vi.fn(),
  deletes: [] as unknown[],
  posts: [] as { path: string; body: unknown }[],
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock("@/infrastructure/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => "/settings/danger",
}));
vi.mock("@/infrastructure/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/api-client")>()),
  api: {
    get: vi.fn(async () => ({ google: state.google })),
    post: vi.fn(async (path: string, _schema: unknown, body: unknown) => {
      state.posts.push({ path, body });
      return path === "/auth/oauth/google/reauth" ? { authorization_url: "https://accounts.example/auth" } : undefined;
    }),
    delete: vi.fn(async (_path: string, body: unknown) => {
      state.deletes.push(body);
    }),
  },
}));

const assign = vi.fn();

beforeEach(() => {
  state.google = true;
  state.search = "";
  state.replace.mockReset();
  state.deletes = [];
  state.posts = [];
  assign.mockReset();
  Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
});

describe("DangerZone", () => {
  it("offers Google confirmation to users with a linked Google account", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DangerZone />);
    await user.click(screen.getByRole("button", { name: "Delete account" }));

    await user.click(await screen.findByRole("button", { name: "Confirm with Google" }));

    expect(state.posts).toEqual([{ path: "/auth/oauth/google/reauth", body: { purpose: "delete", locale: "en" } }]);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.example/auth"));
  });

  it("deletes without a password after returning from Google", async () => {
    const user = userEvent.setup();
    state.search = "reauth=delete";
    renderWithProviders(<DangerZone />);

    expect(await screen.findByText("Confirmed with Google. Finish within 5 minutes.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(state.replace).toHaveBeenCalledWith("/settings/danger");

    const action = screen.getByRole("button", { name: "Delete permanently" });
    expect(action).toBeDisabled();
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(action);

    await waitFor(() => expect(state.deletes).toEqual([{ confirmation: "DELETE" }]));
  });

  it("explains a failed Google confirmation and falls back to the password", async () => {
    state.search = "reauth=deactivate&reauth_error=reauth_mismatch";
    renderWithProviders(<DangerZone />);

    expect(
      await screen.findByText("That Google account is not the one linked to your MailFlow account."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("keeps password-only confirmation when no Google account is linked", async () => {
    const user = userEvent.setup();
    state.google = false;
    renderWithProviders(<DangerZone />);
    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    await user.type(await screen.findByLabelText("Password"), "secret-password");
    expect(screen.queryByRole("button", { name: "Confirm with Google" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Deactivate account" }));

    await waitFor(() =>
      expect(state.posts).toEqual([{ path: "/users/me/deactivate", body: { password: "secret-password" } }]),
    );
  });
});
