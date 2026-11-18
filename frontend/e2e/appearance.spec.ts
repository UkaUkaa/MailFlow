import { expect, test, type Page } from "@playwright/test";
import { accounts, imapAccount } from "./fixtures/data";
import { mockApi } from "./fixtures/mock-api";
import { samplePng } from "./fixtures/png";

/** Three mailboxes; Personal has a picture, the others a preset and a custom colour. */
const mailboxes = [
  { ...accounts[0]!, avatar_updated_at: "2026-11-18T08:00:00Z" },
  { ...accounts[1]!, status: "active", status_reason: null, color: "#c2513a" },
  { ...imapAccount, color: "#e0b100" },
];

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page-level horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("account appearance", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sets any colour and a picture for a mailbox", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/accounts");
    await page.getByRole("button", { name: "Actions for Personal" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit account" });

    await dialog.locator("input[type=file]").setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: samplePng(300, [200, 40, 120]),
    });
    await expect(dialog.getByRole("button", { name: "Replace picture" })).toBeVisible();
    // The picture's average colour is offered; a typed hex code wins.
    await expect(dialog.getByText("Picked from the picture. You can change it.")).toBeVisible();
    await dialog.getByLabel("Hex code").fill("#0A7A5C");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Account updated")).toBeVisible();

    expect(JSON.parse(api.callsTo("PATCH", "/accounts/acc-1")[0]?.body ?? "{}")).toMatchObject({ color: "#0a7a5c" });
    const upload = api.callsTo("PUT", "/accounts/acc-1/avatar");
    expect(upload).toHaveLength(1);
    await expect(page.locator('img[src^="/api/v1/accounts/acc-1/avatar?v="]').first()).toBeVisible();
  });

  test("tints every message row with its mailbox colour", async ({ page }) => {
    await mockApi(page, { accounts: mailboxes });
    await page.goto("/en/mail/inbox");
    const rows = page.locator("li.account-tint");
    await expect(rows.first()).toBeVisible();
    const colours = await rows.evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor));
    // Two mailboxes in the fixture threads, so two distinct washes, neither of them plain surface.
    expect(new Set(colours).size).toBe(2);
    const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--surface").trim());
    expect(colours).not.toContain(surface);
    // Personal shows its picture instead of the dot.
    await expect(page.locator('li img[src^="/api/v1/accounts/acc-1/avatar"]').first()).toBeVisible();
  });
});

const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1440x900", width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`appearance at ${viewport.name} in both themes and locales`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockApi(page, { accounts: mailboxes });
    for (const [theme, locale] of [["light", "en"], ["dark", "uk"], ["light", "uk"], ["dark", "en"]] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/${locale}/mail/inbox`);
      await expect(page.locator("li.account-tint").first()).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${viewport.name}/${locale}-${theme}-20-tinted-list.png` });

      await page.goto(`/${locale}/settings/accounts`);
      await page.getByRole("button", { name: locale === "en" ? "Actions for Personal" : "Дії для Personal" }).click();
      // A dropdown menu from tablet up, a bottom sheet of buttons on phones.
      const edit = locale === "en" ? "Edit" : "Редагувати";
      await page.getByRole("menuitem", { name: edit }).or(page.getByRole("button", { name: edit, exact: true })).first().click();
      const dialog = page.getByRole("dialog", { name: locale === "en" ? "Edit account" : "Редагувати обліковий запис" });
      await expect(dialog.locator(".account-tint")).toBeAttached();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${viewport.name}/${locale}-${theme}-21-appearance-dialog.png` });
    }
  });
}
