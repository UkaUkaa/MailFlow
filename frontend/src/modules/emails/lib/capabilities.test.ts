import { describe, expect, it, vi } from "vitest";
import { makeAccount } from "@/test/accounts";
import { THREAD_ACTIONS } from "../types";
import { ACTION_CAPABILITY, isActionAvailable } from "./capabilities";

// The accounts module's entry point also exports components that use locale-aware navigation.
vi.mock("@/infrastructure/i18n/navigation", () => ({}));

const full = makeAccount("full");
const bare = makeAccount("bare", { archive: false, spam: false, drafts: false }, { provider: "imap" });
const noSpam = makeAccount("no-spam", { spam: false }, { provider: "imap" });
const accounts = [full, bare, noSpam];

describe("isActionAvailable", () => {
  it("ties archive and spam actions, in both directions, to the mailbox capability", () => {
    expect(ACTION_CAPABILITY).toEqual({ archive: "archive", unarchive: "archive", spam: "spam", not_spam: "spam" });
    for (const action of ["archive", "unarchive", "spam", "not_spam"] as const) {
      expect(isActionAvailable(action, accounts, ["full"]), action).toBe(true);
      expect(isActionAvailable(action, accounts, ["bare"]), action).toBe(false);
    }
    expect(isActionAvailable("archive", accounts, ["no-spam"])).toBe(true);
    expect(isActionAvailable("spam", accounts, ["no-spam"])).toBe(false);
  });

  it("always offers the actions every mailbox supports", () => {
    for (const action of THREAD_ACTIONS.filter((item) => !(item in ACTION_CAPABILITY))) {
      expect(isActionAvailable(action, accounts, ["bare"]), action).toBe(true);
      expect(isActionAvailable(action, undefined, ["bare"]), action).toBe(true);
    }
    expect(THREAD_ACTIONS.filter((item) => !(item in ACTION_CAPABILITY))).toEqual([
      "mark_read",
      "mark_unread",
      "star",
      "unstar",
      "trash",
      "restore",
    ]);
  });

  it("offers an action for several threads only when every mailbox involved supports it", () => {
    expect(isActionAvailable("archive", accounts, ["full", "no-spam"])).toBe(true);
    expect(isActionAvailable("archive", accounts, ["full", "bare"])).toBe(false);
    expect(isActionAvailable("spam", accounts, ["full", "no-spam"])).toBe(false);
  });

  it("hides capability-bound actions until the mailboxes are known", () => {
    expect(isActionAvailable("archive", undefined, ["full"])).toBe(false);
    expect(isActionAvailable("spam", accounts, ["unknown"])).toBe(false);
  });
});
