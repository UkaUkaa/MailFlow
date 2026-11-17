import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

test.describe("authentication", () => {
  test("signs in and lands in the inbox", async ({ page }) => {
    const api = await mockApi(page, { authenticated: false });
    await page.goto("/en/login");
    await page.getByLabel("Email").fill("olena.kovalenko@example.com");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/en\/mail\/inbox$/);
    await expect(page.getByRole("list", { name: "Inbox" })).toBeVisible();

    const login = api.callsTo("POST", "/auth/login")[0];
    expect(login?.headers["x-csrf-token"]).toBe("test-csrf");
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain("correct-horse-battery");
  });

  test("rejects wrong credentials with a generic message", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/en/login");
    await page.getByLabel("Email").fill("olena.kovalenko@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The email or password is incorrect." })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/login$/);
  });

  test("validates the form before calling the server", async ({ page }) => {
    const api = await mockApi(page, { authenticated: false });
    await page.goto("/en/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("This field is required.")).toHaveCount(2);
    expect(api.callsTo("POST", "/auth/login")).toHaveLength(0);
  });

  test("returns to the requested page after signing in", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/en/settings/sessions");
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fsettings%2Fsessions$/);
    await page.getByLabel("Email").fill("olena.kovalenko@example.com");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/en\/settings\/sessions$/);
  });

  test("registers and asks the user to check their email", async ({ page }) => {
    const api = await mockApi(page, { authenticated: false });
    await page.goto("/en/register");
    await page.getByLabel("Name").fill("Olena Kovalenko");
    await page.getByLabel("Email").fill("new.user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("Confirm password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("new.user@example.com")).toBeVisible();

    const body = JSON.parse(api.callsTo("POST", "/auth/register")[0]?.body ?? "{}") as Record<string, string>;
    expect(body).toEqual({ email: "new.user@example.com", password: "a-long-enough-password", display_name: "Olena Kovalenko", locale: "en" });
  });

  test("verifies an email address from the link", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/en/verify-email?token=good-token");
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
  });

  test("explains an invalid verification link and offers a new one", async ({ page }) => {
    const api = await mockApi(page, { authenticated: false });
    await page.goto("/en/verify-email?token=expired");
    await expect(page.getByRole("heading", { name: "This link did not work" })).toBeVisible();
    await page.getByLabel("Email").fill("new.user@example.com");
    await page.getByRole("button", { name: "Send a new verification email" }).click();
    await expect(page.getByRole("status").filter({ hasText: "a new email is on its way" })).toBeVisible();
    expect(api.callsTo("POST", "/auth/resend-verification")).toHaveLength(1);
  });

  test("requests a password reset without revealing whether the account exists", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/en/forgot-password");
    await page.getByLabel("Email").fill("someone@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If an account exists for that address")).toBeVisible();
  });

  test("sets a new password from a reset link", async ({ page }) => {
    const api = await mockApi(page, { authenticated: false });
    await page.goto("/en/reset-password?token=reset-token");
    await page.getByLabel("New password").fill("a-brand-new-password");
    await page.getByLabel("Confirm password").fill("a-brand-new-password");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/en\/login\?reset=1$/);
    await expect(page.getByText("Your password was changed.")).toBeVisible();
    expect(JSON.parse(api.callsTo("POST", "/auth/password/reset")[0]?.body ?? "{}")).toEqual({
      token: "reset-token",
      new_password: "a-brand-new-password",
    });
  });
});

test.describe("language and theme", () => {
  test("switches language and keeps the choice", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("button", { name: "Українська" }).click();
    await expect(page).toHaveURL(/\/uk\/login$/);
    await expect(page.getByRole("heading", { name: "Вхід" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "uk");

    // The choice is remembered: the bare root now resolves to Ukrainian.
    await page.goto("/");
    await expect(page).toHaveURL(/\/uk\//);
  });

  test("uses English by default", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("switches theme without a flash after reload", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(dark).toBe("rgb(12, 13, 15)");

    await page.reload();
    // Set by the inline script before hydration.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("follows the system theme by default", async ({ page }) => {
    await mockApi(page, { authenticated: false });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("session expiry", () => {
  test("returns to sign-in when the session ends mid-use and drops cached mail", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await expect(page.getByRole("list", { name: "Inbox" })).toBeVisible();
    api.expireSession();
    await page.getByRole("link", { name: /^Sent/ }).first().click();
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Q4 planning notes")).toHaveCount(0);
  });

  test("signs out from settings", async ({ page }) => {
    const api = await mockApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/en\/login/);
    expect(api.callsTo("POST", "/auth/logout")).toHaveLength(1);
  });
});
