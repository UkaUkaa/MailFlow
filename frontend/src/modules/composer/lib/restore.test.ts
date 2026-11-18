import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxDetail } from "@/modules/outbox";
import { losesAttachments, sessionFromOutbox } from "./restore";

// Only the type of the outbox module is needed; its components pull in the app shell.
vi.mock("@/modules/outbox", () => ({}));

const detail: OutboxDetail = {
  id: "out-1",
  account_id: "acc-2",
  status: "cancelled",
  send_at: "2026-11-19T08:00:00Z",
  created_at: "2026-11-18T09:00:00Z",
  subject: "Fwd: Report",
  to: [{ name: "Marta", email: "marta@example.com" }],
  cc: [{ name: null, email: "cc@example.com" }],
  bcc: [],
  snippet: "See attached",
  attachment_count: 0,
  mode: "forward",
  error_code: null,
  body_html: "<p>See attached</p><blockquote>Original</blockquote>",
  source_message_id: "m7",
  draft_id: "draft-4",
  forward_attachment_ids: [],
  attachments: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("sessionFromOutbox", () => {
  it("rebuilds the compose session with the draft kept and a fresh idempotency key", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "fresh-key" });
    expect(sessionFromOutbox(detail)).toEqual({
      key: "fresh-key",
      mode: "forward",
      accountId: "acc-2",
      to: detail.to,
      cc: detail.cc,
      bcc: [],
      subject: "Fwd: Report",
      bodyHtml: detail.body_html,
      quotedHtml: null,
      sourceMessageId: "m7",
      draftId: "draft-4",
      forwardAttachments: [],
      unsaved: true,
    });
  });
});

describe("losesAttachments", () => {
  it("is true when files or forwarded attachments cannot be restored", () => {
    expect(losesAttachments(detail)).toBe(false);
    expect(losesAttachments({ ...detail, attachments: [{ filename: "a.pdf", mime_type: "application/pdf", size: 10 }] })).toBe(true);
    expect(losesAttachments({ ...detail, forward_attachment_ids: ["att-1"] })).toBe(true);
  });
});
