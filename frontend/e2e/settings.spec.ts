import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("connected accounts", () => {
  test("lists mailboxes with their status", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/settings/accounts");
    const list = page.getByRole("list").filter({ hasText: "Personal" });
    await expect(list.getByText("Connected", { exact: true })).toBeVisible();
    await expect(list.getByText("Reconnect required")).toBeVisible();
    await expect(list.getByText("MailFlow lost access to this mailbox.")).toBeVisible();
    // Each mailbox names its provider.
    await expect(list.getByRole("listitem").filter({ hasText: "Personal" }).getByText(/^Gmail ·/)).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: "Reconnect required" }).getByText(/^Outlook ·/)).toBeVisible();
  });

  test("starts the Gmail connection through the API and follows the returned URL", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/accounts");
    await page.getByRole("button", { name: "Connect Gmail" }).click();
    // The fixture sends the browser straight back, as the real callback redirect does.
    await expect(page.getByText("Mailbox connected. The first synchronization has started.")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
    const start = api.callsTo("POST", "/accounts/oauth/gmail/start")[0];
    expect(JSON.parse(start?.body ?? "{}")).toEqual({ locale: "en" });
  });

  test("starts the Outlook connection through the same flow", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/accounts");
    await page.getByRole("button", { name: "Connect Outlook" }).click();
    await expect(page.getByText("Mailbox connected. The first synchronization has started.")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
    const start = api.callsTo("POST", "/accounts/oauth/outlook/start")[0];
    expect(JSON.parse(start?.body ?? "{}")).toEqual({ locale: "en" });
    expect(api.callsTo("POST", "/accounts/oauth/gmail/start")).toHaveLength(0);
  });

  test("explains a failed connection", async ({ page }) => {
    await mockApi(page);
    await page.goto("/en/settings/accounts?error=access_denied");
    await expect(page.getByText("Access was not granted, so the mailbox was not connected.")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/settings\/accounts$/);
  });

  test("says so when Gmail is not configured on the server", async ({ page }) => {
    await mockApi(page, { gmailAvailable: false });
    await page.goto("/en/settings/accounts");
    await expect(page.getByText("Gmail is not configured on this server yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Gmail" })).toHaveCount(0);
  });

  test("says so when Outlook is not configured, and when the server does not offer IMAP", async ({ page }) => {
    await mockApi(page, { outlookAvailable: false, imapAvailable: false });
    await page.goto("/en/settings/accounts");
    await expect(page.getByText("Outlook is not configured on this server yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Outlook" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect Gmail" })).toBeVisible();
    await expect(page.getByText("Connecting other mailboxes by IMAP is not available on this server.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect another mail account (IMAP)" })).toHaveCount(0);
  });

  test("renames and recolours an account", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/accounts");
    await page.getByRole("button", { name: "Actions for Personal" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit account" });
    await dialog.getByLabel("Display name").fill("Home");
    await dialog.getByRole("button", { name: "Colour 3" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Account updated")).toBeVisible();
    expect(JSON.parse(api.callsTo("PATCH", "/accounts/acc-1")[0]?.body ?? "{}")).toEqual({ display_name: "Home", color: "#1f8a4c" });
    await expect(page.getByRole("button", { name: "Actions for Home" })).toBeVisible();
  });

  test("disconnects a mailbox only after confirmation", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/accounts");
    await page.getByRole("button", { name: "Actions for Personal" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    const dialog = page.getByRole("dialog", { name: "Disconnect this mailbox?" });
    await expect(dialog).toContainText("olena.kovalenko@example.com");
    expect(api.callsTo("DELETE", "/accounts/acc-1")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Mailbox disconnected")).toBeVisible();
    expect(api.callsTo("DELETE", "/accounts/acc-1")).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Actions for Personal" })).toHaveCount(0);
  });

  test("reconnects an expired mailbox", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/accounts");
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect.poll(() => api.callsTo("POST", "/accounts/acc-2/reconnect").length).toBe(1);
  });
});

test.describe("preferences", () => {
  test("saves the language to the account and switches the interface", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/appearance");
    await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "Українська" }).click();
    await expect(page).toHaveURL(/\/uk\/settings\/appearance$/);
    await expect(page.getByRole("heading", { level: 1, name: "Вигляд і мова" })).toBeVisible();
    expect(JSON.parse(api.callsTo("PATCH", "/settings")[0]?.body ?? "{}")).toEqual({ locale: "uk" });
  });

  test("saves the theme and the remote image preference", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/appearance");
    await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("switch", { name: "Always show remote images" }).click();
    await expect.poll(() => api.callsTo("PATCH", "/settings").map((call) => call.body)).toEqual(['{"theme":"dark"}', '{"load_remote_images":true}']);
  });

  test("updates the profile name", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/profile");
    await expect(page.getByLabel("Email")).toHaveValue("olena.kovalenko@example.com");
    await page.getByLabel("Name").fill("Olena K.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
    expect(JSON.parse(api.callsTo("PATCH", "/users/me")[0]?.body ?? "{}")).toEqual({ display_name: "Olena K." });
  });

  test("lists sessions and revokes another device", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/sessions");
    await expect(page.getByText("Chrome · macOS")).toBeVisible();
    await expect(page.getByText("Safari · iOS")).toBeVisible();
    // The current session cannot be revoked from here.
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(2);
    await page.getByRole("listitem").filter({ hasText: "Safari · iOS" }).getByRole("button", { name: "Sign out" }).click();
    await expect.poll(() => api.callsTo("DELETE", "/auth/sessions/s-2").length).toBe(1);
    await page.getByRole("button", { name: "Sign out all other devices" }).click();
    await expect.poll(() => api.callsTo("POST", "/auth/sessions/revoke-others").length).toBe(1);
  });

  test("changes the password after validating the form", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/security");
    await page.getByLabel("Current password").fill("old-password-123");
    await page.getByLabel("New password").fill("new-password-456");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The passwords do not match.")).toBeVisible();
    await page.getByLabel("Confirm password").fill("new-password-456");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed")).toBeVisible();
    expect(JSON.parse(api.callsTo("POST", "/auth/password/change")[0]?.body ?? "{}")).toEqual({
      current_password: "old-password-123",
      new_password: "new-password-456",
    });
  });

  test("deletes the account only after password and typed confirmation", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/settings/danger");
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account permanently?" });
    const confirm = dialog.getByRole("button", { name: "Delete permanently" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Password").fill("my-password-123");
    await dialog.getByLabel("Type DELETE to confirm").fill("delete");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await confirm.click();
    await expect(page).toHaveURL(/\/en\/login/);
    expect(JSON.parse(api.callsTo("DELETE", "/users/me")[0]?.body ?? "{}")).toEqual({ password: "my-password-123", confirmation: "DELETE" });
  });
});
