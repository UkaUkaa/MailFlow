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
  },
  uk: {
    signIn: "Увійти",
    inbox: "Вхідні",
    compose: "Написати",
    newMessage: "Новий лист",
    send: "Надіслати",
    reply: "Відповісти",
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
  const label = `${size.width}x${size.height} ${locale}`;
  await page.emulateMedia({ colorScheme: theme });

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
    // Long senders and subjects are truncated, never wrapped into tall rows.
    expect(box?.height ?? 0, `${label} row ${index} height`).toBeLessThanOrEqual(96);
    await expectNoOverlap(row.locator("time"), row.getByRole("button").first(), `${label} row ${index} time vs star`);
  }
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
    const width = (await sidebar.boundingBox())?.width ?? 0;
    // Rail below 1280px, full sidebar from 1280px.
    if (size.width >= 1280) expect(width, `${label} full sidebar`).toBe(240);
    else expect(width, `${label} rail`).toBe(56);
    await shot(page, size, locale, theme, "3-navigation");
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
  if (split) {
    await expect(list).toBeVisible();
  } else {
    await expect(list).toBeHidden();
    await expectInViewport(page, page.getByRole("link", { name: t.back }), `${label} back`);
  }
  const reply = page.getByRole("button", { name: t.reply, exact: true }).locator("visible=true").first();
  if (phone) {
    await expectInViewport(page, reply, `${label} sticky reply`);
    await expectTouchTarget(reply, `${label} reply`);
    await expectTouchTarget(page.locator("section").first().locator(":scope > div").first().locator("a, button"), `${label} reader toolbar`);
  }
  await shot(page, size, locale, theme, "4-reader");

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
    expect(composerBox?.width ?? 0, `${label} composer is a floating panel`).toBeLessThanOrEqual(576);
  }
  await shot(page, size, locale, theme, "5-composer");
  await composer.getByLabel(t.subject).fill("");
  await composer.getByLabel(t.to).press("Backspace");
  await composer.getByLabel(t.to).press("Backspace");

  // 6. Settings → connected accounts (long address, status badges, dialogs)
  await page.goto(`/${locale}/settings/accounts`);
  await expect(page.getByRole("heading", { name: t.mailboxes })).toBeVisible();
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
