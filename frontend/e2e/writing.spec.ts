import { expect, test, type Page } from "@playwright/test";
import { accounts, imapAccount } from "./fixtures/data";
import { mockApi } from "./fixtures/mock-api";

const followUp = {
  id: "tpl-1",
  name: "Follow-up",
  subject: "Checking in",
  body_html: "<p>Hi {{first_name}}, any news on this?</p>",
  created_at: "2026-11-18T09:00:00Z",
  updated_at: "2026-11-18T09:00:00Z",
};

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test.describe(`writing helpers (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("creates a template in settings", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto("/en/settings/templates");
      await expect(page.getByText("No templates yet.", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "New template" }).click();
      const dialog = page.getByRole("dialog", { name: "New template" });
      await dialog.getByRole("textbox", { name: "Name" }).fill("Thanks");
      await dialog.getByRole("textbox", { name: "Subject" }).fill("Thank you");
      await dialog.getByRole("textbox", { name: "Message" }).click();
      await page.keyboard.type("Thank you, ");
      await dialog.getByRole("button", { name: "Insert placeholder: First name" }).click();
      await dialog.getByRole("button", { name: "Save" }).click();

      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Templates" }).getByText("Thanks")).toBeVisible();
      const created = JSON.parse(api.callsTo("POST", "/templates")[0]?.body ?? "{}") as Record<string, string>;
      expect(created).toMatchObject({ name: "Thanks", subject: "Thank you" });
      expect(created.body_html).toContain("Thank you, {{first_name}}");
      await noHorizontalOverflow(page);
    });

    test("connects the user's own AI key, then inserts a template and drafts a reply", async ({ page }) => {
      const api = await mockApi(page, { templates: [followUp] });
      await page.goto("/en/settings/assistant");
      await page.getByRole("button", { name: "Claude (Anthropic)" }).click();
      const key = page.getByLabel("API key");
      await key.fill("sk-ant-bad-key-0000");
      await page.getByRole("button", { name: "Check and connect" }).click();
      await expect(page.getByText("The AI service did not accept this key.", { exact: false })).toBeVisible();
      await key.fill("sk-ant-good-key-4321");
      await page.getByRole("button", { name: "Check and connect" }).click();
      await expect(page.getByText("Key ending in 4321")).toBeVisible();
      expect(JSON.parse(api.callsTo("PUT", "/assistant").at(-1)?.body ?? "{}")).toEqual({ provider: "anthropic", api_key: "sk-ant-good-key-4321" });
      await page.getByLabel("Model").selectOption("claude-sonnet-5-5");
      await expect.poll(() => api.callsTo("PATCH", "/assistant").length).toBe(1);
      await noHorizontalOverflow(page);

      await page.goto("/en/mail/inbox/thread-1");
      await page.getByRole("button", { name: "Reply", exact: true }).first().click();
      const composer = page.getByRole("dialog", { name: "Reply" });
      await expect(composer.getByRole("textbox", { name: "Message" })).toBeVisible();

      // Template: the recipient's first name is filled in.
      await composer.getByRole("button", { name: "Templates" }).locator("visible=true").first().click();
      await page.getByRole(viewport.name === "phone" ? "button" : "menuitem", { name: /Follow-up/ }).click();
      await expect(composer.getByRole("textbox", { name: "Message" })).toContainText(/Hi \w+, any news on this\?/);

      // AI with the user's own key, from a short note.
      await composer.getByRole("button", { name: "Write with AI" }).locator("visible=true").first().click();
      await expect(composer.getByText("Claude (Anthropic)")).toBeVisible();
      const note = composer.getByRole("textbox", { name: "Write with AI" });
      await note.fill("yes, thursday");
      await note.press("Enter");
      await expect(composer.getByRole("textbox", { name: "Message" })).toContainText("Thursday works for me.");
      await expect(composer.getByText("Written in English.", { exact: false })).toBeVisible();
      expect(JSON.parse(api.callsTo("POST", "/assistant/reply")[0]?.body ?? "{}")).toMatchObject({ instruction: "yes, thursday" });
      await noHorizontalOverflow(page);
    });
  });
}

test("without a key, Write with AI points to settings and sends nothing", async ({ page }) => {
  const api = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/mail/inbox/thread-1");
  await page.getByRole("button", { name: "Reply", exact: true }).first().click();
  const composer = page.getByRole("dialog", { name: "Reply" });
  await composer.getByRole("button", { name: "Write with AI" }).locator("visible=true").first().click();
  await expect(composer.getByRole("link", { name: "Connect AI" })).toBeVisible();
  expect(api.callsTo("POST", "/assistant/reply")).toHaveLength(0);
});

test("fits a 320 px phone in Ukrainian, light and dark", async ({ page }) => {
  await mockApi(page, { templates: [followUp], aiProvider: "gemini" });
  await page.setViewportSize({ width: 320, height: 640 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ["/uk/settings/templates", "/uk/settings/assistant"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noHorizontalOverflow(page);
    }
    await page.getByRole("button", { name: "Замінити ключ" }).click();
    await expect(page.getByRole("button", { name: "Перевірити й підключити" })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto("/uk/mail/inbox/thread-1");
    await page.getByRole("button", { name: "Відповісти", exact: true }).first().click();
    const composer = page.getByRole("dialog", { name: "Відповідь" });
    await composer.getByRole("button", { name: "Написати з ШІ" }).locator("visible=true").first().click();
    await expect(composer.getByRole("textbox", { name: "Написати з ШІ" })).toBeVisible();
    await noHorizontalOverflow(page);
  }
});

// A long mailbox name and address must stay readable without pushing the composer sideways.
// Two active mailboxes, so the sender is a picker.
const longNamed = [
  ...accounts.map((account, index) =>
    index === 0
      ? { ...account, display_name: "Olena Kovalenko — Personal mailbox for family and friends", email_address: "olena.kovalenko.personal.mailbox@example.com" }
      : account,
  ),
  imapAccount,
];

for (const viewport of [
  { name: "phone", width: 320, height: 640 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`new email: the sending mailbox is shown and AI writes it (${viewport.name})`, async ({ page }) => {
    const api = await mockApi(page, { accounts: longNamed, aiProvider: "anthropic" });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const [locale, labels] of [
      ["en", { compose: "Compose", title: "New message", from: "From", ai: "Write with AI", subject: "Subject", body: "Message" }],
      ["uk", { compose: "Написати", title: "Новий лист", from: "Від", ai: "Написати з ШІ", subject: "Тема", body: "Текст листа" }],
    ] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/${locale}/mail/inbox`);
        await page.getByRole("button", { name: labels.compose, exact: true }).locator("visible=true").first().click();
        const composer = page.getByRole("dialog", { name: labels.title });
        const from = composer.getByRole("combobox", { name: labels.from });
        await expect(from).toHaveValue("acc-1");
        const address = composer.getByText("<olena.kovalenko.personal.mailbox@example.com>", { exact: true });
        await expect(address).toBeVisible();
        if (viewport.width >= 768) {
          // The whole address fits; only the long name is shortened.
          expect(await address.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        await noHorizontalOverflow(page);

        await composer.getByRole("button", { name: labels.ai }).locator("visible=true").first().click();
        const note = composer.getByRole("textbox", { name: labels.ai });
        await note.fill("ask Daniel for the March report");
        await note.press("Enter");
        await expect(composer.getByRole("textbox", { name: labels.body })).toContainText(
          "Could you send the March report by Friday?",
        );
        await expect(composer.getByLabel(labels.subject, { exact: true })).toHaveValue("March report");
        await noHorizontalOverflow(page);
        // Close (the draft is saved) so the next round starts from a clean page.
        await composer.getByRole("textbox", { name: labels.body }).press("Escape");
        await expect(composer).toBeHidden();
      }
    }
    const [first] = api.callsTo("POST", "/assistant/compose");
    expect(JSON.parse(first?.body ?? "{}")).toMatchObject({ account_id: "acc-1", instruction: "ask Daniel for the March report", subject: "" });
  });
}
