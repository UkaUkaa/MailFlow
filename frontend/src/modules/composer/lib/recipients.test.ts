import { describe, expect, it } from "vitest";
import { dedupeRecipients, isValidEmail, parseRecipient, parseRecipients } from "./recipients";

describe("recipients", () => {
  it("validates addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail(" user@example.com ")).toBe(true);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("not an email")).toBe(false);
  });

  it("parses plain and named addresses", () => {
    expect(parseRecipient("user@example.com")).toEqual({ name: null, email: "user@example.com" });
    expect(parseRecipient('"Jane Doe" <jane@example.com>')).toEqual({ name: "Jane Doe", email: "jane@example.com" });
    expect(parseRecipient("<jane@example.com>")).toEqual({ name: null, email: "jane@example.com" });
    expect(parseRecipient("   ")).toBeNull();
  });

  it("splits pasted lists", () => {
    expect(parseRecipients("a@example.com, b@example.com;c@example.com d@example.com").map((item) => item.email)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ]);
    expect(parseRecipients("Jane Doe <jane@example.com>, John <john@example.com>")).toEqual([
      { name: "Jane Doe", email: "jane@example.com" },
      { name: "John", email: "john@example.com" },
    ]);
  });

  it("removes duplicates case-insensitively, keeping the first", () => {
    expect(
      dedupeRecipients([
        { name: "A", email: "a@example.com" },
        { name: null, email: "A@Example.com" },
        { name: null, email: "b@example.com" },
      ]),
    ).toEqual([
      { name: "A", email: "a@example.com" },
      { name: null, email: "b@example.com" },
    ]);
  });
});
