import { describe, expect, it } from "vitest";
import type { Message } from "@/modules/emails";
import { prefixSubject, quoteMessage, replyRecipients, type PrefillLabels } from "./prefill";

const message: Message = {
  id: "m1",
  thread_id: "t1",
  account_id: "acc-1",
  from: { name: "Marta", email: "marta@example.com" },
  to: [
    { name: "Me", email: "me@example.com" },
    { name: null, email: "dan@example.com" },
  ],
  cc: [{ name: null, email: "team@example.com" }],
  bcc: [],
  reply_to: [],
  subject: "Planning",
  snippet: "",
  sent_at: "2026-11-17T09:00:00Z",
  is_read: true,
  is_starred: false,
  is_draft: false,
  body_html: "<p>Hello</p>",
  body_text: "Hello",
  has_remote_images: false,
  attachments: [],
};

const labels: PrefillLabels = {
  wroteLine: "On Nov 17, Marta <wrote>:",
  forwardedHeader: "Forwarded message",
  from: "From",
  date: "Date",
  subject: "Subject",
  to: "To",
  formattedDate: "Nov 17, 2026",
};

describe("prefixSubject", () => {
  it("adds a prefix once", () => {
    expect(prefixSubject("Planning", "reply")).toBe("Re: Planning");
    expect(prefixSubject("RE: Planning", "reply_all")).toBe("RE: Planning");
    expect(prefixSubject("Planning", "forward")).toBe("Fwd: Planning");
    expect(prefixSubject("Fw: Planning", "forward")).toBe("Fw: Planning");
    expect(prefixSubject("", "reply")).toBe("Re:");
    expect(prefixSubject(" Planning ", "new")).toBe("Planning");
  });
});

describe("replyRecipients", () => {
  it("replies to the sender only", () => {
    expect(replyRecipients(message, "reply", "me@example.com")).toEqual({ to: [message.from], cc: [] });
  });

  it("prefers Reply-To over From", () => {
    const withReplyTo = { ...message, reply_to: [{ name: null, email: "list@example.com" }] };
    expect(replyRecipients(withReplyTo, "reply", "me@example.com").to).toEqual([{ name: null, email: "list@example.com" }]);
  });

  it("reply all includes the other recipients but never the user's own address", () => {
    const result = replyRecipients(message, "reply_all", "ME@example.com");
    expect(result.to).toEqual([message.from]);
    expect(result.cc.map((address) => address.email)).toEqual(["dan@example.com", "team@example.com"]);
  });

  it("replying to an own sent message addresses the original recipients", () => {
    const sent = { ...message, from: { name: "Me", email: "me@example.com" }, to: [{ name: null, email: "dan@example.com" }] };
    expect(replyRecipients(sent, "reply", "me@example.com").to).toEqual([{ name: null, email: "dan@example.com" }]);
  });

  it("forwarding starts without recipients", () => {
    expect(replyRecipients(message, "forward", "me@example.com")).toEqual({ to: [], cc: [] });
  });
});

describe("quoteMessage", () => {
  it("quotes replies inside a blockquote and escapes the attribution", () => {
    const html = quoteMessage(message, "reply", labels);
    expect(html).toBe("<p>On Nov 17, Marta &lt;wrote&gt;:</p><blockquote><p>Hello</p></blockquote>");
  });

  it("builds a forwarded header", () => {
    const html = quoteMessage(message, "forward", labels) ?? "";
    expect(html).toContain("---------- Forwarded message ----------");
    expect(html).toContain("From: Marta &lt;marta@example.com&gt;");
    expect(html).toContain("Subject: Planning");
    expect(html.endsWith("<p>Hello</p>")).toBe(true);
  });

  it("escapes plain-text originals", () => {
    const plain = { ...message, body_html: null, body_text: "a < b\nnext" };
    expect(quoteMessage(plain, "reply", labels)).toContain("<blockquote>a &lt; b<br>next</blockquote>");
  });

  it("returns nothing for a new message", () => {
    expect(quoteMessage(message, "new", labels)).toBeNull();
  });
});
