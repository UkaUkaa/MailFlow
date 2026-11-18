import { describe, expect, it } from "vitest";
import { ApiError } from "@/infrastructure/api-client";
import { assistantErrorKey, languageName } from "./errors";

describe("assistant errors", () => {
  it("maps server codes to messages", () => {
    expect(assistantErrorKey(new ApiError(409, "assistant_not_configured", ""))).toBe("notConfigured");
    expect(assistantErrorKey(new ApiError(422, "assistant_key_invalid", ""))).toBe("keyInvalid");
    expect(assistantErrorKey(new ApiError(422, "validation_error", "", [{ field: "api_key", code: "invalid" }]))).toBe("keyInvalid");
    expect(assistantErrorKey(new ApiError(422, "assistant_model_unavailable", ""))).toBe("model");
    expect(assistantErrorKey(new ApiError(429, "assistant_rate_limited", ""))).toBe("providerLimit");
    expect(assistantErrorKey(new ApiError(429, "rate_limited", ""))).toBe("rateLimited");
    expect(assistantErrorKey(new ApiError(422, "assistant_refused", ""))).toBe("refused");
    expect(assistantErrorKey(new ApiError(503, "assistant_unavailable", ""))).toBe("unavailable");
    expect(assistantErrorKey(new ApiError(404, "not_found", ""))).toBe("generic");
    expect(assistantErrorKey(new Error("offline"))).toBe("generic");
  });

  it("names the reply language in the interface language", () => {
    expect(languageName("uk", "en")).toBe("Ukrainian");
    expect(languageName("en", "uk")).toBe("англійська");
    expect(languageName("und", "en")).toBeNull();
  });
});
