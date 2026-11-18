import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page-level horizontal overflow").toBeLessThanOrEqual(0);
}

const firstRowHeight = (page: Page) => page.locator("li.account-tint").first().evaluate((row) => row.getBoundingClientRect().height);

test.describe("interface settings", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("reshapes the message list and recolours the app", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await expect(page.locator("li.account-tint").first()).toBeVisible();
    const comfortable = await firstRowHeight(page);

    await page.goto("/en/settings/interface");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByRole("heading", { name: "Interface" })).toBeVisible();
    await dialog.getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
    await dialog.getByRole("group", { name: "Message preview" }).getByRole("button", { name: "Off" }).click();
    await dialog.getByRole("switch", { name: "Sender pictures" }).click();
    await dialog.getByRole("group", { name: "Mailbox colour in rows" }).getByRole("button", { name: "Strong" }).click();
    await dialog.getByRole("button", { name: "Green" }).click();
    await dialog.getByRole("group", { name: "Message text size" }).getByRole("button", { name: "Large" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-accent", "green");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect(page.locator("html")).toHaveAttribute("data-preview", "0");
    await expect(page.locator("html")).toHaveAttribute("data-avatars", "off");
    await expect(page.locator("html")).toHaveAttribute("data-tint", "strong");
    await expect(page.locator("html")).toHaveAttribute("data-reader-text", "large");
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
    expect(accent).toBe("#1d7348");
    const patches = api.callsTo("PATCH", "/settings").map((call) => JSON.parse(call.body ?? "{}"));
    expect(Object.assign({}, ...patches)).toEqual({
      list_density: "compact",
      list_preview_lines: 0,
      show_avatars: false,
      account_tint: "strong",
      accent_color: "green",
      reader_text_size: "large",
    });

    await page.goto("/en/mail/inbox");
    await expect(page.locator("li.account-tint").first()).toBeVisible();
    expect(await firstRowHeight(page)).toBeLessThan(comfortable - 20);
    await page.screenshot({ path: "e2e/screenshots/1280x800/en-light-23-compact-green-list.png" });

    // Reset brings back the default list.
    await page.goto("/en/settings/interface");
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(page.getByText("Interface settings reset")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
    await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
  });
});

const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1440x900", width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test(`interface settings at ${viewport.name} in both themes and locales`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockApi(page);
    for (const [theme, locale] of [["light", "en"], ["dark", "uk"], ["light", "uk"], ["dark", "en"]] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/${locale}/settings/interface`);
      await expect(page.getByRole("button", { name: locale === "en" ? "Reset to defaults" : "Скинути до типових" })).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${viewport.name}/${locale}-${theme}-22-interface-settings.png` });
      await page.getByRole("button", { name: locale === "en" ? "Reset to defaults" : "Скинути до типових" }).scrollIntoViewIfNeeded();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${viewport.name}/${locale}-${theme}-22b-interface-settings-end.png` });
    }
  });
}
