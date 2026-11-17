import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

/**
 * Server HTML and the first client render must match. The document is
 * delivered in one piece (as a buffering reverse proxy such as nginx does),
 * because that is the condition under which a mismatch surfaced in production:
 * streamed responses from `next start` hid it.
 */
function collectReactErrors(page: Page): string[] {
  const errors: string[] = [];
  const record = (text: string) => {
    if (/Minified React error|Hydration|hydrat/i.test(text)) errors.push(text.slice(0, 300));
  };
  page.on("pageerror", (error) => record(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  return errors;
}

async function deliverBuffered(page: Page) {
  await page.route(
    (url) => !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/_next/") && !/\.\w+$/.test(url.pathname),
    async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response });
    },
  );
}

const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 375, height: 812 },
];

for (const size of SIZES) {
  for (const locale of ["en", "uk"] as const) {
    test(`mail page hydrates cleanly (${size.name}, ${locale})`, async ({ page }) => {
      await page.setViewportSize(size);
      const errors = collectReactErrors(page);
      await mockApi(page);
      await deliverBuffered(page);
      // Client-only state (system theme, stored sidebar mode) is the classic source of
      // server/client differences: the server always renders light + automatic sidebar.
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => window.localStorage.setItem("mf-sidebar", "true"));
      for (const path of ["mail/inbox", "mail/inbox/thread-1", "settings/appearance"]) {
        await page.goto(`/${locale}/${path}`);
        await expect(page.locator("h1").locator("visible=true").first()).toBeVisible();
        await page.waitForTimeout(500);
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(errors).toEqual([]);
    });
  }

  test(`signed-out pages hydrate cleanly (${size.name})`, async ({ page }) => {
    await page.setViewportSize(size);
    const errors = collectReactErrors(page);
    await mockApi(page, { authenticated: false });
    await deliverBuffered(page);
    for (const path of ["login", "register", "forgot-password", "verify-email?token=good-token"]) {
      await page.goto(`/en/${path}`);
      await expect(page.locator("h1")).toBeVisible();
      await page.waitForTimeout(500);
    }
    expect(errors).toEqual([]);
  });
}
