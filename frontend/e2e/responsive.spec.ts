import { expect, test, type Page } from "@playwright/test";
import { expectInViewport, expectNoHorizontalOverflow, expectNoOverlap, expectTouchTarget, settle } from "./fixtures/helpers";
import { mockApi } from "./fixtures/mock-api";

/**
 * Viewport matrix from the product requirements. Every key screen is opened at
 * every size and checked for horizontal overflow, clipped or overlapping
 * controls and (on phones) touch-target size. Screenshots are written to
 * e2e/screenshots/<viewport>/ for visual review.
 */
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 430, height: 932 },
  { width: 600, height: 900 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

/** Landscape phones and tablets. */
const LANDSCAPE = [
  { width: 568, height: 320 },
  { width: 812, height: 375 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 1180, height: 820 },
] as const;

type Locale = "en" | "uk";
type Size = { width: number; height: number };

const TEXT = {
  en: {
    signIn: "Sign in",
    inbox: "Inbox",
    compose: "Compose",
    newMessage: "New message",
    send: "Send",
    reply: "Reply",
    replyTitle: "Reply",
    primary: "Primary",
    openMenu: "Open navigation",
    menu: "Navigation",
    mailboxes: "Your mailboxes",
    connectGmail: "Connect Gmail",
    connectOutlook: "Connect Outlook",
    back: "Back to list",
    formatting: "Formatting",
    settings: "Settings",
    subject: "Subject",
    to: "To",
    expand: "Expand menu",
    collapse: "Collapse menu",
    search: "Search mail",
    searchHint: "Search by words",
    searchResults: "Search",
    today: "Today",
    showQuoted: "Show quoted text",
    settingsTitle: "Settings",
  },
  uk: {
    signIn: "Увійти",
    inbox: "Вхідні",
    compose: "Написати",
    newMessage: "Новий лист",
    send: "Надіслати",
    reply: "Відповісти",
    replyTitle: "Відповідь",
    primary: "Основна навігація",
    openMenu: "Відкрити навігацію",
    menu: "Навігація",
    mailboxes: "Ваші поштові скриньки",
    connectGmail: "Підключити Gmail",
    connectOutlook: "Підключити Outlook",
    back: "Назад до списку",
    formatting: "Форматування",
    settings: "Налаштування",
    subject: "Тема",
    to: "Кому",
    expand: "Розгорнути меню",
    collapse: "Згорнути меню",
    search: "Пошук у пошті",
    searchHint: "Пошук за словами",
    searchResults: "Пошук",
    today: "Сьогодні",
    showQuoted: "Показати цитований текст",
    settingsTitle: "Налаштування",
  },
} satisfies Record<Locale, Record<string, string>>;

const LONG_SUBJECT = /Fix horizontal overflow/;

async function shot(page: Page, size: Size, locale: Locale, theme: string, name: string) {
  await settle(page);
  await page.screenshot({ path: `e2e/screenshots/${size.width}x${size.height}/${locale}-${theme}-${name}.png` });
}

async function walkthrough(page: Page, size: Size, locale: Locale, theme: "light" | "dark") {
  const t = TEXT[locale];
  const phone = size.width < 768;
  const split = size.width >= 900;
  const desktop = size.width >= 1024;
  const label = `${size.width}x${size.height} ${locale}`;
  await page.emulateMedia({ colorScheme: theme });
  // The fixtures' newest mail is dated 17 November 2026; pin "now" so the date groups are stable.
  await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));

  // 1. Login
  await mockApi(page, { authenticated: false });
  await page.goto(`/${locale}/login`);
  const submit = page.getByRole("button", { name: t.signIn });
  // Short landscape screens scroll vertically; the action must still be reachable.
  await submit.scrollIntoViewIfNeeded();
  await expectInViewport(page, submit, `${label} login submit`);
  await expectNoHorizontalOverflow(page, `${label} login`);
  if (phone) {
    await expectTouchTarget(submit, `${label} login submit`);
    await expectTouchTarget(page.locator("input"), `${label} login inputs`, 44);
  }
  await shot(page, size, locale, theme, "1-login");

  // 2. Unified inbox
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockApi(page);
  await page.goto(`/${locale}/mail/inbox`);
  const list = page.getByRole("list", { name: t.inbox });
  await expect(list).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} inbox`);
  const rows = list.getByRole("listitem");
  for (const index of [0, 1, 2, 3]) {
    const row = rows.nth(index);
    const box = await row.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= size.width + 0.5, `${label} row ${index} inside viewport`).toBe(true);
    // Long senders and subjects are truncated, never wrapped into tall rows: three lines, 88px.
    expect(box?.height ?? 0, `${label} row ${index} height`).toBeLessThanOrEqual(96);
    expect(box?.height ?? 0, `${label} row ${index} is a three-line row`).toBeGreaterThanOrEqual(88);
    // Avatar disc: 28px, never squeezed by a long sender.
    const avatar = await row.locator("a > span").first().locator("span[aria-hidden]").last().boundingBox();
    expect(Math.round(avatar?.width ?? 0), `${label} row ${index} avatar`).toBe(28);
    await expectNoOverlap(row.locator("time"), row.getByRole("button").first(), `${label} row ${index} time vs star`);
  }
  // Conversations are grouped by date; the fixtures' newest mail is from "today".
  await expect(list.getByRole("heading", { name: t.today }), `${label} date group`).toBeVisible();
  if (phone) {
    const nav = page.getByRole("navigation", { name: t.primary });
    await expectInViewport(page, nav, `${label} bottom nav`);
    await expectTouchTarget(nav.locator("a, button"), `${label} bottom nav items`);
    await expectTouchTarget(page.getByRole("button", { name: t.openMenu }), `${label} menu button`);
    await expectTouchTarget(rows.first().getByRole("button").first(), `${label} star`);
    await expect(page.locator("aside.mf-sidebar")).toBeHidden();
    // The list must not disappear behind the fixed navigation.
    const navBox = await nav.boundingBox();
    const listBox = await list.locator("xpath=..").boundingBox();
    expect((listBox?.y ?? 0) + (listBox?.height ?? 0), `${label} list ends above bottom nav`).toBeLessThanOrEqual((navBox?.y ?? 0) + 0.5);
  } else {
    await expectInViewport(page, page.locator("aside.mf-sidebar"), `${label} sidebar`);
    await expect(page.getByRole("navigation", { name: t.primary })).toBeHidden();
  }
  await shot(page, size, locale, theme, "2-inbox");

  // 3. Navigation
  if (phone) {
    await page.getByRole("button", { name: t.openMenu }).click();
    const drawer = page.getByRole("dialog", { name: t.menu });
    await expectInViewport(page, drawer, `${label} drawer`);
    await expectTouchTarget(drawer.locator("nav a"), `${label} drawer links`);
    await expectNoHorizontalOverflow(page, `${label} drawer`);
    await shot(page, size, locale, theme, "3-navigation");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  } else {
    const sidebar = page.locator("aside.mf-sidebar");
    // One navigation column from 768px: the 70px icon rail, expanded in place to 240px.
    expect((await sidebar.boundingBox())?.width ?? 0, `${label} rail`).toBe(70);
    const toggle = sidebar.getByRole("button", { name: t.expand });
    const toggleBox = await toggle.boundingBox();
    const settingsLink = sidebar.getByRole("link", { name: t.settings });
    const settingsBox = await settingsLink.boundingBox();
    await expectInViewport(page, settingsLink, `${label} settings at the bottom of the rail`);
    await toggle.click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width, { message: `${label} expanded menu` }).toBe(240);
    const collapse = sidebar.getByRole("button", { name: t.collapse });
    expect(await collapse.boundingBox(), `${label} toggle did not move`).toEqual(toggleBox);
    const settingsExpanded = await settingsLink.boundingBox();
    expect([settingsExpanded?.x, settingsExpanded?.y], `${label} settings row did not move`).toEqual([settingsBox?.x, settingsBox?.y]);
    await expectNoHorizontalOverflow(page, `${label} expanded menu`);
    // Labels stay inside the column in both languages.
    for (const text of await sidebar.locator(".mf-nav-label").all()) {
      const box = await text.boundingBox();
      if (box) expect(box.x + box.width, `${label} label inside the menu`).toBeLessThanOrEqual(240.5);
    }
    await expect(list, `${label} list beside the expanded menu`).toBeVisible();
    await shot(page, size, locale, theme, "3-navigation");
    await collapse.click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width, { message: `${label} collapsed again` }).toBe(70);
    await expect(toggle, `${label} focus stays on the toggle`).toBeFocused();
  }

  // 4. Reader: long subject, long addresses, a 900px-wide table and a long URL
  await page.goto(`/${locale}/mail/inbox/thread-2`);
  const heading = page.getByRole("heading", { level: 1, name: LONG_SUBJECT });
  await expect(heading).toBeVisible();
  const frame = page.locator("iframe").last();
  await expect(frame).toBeVisible();
  await settle(page);
  await expectNoHorizontalOverflow(page, `${label} reader`);
  const headingBox = await heading.boundingBox();
  expect((headingBox?.x ?? 0) + (headingBox?.width ?? 0), `${label} subject wraps inside the pane`).toBeLessThanOrEqual(size.width + 0.5);
  const frameBox = await frame.boundingBox();
  expect((frameBox?.x ?? -1) >= 0 && (frameBox?.x ?? 0) + (frameBox?.width ?? 0) <= size.width + 0.5, `${label} email frame inside viewport`).toBe(true);
  // Reading width stays comfortable on wide and ultrawide screens.
  expect(frameBox?.width ?? 0, `${label} reading width cap`).toBeLessThanOrEqual(768);
  // The wide table was scaled to fit, not clipped.
  const inner = await frame.evaluate((element: HTMLIFrameElement) => ({
    scrollWidth: element.contentDocument?.documentElement.scrollWidth ?? 0,
    clientWidth: element.contentDocument?.documentElement.clientWidth ?? 0,
  }));
  expect(inner.scrollWidth, `${label} email content fits its frame`).toBeLessThanOrEqual(inner.clientWidth + 1);
  if (split) await expect(list).toBeVisible();
  else await expect(list).toBeHidden();
  await expectInViewport(page, page.getByRole("link", { name: t.back }), `${label} back`);
  // Messages are cards: 12px radius, inside the pane with a 12px inset.
  const card = page.locator("article").filter({ has: frame });
  const cardBox = await card.boundingBox();
  expect(await card.evaluate((element) => getComputedStyle(element).borderTopLeftRadius), `${label} card radius`).toBe("12px");
  expect((cardBox?.x ?? 0) >= 12 && (cardBox?.x ?? 0) + (cardBox?.width ?? 0) <= size.width - 12 + 0.5, `${label} card inset`).toBe(true);
  // Quoted history starts collapsed behind a toggle.
  await expect(card.getByRole("button", { name: t.showQuoted }), `${label} quote toggle`).toBeVisible();
  const reply = page.getByRole("button", { name: t.reply, exact: true }).locator("visible=true").first();
  if (phone) {
    await expectInViewport(page, reply, `${label} sticky reply`);
    await expectTouchTarget(reply, `${label} reply`);
    await expectTouchTarget(page.locator("section").first().locator(":scope > div").first().locator("a, button"), `${label} reader toolbar`);
  }
  await shot(page, size, locale, theme, "4-reader");

  // 4b. Reply: docked panel on desktop, the full composer below.
  await reply.click();
  const replyPanel = page.getByRole("dialog", { name: t.replyTitle, exact: true });
  await expectInViewport(page, replyPanel, `${label} reply composer`);
  await settle(page); // the docked panel scales in
  const replyBox = await replyPanel.boundingBox();
  if (desktop) {
    expect(replyBox?.width, `${label} docked reply width`).toBe(520);
    expect(replyBox?.height ?? 0, `${label} docked reply height`).toBeLessThanOrEqual(380);
    expect(Math.round((replyBox?.x ?? 0) + (replyBox?.width ?? 0)), `${label} docked reply sits at the right edge`).toBe(size.width - 12);
    expect(Math.round((replyBox?.y ?? 0) + (replyBox?.height ?? 0)), `${label} docked reply sits at the bottom`).toBe(size.height - 12);
  } else {
    expect(replyBox, `${label} reply takes the workspace`).toMatchObject({ x: phone ? 0 : 70, y: 0, width: phone ? size.width : size.width - 70, height: size.height });
  }
  await expectInViewport(page, replyPanel.getByRole("button", { name: t.send }).locator("visible=true").first(), `${label} reply send`);
  await expectInViewport(page, replyPanel.getByRole("toolbar", { name: t.formatting }), `${label} reply formatting`);
  await expectNoHorizontalOverflow(page, `${label} reply composer`);
  await shot(page, size, locale, theme, "4b-reply");
  await page.keyboard.press("Escape");
  await expect(replyPanel).toHaveCount(0);

  // 5. Composer
  await page.goto(`/${locale}/mail/inbox`);
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: t.compose }).locator("visible=true").first().click();
  const composer = page.getByRole("dialog", { name: t.newMessage });
  await expect(composer).toBeVisible();
  await composer.getByLabel(t.to).fill("someone-with-a-really-long-address@a-very-long-domain-name-for-testing.example.com, b@example.com,");
  await composer.getByLabel(t.subject).fill("Supercalifragilisticexpialidocious_and_unbreakable_subject_token_0123456789_0123456789");
  await expectInViewport(page, composer, `${label} composer`);
  const send = composer.getByRole("button", { name: t.send }).locator("visible=true").first();
  await expectInViewport(page, send, `${label} send`);
  await expectInViewport(page, composer.getByRole("toolbar", { name: t.formatting }), `${label} formatting toolbar`);
  await expectNoHorizontalOverflow(page, `${label} composer`);
  const composerBox = await composer.boundingBox();
  if (phone) {
    expect(composerBox, `${label} composer is full screen`).toMatchObject({ x: 0, y: 0, width: size.width, height: size.height });
    await expectTouchTarget(send, `${label} send`);
    await expectTouchTarget(composer.locator("footer").locator("button, label[role=button]"), `${label} composer toolbar`);
  } else {
    // Takes over the list and reading panes; the rail stays.
    expect(composerBox, `${label} composer takes the workspace`).toMatchObject({ x: 70, y: 0, width: size.width - 70, height: size.height });
    await expectInViewport(page, page.locator("aside.mf-sidebar"), `${label} rail beside the composer`);
    // The subject is the document title: 22px, no field chrome.
    const subjectStyle = await composer.getByLabel(t.subject).evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, border: style.borderTopWidth };
    });
    expect(subjectStyle, `${label} subject as title`).toEqual({ size: "22px", border: "0px" });
  }
  await shot(page, size, locale, theme, "5-composer");
  await composer.getByLabel(t.subject).fill("");
  await composer.getByLabel(t.to).press("Backspace");
  await composer.getByLabel(t.to).press("Backspace");

  // 6. Search as a mode of the list pane
  await page.goto(`/${locale}/mail/search`);
  const searchbox = page.getByRole("searchbox", { name: t.search });
  await expect(searchbox).toBeFocused();
  await expect(page.getByRole("heading", { name: t.searchHint })).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} search suggestions`);
  if (phone) await expectTouchTarget(searchbox, `${label} search field`);
  await shot(page, size, locale, theme, "8-search");
  await searchbox.fill("invoice");
  await searchbox.press("Enter");
  await expect(page.getByRole("list", { name: t.searchResults }).getByRole("listitem").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} search results`);
  await shot(page, size, locale, theme, "9-search-results");

  // 7. Settings → connected accounts (long address, status badges, dialogs)
  await page.goto(`/${locale}/settings/accounts`);
  await expect(page.getByRole("heading", { name: t.mailboxes })).toBeVisible();
  const settingsDialog = page.getByRole("dialog", { name: t.settingsTitle });
  if (phone) {
    // Full pages on phones.
    await expect(settingsDialog).toHaveCount(0);
  } else {
    await expectInViewport(page, settingsDialog, `${label} settings dialog`);
    const dialogBox = await settingsDialog.boundingBox();
    expect(dialogBox?.width ?? 0, `${label} settings dialog width`).toBeLessThanOrEqual(870);
    expect(dialogBox?.height ?? 0, `${label} settings dialog height`).toBeLessThanOrEqual(700);
    expect(await settingsDialog.evaluate((element) => getComputedStyle(element).borderTopLeftRadius), `${label} settings radius`).toBe("12px");
  }
  await expectInViewport(page, page.getByRole("button", { name: t.connectGmail }), `${label} connect button`).catch(async () => {
    // On short screens the button may be below the fold; it must then be reachable by scrolling.
    await page.getByRole("button", { name: t.connectGmail }).scrollIntoViewIfNeeded();
    await expectInViewport(page, page.getByRole("button", { name: t.connectGmail }), `${label} connect button after scroll`);
  });
  await expectNoHorizontalOverflow(page, `${label} accounts`);
  const connectOutlook = page.getByRole("button", { name: t.connectOutlook });
  await connectOutlook.scrollIntoViewIfNeeded();
  await expectInViewport(page, connectOutlook, `${label} connect Outlook button`);
  if (phone) {
    await expectTouchTarget(page.getByRole("button", { name: t.connectGmail }), `${label} connect`);
    await expectTouchTarget(connectOutlook, `${label} connect Outlook`);
  }
  await shot(page, size, locale, theme, "6-accounts");
  const actions = page.locator("ul li").getByRole("button").first();
  await actions.scrollIntoViewIfNeeded();
  await actions.click();
  const menu = phone ? page.getByRole("dialog") : page.getByRole("menu");
  await expectInViewport(page, menu, `${label} account actions menu`);
  await expectNoHorizontalOverflow(page, `${label} account actions menu`);
  if (phone) await expectTouchTarget(menu.getByRole("button"), `${label} sheet actions`);
  await shot(page, size, locale, theme, "7-menu");
}

for (const size of VIEWPORTS) {
  test(`key screens at ${size.width}x${size.height} (en, light)`, async ({ page }) => {
    await page.setViewportSize(size);
    await walkthrough(page, size, "en", "light");
  });
}

// Ukrainian strings are longer; cover one size per layout mode plus the narrowest phone, in dark theme.
for (const size of [VIEWPORTS[0], VIEWPORTS[3], VIEWPORTS[6], VIEWPORTS[7], VIEWPORTS[9], VIEWPORTS[12], VIEWPORTS[14]]) {
  test(`key screens at ${size.width}x${size.height} (uk, dark)`, async ({ page }) => {
    await page.setViewportSize(size);
    await walkthrough(page, size, "uk", "dark");
  });
}

for (const size of LANDSCAPE) {
  test(`key screens in landscape ${size.width}x${size.height} (en, light)`, async ({ page }) => {
    await page.setViewportSize(size);
    await walkthrough(page, size, "en", "light");
  });
}

test("landscape phone in Ukrainian", async ({ page }) => {
  const size = { width: 844, height: 390 };
  await page.setViewportSize(size);
  await walkthrough(page, size, "uk", "light");
});

test.describe("other screens stay inside the viewport", () => {
  const routes = [
    "register",
    "forgot-password",
    "reset-password?token=x",
    "verify-email?token=expired",
    "mail/search?q=invoice",
    "mail/trash",
    "settings",
    "settings/profile",
    "settings/appearance",
    "settings/security",
    "settings/sessions",
    "settings/danger",
  ];
  for (const size of [VIEWPORTS[0], VIEWPORTS[3], VIEWPORTS[7], VIEWPORTS[10], VIEWPORTS[13]]) {
    for (const locale of ["en", "uk"] as const) {
      test(`${size.width}x${size.height} ${locale}`, async ({ page }) => {
        await page.setViewportSize(size);
        await mockApi(page, { authenticated: false });
        for (const route of routes.slice(0, 4)) {
          await page.goto(`/${locale}/${route}`);
          await expect(page.locator("h1")).toBeVisible();
          await settle(page);
          await expectNoHorizontalOverflow(page, `${size.width} ${locale} ${route}`);
          await page.screenshot({ path: `e2e/screenshots/${size.width}x${size.height}/${locale}-light-other-${route.replace(/\W+/g, "-")}.png` });
        }
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await mockApi(page);
        for (const route of routes.slice(4)) {
          await page.goto(`/${locale}/${route}`);
          await expect(page.locator("h1").locator("visible=true").first()).toBeVisible();
          await settle(page);
          await expectNoHorizontalOverflow(page, `${size.width} ${locale} ${route}`);
          await page.screenshot({ path: `e2e/screenshots/${size.width}x${size.height}/${locale}-light-other-${route.replace(/\W+/g, "-")}.png` });
        }
        // Confirmation dialog: bottom sheet on phones, centred dialog otherwise, always fully visible.
        await page.goto(`/${locale}/settings/danger`);
        await page.locator("section button").last().click();
        const dialog = page.getByRole("dialog");
        await expectInViewport(page, dialog, `${size.width} ${locale} delete dialog`);
        await expectInViewport(page, dialog.getByRole("button").last(), `${size.width} ${locale} delete dialog action`);
        await expectNoHorizontalOverflow(page, `${size.width} ${locale} delete dialog`);
        await page.screenshot({ path: `e2e/screenshots/${size.width}x${size.height}/${locale}-light-other-delete-dialog.png` });
      });
    }
  }
});
