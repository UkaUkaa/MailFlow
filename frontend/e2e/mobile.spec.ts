import { expect, test } from "@playwright/test";
import { expectInViewport, expectNoHorizontalOverflow } from "./fixtures/helpers";
import { mockApi } from "./fixtures/mock-api";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.describe("mobile navigation", () => {
  test("uses bottom navigation and hides the desktop sidebar", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    const bottomNav = page.getByRole("navigation", { name: "Primary" });
    await expect(bottomNav).toBeVisible();
    await expect(page.locator("aside.mf-sidebar")).toBeHidden();

    await bottomNav.getByRole("link", { name: "Starred" }).tap();
    await expect(page).toHaveURL(/\/en\/mail\/starred$/);
    await expect(bottomNav.getByRole("link", { name: "Starred" })).toHaveAttribute("aria-current", "page");

    await bottomNav.getByRole("link", { name: "Search" }).tap();
    await expect(page.getByRole("searchbox", { name: "Search mail" })).toBeFocused();

    await bottomNav.getByRole("link", { name: "Settings" }).tap();
    await expect(page).toHaveURL(/\/en\/settings$/);
    await expect(page.getByRole("link", { name: "Connected accounts" })).toBeVisible();
  });

  test("opens the drawer to switch folders and accounts", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Open navigation" }).tap();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Drafts, 1 unread" })).toBeVisible();
    await expectInViewport(page, drawer, "drawer");

    await drawer.getByRole("link", { name: "Sent" }).tap();
    await expect(page).toHaveURL(/\/en\/mail\/sent$/);
    await expect(drawer).toBeHidden();

    await page.getByRole("button", { name: "Open navigation" }).tap();
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Personal" }).tap();
    await expect(page).toHaveURL(/\/en\/mail\/sent\?account=acc-1$/);
    await expect(page.locator("header").getByText("Personal")).toBeVisible();
  });

  test("opens a conversation full screen and returns to the list", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("link", { name: /Q4 planning notes/ }).first().tap();
    await expect(page.getByRole("heading", { level: 1, name: "Q4 planning notes and next steps" })).toBeVisible();
    // Single pane: list and bottom navigation make way for the reader.
    await expect(page.getByRole("list", { name: "Inbox" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expectInViewport(page, page.getByRole("button", { name: "Reply", exact: true }).last(), "sticky reply");
    await expectNoHorizontalOverflow(page, "mobile reader");

    await page.getByRole("link", { name: "Back to list" }).tap();
    await expect(page).toHaveURL(/\/en\/mail\/inbox$/);
    await expect(page.getByRole("list", { name: "Inbox" })).toBeVisible();
  });

  test("message actions open as a bottom sheet", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-2");
    await page.getByRole("button", { name: "More actions" }).tap();
    const sheet = page.getByRole("dialog", { name: "More actions" });
    await expect(sheet).toBeVisible();
    await expectInViewport(page, sheet, "action sheet");
    const box = await sheet.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(390);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
    await sheet.getByRole("button", { name: "Mark as spam" }).tap();
    await expect.poll(() => api.callsTo("POST", "/threads/thread-2/actions").map((call) => call.body)).toContain('{"action":"spam"}');
  });

  test("composes full screen with send always reachable", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Compose" }).tap();
    const composer = page.getByRole("dialog", { name: "New message" });
    await expect(composer).toBeVisible();
    const box = await composer.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });

    // Stand-in for an open on-screen keyboard: the visible area shrinks.
    await page.setViewportSize({ width: 390, height: 430 });
    const send = composer.getByRole("button", { name: "Send" }).first();
    await expectInViewport(page, send, "send with keyboard open");
    await expectInViewport(page, composer.getByRole("toolbar", { name: "Formatting" }), "toolbar with keyboard open");
    await expectInViewport(page, composer.getByRole("button", { name: "Attach files" }), "attach with keyboard open");
    const height = await composer.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.round(height)).toBe(430);

    // One "To, Cc, Bcc" line until the recipients get focus.
    await expect(composer.getByLabel("Bcc")).toHaveCount(0);
    await expect(composer.getByPlaceholder("To, Cc, Bcc")).toBeVisible();
    await composer.getByLabel("To").fill("daniel@okafor.example,");
    await expect(composer.getByLabel("Cc", { exact: true })).toBeVisible();
    await expect(composer.getByLabel("Bcc")).toBeVisible();
    await composer.getByLabel("Subject").fill("From my phone");
    await send.tap();
    await expect.poll(() => api.callsTo("POST", "/emails/send").length).toBe(1);
  });

  test("settings sections are separate screens with a way back", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/settings");
    await page.getByRole("link", { name: "Sessions" }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
    await expect(page.getByText("This device")).toBeVisible();
    await page.getByRole("link", { name: "Back to settings" }).tap();
    await expect(page).toHaveURL(/\/en\/settings$/);
  });
});
