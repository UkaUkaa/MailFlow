import type { Message } from "@/modules/emails";
import type { Address } from "@/shared/types/address";
import { escapeHtml } from "@/shared/utils/format";
import type { ComposeMode } from "../types";
import { dedupeRecipients } from "./recipients";

export interface PrefillLabels {
  /** e.g. "On 12 Nov 2026, 10:00, Jane Doe wrote:" */
  wroteLine: string;
  forwardedHeader: string;
  from: string;
  date: string;
  subject: string;
  to: string;
  formattedDate: string;
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function formatAddress(address: Address): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

export function prefixSubject(subject: string, mode: ComposeMode): string {
  const trimmed = subject.trim();
  if (mode === "forward") return /^fwd?:/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`.trim();
  if (mode === "reply" || mode === "reply_all") return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`.trim();
  return trimmed;
}

export function replyRecipients(
  message: Message,
  mode: ComposeMode,
  ownEmail: string | null,
): { to: Address[]; cc: Address[] } {
  if (mode === "forward" || mode === "new") return { to: [], cc: [] };
  const isOwn = (address: Address) => ownEmail !== null && sameEmail(address.email, ownEmail);
  // Replying to something we sent ourselves continues the conversation with the original recipients.
  const primary = isOwn(message.from) ? message.to : message.reply_to.length > 0 ? message.reply_to : [message.from];
  const to = dedupeRecipients(primary);
  if (mode === "reply") return { to, cc: [] };
  const others = [...(isOwn(message.from) ? [] : message.to), ...message.cc].filter(
    (address) => !isOwn(address) && !to.some((item) => sameEmail(item.email, address.email)),
  );
  return { to, cc: dedupeRecipients(others) };
}

function originalBody(message: Message): string {
  if (message.body_html) return message.body_html;
  return escapeHtml(message.body_text ?? "").replaceAll("\n", "<br>");
}

export function quoteMessage(message: Message, mode: ComposeMode, labels: PrefillLabels): string | null {
  if (mode === "new") return null;
  if (mode === "forward") {
    const lines = [
      `${labels.from}: ${formatAddress(message.from)}`,
      `${labels.date}: ${labels.formattedDate}`,
      `${labels.subject}: ${message.subject}`,
      `${labels.to}: ${message.to.map(formatAddress).join(", ")}`,
    ]
      .map(escapeHtml)
      .join("<br>");
    return `<p>---------- ${escapeHtml(labels.forwardedHeader)} ----------<br>${lines}</p>${originalBody(message)}`;
  }
  return `<p>${escapeHtml(labels.wroteLine)}</p><blockquote>${originalBody(message)}</blockquote>`;
}
