import { describe, expect, it } from "vitest";
import { makeAccount } from "@/test/accounts";
import { accountsSupport, anyAccountSupports } from "./capabilities";

const gmail = makeAccount("gmail");
const imapNoArchive = makeAccount("imap", { archive: false, spam: false, drafts: false }, { provider: "imap" });

describe("accountsSupport", () => {
  it("follows the capability of the mailbox", () => {
    expect(accountsSupport([gmail, imapNoArchive], ["gmail"], "archive")).toBe(true);
    expect(accountsSupport([gmail, imapNoArchive], ["imap"], "archive")).toBe(false);
    expect(accountsSupport([gmail, imapNoArchive], ["imap"], "spam")).toBe(false);
    expect(accountsSupport([gmail, imapNoArchive], ["imap"], "incremental_sync")).toBe(true);
  });

  it("needs every mailbox of a mixed selection to support the capability", () => {
    expect(accountsSupport([gmail, imapNoArchive], ["gmail", "imap"], "archive")).toBe(false);
    expect(accountsSupport([gmail, imapNoArchive], ["gmail", "gmail"], "archive")).toBe(true);
    expect(accountsSupport([gmail, imapNoArchive], new Set(["gmail", "imap"]), "incremental_sync")).toBe(true);
  });

  it("never assumes support for a mailbox it does not know", () => {
    expect(accountsSupport(undefined, ["gmail"], "archive")).toBe(false);
    expect(accountsSupport([gmail], ["gone"], "archive")).toBe(false);
    expect(accountsSupport([gmail], [], "archive")).toBe(false);
  });
});

describe("anyAccountSupports", () => {
  it("is true while at least one mailbox supports the capability", () => {
    expect(anyAccountSupports([gmail, imapNoArchive], "drafts")).toBe(true);
    expect(anyAccountSupports([imapNoArchive], "drafts")).toBe(false);
    expect(anyAccountSupports([], "drafts")).toBe(false);
  });
});
