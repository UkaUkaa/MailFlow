import type { Page, Request, Route } from "@playwright/test";
import { samplePng } from "./png";
import { accounts, imapAccount, type AccountFixture, folderCounts, folders, makeThreadDetail, makeThreads, sessions, settings, user, type ThreadFixture } from "./data";

export interface MockOptions {
  authenticated?: boolean;
  accounts?: AccountFixture[];
  gmailAvailable?: boolean;
  outlookAvailable?: boolean;
  imapAvailable?: boolean;
  /** Make every authenticated call answer 401 after this many requests (session expiry). */
  expireAfter?: number;
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
    settings: { ...settings },
    // Cloned so one test renaming an account cannot leak into the next test in the same worker.
    accounts: structuredClone(options.accounts ?? accounts),
    threads: makeThreads(45),
    drafts: 0,
    authedCalls: 0,
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
    if (path === "/emails/send") return json(route, 200, { message_id: "sent-1", thread_id: "thread-sent-1" });
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
  };
}
