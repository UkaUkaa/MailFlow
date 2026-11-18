import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

/** Desktop layout: navigation column, date-grouped list, reader cards, docked reply, settings dialog. */
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  // The fixtures' newest mail is dated 17 November 2026 (a Tuesday).
  await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));
});

test.describe("navigation column", () => {
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

  test("expanding and collapsing moves no icon: one layout in both states", async ({ page }) => {
    await mockApi(page);
    for (const [theme, locale] of [["light", "en"], ["dark", "uk"]] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/${locale}/mail/inbox`);
      const sidebar = page.locator("aside.mf-sidebar");
      await expect(sidebar.locator('nav a[aria-current="true"]')).toBeVisible(); // accounts have loaded
      await expect(sidebar.locator("nav a").first()).toHaveAttribute("aria-label", /3/); // and the unread counts
      const toggle = sidebar.locator("button[aria-expanded]");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");

      /** Position of every control's icon cell (the toggle is its own cell), top to bottom. */
      const icons = () =>
        sidebar.evaluate((aside) =>
          Array.from(aside.querySelectorAll<HTMLElement>("a, button")).map((control) => {
            const cell = control.hasAttribute("aria-expanded") ? control : (control.firstElementChild as HTMLElement);
            const glyph = (cell.querySelector("svg") ?? cell).getBoundingClientRect();
            const box = cell.getBoundingClientRect();
            return {
              // Language and theme rows are named after what they switch to; the row itself is what matters.
              key: control.getAttribute("href") ?? control.getAttribute("aria-label") ?? "",
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              glyphX: glyph.x,
              glyphY: glyph.y,
            };
          }),
        );
      const width = async () => (await sidebar.boundingBox())?.width;
      const expectSame = (before: Awaited<ReturnType<typeof icons>>, after: Awaited<ReturnType<typeof icons>>, context: string) => {
        expect(after.length, `${context}: same number of controls`).toBe(before.length);
        for (const [index, item] of before.entries()) {
          const now = after[index]!;
          for (const key of ["x", "y", "width", "height", "glyphX", "glyphY"] as const) {
            expect(Math.abs(now[key] - item[key]), `${context}: ${item.key} ${key} (${item[key]} → ${now[key]})`).toBeLessThanOrEqual(0.5);
          }
        }
      };

      const collapsed = await icons();
      // toggle, compose, 7 views, all accounts + 2 mailboxes, language, theme, settings
      expect(collapsed).toHaveLength(15);
      // Every icon is centred on the rail's axis.
      for (const item of collapsed) expect(item.x + item.width / 2, `${item.key} on the rail axis`).toBe(35);
      const toggleBox = await toggle.boundingBox();

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect.poll(width).toBe(240);
      const expanded = await icons();
      // The toggle changes its name, nothing else does.
      expect(expanded.slice(1).map((item) => item.key)).toEqual(collapsed.slice(1).map((item) => item.key));
      expectSame(collapsed, expanded, `${locale} expand`);
      expect(await toggle.boundingBox()).toEqual(toggleBox);
      await expect(toggle).toBeFocused();
      await page.screenshot({ path: `e2e/screenshots/1440x900/${locale}-${theme}-10-menu-expanded.png` });

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect.poll(width).toBe(70);
      expectSame(expanded, await icons(), `${locale} collapse`);
      expect(await toggle.boundingBox()).toEqual(toggleBox);
      await expect(toggle).toBeFocused();
      await page.screenshot({ path: `e2e/screenshots/1440x900/${locale}-${theme}-10-menu-collapsed.png` });
    }
  });

  test("expanded: labels and counts appear, tooltips go, and the panes only give up width", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const sidebar = page.locator("aside.mf-sidebar");
    const list = page.locator("main section").first();
    const inbox = sidebar.getByRole("link", { name: "Inbox, 3 unread" });
    await expect(inbox).toBeVisible();
    const label = inbox.locator(".mf-nav-label").first();
    const opacity = () => label.evaluate((element) => getComputedStyle(element).opacity);
    expect(await opacity()).toBe("0");
    const before = await list.boundingBox();

    await sidebar.getByRole("button", { name: "Expand menu" }).click();
    await expect.poll(opacity).toBe("1");
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);
    await expect(inbox).toContainText("Inbox");
    await expect(inbox).toContainText("3");
    // Text is inside the column, not cut off.
    const labelBox = await label.boundingBox();
    expect((labelBox?.x ?? 0) + (labelBox?.width ?? 0)).toBeLessThanOrEqual(240);
    await expect(sidebar.getByText("MailFlow")).toBeVisible();
    // The list pane moved right by exactly the extra width and kept its size and vertical position.
    const after = await list.boundingBox();
    expect(after).toEqual({ ...before!, x: before!.x + 170 });

    // The label is visible, so there is no tooltip repeating it.
    await sidebar.getByRole("link", { name: "Sent" }).hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.mouse.move(900, 450);

    await sidebar.getByRole("button", { name: "Collapse menu" }).click();
    await expect.poll(opacity).toBe("0");
    await sidebar.getByRole("link", { name: "Sent" }).hover();
    await expect(page.getByRole("tooltip", { name: "Sent" })).toBeVisible();
  });

  test("the width animates, the composer follows it, and reduced motion switches it off", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const sidebar = page.locator("aside.mf-sidebar");
    await expect(page.locator("html")).toHaveAttribute("data-nav-ready", "");
    const transition = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return { property: style.transitionProperty, duration: style.transitionDuration };
      });
    expect(await transition()).toEqual({ property: "--nav-width", duration: "0.18s" });

    await sidebar.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    expect((await composer.boundingBox())?.x).toBe(70);
    // Mid-animation the composer's edge is wherever the column's edge is.
    await page.evaluate(() => {
      (window as unknown as { samples: number[][] }).samples = [];
      const aside = document.querySelector("aside.mf-sidebar")!;
      const dialog = document.querySelector('[role=dialog][data-layout="page"]')!;
      const sample = () => {
        (window as unknown as { samples: number[][] }).samples.push([aside.getBoundingClientRect().right, dialog.getBoundingClientRect().left]);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await sidebar.getByRole("button", { name: "Expand menu" }).click();
    await expect.poll(async () => (await composer.boundingBox())?.x).toBe(240);
    const samples = await page.evaluate(() => (window as unknown as { samples: number[][] }).samples);
    expect(samples.some(([edge]) => edge! > 71 && edge! < 239), "the width passed through intermediate values").toBe(true);
    for (const [edge, left] of samples) expect(Math.abs(edge! - left!)).toBeLessThanOrEqual(0.5);
    await page.keyboard.press("Escape");

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(Number.parseFloat((await transition()).duration)).toBeLessThan(0.001);
    // No intermediate widths: the column is 240px, then 70px (the change lands on the next frame).
    await page.evaluate(() => {
      const widths: number[] = [];
      (window as unknown as { widths: number[] }).widths = widths;
      const aside = document.querySelector("aside.mf-sidebar")!;
      const sample = () => {
        widths.push(Math.round(aside.getBoundingClientRect().width));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await sidebar.getByRole("button", { name: "Collapse menu" }).click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(70);
    await page.waitForTimeout(250);
    const widths = await page.evaluate(() => (window as unknown as { widths: number[] }).widths);
    expect([...new Set(widths)].sort(), "reduced motion: no in-between widths").toEqual([240, 70]);
  });

  test("the expanded state survives a reload without flashing the collapsed rail", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const sidebar = page.locator("aside.mf-sidebar");
    await sidebar.getByRole("button", { name: "Expand menu" }).click();
    await expect(sidebar).toHaveAttribute("data-pinned", "true");
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);
    expect(await page.evaluate(() => window.localStorage.getItem("mf-sidebar"))).toBe("false");

    // Record the column's width from the very first frame of the next load, before hydration.
    await page.addInitScript(() => {
      const widths: number[] = [];
      (window as unknown as { navWidths: number[] }).navWidths = widths;
      const sample = () => {
        const aside = document.querySelector("aside.mf-sidebar");
        if (aside) widths.push(Math.round(aside.getBoundingClientRect().width));
        if (widths.length < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await expect(sidebar).toHaveAttribute("data-pinned", "true");
    await expect(sidebar.getByRole("button", { name: "Collapse menu" })).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(400);
    const widths = await page.evaluate(() => (window as unknown as { navWidths: number[] }).navWidths);
    expect(widths.length).toBeGreaterThan(5);
    expect([...new Set(widths)], "the column was 240px in every frame").toEqual([240]);

    // The composer starts after the expanded column, not under it.
    await sidebar.getByRole("button", { name: "Compose" }).click();
    expect((await page.getByRole("dialog", { name: "New message" }).boundingBox())?.x).toBe(240);
    await page.keyboard.press("Escape");
    await sidebar.getByRole("button", { name: "Collapse menu" }).click();
    await expect(sidebar).toHaveAttribute("data-pinned", "false");
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(70);
  });

  test("the toggle works from the keyboard and keeps the focus", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const sidebar = page.locator("aside.mf-sidebar");
    const toggle = sidebar.locator("button[aria-expanded]");
    await expect(sidebar).toHaveAttribute("data-pinned", "false");
    // A key press that lands before React has hydrated the button is lost, so retry.
    await expect(async () => {
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(sidebar).toHaveAttribute("data-pinned", "true", { timeout: 1500 });
    }).toPass();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName("Collapse menu");
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);
    await page.keyboard.press("Enter");
    await expect(sidebar).toHaveAttribute("data-pinned", "false");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName("Expand menu");
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(70);
    // Tab order follows the visual order: toggle, compose, first view.
    await page.keyboard.press("Tab");
    await expect(sidebar.getByRole("button", { name: "Compose" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sidebar.getByRole("link", { name: "Inbox, 3 unread" })).toBeFocused();
  });

  test("accounts are in the column in both states; a mailbox's folders only when expanded", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const sidebar = page.locator("aside.mf-sidebar");
    const accounts = sidebar.getByRole("navigation", { name: "Accounts" });
    await accounts.getByRole("link", { name: "Personal" }).hover();
    await expect(page.getByRole("tooltip", { name: /Personal · Gmail · olena\.kovalenko@example\.com/ })).toBeVisible();
    await accounts.getByRole("link", { name: "Personal" }).click();
    await expect(page).toHaveURL(/account=acc-1/);
    await expect(accounts.getByRole("link", { name: "Personal" })).toHaveAttribute("aria-current", "true");
    await expect(sidebar.getByRole("navigation", { name: "Labels" })).toHaveCount(0);
    const settings = await sidebar.getByRole("link", { name: "Settings" }).boundingBox();

    await sidebar.getByRole("button", { name: "Expand menu" }).click();
    const folders = sidebar.getByRole("navigation", { name: "Labels" });
    await expect(folders.getByRole("link", { name: /Receipts and invoices/ })).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);
    // They sit below the accounts and do not push the bottom block.
    const lastAccount = await accounts.getByRole("link").last().boundingBox();
    const firstFolder = await folders.getByRole("link").first().boundingBox();
    expect(firstFolder!.y).toBeGreaterThan(lastAccount!.y + lastAccount!.height);
    const settingsNow = await sidebar.getByRole("link", { name: "Settings" }).boundingBox();
    expect([settingsNow!.x, settingsNow!.y]).toEqual([settings!.x, settings!.y]);
    await folders.getByRole("link", { name: "Travel" }).click();
    await expect(page).toHaveURL(/\/en\/mail\/folder-f-10\?account=acc-1$/);
  });
});

test.describe("language and theme in the navigation", () => {
  test("rail buttons switch the language and cycle the theme, and save both to the account", async ({ page }) => {
    await mockApi(page);
    const saved: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().endsWith("/api/v1/settings")) saved.push(request.postData() ?? "");
    });
    await page.goto("/en/mail/inbox");
    const rail = page.locator("aside.mf-sidebar");
    const html = page.locator("html");

    // Theme: system → light → dark, the icon button always names the next theme.
    await rail.getByRole("button", { name: "Switch theme to Light" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await rail.getByRole("button", { name: "Switch theme to Dark" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(rail.getByRole("button", { name: "Switch theme to System" })).toBeVisible();

    // Language: one click, the URL and the interface change and the place is kept.
    await rail.getByRole("button", { name: "Switch language to Українська" }).click();
    await expect(page).toHaveURL(/\/uk\/mail\/inbox$/);
    await expect(html).toHaveAttribute("lang", "uk");
    await expect(rail.getByRole("button", { name: "Змінити мову на English" })).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "dark");

    expect(saved.map((body) => JSON.parse(body))).toEqual([{ theme: "light" }, { theme: "dark" }, { locale: "uk" }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("expanded, the same two rows name the current language and theme; the phone drawer has them too", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const sidebar = page.locator("aside.mf-sidebar");
    const language = sidebar.getByRole("button", { name: "Switch language to Українська" });
    const theme = sidebar.getByRole("button", { name: "Switch theme to Light" });
    const before = [await language.boundingBox(), await theme.boundingBox()];
    await sidebar.getByRole("button", { name: "Expand menu" }).click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);
    // Same rows, same place, now with their labels; no segmented switches.
    await expect(language).toContainText("Language: English");
    await expect(theme).toContainText("Theme: System");
    await expect(sidebar.getByRole("group")).toHaveCount(0);
    for (const [index, control] of [language, theme].entries()) {
      const box = await control.boundingBox();
      expect([box?.x, box?.y, box?.height]).toEqual([before[index]?.x, before[index]?.y, before[index]?.height]);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(240);
    }
    await theme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(sidebar.getByRole("button", { name: "Switch theme to Dark" })).toContainText("Theme: Light");
    await sidebar.getByRole("button", { name: "Switch theme to Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await language.click();
    await expect(page).toHaveURL(/\/uk\/mail\/inbox$/);
    const ukLanguage = sidebar.getByRole("button", { name: "Змінити мову на English" });
    await expect(ukLanguage).toContainText("Мова: Українська");
    // The expanded state is kept across the language change.
    await expect(sidebar).toHaveAttribute("data-pinned", "true");
    // Ukrainian labels fit their rows.
    for (const label of await sidebar.locator(".mf-nav-label").all()) {
      const box = await label.boundingBox();
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(240);
    }
    await page.screenshot({ path: "e2e/screenshots/1440x900/uk-dark-11-menu-preferences.png" });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "Відкрити навігацію" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("button", { name: "Змінити мову на English" })).toContainText("Мова: Українська");
    await expect(drawer.getByRole("button", { name: "Змінити тему на Системна" })).toContainText("Тема: Темна");
    for (const control of await drawer.locator("a, button").all()) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.waitForTimeout(300);
    await page.screenshot({ path: "e2e/screenshots/320x568/uk-dark-11-drawer-preferences.png" });
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
