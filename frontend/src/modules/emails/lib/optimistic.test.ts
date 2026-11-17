import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Page } from "@/infrastructure/api-client";
import type { ThreadListFilter, ThreadSummary } from "../types";
import { applyActionToList, applyActionToThread, staysInView } from "./optimistic";

function thread(id: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id,
    account_id: "acc-1",
    subject: "s",
    snippet: "",
    participants: [],
    message_count: 1,
    has_attachments: false,
    is_unread: true,
    is_starred: false,
    last_message_at: "2026-11-17T09:00:00Z",
    ...overrides,
  };
}

function data(...threads: ThreadSummary[]): InfiniteData<Page<ThreadSummary>> {
  return { pages: [{ items: threads, next_cursor: null }], pageParams: [null] };
}

const filter = (view: string, unreadOnly = false): ThreadListFilter => ({ view, accountId: null, folderId: null, query: null, unreadOnly });
const ids = (result: InfiniteData<Page<ThreadSummary>> | undefined) => result?.pages.flatMap((page) => page.items.map((item) => item.id));

describe("optimistic thread updates", () => {
  it("knows which actions remove a thread from which view", () => {
    expect(staysInView("archive", "inbox")).toBe(false);
    expect(staysInView("archive", "starred")).toBe(true);
    expect(staysInView("trash", "inbox")).toBe(false);
    expect(staysInView("trash", "trash")).toBe(true);
    expect(staysInView("restore", "trash")).toBe(false);
    expect(staysInView("spam", "inbox")).toBe(false);
    expect(staysInView("not_spam", "spam")).toBe(false);
    expect(staysInView("unstar", "starred")).toBe(false);
    expect(staysInView("unstar", "inbox")).toBe(true);
    expect(staysInView("mark_read", "inbox")).toBe(true);
  });

  it("flags threads in place", () => {
    expect(applyActionToThread(thread("a"), "mark_read").is_unread).toBe(false);
    expect(applyActionToThread(thread("a"), "star").is_starred).toBe(true);
    expect(applyActionToThread(thread("a", { is_starred: true }), "unstar").is_starred).toBe(false);
  });

  it("removes archived threads from the inbox list only", () => {
    const list = data(thread("a"), thread("b"));
    expect(ids(applyActionToList(list, filter("inbox"), new Set(["a"]), "archive"))).toEqual(["b"]);
    expect(ids(applyActionToList(list, filter("starred"), new Set(["a"]), "archive"))).toEqual(["a", "b"]);
  });

  it("drops threads from an unread-only list once they are read", () => {
    const list = data(thread("a"), thread("b"));
    expect(ids(applyActionToList(list, filter("inbox", true), new Set(["a"]), "mark_read"))).toEqual(["b"]);
  });

  it("does not mutate the cached data", () => {
    const list = data(thread("a"));
    const next = applyActionToList(list, filter("inbox"), new Set(["a"]), "star");
    expect(list.pages[0]?.items[0]?.is_starred).toBe(false);
    expect(next?.pages[0]?.items[0]?.is_starred).toBe(true);
  });

  it("passes through an empty cache", () => {
    expect(applyActionToList(undefined, filter("inbox"), new Set(["a"]), "trash")).toBeUndefined();
  });
});
