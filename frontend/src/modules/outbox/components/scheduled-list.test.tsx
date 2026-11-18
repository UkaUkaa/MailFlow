import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatScheduleDate } from "@/shared/utils/format";
import { renderWithProviders } from "@/test/render";
import type { OutboxDetail, OutboxItem } from "../types";
import { ScheduledList } from "./scheduled-list";

const route = vi.hoisted(() => ({ account: null as string | null }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.account ? { account: route.account } : {}),
}));
vi.mock("@/shared/components/layout/app-shell", () => ({ useShell: () => ({ openDrawer: vi.fn() }) }));

const item = (id: string, patch: Partial<OutboxItem> = {}): OutboxItem => ({
  id,
  account_id: "acc-1",
  status: "pending",
  send_at: "2099-03-02T08:00:00Z",
  created_at: "2026-11-18T09:00:00Z",
  subject: `Subject ${id}`,
  to: [{ name: "Marta Shevchenko", email: "marta@example.com" }],
  cc: [{ name: null, email: "daniel@example.com" }],
  bcc: [],
  snippet: `Snippet ${id}`,
  attachment_count: 0,
  mode: "new",
  error_code: null,
  ...patch,
});
const detailOf = (source: OutboxItem): OutboxDetail => ({
  ...source,
  status: "cancelled",
  body_html: "<p>Body</p>",
  source_message_id: null,
  draft_id: "draft-9",
  forward_attachment_ids: [],
  attachments: [],
});

const fetchMock = vi.fn<typeof fetch>();
let items: OutboxItem[];
let listStatus: number;
let cancelStatus: number;

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const callsTo = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url) === `/api/v1${path}` && (init?.method ?? "GET") === method);

beforeEach(() => {
  route.account = null;
  items = [];
  listStatus = 200;
  cancelStatus = 200;
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/v1/outbox") {
      return listStatus === 200 ? respond(200, { items }) : respond(listStatus, { error: { code: "internal_error", message: "boom" } });
    }
    const match = /^\/api\/v1\/outbox\/([^/]+)(\/cancel)?$/.exec(url);
    const target = items.find((candidate) => candidate.id === match?.[1]);
    if (match && target && method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { send_at: string };
      Object.assign(target, { send_at: body.send_at, status: "pending", error_code: null });
      return respond(200, target);
    }
    if (match && target && method === "POST" && match[2]) {
      if (cancelStatus !== 200) return respond(cancelStatus, { error: { code: "outbox_not_cancellable", message: "too late" } });
      items = items.filter((candidate) => candidate.id !== target.id);
      return respond(200, detailOf(target));
    }
    return respond(404, { error: { code: "not_found", message: "not found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  // Phone: pickers and dialogs are sheets, which jsdom can drive without layout.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  document.cookie = "mf_csrf=token; Path=/";
});
afterEach(() => vi.unstubAllGlobals());

function renderList() {
  const onReopen = vi.fn<(detail: OutboxDetail) => void>();
  renderWithProviders(<ScheduledList onReopen={onReopen} />);
  return { onReopen };
}

describe("ScheduledList", () => {
  it("shows a loading state, then an empty state when nothing is scheduled", async () => {
    renderList();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Nothing scheduled" })).toBeInTheDocument();
    expect(screen.getByText("Messages you choose to send later wait here until their time.")).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    listStatus = 500;
    const user = userEvent.setup();
    renderList();
    const alert = await screen.findByRole("alert", {}, { timeout: 5_000 });
    expect(alert).toHaveTextContent("Could not load this");
    listStatus = 200;
    items = [item("a")];
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Subject a")).toBeInTheDocument();
  });

  it("lists recipients, subject, snippet, send time and attachments, with visible actions", async () => {
    items = [item("a", { attachment_count: 2 }), item("b", { subject: "", snippet: "" })];
    renderList();
    const rows = within(await screen.findByRole("list", { name: "Scheduled" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("2 messages")).toBeInTheDocument();

    const first = within(rows[0]!);
    expect(first.getByText("To: Marta Shevchenko, daniel@example.com")).toBeInTheDocument();
    expect(first.getByText("Subject a")).toBeInTheDocument();
    expect(first.getByText("Snippet a")).toBeInTheDocument();
    expect(first.getByText(`Sends ${formatScheduleDate("2099-03-02T08:00:00Z", "en")}`)).toBeInTheDocument();
    expect(first.getByText("2 attachments")).toBeInTheDocument();
    expect(first.getByRole("button", { name: "Reschedule" })).toBeEnabled();
    expect(first.getByRole("button", { name: "Cancel send" })).toBeEnabled();

    expect(within(rows[1]!).getByText("(no subject)")).toBeInTheDocument();
    expect(within(rows[1]!).queryByText(/attachment/)).not.toBeInTheDocument();
  });

  it("explains failed sends and locks a message that is being sent", async () => {
    items = [
      item("auth", { status: "failed", error_code: "provider_auth_required" }),
      item("other", { status: "failed", error_code: "provider_unavailable" }),
      item("busy", { status: "sending" }),
    ];
    renderList();
    const rows = within(await screen.findByRole("list", { name: "Scheduled" })).getAllByRole("listitem");
    expect(within(rows[0]!).getByRole("status")).toHaveTextContent("Couldn't send. Reconnect the mailbox and retry.");
    expect(within(rows[0]!).getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(within(rows[1]!).getByRole("status")).toHaveTextContent("Couldn't send this message.");
    expect(within(rows[2]!).getByText("Sending now…")).toBeInTheDocument();
    expect(within(rows[2]!).getByRole("button", { name: "Reschedule" })).toBeDisabled();
    expect(within(rows[2]!).getByRole("button", { name: "Cancel send" })).toBeDisabled();
  });

  it("shows only the selected mailbox's sends", async () => {
    route.account = "acc-2";
    items = [item("a"), item("b", { account_id: "acc-2" })];
    renderList();
    expect(await screen.findByText("Subject b")).toBeInTheDocument();
    expect(screen.queryByText("Subject a")).not.toBeInTheDocument();
    expect(screen.getByText("1 message")).toBeInTheDocument();
  });

  it("reschedules through the send-later picker", async () => {
    items = [item("a")];
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole("button", { name: "Reschedule" }));
    const sheet = within(screen.getByRole("dialog", { name: "Reschedule send" }));
    await user.click(sheet.getByRole("button", { name: /Tomorrow morning/ }));

    await waitFor(() => expect(callsTo("PATCH", "/outbox/a")).toHaveLength(1));
    const body = JSON.parse(String(callsTo("PATCH", "/outbox/a")[0]?.[1]?.body)) as { send_at: string };
    const sendAt = new Date(body.send_at);
    expect(sendAt.getHours()).toBe(8);
    expect(sendAt.getTime()).toBeGreaterThan(Date.now());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(`Send rescheduled for ${formatScheduleDate(body.send_at, "en")}`),
    );
    expect(await screen.findByText(`Sends ${formatScheduleDate(body.send_at, "en")}`)).toBeInTheDocument();
  });

  it("cancels after a confirmation and hands the content back for the composer", async () => {
    items = [item("a")];
    const user = userEvent.setup();
    const { onReopen } = renderList();
    await user.click(await screen.findByRole("button", { name: "Cancel send" }));

    const confirm = within(screen.getByRole("dialog", { name: "Cancel this send?" }));
    await user.click(confirm.getByRole("button", { name: "Keep scheduled" }));
    expect(callsTo("POST", "/outbox/a/cancel")).toHaveLength(0);
    expect(onReopen).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel send" }));
    await user.click(within(screen.getByRole("dialog", { name: "Cancel this send?" })).getByRole("button", { name: "Cancel send" }));
    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1));
    expect(onReopen.mock.calls[0]?.[0]).toMatchObject({ id: "a", status: "cancelled", draft_id: "draft-9", body_html: "<p>Body</p>" });
    expect(await screen.findByRole("heading", { name: "Nothing scheduled" })).toBeInTheDocument();
  });

  it("says it is too late when the message is already on its way", async () => {
    items = [item("a")];
    cancelStatus = 409;
    const user = userEvent.setup();
    const { onReopen } = renderList();
    await user.click(await screen.findByRole("button", { name: "Cancel send" }));
    await user.click(within(screen.getByRole("dialog", { name: "Cancel this send?" })).getByRole("button", { name: "Cancel send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith("Too late — the message was already sent"));
    expect(onReopen).not.toHaveBeenCalled();
  });
});
