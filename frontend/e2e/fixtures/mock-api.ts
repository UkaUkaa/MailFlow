import type { Page, Request, Route } from "@playwright/test";
import { samplePng } from "./png";
import { accounts, imapAccount, type AccountFixture, folderCounts, folders, makeThreadDetail, makeThreads, type OutboxFixture, sessions, settings, user, type ThreadFixture } from "./data";

export interface MockOptions {
  authenticated?: boolean;
  accounts?: AccountFixture[];
  gmailAvailable?: boolean;
  outlookAvailable?: boolean;
  imapAvailable?: boolean;
  /** "Continue with Google" sign-in configured on the server (default: off). */
  googleSignIn?: boolean;
  /** Make every authenticated call answer 401 after this many requests (session expiry). */
  expireAfter?: number;
  /** Override saved user settings, e.g. a user who turned remote images off. */
  settings?: Partial<typeof settings>;
  /** Sends already scheduled (or failed) when the test starts. */
  outbox?: OutboxFixture[];
  /** The user's own AI key is already connected with this provider (default: none). */
  aiProvider?: "openai" | "anthropic" | "gemini";
  /** Saved message templates when the test starts. */
  templates?: TemplateFixture[];
}

export interface TemplateFixture {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  created_at: string;
  updated_at: string;
}

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface MockApi {
  calls: RecordedCall[];
  callsTo: (method: string, path: string | RegExp) => RecordedCall[];
  expireSession: () => void;
  /** The worker picked every held send up: from now on cancelling is too late. */
  startSending: () => void;
}

const AI_MODELS = {
  openai: ["gpt-5", "gpt-5-mini", "gpt-4o"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
} as const;

/** `/assistant` as the server returns it: never the key, only its last four characters. */
interface AiConfig {
  configured: boolean;
  provider: keyof typeof AI_MODELS | null;
  model: string | null;
  key_hint: string | null;
  models: string[];
}

function aiConfig(provider: keyof typeof AI_MODELS | null, hint: string | null): AiConfig {
  if (!provider) return { configured: false, provider: null, model: null, key_hint: null, models: [] };
  return { configured: true, provider, model: AI_MODELS[provider][0] as string, key_hint: hint, models: [...AI_MODELS[provider]] as string[] };
}

/** The JSON part of a multipart `/emails/send` body. */
function sendPayload(body: string | null): Record<string, unknown> {
  const match = /name="payload"\r\n\r\n([\s\S]*?)\r\n--/.exec(body ?? "");
  return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

const DETAIL_ONLY = ["body_html", "source_message_id", "draft_id", "forward_attachment_ids", "attachments", "undo"];

/** The list shape: a send without its content. */
function outboxSummary(item: OutboxFixture) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !DETAIL_ONLY.includes(key)));
}

const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Like the server: a time without an offset is the user's local time, read in the zone of the
 * `mf_tz` cookie. The browsers of this suite run in UTC, so that zone is UTC here.
 */
function serverTime(value: unknown): Date {
  const text = String(value);
  return new Date(/(Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text}Z`);
}

/** The server's `send_at` rules: in the future, at most a year ahead. */
function sendAtProblem(value: unknown): "in_past" | "too_far" | null {
  const time = serverTime(value).getTime();
  if (Number.isNaN(time) || time <= Date.now()) return "in_past";
  return time > Date.now() + YEAR_MS ? "too_far" : null;
}

function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers });
}

function error(route: Route, status: number, code: string, message = code) {
  return json(route, status, { error: { code, message } });
}

/** The password that the fake mail servers reject (like `wrong-password` for sign-in). */
export const REJECTED_MAIL_PASSWORD = "rejected-by-mail-server";

function mailServerError(route: Route, code: string, server: "imap" | "smtp") {
  return json(route, 422, { error: { code, message: code, details: [{ field: server, code }] } });
}

const PUBLIC = /^\/auth\/(csrf|login|register|verify-email|resend-verification|password\/(forgot|reset))$/;

/** Answers every `/api/v1` request from in-memory fixtures. */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<MockApi> {
  const state = {
    authenticated: options.authenticated ?? true,
    settings: { ...settings, ...options.settings },
    // Cloned so one test renaming an account cannot leak into the next test in the same worker.
    accounts: structuredClone(options.accounts ?? accounts),
    threads: makeThreads(45),
    drafts: 0,
    authedCalls: 0,
    outbox: structuredClone(options.outbox ?? []),
    outboxIds: 0,
    templates: structuredClone(options.templates ?? []),
    assistant: options.aiProvider ? aiConfig(options.aiProvider, "abcd") : aiConfig(null, null),
    templateIds: 0,
  };
  const calls: RecordedCall[] = [];
  const applyAction = (thread: (typeof state.threads)[number], action: string) => {
    if (action === "mark_read") thread.is_unread = false;
    if (action === "mark_unread") thread.is_unread = true;
    if (action === "star") thread.is_starred = true;
    if (action === "unstar") thread.is_starred = false;
    if (["archive", "trash", "spam"].includes(action)) state.threads = state.threads.filter((item) => item.id !== thread.id);
  };
  // Accounts with a picture. Every picture is served as the same generated PNG; tests assert on
  // the upload request itself.
  const avatars = new Set(state.accounts.filter((account) => account.avatar_updated_at).map((account) => account.id));

  const handler = async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    calls.push({ method, path, headers: request.headers(), body: request.postData() });

    if (method !== "GET" && request.headers()["x-csrf-token"] !== "test-csrf") {
      return error(route, 403, "csrf_failed");
    }
    if (path === "/auth/csrf") {
      return json(route, 200, { csrf_token: "test-csrf" }, { "Set-Cookie": "mf_csrf=test-csrf; Path=/; SameSite=Lax" });
    }
    if (path === "/auth/login") {
      const body = request.postDataJSON() as { email: string; password: string };
      if (body.password === "wrong-password") return error(route, 401, "invalid_credentials");
      if (body.email.startsWith("unverified")) return error(route, 403, "email_not_verified");
      state.authenticated = true;
      return json(route, 200, { user });
    }
    if (path === "/auth/providers") return json(route, 200, { google: options.googleSignIn ?? false });
    if (path === "/auth/register") return json(route, 202, { status: "verification_required" });
    if (path === "/auth/verify-email") {
      const body = request.postDataJSON() as { token: string };
      return body.token === "good-token" ? json(route, 200, { status: "verified" }) : error(route, 422, "invalid_token");
    }
    if (PUBLIC.test(path)) return route.fulfill({ status: 202, body: "" });

    if (state.authenticated && options.expireAfter !== undefined && ++state.authedCalls > options.expireAfter) {
      state.authenticated = false;
    }
    if (!state.authenticated) return error(route, 401, "unauthenticated");

    if (path === "/auth/me" || path === "/users/me") {
      if (method === "PATCH") return json(route, 200, { ...user, ...(request.postDataJSON() as object) });
      if (method === "DELETE") {
        state.authenticated = false;
        return route.fulfill({ status: 204, body: "" });
      }
      return json(route, 200, path === "/auth/me" ? { user } : user);
    }
    if (path === "/auth/logout" || path === "/users/me/deactivate") {
      state.authenticated = false;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/auth/sessions") return json(route, 200, { items: sessions, next_cursor: null });
    if (path.startsWith("/auth/")) return route.fulfill({ status: 204, body: "" });

    if (path === "/settings") {
      if (method === "PATCH") Object.assign(state.settings, request.postDataJSON());
      return json(route, 200, state.settings);
    }
    if (path === "/accounts/providers") {
      return json(route, 200, {
        items: [
          { kind: "gmail", available: options.gmailAvailable ?? true, capabilities: accounts[0]!.capabilities },
          { kind: "outlook", available: options.outlookAvailable ?? true, capabilities: accounts[1]!.capabilities },
          { kind: "imap", available: options.imapAvailable ?? true, capabilities: imapAccount.capabilities },
        ],
        next_cursor: null,
      });
    }
    if (path === "/accounts") return json(route, 200, { items: state.accounts, next_cursor: null });
    if (/^\/accounts\/oauth\/\w+\/start$/.test(path) || /\/reconnect$/.test(path)) {
      return json(route, 200, { authorization_url: `${url.origin}/en/settings/accounts?connected=acc-1` });
    }
    if (path === "/accounts/imap" && method === "POST") {
      const body = request.postDataJSON() as { email_address: string; display_name?: string; password: string };
      if (body.password === REJECTED_MAIL_PASSWORD) return mailServerError(route, "authentication_failed", "smtp");
      const existing = state.accounts.find((account) => account.email_address === body.email_address);
      if (existing) {
        Object.assign(existing, { status: "active", status_reason: null });
        return json(route, 200, existing);
      }
      const created: AccountFixture = {
        ...structuredClone(imapAccount),
        id: "acc-imap-new",
        email_address: body.email_address,
        display_name: body.display_name ?? null,
        sync: { status: "queued", last_synced_at: null, last_error_code: null },
      };
      state.accounts.push(created);
      return json(route, 201, created);
    }
    const credentials = /^\/accounts\/([^/]+)\/imap\/credentials$/.exec(path);
    if (credentials && method === "POST") {
      const account = state.accounts.find((item) => item.id === credentials[1] && item.provider === "imap");
      if (!account) return error(route, 404, "not_found");
      const body = request.postDataJSON() as { password: string };
      if (body.password === REJECTED_MAIL_PASSWORD) return mailServerError(route, "authentication_failed", "imap");
      Object.assign(account, { status: "active", status_reason: null });
      account.sync = { ...account.sync, status: "idle", last_error_code: null };
      return json(route, 200, account);
    }
    const avatar = /^\/accounts\/([^/]+)\/avatar$/.exec(path);
    if (avatar) {
      const account = state.accounts.find((item) => item.id === avatar[1]);
      if (!account) return error(route, 404, "not_found");
      if (method === "GET") {
        return avatars.has(account.id)
          ? route.fulfill({ status: 200, contentType: "image/png", body: samplePng(96, [214, 120, 60]) })
          : error(route, 404, "not_found");
      }
      if (method === "PUT") {
        avatars.add(account.id);
        account.avatar_updated_at = new Date().toISOString();
      } else if (method === "DELETE") {
        avatars.delete(account.id);
        account.avatar_updated_at = null;
      }
      return json(route, 200, account);
    }
    if (path.startsWith("/accounts/")) {
      const id = path.split("/")[2];
      if (method === "DELETE") {
        state.accounts = state.accounts.filter((account) => account.id !== id);
        return route.fulfill({ status: 204, body: "" });
      }
      const account = state.accounts.find((item) => item.id === id);
      if (!account) return error(route, 404, "not_found");
      Object.assign(account, request.postDataJSON());
      return json(route, 200, account);
    }
    if (path === "/sync/status") {
      return json(route, 200, {
        items: state.accounts.map((account) => ({
          account_id: account.id,
          status: account.sync.status === "error" ? "error" : "idle",
          last_synced_at: account.sync.last_synced_at,
          last_error_code: account.sync.last_error_code,
          initial_sync_complete: true,
        })),
        next_cursor: null,
      });
    }
    if (path.startsWith("/sync/")) return json(route, 202, { status: "queued" });
    if (path === "/folders/counts") return json(route, 200, { items: folderCounts, next_cursor: null });
    if (path === "/folders") return json(route, 200, { items: folders, next_cursor: null });

    if (path === "/threads" || path === "/search") {
      const view = url.searchParams.get("view") ?? "inbox";
      const accountId = url.searchParams.get("account_id");
      const query = url.searchParams.get("q")?.toLowerCase();
      let items: ThreadFixture[] = state.threads;
      if (path === "/search") items = query === "nothing" ? [] : items.filter((thread) => thread.subject.toLowerCase().includes(query ?? ""));
      else if (view === "starred") items = items.filter((thread) => thread.is_starred);
      else if (view === "trash" || view === "spam") items = [];
      else if (view !== "inbox") items = items.slice(0, 4);
      if (accountId) items = items.filter((thread) => thread.account_id === accountId);
      if (url.searchParams.get("unread") === "true") items = items.filter((thread) => thread.is_unread);
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 30);
      const next = start + limit < items.length ? String(start + limit) : null;
      return json(route, 200, { items: items.slice(start, start + limit), next_cursor: next });
    }
    if (path === "/threads/actions") {
      const body = request.postDataJSON() as { thread_ids: string[]; action: string };
      const targets = state.threads.filter((item) => body.thread_ids.includes(item.id));
      for (const thread of targets) applyAction(thread, body.action);
      return json(route, 200, { updated: targets.map((item) => item.id) });
    }
    const threadMatch = /^\/threads\/([^/]+)(\/actions)?$/.exec(path);
    if (threadMatch) {
      const thread = state.threads.find((item) => item.id === threadMatch[1]);
      if (!thread) return error(route, 404, "not_found");
      if (threadMatch[2]) {
        const { action } = request.postDataJSON() as { action: string };
        applyAction(thread, action);
        return json(route, 200, thread);
      }
      return json(route, 200, makeThreadDetail(thread));
    }
    if (path === "/emails/send") {
      const payload = sendPayload(request.postData());
      const undoSeconds = state.settings.undo_send_seconds;
      const held = payload.send_at !== undefined || undoSeconds > 0;
      if (!held) {
        return json(route, 200, { status: "sent", message_id: "sent-1", thread_id: "thread-sent-1", outbox_id: null, send_at: null, undo_seconds: 0 });
      }
      if (payload.send_at !== undefined) {
        const problem = sendAtProblem(payload.send_at);
        if (problem) return json(route, 422, { error: { code: "validation_error", message: problem, details: [{ field: "send_at", code: problem }] } });
      }
      const scheduled = payload.send_at !== undefined;
      const files = [...(request.postData() ?? "").matchAll(/name="files"; filename="([^"]*)"/g)].map((match) => match[1] ?? "");
      const bodyHtml = String(payload.body_html ?? "");
      const item: OutboxFixture = {
        id: `out-${++state.outboxIds}`,
        account_id: String(payload.account_id),
        status: "pending",
        send_at: scheduled ? serverTime(payload.send_at).toISOString() : new Date(Date.now() + undoSeconds * 1000).toISOString(),
        created_at: new Date().toISOString(),
        subject: String(payload.subject ?? ""),
        to: (payload.to ?? []) as OutboxFixture["to"],
        cc: (payload.cc ?? []) as OutboxFixture["cc"],
        bcc: (payload.bcc ?? []) as OutboxFixture["bcc"],
        snippet: bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
        attachment_count: files.length + ((payload.forward_attachment_ids as string[] | undefined)?.length ?? 0),
        mode: String(payload.mode ?? "new"),
        error_code: null,
        body_html: bodyHtml,
        source_message_id: (payload.source_message_id as string | undefined) ?? null,
        draft_id: (payload.draft_id as string | undefined) ?? null,
        forward_attachment_ids: (payload.forward_attachment_ids as string[] | undefined) ?? [],
        attachments: files.map((filename) => ({ filename, mime_type: "application/octet-stream", size: 1 })),
        undo: !scheduled,
      };
      state.outbox.push(item);
      return json(route, 202, {
        status: scheduled ? "scheduled" : "undoable",
        message_id: null,
        thread_id: null,
        outbox_id: item.id,
        send_at: item.send_at,
        undo_seconds: scheduled ? 0 : undoSeconds,
      });
    }
    if (path === "/outbox") {
      const items = state.outbox
        .filter((item) => !item.undo && ["pending", "sending", "failed"].includes(item.status))
        .sort((a, b) => a.send_at.localeCompare(b.send_at));
      return json(route, 200, { items: items.map(outboxSummary) });
    }
    const outboxMatch = /^\/outbox\/([^/]+)(\/cancel)?$/.exec(path);
    if (outboxMatch) {
      const item = state.outbox.find((candidate) => candidate.id === outboxMatch[1]);
      if (!item) return error(route, 404, "not_found");
      const open = item.status === "pending" || item.status === "failed";
      if (outboxMatch[2]) {
        if (!open) return error(route, 409, "outbox_not_cancellable");
        item.status = "cancelled";
        return json(route, 200, { ...item, undo: undefined });
      }
      if (method === "PATCH") {
        if (!open) return error(route, 409, "outbox_not_editable");
        const body = request.postDataJSON() as { send_at: string };
        const problem = sendAtProblem(body.send_at);
        if (problem) return json(route, 422, { error: { code: "validation_error", message: problem, details: [{ field: "send_at", code: problem }] } });
        Object.assign(item, { send_at: serverTime(body.send_at).toISOString(), status: "pending", error_code: null });
        return json(route, 200, outboxSummary(item));
      }
      return json(route, 200, { ...item, undo: undefined });
    }
    if (path === "/assistant") {
      if (method === "PUT") {
        const body = request.postDataJSON() as { provider: "openai" | "anthropic" | "gemini"; api_key: string };
        if (body.api_key.includes("bad")) return error(route, 422, "assistant_key_invalid");
        state.assistant = aiConfig(body.provider, body.api_key.slice(-4));
      } else if (method === "PATCH") {
        state.assistant = { ...state.assistant, model: (request.postDataJSON() as { model: string }).model };
      } else if (method === "DELETE") {
        state.assistant = aiConfig(null, null);
        return route.fulfill({ status: 204, body: "" });
      }
      return json(route, 200, state.assistant);
    }
    if (path === "/assistant/reply") {
      if (!state.assistant.configured) return error(route, 409, "assistant_not_configured");
      const body = request.postDataJSON() as { instruction: string };
      return json(route, 200, {
        language: "en",
        body_html: `<p>Hi Daniel,</p><p>${body.instruction ? "Thursday works for me." : "Thanks for the update."}</p><p>Best,<br>Sasha</p>`,
      });
    }
    if (path === "/templates") {
      if (method === "POST") {
        const body = request.postDataJSON() as Omit<TemplateFixture, "id" | "created_at" | "updated_at">;
        const created = { id: `tpl-${++state.templateIds}`, ...body, created_at: "2026-11-18T09:00:00Z", updated_at: "2026-11-18T09:00:00Z" };
        state.templates.push(created);
        return json(route, 201, created);
      }
      return json(route, 200, { items: [...state.templates].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const templateMatch = /^\/templates\/([^/]+)$/.exec(path);
    if (templateMatch) {
      const index = state.templates.findIndex((item) => item.id === templateMatch[1]);
      if (index < 0) return error(route, 404, "not_found");
      if (method === "DELETE") {
        state.templates.splice(index, 1);
        return route.fulfill({ status: 204, body: "" });
      }
      Object.assign(state.templates[index]!, request.postDataJSON() as Partial<TemplateFixture>);
      return json(route, 200, state.templates[index]);
    }
    if (path.startsWith("/emails/drafts")) {
      if (method === "DELETE") return route.fulfill({ status: 204, body: "" });
      const body = (method === "GET" ? {} : request.postDataJSON()) as Record<string, unknown>;
      const id = path.split("/")[3] ?? `draft-${++state.drafts}`;
      return json(route, method === "POST" ? 201 : 200, {
        id,
        account_id: "acc-1",
        thread_id: null,
        to: [],
        cc: [],
        bcc: [],
        subject: "Saved draft",
        body_html: "<p>Draft body</p>",
        mode: "new",
        source_message_id: null,
        ...body,
        updated_at: "2026-11-17T09:00:00Z",
      });
    }
    return error(route, 404, "not_found");
  };

  await page.route("**/api/v1/**", handler);
  return {
    calls,
    callsTo: (method, path) =>
      calls.filter((call) => call.method === method && (typeof path === "string" ? call.path === path : path.test(call.path))),
    expireSession: () => {
      state.authenticated = false;
    },
    startSending: () => {
      for (const item of state.outbox) if (item.status === "pending") item.status = "sending";
    },
  };
}
