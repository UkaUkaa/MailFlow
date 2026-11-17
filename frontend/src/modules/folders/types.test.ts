import { describe, expect, it } from "vitest";
import { folderViewSlug, parseMailView } from "./types";

describe("parseMailView", () => {
  it("recognises system views", () => {
    expect(parseMailView("sent")).toEqual({ kind: "system", role: "sent", slug: "sent" });
  });
  it("recognises custom folders", () => {
    expect(parseMailView(folderViewSlug("abc"))).toEqual({ kind: "folder", folderId: "abc", slug: "folder-abc" });
  });
  it("recognises search", () => {
    expect(parseMailView("search")).toEqual({ kind: "search", slug: "search" });
  });
  it("falls back to the inbox for anything else", () => {
    expect(parseMailView("nonsense")).toEqual({ kind: "system", role: "inbox", slug: "inbox" });
    expect(parseMailView("folder-")).toEqual({ kind: "system", role: "inbox", slug: "inbox" });
  });
});
