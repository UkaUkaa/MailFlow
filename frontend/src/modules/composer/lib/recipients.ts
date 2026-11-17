import { z } from "zod";
import type { Address } from "@/shared/types/address";

const emailSchema = z.email();

export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value.trim()).success;
}

const NAMED = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+)>\s*$/;

/** Parses one token: `user@example.com` or `Name <user@example.com>`. */
export function parseRecipient(token: string): Address | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const named = NAMED.exec(trimmed);
  if (named) {
    const name = named[1]?.trim() ?? "";
    return { name: name || null, email: (named[2] ?? "").trim() };
  }
  return { name: null, email: trimmed };
}

/** Splits pasted or typed text into recipients (comma, semicolon or newline separated). */
export function parseRecipients(text: string): Address[] {
  const tokens = text.includes("<") ? text.split(/[,;\n]+/) : text.split(/[,;\s]+/);
  return tokens.map(parseRecipient).filter((address): address is Address => address !== null);
}

export function dedupeRecipients(addresses: Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
