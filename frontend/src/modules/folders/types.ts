import { z } from "zod";

export const SYSTEM_VIEWS = ["inbox", "starred", "sent", "drafts", "archive", "trash", "spam"] as const;
export type SystemView = (typeof SYSTEM_VIEWS)[number];

export const folderRoleSchema = z.enum([...SYSTEM_VIEWS, "custom"]);
export type FolderRole = z.infer<typeof folderRoleSchema>;

export const folderSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  role: folderRoleSchema,
  name: z.string(),
  unread_count: z.number(),
});
export type Folder = z.infer<typeof folderSchema>;

export const folderCountSchema = z.object({ role: folderRoleSchema, unread_count: z.number() });
export type FolderCount = z.infer<typeof folderCountSchema>;

export function isSystemView(value: string): value is SystemView {
  return (SYSTEM_VIEWS as readonly string[]).includes(value);
}

export type MailView =
  | { kind: "system"; role: SystemView; slug: string }
  | { kind: "folder"; folderId: string; slug: string }
  | { kind: "search"; slug: "search" };

const FOLDER_PREFIX = "folder-";

/** Parses the `[view]` route segment. Unknown values fall back to the inbox. */
export function parseMailView(slug: string): MailView {
  if (slug === "search") return { kind: "search", slug };
  if (isSystemView(slug)) return { kind: "system", role: slug, slug };
  if (slug.startsWith(FOLDER_PREFIX) && slug.length > FOLDER_PREFIX.length) {
    return { kind: "folder", folderId: slug.slice(FOLDER_PREFIX.length), slug };
  }
  return { kind: "system", role: "inbox", slug: "inbox" };
}

export function folderViewSlug(folderId: string): string {
  return `${FOLDER_PREFIX}${folderId}`;
}
