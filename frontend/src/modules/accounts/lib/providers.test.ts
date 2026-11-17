import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import uk from "@/messages/uk.json";
import { KNOWN_PROVIDERS, OAUTH_PROVIDERS, isPasswordProvider, providerLabelKey } from "./providers";

describe("providers", () => {
  it("maps known kinds to their label and anything else to the generic one", () => {
    expect(providerLabelKey("gmail")).toBe("gmail");
    expect(providerLabelKey("outlook")).toBe("outlook");
    expect(providerLabelKey("imap")).toBe("imap");
    expect(providerLabelKey("yahoo")).toBe("other");
  });

  it("has a label for every known provider in both locales", () => {
    for (const kind of [...KNOWN_PROVIDERS, "other"] as const) {
      expect(en.accounts.providers[kind]).toBeTruthy();
      expect(uk.accounts.providers[kind]).toBeTruthy();
    }
  });

  it("offers Gmail and Outlook through OAuth, and never IMAP", () => {
    expect([...OAUTH_PROVIDERS]).toEqual(["gmail", "outlook"]);
  });

  it("treats IMAP, and only IMAP, as a provider connected with a password", () => {
    expect(isPasswordProvider("imap")).toBe(true);
    expect(isPasswordProvider("gmail")).toBe(false);
    expect(isPasswordProvider("outlook")).toBe(false);
    expect(isPasswordProvider("yahoo")).toBe(false);
  });
});
