import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/infrastructure/api-client";
import en from "@/messages/en.json";
import { formatScheduleDate } from "@/shared/utils/format";
import type { ComposeSession, SendResult } from "../types";
import { useSendOutcome } from "./use-send-outcome";

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  cancel: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/modules/outbox", () => ({ cancelOutboxItem: mocks.cancel, outboxKeys: { all: ["outbox"] } }));

type ToastOptions = { id: string; duration: number; action: { label: string; onClick: () => void } };

const file = new File(["hello"], "notes.txt", { type: "text/plain" });
const snapshot: ComposeSession = {
  key: "old-key",
  mode: "reply",
  accountId: "acc-1",
  to: [{ name: "Marta", email: "marta@example.com" }],
  cc: [],
  bcc: [],
  subject: "Re: Hello",
  bodyHtml: "<p>Thanks!</p>",
  quotedHtml: "<blockquote>Hello</blockquote>",
  sourceMessageId: "m1",
  draftId: "draft-1",
  forwardAttachments: [],
  files: [file],
};
const result = (patch: Partial<SendResult>): SendResult => ({
  status: "undoable",
  message_id: null,
  thread_id: null,
  outbox_id: "out-1",
  send_at: "2026-11-18T10:00:05Z",
  undo_seconds: 5,
  ...patch,
});
const detail = { draft_id: "draft-1" };

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const reopen = vi.fn<(session: ComposeSession) => void>();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
  const hook = renderHook(() => useSendOutcome(reopen), { wrapper });
  const invalidated = () => invalidate.mock.calls.map(([filters]) => (filters?.queryKey as string[])[0]);
  return { handle: hook.result.current, reopen, invalidate, invalidated };
}

const lastToast = () => mocks.toast.mock.calls.at(-1) as [ReactElement | string, ToastOptions];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.toast.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
  mocks.cancel.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => "new-key" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSendOutcome", () => {
  it("announces a message that was sent at once", () => {
    const { handle, invalidated } = setup();
    act(() => handle(result({ status: "sent", message_id: "m9", outbox_id: null, send_at: null, undo_seconds: 0 }), snapshot));
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith("Message sent");
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(invalidated()).toEqual(["threads", "folders", "outbox"]);
  });

  it("offers Undo for the undo window, then reports the message as sent and refreshes twice", () => {
    const { handle, invalidate, invalidated, reopen } = setup();
    act(() => handle(result({}), snapshot));

    const [content, options] = lastToast();
    render(content as ReactElement);
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(options.action.label).toBe("Undo");
    expect(options.duration).toBeGreaterThanOrEqual(5_000);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(4_999));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith("Message sent", expect.objectContaining({ id: options.id, action: undefined }));
    expect(invalidated()).toEqual(["threads", "folders", "outbox"]);

    // The worker sends asynchronously: one more refresh a little later.
    act(() => vi.advanceTimersByTime(3_000));
    expect(invalidated()).toEqual(["threads", "folders", "outbox", "threads", "folders", "outbox"]);

    // Undo after the window does nothing.
    act(() => options.action.onClick());
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(reopen).not.toHaveBeenCalled();
  });

  it("cancels on Undo and reopens the composer with its exact state and a new idempotency key", async () => {
    mocks.cancel.mockResolvedValue(detail);
    const { handle, reopen } = setup();
    act(() => handle(result({}), snapshot));
    act(() => vi.advanceTimersByTime(2_000));

    await act(async () => {
      lastToast()[1].action.onClick();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("out-1");
    expect(reopen).toHaveBeenCalledExactlyOnceWith({ ...snapshot, key: "new-key", unsaved: true });
    expect(reopen.mock.calls[0]?.[0].files?.[0]).toBe(file);

    // The window's timer was stopped: the message is never reported as sent.
    act(() => vi.advanceTimersByTime(10_000));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("cancels only once when Undo is pressed twice", async () => {
    mocks.cancel.mockResolvedValue(detail);
    const { handle, reopen } = setup();
    act(() => handle(result({}), snapshot));
    await act(async () => {
      lastToast()[1].action.onClick();
      lastToast()[1].action.onClick();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("says it is too late when the message has already gone out", async () => {
    mocks.cancel.mockRejectedValue(new ApiError(409, "outbox_not_cancellable", "too late"));
    const { handle, reopen, invalidated } = setup();
    act(() => handle(result({}), snapshot));
    await act(async () => {
      lastToast()[1].action.onClick();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.toast.error).toHaveBeenCalledExactlyOnceWith("Too late — the message was already sent", expect.anything());
    expect(reopen).not.toHaveBeenCalled();
    expect(invalidated()).toEqual(["threads", "folders", "outbox"]);
  });

  it("reports any other failure to undo without reopening the composer", async () => {
    mocks.cancel.mockRejectedValue(new ApiError(0, "network_error", "offline"));
    const { handle, reopen } = setup();
    act(() => handle(result({}), snapshot));
    await act(async () => {
      lastToast()[1].action.onClick();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.toast.error).toHaveBeenCalledExactlyOnceWith("The send could not be undone. Check Scheduled or Sent.", expect.anything());
    expect(reopen).not.toHaveBeenCalled();
  });

  it("confirms a scheduled send with its time and an Undo that works the same way", async () => {
    mocks.cancel.mockResolvedValue({ draft_id: null });
    const { handle, reopen, invalidated } = setup();
    const sendAt = "2026-11-19T08:00:00Z";
    act(() => handle(result({ status: "scheduled", send_at: sendAt, undo_seconds: 0 }), snapshot));

    const [content, options] = lastToast();
    expect(content).toBe(`Send scheduled for ${formatScheduleDate(sendAt, "en")}`);
    expect(options.action.label).toBe("Undo");
    expect(invalidated()).toContain("outbox");

    // No "Message sent" follows: the message waits for its time.
    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.toast.success).not.toHaveBeenCalled();

    await act(async () => {
      options.action.onClick();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("out-1");
    // Without a draft on the server the composer keeps the one it knew.
    expect(reopen).toHaveBeenCalledExactlyOnceWith({ ...snapshot, key: "new-key", unsaved: true });
  });
});
