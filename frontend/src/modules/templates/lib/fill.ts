import type { Address } from "@/shared/types/address";

export const PLACEHOLDERS = ["first_name", "name", "email", "my_name", "date"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export interface TemplateContext {
  /** First "To" recipient, if any. */
  recipient: Address | null;
  myName: string;
  locale: string;
  now: Date;
}

/** Values known in this context. A placeholder without a value stays as written for the user to fill in. */
export function placeholderValues({ recipient, myName, locale, now }: TemplateContext): Partial<Record<Placeholder, string>> {
  const name = recipient?.name?.trim() ?? "";
  const values: Partial<Record<Placeholder, string>> = {
    date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(now),
  };
  if (name) {
    values.name = name;
    values.first_name = name.split(/\s+/)[0] ?? name;
  }
  if (recipient?.email) values.email = recipient.email;
  if (myName.trim()) values.my_name = myName.trim();
  return values;
}

function replace(text: string, values: Partial<Record<Placeholder, string>>, escape: (value: string) => string): string {
  return text.replace(PATTERN, (match, key: string) => {
    const value = values[key as Placeholder];
    return value === undefined ? match : escape(value);
  });
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function fillText(text: string, values: Partial<Record<Placeholder, string>>): string {
  return replace(text, values, (value) => value);
}

/** Fills placeholders in template HTML; values are escaped, so a name can never add markup. */
export function fillHtml(html: string, values: Partial<Record<Placeholder, string>>): string {
  return replace(html, values, escapeHtml);
}
