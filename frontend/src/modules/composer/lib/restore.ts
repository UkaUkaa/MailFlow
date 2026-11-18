import type { OutboxDetail } from "@/modules/outbox";
import type { ComposeSession } from "../types";

/**
 * A compose session never reuses an idempotency key: the server refuses a key whose send was
 * cancelled, so every reopened composer gets a fresh one.
 */
export function newSessionKey(): string {
  return crypto.randomUUID();
}

/**
 * The composer as it was when the user pressed Send, for "Undo": the in-memory state (files
 * included) with a new idempotency key. The draft the server kept, if any, wins over ours.
 */
export function sessionAfterUndo(snapshot: ComposeSession, draftId: string | null): ComposeSession {
  return { ...snapshot, key: newSessionKey(), draftId: draftId ?? snapshot.draftId, unsaved: true };
}

/**
 * A cancelled scheduled send as a compose session. The stored body already contains any quoted
 * original. Attachments are not part of the response, so they are not restored.
 */
export function sessionFromOutbox(detail: OutboxDetail): ComposeSession {
  return {
    key: newSessionKey(),
    mode: detail.mode,
    accountId: detail.account_id,
    to: detail.to,
    cc: detail.cc,
    bcc: detail.bcc,
    subject: detail.subject,
    bodyHtml: detail.body_html,
    quotedHtml: null,
    sourceMessageId: detail.source_message_id,
    draftId: detail.draft_id,
    forwardAttachments: [],
    unsaved: true,
  };
}

/** Whether reopening this send loses attachments the user has to add again. */
export function losesAttachments(detail: OutboxDetail): boolean {
  return detail.attachments.length > 0 || detail.forward_attachment_ids.length > 0;
}
