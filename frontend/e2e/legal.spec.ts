import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./fixtures/helpers";
import { mockApi } from "./fixtures/mock-api";

const VIEWPORTS = [
  { name: "phone", width: 320, height: 640 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

const DOCUMENTS = [
  { path: "privacy", title: { en: "Privacy Policy", uk: "Політика конфіденційності" } },
  { path: "terms", title: { en: "Terms of Service", uk: "Умови використання" } },
] as const;

test.describe("legal pages", () => {
  for (const viewport of VIEWPORTS) {
    for (const locale of ["en", "uk"] as const) {
      for (const theme of ["light", "dark"] as const) {
        test(`${viewport.name} ${locale} ${theme}: documents are public and fit the screen`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await page.emulateMedia({ colorScheme: theme });
          await mockApi(page, { authenticated: false });
          for (const document of DOCUMENTS) {
            await page.goto(`/${locale}/${document.path}`);
            await expect(page).toHaveURL(new RegExp(`/${locale}/${document.path}$`));
            await expect(page.getByRole("heading", { level: 1, name: document.title[locale] })).toBeVisible();
            expect(await page.getByRole("heading", { level: 2 }).count()).toBeGreaterThan(3);
            await expectNoHorizontalOverflow(page, `${viewport.name} ${locale} ${theme} ${document.path}`);
          }
        });
      }
    }
  }

  test("the privacy policy carries the Google Limited Use disclosure", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/en/privacy");
    const policy = page.getByRole("link", { name: "Google API Services User Data Policy" });
    await expect(policy).toHaveAttribute("href", "https://developers.google.com/terms/api-services-user-data-policy");
    await expect(page.getByText("including the Limited Use requirements")).toBeVisible();
  });

  test("sign-in screens link to both documents", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/uk/login");
    await page.getByRole("link", { name: "Політика конфіденційності" }).click();
    await expect(page).toHaveURL(/\/uk\/privacy$/);
    await page.goto("/en/register");
    await page.getByRole("link", { name: "Terms of Service" }).click();
    await expect(page).toHaveURL(/\/en\/terms$/);
  });
});

test.describe("sign in with Google", () => {
  test("the button appears only when configured and starts the server-side flow", async ({ page }) => {
    await mockApi(page, { authenticated: false, googleSignIn: true });
    await page.goto("/en/login?next=%2Fsettings%2Faccounts");
    const google = page.getByRole("link", { name: "Continue with Google" });
    await expect(google).toHaveAttribute("href", "/api/v1/auth/oauth/google/start?locale=en&next=%2Fsettings%2Faccounts");
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalOverflow(page, "phone login with Google");
  });

  test("hidden when not configured; a failed attempt is explained", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/uk/login?oauth_error=access_denied");
    await expect(page.getByRole("alert").filter({ hasText: "Вхід через Google" })).toHaveText("Вхід через Google скасовано.");
    await expect(page.getByRole("link", { name: "Увійти через Google" })).toHaveCount(0);
  });
});
