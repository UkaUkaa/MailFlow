import { describe, expect, it } from "vitest";
import en from "./en.json";
import uk from "./uk.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(path, value);
    else for (const [childKey, childValue] of flatten(value, path)) result.set(childKey, childValue);
  }
  return result;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1] ?? "").sort();
}

describe("translations", () => {
  const english = flatten(en);
  const ukrainian = flatten(uk);

  it("has the same keys in both locales", () => {
    expect([...ukrainian.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("has no empty messages", () => {
    for (const [key, value] of [...english, ...ukrainian]) expect(value.trim(), key).not.toBe("");
  });

  it("uses the same placeholders in both locales", () => {
    for (const [key, value] of english) {
      const unique = (list: string[]) => [...new Set(list.filter((name) => !["one", "few", "many", "other"].includes(name)))];
      expect(unique(placeholders(ukrainian.get(key) ?? "")), key).toEqual(unique(placeholders(value)));
    }
  });

  it("actually translates the Ukrainian interface", () => {
    // Product names are the same in every language.
    const allowedIdentical = new Set([
      "accounts.providers.gmail",
      "accounts.providers.outlook",
      "accounts.providers.imap",
      "assistant.settings.providers.openai",
      "assistant.settings.providers.anthropic",
      "assistant.settings.providers.gemini",
    ]);
    const identical = [...english].filter(([key, value]) => ukrainian.get(key) === value && !allowedIdentical.has(key));
    expect(identical.map(([key]) => key)).toEqual([]);
  });
});
