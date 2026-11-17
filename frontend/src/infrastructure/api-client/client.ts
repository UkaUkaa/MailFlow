import type { z } from "zod";

export const API_BASE = "/api/v1";
const CSRF_COOKIE = "mf_csrf";
const CSRF_HEADER = "X-CSRF-Token";

export interface ApiErrorDetail {
  field?: string;
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = [], retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

type ParamValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  params?: Record<string, ParamValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Do not trigger the global session-expired handler on 401 (login, session probe). */
  skipAuthRedirect?: boolean;
}

type UnauthenticatedHandler = () => void;
let unauthenticatedHandler: UnauthenticatedHandler | null = null;

export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | null): void {
  unauthenticatedHandler = handler;
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

export function buildUrl(path: string, params?: Record<string, ParamValue>): string {
  const search = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return `${API_BASE}${path}${query ? `?${query}` : ""}`;
}

let csrfRequest: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  csrfRequest ??= fetch(`${API_BASE}/auth/csrf`, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) return null;
      const body: unknown = await response.json().catch(() => null);
      const token =
        typeof body === "object" && body !== null && "csrf_token" in body && typeof body.csrf_token === "string"
          ? body.csrf_token
          : null;
      // The body carries the token that matches the cookie this response just set.
      return token ?? readCookie(CSRF_COOKIE);
    })
    .catch(() => null)
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}

async function csrfToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const existing = readCookie(CSRF_COOKIE);
    if (existing) return existing;
  }
  return fetchCsrfToken();
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfter = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null;
  let code = response.status === 401 ? "unauthenticated" : "internal_error";
  let message = response.statusText || "Request failed";
  let details: ApiErrorDetail[] = [];
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === "object" && error !== null) {
        const record = error as Record<string, unknown>;
        if (typeof record.code === "string") code = record.code;
        if (typeof record.message === "string") message = record.message;
        if (Array.isArray(record.details)) {
          details = record.details.filter(
            (item): item is ApiErrorDetail => typeof item === "object" && item !== null,
          );
        }
      }
    }
  } catch {
    // Non-JSON error body (e.g. proxy error page): keep the defaults.
  }
  return new ApiError(response.status, code, message, details, retryAfter);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function send(method: string, path: string, body: unknown, options: RequestOptions, csrf: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (csrf) headers[CSRF_HEADER] = csrf;
  return fetch(buildUrl(path, options.params), {
    method,
    headers,
    body: payload,
    credentials: "same-origin",
    signal: options.signal,
  });
}

async function request<T>(
  method: string,
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const mutating = MUTATING.has(method);
  let response: Response;
  try {
    response = await send(method, path, body, options, mutating ? await csrfToken() : null);
    if (mutating && response.status === 403) {
      const error = await toApiError(response.clone());
      if (error.code === "csrf_failed") {
        response = await send(method, path, body, options, await csrfToken(true));
      }
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "network_error", "Network request failed");
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (error.status === 401 && !options.skipAuthRedirect) unauthenticatedHandler?.();
    throw error;
  }
  if (schema === null || response.status === 204) return undefined as T;
  const data: unknown = await response.json();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(response.status, "invalid_response", "Unexpected response from the server");
  }
  return parsed.data;
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>, options?: RequestOptions) => request("GET", path, schema, undefined, options),
  post: <T>(path: string, schema: z.ZodType<T> | null, body?: unknown, options?: RequestOptions) =>
    request("POST", path, schema, body, options),
  put: <T>(path: string, schema: z.ZodType<T> | null, body?: unknown, options?: RequestOptions) =>
    request("PUT", path, schema, body, options),
  patch: <T>(path: string, schema: z.ZodType<T> | null, body?: unknown, options?: RequestOptions) =>
    request("PATCH", path, schema, body, options),
  delete: (path: string, body?: unknown, options?: RequestOptions) => request<void>("DELETE", path, null, body, options),
};

const KNOWN_ERROR_KEYS = [
  "validation_error",
  "unauthenticated",
  "invalid_credentials",
  "email_not_verified",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "provider_auth_required",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_not_configured",
  "unsupported",
  "payload_too_large",
  "network_error",
  "invalid_token",
] as const;
export type KnownErrorKey = (typeof KNOWN_ERROR_KEYS)[number] | "unknown";

/** Maps any thrown value to a key under the `errors` message namespace. */
export function errorKey(error: unknown): KnownErrorKey {
  if (!isApiError(error)) return "unknown";
  return KNOWN_ERROR_KEYS.find((key) => key === error.code) ?? "unknown";
}
