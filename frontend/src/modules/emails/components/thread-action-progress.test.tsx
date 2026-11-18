import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { THREAD_ACTION_KEY, type ActionVariables } from "../api";
import { ThreadActionProgress } from "./thread-action-progress";

vi.mock("@/infrastructure/i18n/navigation", () => ({}));

function startAction(queryClient: ReturnType<typeof renderWithProviders>["queryClient"], variables: ActionVariables) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const mutation = queryClient.getMutationCache().build(queryClient, { mutationKey: THREAD_ACTION_KEY, mutationFn: () => done });
  void act(() => mutation.execute(variables));
  return () => act(async () => {
    finish();
    await done;
  });
}

describe("ThreadActionProgress", () => {
  afterEach(() => vi.clearAllMocks());

  it("blocks the app with the running action and its count until the server answers", async () => {
    const { queryClient } = renderWithProviders(<ThreadActionProgress />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const finish = startAction(queryClient, { threadIds: ["a", "b", "c"], action: "trash" });
    const dialog = await screen.findByRole("dialog", { name: "Moving 3 conversations to trash…" });
    expect(dialog).toHaveAttribute("aria-busy", "true");

    await finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays out of the way of background actions", async () => {
    const { queryClient } = renderWithProviders(<ThreadActionProgress />);
    startAction(queryClient, { threadIds: ["a"], action: "mark_read", silent: true });
    await act(() => Promise.resolve());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
