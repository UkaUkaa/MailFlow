import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

/** Desktop layout: rail and flyout, date-grouped list, reader cards, docked reply, settings dialog. */
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  // The fixtures' newest mail is dated 17 November 2026 (a Tuesday).
  await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));
});

test.describe("rail and flyout", () => {
  test("three tonal steps: rail, list pane and reading pane differ and have no divider", async ({ page }) => {
    await mockApi(page);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/en/mail/inbox");
      await expect(page.getByRole("list", { name: "Inbox" })).toBeVisible();
      const tones = await page.evaluate(() => {
        const background = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
        const list = document.querySelector("main section")!;
        return {
          rail: background("aside.mf-sidebar"),
          list: getComputedStyle(list).backgroundColor,
          reader: background("main"),
          page: getComputedStyle(document.body).backgroundColor,
          listBorder: getComputedStyle(list.parentElement!).borderRightWidth,
          railBorder: getComputedStyle(document.querySelector("aside.mf-sidebar")!).borderRightWidth,
        };
      });
      expect(new Set([tones.rail, tones.list, tones.page]).size, `${theme}: three distinct surfaces`).toBe(3);
      expect(tones.listBorder).toBe("0px");
      expect(tones.railBorder).toBe("0px");
    }
  });

  test("the open view is a solid accent square with a tooltip on hover and focus", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/starred");
    const rail = page.locator("aside.mf-sidebar");
    const starred = rail.getByRole("link", { name: "Starred" });
    await expect(starred).toHaveAttribute("aria-current", "page");
    const box = await starred.boundingBox();
    expect([box?.width, box?.height]).toEqual([28, 28]);
    const colours = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const link = document.querySelector("aside.mf-sidebar a[aria-current=page]")!;
      const probe = document.createElement("span");
      probe.style.color = root.getPropertyValue("--accent");
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { background: getComputedStyle(link).backgroundColor, accent, radius: getComputedStyle(link).borderRadius };
    });
    expect(colours.background).toBe(colours.accent);
    expect(colours.radius).toBe("7px");

    await rail.getByRole("link", { name: "Sent" }).hover();
    await expect(page.getByRole("tooltip", { name: "Sent" })).toBeVisible();
    await page.mouse.move(700, 450);
    // Keyboard users get the same label.
    await rail.getByRole("button", { name: "Compose" }).focus();
    await page.keyboard.press("Tab");
    await expect(rail.getByRole("link", { name: "Inbox, 3 unread" })).toBeFocused();
    await expect(page.getByRole("tooltip", { name: "Inbox" })).toBeVisible();
  });

  test("the flyout is keyboard operable: opens, traps focus, navigates and returns focus", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const more = page.getByRole("button", { name: "Accounts and folders" });
    await more.focus();
    await page.keyboard.press("Enter");
    const flyout = page.getByRole("dialog", { name: "Navigation" });
    await expect(flyout).toBeVisible();
    // While it is open the rest of the page is hidden from assistive technology, so query by CSS.
    await expect(page.locator("aside.mf-sidebar button[aria-haspopup=dialog]")).toHaveAttribute("aria-expanded", "true");
    await expect(flyout.getByRole("link", { name: "Inbox, 3 unread" })).toBeFocused();
    await expect(flyout.getByRole("link", { name: "Spam, 12 unread" })).toContainText("12");
    await expect(flyout.getByRole("navigation", { name: "Accounts" })).toBeVisible();

    // Focus stays inside while tabbing through every control and around.
    for (let step = 0; step < 16; step += 1) {
      await page.keyboard.press("Tab");
      expect(await flyout.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(flyout).toBeHidden();
    await expect(more).toBeFocused();

    // Choosing a destination closes it.
    await page.keyboard.press("Enter");
    await flyout.getByRole("link", { name: "Sent" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/mail\/sent$/);
    await expect(flyout).toBeHidden();

    // And so does a click outside it.
    await more.click();
    await expect(flyout).toBeVisible();
    await page.mouse.click(1000, 450);
    await expect(flyout).toBeHidden();
  });

  test("the sidebar can be pinned open and the choice survives a reload", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Accounts and folders" }).click();
    await page.getByRole("button", { name: "Keep sidebar open" }).click();
    const sidebar = page.locator("aside.mf-sidebar");
    await expect(sidebar).toHaveAttribute("data-pinned", "true");
    expect((await sidebar.boundingBox())?.width).toBe(240);
    await expect(sidebar.getByRole("navigation", { name: "Accounts" })).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/1440x900/en-light-10-pinned-sidebar.png" });
    await page.reload();
    await expect(sidebar).toHaveAttribute("data-pinned", "true");
    // The composer starts after the pinned sidebar, not under it.
    await sidebar.getByRole("button", { name: "Compose" }).click();
    expect((await page.getByRole("dialog", { name: "New message" }).boundingBox())?.x).toBe(240);
    await page.keyboard.press("Escape");
    await sidebar.getByRole("button", { name: "Collapse to icons" }).click();
    await expect(sidebar).toHaveAttribute("data-pinned", "false");
    expect((await sidebar.boundingBox())?.width).toBe(70);
  });
});

test.describe("thread list", () => {
  test("groups conversations by date in the browser's time zone", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const list = page.getByRole("list", { name: "Inbox" });
    await expect(list.getByRole("listitem")).toHaveCount(30);
    // en-US weeks start on Sunday: Sunday 15 November is still "this week".
    await expect(list.getByRole("heading")).toHaveText(["Today", "Yesterday", "This week", "Last week"]);
    await list.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await expect(list.getByRole("listitem")).toHaveCount(45);
    // The fixtures span nine days, so everything older still falls into last week.
    await expect(list.getByRole("heading")).toHaveText(["Today", "Yesterday", "This week", "Last week"]);

    await page.goto("/uk/mail/inbox");
    const ukList = page.getByRole("list", { name: "Вхідні" });
    // Ukrainian weeks start on Monday: the 15th belongs to last week.
    await expect(ukList.getByRole("heading")).toHaveText(["Сьогодні", "Учора", "Минулого тижня"]);
  });

  test("moves the groups when the time zone changes the calendar day", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Pacific/Auckland", locale: "en-US" });
    const page = await context.newPage();
    // 17 Nov 12:00 UTC is already 01:00 on the 18th in Auckland; the newest mail (09:00 UTC = 22:00 on the 17th) is yesterday's.
    await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const list = page.getByRole("list", { name: "Inbox" });
    await expect(list.getByRole("listitem")).toHaveCount(30);
    await expect(list.getByRole("heading").first()).toHaveText("Yesterday");
    await expect(list.getByRole("heading", { name: "Today" })).toHaveCount(0);
    await context.close();
  });

  test("row: avatar, three lines, and quick actions in the gutter on hover and on keyboard focus", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    const rows = page.getByRole("list", { name: "Inbox" }).getByRole("listitem");
    const first = rows.first();
    expect((await first.boundingBox())?.height).toBe(88);
    await expect(first.getByText("3 messages")).toBeAttached();

    // Hidden at rest.
    const second = rows.nth(1);
    await expect(second.getByRole("button", { name: "Archive" })).toBeHidden();
    await second.hover();
    const archive = second.getByRole("button", { name: "Archive" });
    await expect(archive).toBeVisible();
    await expect(second.getByRole("button", { name: "Mark as read" })).toBeVisible();
    await expect(second.getByRole("button", { name: "Move to trash" })).toBeVisible();
    // They take the place of the dot and the avatar, inside the row's left gutter.
    const [rowBox, archiveBox] = [await second.boundingBox(), await archive.boundingBox()];
    expect((archiveBox?.x ?? 0) - (rowBox?.x ?? 0)).toBeLessThan(58);

    // Keyboard: focusing the row reveals them without a pointer.
    await page.mouse.move(1000, 450);
    await expect(archive).toBeHidden();
    await second.getByRole("link").focus();
    await page.keyboard.press("Tab"); // star: the row now holds keyboard focus
    await expect(second.getByRole("button", { name: "Star", exact: true }).or(second.getByRole("button", { name: "Remove star" }))).toBeFocused();
    await expect(archive).toBeVisible();
    await page.keyboard.press("Tab"); // mark as read
    await expect(second.getByRole("button", { name: "Mark as read" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => api.callsTo("POST", "/threads/thread-2/actions").map((call) => call.body)).toContain('{"action":"mark_read"}');
    await expect(second.getByText("Unread")).toHaveCount(0);

    // Trash from the gutter is optimistic and can be undone.
    await second.hover();
    await second.getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByText("Conversation moved to trash")).toBeVisible();
    await expect(rows.nth(1)).not.toContainText("Fix horizontal overflow");
  });

  test("the selected row has the accent tint and no border", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox/thread-2");
    const selected = page.getByRole("list", { name: "Inbox" }).getByRole("listitem").nth(1);
    await expect(selected.getByRole("link")).toHaveAttribute("aria-current", "true");
    const style = await selected.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent-soft");
      document.body.append(probe);
      const tint = getComputedStyle(probe).color;
      probe.remove();
      return { background: getComputedStyle(element).backgroundColor, tint, border: getComputedStyle(element).borderBottomWidth };
    });
    expect(style.background).toBe(style.tint);
    expect(style.border).toBe("0px");
  });
});

test.describe("reader", () => {
  test("empty pane is a decorative glyph with hidden text", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    await expect(page.getByText("No conversation selected.")).toBeAttached();
    await expect(page.getByRole("heading", { name: "No conversation selected" })).toHaveCount(0);
  });

  test("toolbar pill closes or archives; quoted history is collapsed until asked for", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-2");
    const frame = page.locator("iframe").last();
    await expect(frame).toBeVisible();
    const quoteHidden = () =>
      frame.evaluate((element: HTMLIFrameElement) => {
        const quote = element.contentDocument?.querySelector("blockquote");
        return quote ? getComputedStyle(quote).display === "none" : null;
      });
    await expect.poll(quoteHidden).toBe(true);
    const toggle = page.getByRole("button", { name: "Show quoted text" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect.poll(quoteHidden).toBe(false);
    await expect(page.getByRole("button", { name: "Hide quoted text" })).toHaveAttribute("aria-expanded", "true");
    // The frame is exactly as locked down as before.
    expect(await frame.getAttribute("sandbox")).toBe("allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    expect(await frame.getAttribute("srcdoc")).toContain("default-src 'none'");

    await page.getByRole("button", { name: "Mark as spam" }).click();
    await expect.poll(() => api.callsTo("POST", "/threads/thread-2/actions").map((call) => call.body)).toContain('{"action":"spam"}');
    await expect(page).toHaveURL(/\/en\/mail\/inbox$/);

    await page.goto("/en/mail/inbox/thread-4");
    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(page).toHaveURL(/\/en\/mail\/inbox$/);
  });
});

test.describe("docked reply", () => {
  test("opens at the bottom right of the reading pane, expands, docks and sends", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-2");
    await page.getByRole("article").getByRole("button", { name: "Reply", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Reply", exact: true });
    await expect(panel).toHaveAttribute("data-layout", "docked");
    await expect(panel.getByLabel("Subject")).toHaveValue(/^Re: \[mailflow\/app\]/);
    await expect(panel.getByRole("textbox", { name: "Message" })).toBeFocused();
    await page.keyboard.type("Looks good.");
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(520);
    // The conversation stays readable behind it.
    await expect(page.getByRole("heading", { level: 1, name: /Fix horizontal overflow/ })).toBeVisible();

    await panel.getByRole("button", { name: "Expand" }).click();
    await expect(panel).toHaveAttribute("data-layout", "page");
    expect(await panel.boundingBox()).toMatchObject({ x: 70, y: 0, width: 1370, height: 900 });
    await expect(panel.getByRole("textbox", { name: "Message" })).toContainText("Looks good.");
    await panel.getByRole("button", { name: "Dock" }).click();
    await expect(panel).toHaveAttribute("data-layout", "docked");
    await expect(panel.getByRole("textbox", { name: "Message" })).toContainText("Looks good.");

    await panel.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Message sent")).toBeVisible();
    const sends = api.callsTo("POST", "/emails/send");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sends[0]?.body).toContain('"mode":"reply"');
    expect(sends[0]?.body).toContain("Looks good.");
  });

  test("below 1024px a reply uses the full composer", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await mockApi(page);
    await page.goto("/en/mail/inbox/thread-2");
    await page.getByRole("article").getByRole("button", { name: "Reply", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Reply", exact: true });
    await expect(panel).toHaveAttribute("data-layout", "page");
    await expect(panel.getByRole("button", { name: "Expand" })).toHaveCount(0);
  });
});

test.describe("settings dialog", () => {
  test("opens over the mail view and closes back to it", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/sent");
    await expect(page.getByRole("list", { name: "Sent" })).toBeVisible();
    await page.locator("aside.mf-sidebar").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/en\/settings$/);
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const box = await dialog.boundingBox();
    expect([box?.width, box?.height]).toEqual([870, 700]);
    // The list the user came from stays behind it, out of reach.
    const behind = page.locator("[inert] section h1");
    await expect(behind).toHaveText("Sent");
    await expect(page.locator("aside.mf-sidebar")).toHaveAttribute("inert", "");
    await expect(dialog.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();

    // The URL follows the section.
    await dialog.getByRole("link", { name: "Sessions" }).click();
    await expect(page).toHaveURL(/\/en\/settings\/sessions$/);
    await expect(dialog.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");

    // Tab never leaves the dialog.
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/en\/mail\/sent$/);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("aside.mf-sidebar")).not.toHaveAttribute("inert");
  });

  test("deep links open the dialog on their section: OAuth return, error and a reload", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/settings/accounts?connected=acc-1");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByRole("heading", { level: 1, name: "Connected accounts" })).toBeVisible();
    await expect(page.getByText("Mailbox connected. The first synchronization has started.")).toHaveCount(1);
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
    await expect(dialog.getByRole("link", { name: "Connected accounts" })).toHaveAttribute("aria-current", "page");
    // With nothing remembered, the inbox is what shows behind and what closing returns to.
    await expect(page.locator("[inert] section h1")).toHaveText("Inbox");

    await page.goto("/en/settings/accounts?error=access_denied");
    await expect(page.getByText("Access was not granted, so the mailbox was not connected.")).toHaveCount(1);
    await expect(dialog).toBeVisible();

    await page.goto("/en/settings/danger");
    await page.reload();
    await expect(dialog.getByRole("heading", { level: 1, name: "Delete account" })).toBeVisible();
    await page.mouse.click(20, 450); // the dimmed backdrop
    await expect(page).toHaveURL(/\/en\/mail\/inbox$/);
  });

  test("dialogs opened from settings sit on top, and Escape closes only them", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/settings/accounts");
    const settings = page.locator("[role=dialog][aria-modal=true]").first();
    await page.getByRole("button", { name: "Connect another mail account (IMAP)" }).click();
    const imap = page.getByRole("dialog").filter({ has: page.getByLabel("Password") });
    await expect(imap).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(imap).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
    await expect(settings).toBeVisible();

    await page.getByRole("button", { name: "Actions for Personal" }).click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
  });

  test("on a phone settings are pages, not a dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto("/en/settings/accounts?connected=acc-1");
    await expect(page.getByText("Mailbox connected. The first synchronization has started.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to settings" })).toBeVisible();
    await expect(page.locator("[inert] section")).toHaveCount(0);
  });
});
