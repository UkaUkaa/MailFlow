import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("inbox", () => {
  test("shows the unified inbox with unread, sender, subject, date and indicators", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const list = page.getByRole("list", { name: "Inbox" });
    const first = list.getByRole("listitem").first();
    await expect(first).toContainText("Marta Shevchenko");
    await expect(first).toContainText("Q4 planning notes and next steps");
    await expect(first.getByText("Unread")).toBeAttached();
    await expect(first.getByLabel("Has attachments")).toBeVisible();
    await expect(first.locator("time")).toHaveAttribute("datetime", "2026-11-17T09:00:00.000Z");
    await expect(page.getByRole("link", { name: "Inbox, 3 unread" })).toBeVisible();
  });

  test("loads more conversations while scrolling", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    const rows = page.getByRole("list", { name: "Inbox" }).getByRole("listitem");
    await expect(rows).toHaveCount(30);
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(45);
    await expect(page.getByText("End of list")).toBeVisible();
    expect(api.callsTo("GET", "/threads").length).toBeGreaterThanOrEqual(2);
  });

  test("narrows to a single account", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    // Accounts live in the flyout next to the rail.
    await page.getByRole("button", { name: "Accounts and folders" }).click();
    const flyout = page.getByRole("dialog", { name: "Navigation" });
    await flyout.getByRole("navigation", { name: "Accounts" }).getByRole("link", { name: "Personal" }).click();
    await expect(flyout).toBeHidden();
    await expect(page).toHaveURL(/account=acc-1/);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.locator("header").getByText("Personal")).toBeVisible();
    await expect.poll(() => api.calls.some((call) => call.path === "/threads" && call.headers.referer?.includes("account=acc-1"))).toBe(true);
  });

  test("filters unread conversations", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Show unread only" }).click();
    await expect(page.getByRole("list", { name: "Inbox" }).getByRole("listitem")).toHaveCount(3);
  });

  test("stars a conversation from the list", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    const first = page.getByRole("list", { name: "Inbox" }).getByRole("listitem").first();
    await first.getByRole("button", { name: "Star" }).click();
    await expect(first.getByRole("button", { name: "Remove star" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => api.callsTo("POST", "/threads/thread-1/actions").map((call) => call.body)).toContain('{"action":"star"}');
  });

  test("shows an empty state for an empty folder", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/trash");
    await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  });

  test("invites the user to connect a mailbox when none is connected", async ({ page }) => {
    await mockApi(page, { accounts: [] });
    await page.goto("/en/mail/inbox");
    await expect(page.getByRole("heading", { name: "Connect your first mailbox" })).toBeVisible();
    await page.getByRole("link", { name: "Connect an account" }).click();
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
  });

  test("searches mail", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/sent");
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/mail\/search$/);
    await expect(page.getByRole("searchbox", { name: "Search mail" })).toBeFocused();
    await page.getByRole("searchbox", { name: "Search mail" }).fill("invoice");
    await page.getByRole("searchbox", { name: "Search mail" }).press("Enter");
    await expect(page).toHaveURL(/\/en\/mail\/search\?q=invoice$/);
    const rows = page.getByRole("list", { name: "Search" }).getByRole("listitem");
    await expect(rows.first()).toContainText("Invoice INV-2026-11-000482");

    await page.getByRole("searchbox", { name: "Search mail" }).fill("nothing");
    await page.getByRole("searchbox", { name: "Search mail" }).press("Enter");
    await expect(page.getByRole("heading", { name: "No results" })).toBeVisible();

    // Clearing goes back to the suggestions: this session's queries, newest first, and no operators.
    await page.getByRole("button", { name: "Clear search" }).click();
    const recent = page.getByRole("region", { name: "Recent searches" }).getByRole("link");
    await expect(recent).toHaveText(["nothing", "invoice"]);
    await expect(page.getByText(/from:|has:|subject:/)).toHaveCount(1); // only the note that operators are not supported
    await recent.last().click();
    await expect(page).toHaveURL(/\/en\/mail\/search\?q=invoice$/);
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain("invoice");

    // Escape leaves search for the list the user came from.
    await page.getByRole("searchbox", { name: "Search mail" }).press("Escape");
    await expect(page).toHaveURL(/\/en\/mail\/sent$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible();
  });

  test("starts a manual synchronization", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect.poll(() => api.callsTo("POST", "/sync/all").length).toBe(1);
  });
});

test.describe("reading", () => {
  test("opens a conversation next to the list and marks it read", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("link", { name: /Q4 planning notes/ }).first().click();
    await expect(page).toHaveURL(/\/en\/mail\/inbox\/thread-1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Q4 planning notes and next steps" })).toBeVisible();
    // Three-pane layout: the list stays visible beside the reader.
    await expect(page.getByRole("list", { name: "Inbox" })).toBeVisible();
    await expect.poll(() => api.callsTo("POST", "/threads/thread-1/actions").map((call) => call.body)).toContain('{"action":"mark_read"}');
    await expect(page.getByRole("link", { name: "Download: chart.png" })).toHaveAttribute(
      "href",
      "/api/v1/attachments/thread-1-a2/download",
    );
  });

  test("renders email HTML in a script-less sandbox with remote images blocked", async ({ page }) => {
    await mockApi(page);
    // Counts requests that actually reach the network (CSP-blocked ones never do).
    const remote: string[] = [];
    await page.route("**://tracker.example/**", (route) => {
      remote.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "image/gif", body: "" });
    });
    await page.goto("/en/mail/inbox/thread-1");
    const frame = page.locator("iframe[title='Message from Marta Shevchenko']").last();
    await expect(frame).toBeVisible();
    const sandbox = (await frame.getAttribute("sandbox")) ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).not.toContain("allow-top-navigation");
    const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain("img-src data: cid:;");
    expect(srcdoc).not.toContain("tracker.example");

    await expect(page.getByText("Remote images are hidden to protect your privacy.")).toBeVisible();
    await page.waitForTimeout(300);
    expect(remote).toHaveLength(0);

    await page.getByRole("button", { name: "Show images" }).click();
    await expect(page.getByText("Remote images are hidden")).toHaveCount(0);
    await expect.poll(async () => (await frame.getAttribute("srcdoc")) ?? "").toContain("img-src data: cid: https: http:");
    await expect.poll(() => remote.length).toBeGreaterThan(0);
  });

  test("archives from the reader and can undo", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-2");
    await expect(page.getByRole("heading", { level: 1, name: /Fix horizontal overflow/ })).toBeVisible();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page).toHaveURL(/\/en\/mail\/inbox$/);
    await expect(page.getByText("Conversation archived")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => api.callsTo("POST", "/threads/thread-2/actions").map((call) => call.body)).toEqual(
      expect.arrayContaining(['{"action":"archive"}', '{"action":"unarchive"}']),
    );
  });

  test("moves a conversation to trash", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-4");
    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByText("Conversation moved to trash")).toBeVisible();
    await expect.poll(() => api.callsTo("POST", "/threads/thread-4/actions").map((call) => call.body)).toContain('{"action":"trash"}');
  });

  test("shows a not-found state for a missing conversation", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox/does-not-exist");
    await expect(page.getByRole("heading", { name: "Conversation not found" })).toBeVisible();
  });

  test("expands earlier messages and shows recipient details", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox/thread-1");
    await expect(page.getByRole("button", { name: "Expand message from Marta Shevchenko" })).toHaveCount(2);
    await page.getByRole("button", { name: "Expand message from Marta Shevchenko" }).first().click();
    await expect(page.getByRole("button", { name: "Expand message from Marta Shevchenko" })).toHaveCount(1);
    await page.getByRole("button", { name: /Show or hide details/ }).first().click();
    await expect(page.getByText("Daniel Okafor <daniel@okafor.example>").first()).toBeVisible();
  });
});
