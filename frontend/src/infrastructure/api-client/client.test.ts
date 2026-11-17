import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api, ApiError, buildUrl, errorKey, setUnauthenticatedHandler } from "./client";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthenticatedHandler(null);
});

function lastCall(index = -1): { url: string; init: RequestInit; headers: Record<string, string> } {
  const call = fetchMock.mock.calls.at(index);
  if (!call) throw new Error("fetch was not called");
  const init = (call[1] ?? {}) as RequestInit;
  return { url: String(call[0]), init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe("buildUrl", () => {
  it("prefixes the versioned base path and skips empty parameters", () => {
    expect(buildUrl("/threads", { view: "inbox", account_id: null, cursor: undefined, q: "", limit: 30 })).toBe(
      "/api/v1/threads?view=inbox&limit=30",
    );
  });
});

describe("api client", () => {
  it("parses successful responses with the given schema", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "1", extra: true }));
    const result = await api.get("/things/1", z.object({ id: z.string() }));
    expect(result).toEqual({ id: "1" });
    expect(lastCall().init.credentials).toBe("same-origin");
  });

  it("rejects responses that do not match the schema", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 5 }));
    await expect(api.get("/things/1", z.object({ id: z.string() }))).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not send a CSRF header on GET", async () => {
    document.cookie = "mf_csrf=abc; Path=/";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await api.get("/things", z.object({}));
    expect(lastCall().headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("echoes the CSRF cookie on state-changing requests", async () => {
    document.cookie = "mf_csrf=abc123; Path=/";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api.post("/things", z.object({ ok: z.boolean() }), { name: "x" });
    const call = lastCall();
    expect(call.headers["X-CSRF-Token"]).toBe("abc123");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.init.body).toBe(JSON.stringify({ name: "x" }));
  });

  it("fetches a CSRF token first when the cookie is missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { csrf_token: "fresh" })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.post("/auth/logout", null);
    expect(lastCall(0).url).toBe("/api/v1/auth/csrf");
    expect(lastCall(1).headers["X-CSRF-Token"]).toBe("fresh");
  });

  it("refreshes the token and retries once after csrf_failed", async () => {
    document.cookie = "mf_csrf=stale; Path=/";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { error: { code: "csrf_failed", message: "bad token" } }))
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: "fresh" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.delete("/accounts/1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lastCall(2).headers["X-CSRF-Token"]).toBe("fresh");
  });

  it("does not set a JSON content type for multipart bodies", async () => {
    document.cookie = "mf_csrf=abc; Path=/";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    const form = new FormData();
    form.set("payload", "{}");
    await api.post("/emails/send", z.object({}), form, { headers: { "Idempotency-Key": "key-1" } });
    const call = lastCall();
    expect(call.headers["Content-Type"]).toBeUndefined();
    expect(call.headers["Idempotency-Key"]).toBe("key-1");
    expect(call.init.body).toBe(form);
  });

  it("maps the error envelope to ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        429,
        { error: { code: "rate_limited", message: "Slow down", details: [{ field: "email", code: "invalid" }] } },
        { "Retry-After": "30" },
      ),
    );
    const error = await api.get("/things", z.object({})).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "rate_limited", message: "Slow down", retryAfter: 30 });
    expect((error as ApiError).details).toEqual([{ field: "email", code: "invalid" }]);
    expect(errorKey(error)).toBe("rate_limited");
  });

  it("survives non-JSON error bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api.get("/things", z.object({}))).rejects.toMatchObject({ status: 502, code: "internal_error" });
  });

  it("reports network failures as network_error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await api.get("/things", z.object({})).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(errorKey(error)).toBe("network_error");
  });

  it("notifies the session handler on 401", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: "unauthenticated", message: "no session" } }));
    await expect(api.get("/threads", z.object({}))).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not notify the session handler when the caller opts out", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: "invalid_credentials", message: "nope" } }));
    await expect(api.get("/auth/me", z.object({}), { skipAuthRedirect: true })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps unknown codes to the generic message key", () => {
    expect(errorKey(new ApiError(500, "something_new", "x"))).toBe("unknown");
    expect(errorKey(new Error("boom"))).toBe("unknown");
  });
});
