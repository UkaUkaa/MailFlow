/** Test fixtures only. Never imported by application code. */

export const user = {
  id: "user-1",
  email: "olena.kovalenko@example.com",
  display_name: "Olena Kovalenko",
  email_verified: true,
  created_at: "2026-01-10T09:00:00Z",
};

const capabilities = {
  threads: true,
  labels: true,
  server_search: true,
  drafts: true,
  spam: true,
  archive: true,
  incremental_sync: true,
};

export interface AccountFixture {
  id: string;
  provider: string;
  email_address: string;
  display_name: string | null;
  color: string | null;
  avatar_updated_at?: string | null;
  status: string;
  status_reason: string | null;
  capabilities: typeof capabilities;
  created_at: string;
  sync: { status: string; last_synced_at: string | null; last_error_code: string | null };
}

export const accounts: AccountFixture[] = [
  {
    id: "acc-1",
    provider: "gmail",
    email_address: "olena.kovalenko@example.com",
    display_name: "Personal",
    color: "#3355e0",
    status: "active",
    status_reason: null,
    capabilities,
    created_at: "2026-02-01T10:00:00Z",
    sync: { status: "idle", last_synced_at: "2026-11-17T08:55:00Z", last_error_code: null },
  },
  {
    id: "acc-2",
    provider: "outlook",
    email_address: "o.kovalenko.with.a.very.long.work.address@subdomain.international-company.example.org",
    display_name: null,
    color: "#1f8a4c",
    status: "needs_reauth",
    status_reason: "token_revoked",
    capabilities: { ...capabilities, labels: false },
    created_at: "2026-03-01T10:00:00Z",
    sync: { status: "error", last_synced_at: "2026-11-10T08:55:00Z", last_error_code: "provider_auth_required" },
  },
];

/**
 * A generic IMAP mailbox. Capabilities are per account: this one has Archive, Junk and Drafts
 * folders; tests that need a mailbox without them override the flags.
 */
export const imapAccount: AccountFixture = {
  id: "acc-imap",
  provider: "imap",
  email_address: "olena@fastmail.example",
  display_name: "Fastmail",
  color: "#b4521f",
  status: "active",
  status_reason: null,
  capabilities: { ...capabilities, threads: false, labels: false, server_search: false },
  created_at: "2026-04-01T10:00:00Z",
  sync: { status: "idle", last_synced_at: "2026-11-17T08:50:00Z", last_error_code: null },
};

export const settings = { locale: "en", theme: "system", load_remote_images: false, conversation_view: true };

const people = [
  { name: "Marta Shevchenko", email: "marta@studio-north.example" },
  { name: "GitHub", email: "notifications@github.example" },
  { name: null, email: "billing-department-notifications-noreply@a-very-long-domain-name-for-testing.example.com" },
  { name: "Андрій Мельник", email: "andrii.melnyk@example.ua" },
  { name: "Linear", email: "updates@linear.example" },
  { name: "Daniel Okafor", email: "daniel@okafor.example" },
];

const subjects = [
  "Q4 planning notes and next steps",
  "[mailflow/app] Fix horizontal overflow in the reading pane on small phones when the subject line is extremely long and has no natural break points (#482)",
  "Invoice INV-2026-11-000482 for November is ready — Supercalifragilisticexpialidocious_and_unbreakable_token_0123456789",
  "Запрошення на щоквартальну зустріч команди та обговорення планів на наступний рік",
  "Weekly digest",
  "Re: Lunch on Thursday?",
];

const snippets = [
  "Hi Olena, here are the notes from today's planning session. The main points we agreed on are below.",
  "@dkim approved these changes. All checks have passed. You can merge this pull request.",
  "Your invoice is attached. The amount due is 1 240,00 USD. Payment is due within 14 days.",
  "Доброго дня! Запрошуємо вас на зустріч, яка відбудеться наступного вівторка о десятій годині ранку.",
  "12 issues were completed this week across 3 projects.",
  "Thursday works for me. Shall we say 12:30 at the usual place?",
];

export interface ThreadFixture {
  id: string;
  account_id: string;
  subject: string;
  snippet: string;
  participants: { name: string | null; email: string }[];
  message_count: number;
  has_attachments: boolean;
  is_unread: boolean;
  is_starred: boolean;
  last_message_at: string;
}

export function makeThreads(count: number, offset = 0): ThreadFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + offset;
    const base = Date.UTC(2026, 10, 17, 9, 0, 0) - n * 5 * 60 * 60 * 1000;
    return {
      id: `thread-${n + 1}`,
      account_id: n % 3 === 2 ? "acc-2" : "acc-1",
      subject: subjects[n % subjects.length] ?? "",
      snippet: snippets[n % snippets.length] ?? "",
      participants: n % 4 === 0 ? [people[0]!, people[5]!, people[3]!, people[1]!] : [people[n % people.length]!],
      message_count: n % 4 === 0 ? 3 : 1,
      has_attachments: n % 3 === 0,
      is_unread: n < 3,
      is_starred: n % 5 === 1,
      last_message_at: new Date(base).toISOString(),
    };
  });
}

const wideTableHtml = `
<p>Hello Olena,</p>
<p>Please find the quarterly numbers below. The link is https://example.com/reports/2026/q4/a-very-long-url-segment-that-does-not-contain-any-natural-break-points-0123456789012345678901234567890123456789</p>
<table width="900" cellpadding="8" style="width:900px;border:1px solid #cccccc">
  <tr style="background:#f0f0f0"><th>Region</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Total</th><th>Change</th></tr>
  <tr><td>North America</td><td>120 400</td><td>131 250</td><td>128 900</td><td>142 310</td><td>522 860</td><td>+8.4%</td></tr>
  <tr><td>Europe</td><td>98 120</td><td>101 480</td><td>99 730</td><td>110 020</td><td>409 350</td><td>+5.1%</td></tr>
</table>
<pre>const total = regions.reduce((sum, region) => sum + region.total, 0); // a long line of code that should wrap instead of overflowing</pre>
<blockquote><p>On Mon, Marta wrote:</p><blockquote><p>Earlier quoted text that goes on for a while to check nested quotes.</p></blockquote></blockquote>
<img src="https://tracker.example/pixel.gif" width="1" height="1" alt="">
`;

export function makeThreadDetail(thread: ThreadFixture) {
  const from = thread.participants[0]!;
  const own = accounts.find((account) => account.id === thread.account_id)!;
  const message = (index: number, overrides: Record<string, unknown> = {}) => ({
    id: `${thread.id}-m${index}`,
    thread_id: thread.id,
    account_id: thread.account_id,
    from,
    to: [
      { name: user.display_name, email: own.email_address },
      { name: "Daniel Okafor", email: "daniel@okafor.example" },
    ],
    cc: [{ name: null, email: "team-announcements-and-updates@a-very-long-domain-name-for-testing.example.com" }],
    bcc: [],
    reply_to: [],
    subject: thread.subject,
    snippet: thread.snippet,
    sent_at: new Date(Date.parse(thread.last_message_at) - (thread.message_count - index) * 3_600_000).toISOString(),
    is_read: true,
    is_starred: false,
    is_draft: false,
    body_html: `<p>${thread.snippet}</p><p>Best regards,<br>${from.name ?? from.email}</p>`,
    body_text: thread.snippet,
    has_remote_images: false,
    attachments: [],
    ...overrides,
  });
  const messages = Array.from({ length: thread.message_count }, (_, index) => message(index + 1));
  const last = messages[messages.length - 1]!;
  last.body_html = wideTableHtml;
  last.has_remote_images = true;
  last.is_read = !thread.is_unread;
  if (thread.has_attachments) {
    last.attachments = [
      { id: `${thread.id}-a1`, filename: "Quarterly-report-2026-Q4-final-version-reviewed-and-approved-by-finance.pdf", mime_type: "application/pdf", size: 2_483_200, is_inline: false },
      { id: `${thread.id}-a2`, filename: "chart.png", mime_type: "image/png", size: 184_320, is_inline: false },
    ] as never;
  }
  return { ...thread, messages };
}

export const folderCounts = [
  { role: "inbox", unread_count: 3 },
  { role: "starred", unread_count: 0 },
  { role: "sent", unread_count: 0 },
  { role: "drafts", unread_count: 1 },
  { role: "archive", unread_count: 0 },
  { role: "trash", unread_count: 0 },
  { role: "spam", unread_count: 12 },
];

export const folders = [
  { id: "f-1", account_id: "acc-1", role: "inbox", name: "Inbox", unread_count: 3 },
  { id: "f-9", account_id: "acc-1", role: "custom", name: "Receipts and invoices from suppliers", unread_count: 2 },
  { id: "f-10", account_id: "acc-1", role: "custom", name: "Travel", unread_count: 0 },
];

export const sessions = [
  {
    id: "s-1",
    created_at: "2026-11-15T09:00:00Z",
    last_seen_at: "2026-11-17T09:00:00Z",
    expires_at: "2026-12-15T09:00:00Z",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    ip_address: "203.0.113.24",
    is_current: true,
  },
  {
    id: "s-2",
    created_at: "2026-11-10T09:00:00Z",
    last_seen_at: "2026-11-16T19:30:00Z",
    expires_at: "2026-12-10T09:00:00Z",
    user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
    ip_address: "2001:db8:85a3:8d3:1319:8a2e:370:7348",
    is_current: false,
  },
];
