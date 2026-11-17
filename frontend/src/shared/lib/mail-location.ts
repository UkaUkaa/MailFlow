/**
 * Where the user last was in the mail views, kept in memory for this tab only. Surfaces that
 * sit on top of the mail workspace (settings, search) use it to return to the same place.
 */
export interface MailListScope {
  view: string;
  accountId: string | null;
}

let lastHref = "/mail/inbox";
let lastList: MailListScope = { view: "inbox", accountId: null };

/** Called by the mail workspace on every navigation. Search is not a place to return to. */
export function rememberMailLocation(view: string, threadId: string | undefined, searchParams: URLSearchParams): void {
  const query = searchParams.toString();
  lastHref = `/mail/${view}${threadId ? `/${threadId}` : ""}${query ? `?${query}` : ""}`;
  if (view !== "search") lastList = { view, accountId: searchParams.get("account") };
}

/** The last mail page, conversation included (locale-less href). */
export function lastMailLocation(): string {
  return lastHref;
}

/** The last list that was not the search view. */
export function lastMailList(): MailListScope {
  return lastList;
}

export function mailListHref(scope: MailListScope): string {
  return `/mail/${scope.view}${scope.accountId ? `?account=${encodeURIComponent(scope.accountId)}` : ""}`;
}
