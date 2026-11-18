import { describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "@/modules/emails";
import { makeAccount } from "@/test/accounts";
import { bulkActions } from "./bulk-actions";

vi.mock("@/infrastructure/i18n/navigation", () => ({}));

const full = makeAccount("full");
const bare = makeAccount("bare", { archive: false, spam: false, drafts: false }, { provider: "imap" });
const accounts = [full, bare];

function thread(id: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id,
    account_id: "full",
    subject: id,
    snippet: "",
    participants: [],
    message_count: 1,
    has_attachments: false,
    is_unread: false,
    is_starred: false,
    last_message_at: "2026-11-17T09:00:00Z",
    ...overrides,
  };
}

describe("bulkActions", () => {
  it("offers nothing for an empty selection", () => {
    expect(bulkActions("inbox", [], accounts)).toEqual([]);
  });

  it("offers the inbox actions, with read and star following the selection", () => {
    expect(bulkActions("inbox", [thread("a", { is_unread: true }), thread("b")], accounts)).toEqual([
      "mark_read",
      "archive",
      "trash",
      "spam",
      "star",
    ]);
    expect(bulkActions("inbox", [thread("a", { is_starred: true })], accounts)).toEqual([
      "mark_unread",
      "archive",
      "trash",
      "spam",
      "unstar",
    ]);
  });

  it("leaves archive and spam out when any selected mailbox lacks them", () => {
    const mixed = [thread("a"), thread("b", { account_id: "bare" })];
    expect(bulkActions("inbox", mixed, accounts)).toEqual(["mark_unread", "trash", "star"]);
  });

  it("restores from trash and moves out of spam and archive", () => {
    expect(bulkActions("trash", [thread("a")], accounts)).toEqual(["mark_unread", "restore", "star"]);
    expect(bulkActions("spam", [thread("a")], accounts)).toEqual(["mark_unread", "trash", "not_spam", "star"]);
    expect(bulkActions("archive", [thread("a")], accounts)).toEqual(["mark_unread", "unarchive", "trash", "spam", "star"]);
  });
});
