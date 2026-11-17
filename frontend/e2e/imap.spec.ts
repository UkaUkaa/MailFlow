import { expect, test, type Locator, type Page } from "@playwright/test";
import { accounts, imapAccount, type AccountFixture } from "./fixtures/data";
import { expectInViewport, expectNoHorizontalOverflow, settle } from "./fixtures/helpers";
import { mockApi, REJECTED_MAIL_PASSWORD } from "./fixtures/mock-api";

const COPY = {
  en: {
    open: "Connect another mail account (IMAP)",
    title: "Connect a mail account",
    email: "Email address",
    displayName: "Display name (optional)",
    incoming: "Incoming mail (IMAP)",
    outgoing: "Outgoing mail (SMTP)",
    host: "Server",
    port: "Port",
    security: "Encryption",
    username: "Username",
    password: "Password",
    submit: "Connect",
    cancel: "Cancel",
    required: "This field is required.",
  },
  uk: {
    open: "Підключити іншу поштову скриньку (IMAP)",
    title: "Підключити поштову скриньку",
    email: "Електронна адреса",
    displayName: "Відображуване ім’я (необов’язково)",
    incoming: "Вхідна пошта (IMAP)",
    outgoing: "Вихідна пошта (SMTP)",
    host: "Сервер",
    port: "Порт",
    security: "Шифрування",
    username: "Ім’я користувача",
    password: "Пароль",
    submit: "Підключити",
    cancel: "Скасувати",
    required: "Це поле обов’язкове.",
  },
} as const;
type Locale = keyof typeof COPY;

async function openConnectDialog(page: Page, locale: Locale): Promise<Locator> {
  await page.goto(`/${locale}/settings/accounts`);
  await page.getByRole("button", { name: COPY[locale].open }).click();
  const dialog = page.getByRole("dialog", { name: COPY[locale].title });
  await expect(dialog).toBeVisible();
  await settle(page);
  return dialog;
}

function fields(dialog: Locator, locale: Locale): { name: string; locator: Locator }[] {
  const copy = COPY[locale];
  const incoming = dialog.getByRole("group", { name: copy.incoming });
  const outgoing = dialog.getByRole("group", { name: copy.outgoing });
  return [
    { name: "email", locator: dialog.getByLabel(copy.email) },
    { name: "display name", locator: dialog.getByLabel(copy.displayName) },
    { name: "imap host", locator: incoming.getByLabel(copy.host) },
    { name: "imap port", locator: incoming.getByLabel(copy.port) },
    { name: "imap security", locator: incoming.getByLabel(copy.security) },
    { name: "smtp host", locator: outgoing.getByLabel(copy.host) },
    { name: "smtp port", locator: outgoing.getByLabel(copy.port) },
    { name: "smtp security", locator: outgoing.getByLabel(copy.security) },
    { name: "username", locator: dialog.getByLabel(copy.username) },
    { name: "password", locator: dialog.getByLabel(copy.password, { exact: true }) },
    { name: "cancel", locator: dialog.getByRole("button", { name: copy.cancel }) },
    { name: "submit", locator: dialog.getByRole("button", { name: copy.submit, exact: true }) },
  ];
}

/** Nothing inside the dialog is wider than the dialog, and no text is clipped sideways. */
async function expectNoOverflowInside(dialog: Locator, context: string): Promise<void> {
  const offenders = await dialog.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const result: string[] = [];
    for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const label = `${element.tagName.toLowerCase()}#${element.id}.${String(element.className).slice(0, 40)}`;
      if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) result.push(`outside: ${label}`);
      const style = getComputedStyle(element);
      if (style.overflowX !== "visible" && element.scrollWidth > element.clientWidth + 1 && !["INPUT", "SELECT"].includes(element.tagName)) {
        result.push(`scrolls sideways: ${label}`);
      }
    }
    return result;
  });
  expect(offenders, `${context}: horizontal overflow inside the dialog`).toEqual([]);
}

/** Every field and both buttons can be brought fully into the viewport by scrolling the dialog. */
async function expectEverythingReachable(page: Page, dialog: Locator, locale: Locale, context: string): Promise<void> {
  await expectInViewport(page, dialog, `${context}: dialog`);
  for (const { name, locator } of fields(dialog, locale)) {
    await locator.scrollIntoViewIfNeeded();
    await expectInViewport(page, locator, `${context}: ${name}`);
    // The control is really on top there (not hidden under the dialog header or another layer).
    const box = (await locator.boundingBox())!;
    const onTop = await locator.evaluate(
      (element, point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return hit === element || element.contains(hit);
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(onTop, `${context}: ${name} is not covered`).toBe(true);
  }
}

const LAYOUTS: { name: string; viewport: { width: number; height: number }; touch: boolean }[] = [
  { name: "320px phone", viewport: { width: 320, height: 568 }, touch: true },
  { name: "phone with the keyboard open", viewport: { width: 320, height: 380 }, touch: true },
  { name: "desktop", viewport: { width: 1280, height: 800 }, touch: false },
];

for (const layout of LAYOUTS) {
  for (const locale of ["en", "uk"] as const) {
    test.describe(`IMAP connect dialog — ${layout.name}, ${locale}`, () => {
      test.use({ viewport: layout.viewport, hasTouch: layout.touch, isMobile: layout.touch });

      test("fits the screen, scrolls inside and keeps every control reachable", async ({ page }) => {
        await mockApi(page, { accounts: [accounts[0]!] });
        await page.goto(`/${locale}/settings/accounts`);
        await expectNoHorizontalOverflow(page, `${layout.name} ${locale}: accounts page`);
        const open = page.getByRole("button", { name: COPY[locale].open });
        await open.scrollIntoViewIfNeeded();
        await expectInViewport(page, open, "connect button");

        const dialog = await openConnectDialog(page, locale);
        const context = `${layout.name} ${locale}`;
        await expectNoHorizontalOverflow(page, `${context}: page behind the dialog`);
        await expectNoOverflowInside(dialog, context);
        await expectEverythingReachable(page, dialog, locale, context);

        // Validation messages (long in Ukrainian) must not break the layout either.
        const submit = dialog.getByRole("button", { name: COPY[locale].submit, exact: true });
        await submit.scrollIntoViewIfNeeded();
        await submit.click();
        await expect(dialog.getByText(COPY[locale].required).first()).toBeVisible();
        await expectNoOverflowInside(dialog, `${context} with errors`);
        await expectNoHorizontalOverflow(page, `${context} with errors`);
        await expectEverythingReachable(page, dialog, locale, `${context} with errors`);

        // A focused field stays visible, as it must above an open keyboard.
        const password = dialog.getByLabel(COPY[locale].password, { exact: true });
        await password.focus();
        await expectInViewport(page, password, `${context}: focused password`);
        await page.screenshot({
          path: `e2e/screenshots/${layout.viewport.width}x${layout.viewport.height}/${locale}-light-imap-connect.png`,
        });
      });
    });
  }
}

test.describe("IMAP connect", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("connects a mailbox and never keeps the password in the browser", async ({ page }) => {
    const api = await mockApi(page);
    const dialog = await openConnectDialog(page, "en");
    const incoming = dialog.getByRole("group", { name: "Incoming mail (IMAP)" });
    const outgoing = dialog.getByRole("group", { name: "Outgoing mail (SMTP)" });

    await expect(incoming.getByLabel("Port")).toHaveValue("993");
    await expect(incoming.getByLabel("Encryption")).toHaveValue("ssl");
    await expect(outgoing.getByLabel("Port")).toHaveValue("587");
    await expect(outgoing.getByLabel("Encryption")).toHaveValue("starttls");
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(dialog.getByText(/require an app-specific password/)).toBeVisible();

    await dialog.getByLabel("Email address").fill("olena@fastmail.example");
    await expect(dialog.getByLabel("Username")).toHaveValue("olena@fastmail.example");
    await dialog.getByLabel("Display name (optional)").fill("Fastmail");
    await incoming.getByLabel("Server").fill("imap.fastmail.example");
    await outgoing.getByLabel("Server").fill("smtp.fastmail.example");
    await outgoing.getByLabel("Encryption").selectOption("ssl");
    await expect(outgoing.getByLabel("Port")).toHaveValue("465");
    await dialog.getByLabel("Password", { exact: true }).fill("app-password-abcd-1234");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(page.getByText("Mailbox connected. Synchronization has started.")).toBeVisible();
    await expect(dialog).toBeHidden();
    const calls = api.callsTo("POST", "/accounts/imap");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      email_address: "olena@fastmail.example",
      display_name: "Fastmail",
      imap: { host: "imap.fastmail.example", port: 993, security: "ssl" },
      smtp: { host: "smtp.fastmail.example", port: 465, security: "ssl" },
      username: "olena@fastmail.example",
      password: "app-password-abcd-1234",
    });
    // The new mailbox is listed with its provider, from a refreshed accounts list.
    const row = page.getByRole("listitem").filter({ hasText: "olena@fastmail.example" });
    await expect(row.getByText(/^IMAP ·/)).toBeVisible();
    await expect.poll(() => api.callsTo("GET", "/accounts").length).toBeGreaterThan(1);

    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, location.href, document.cookie]));
    expect(stored).not.toContain("app-password-abcd-1234");
    // Reopening shows an empty form.
    await page.getByRole("button", { name: "Connect another mail account (IMAP)" }).click();
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Email address")).toHaveValue("");
  });

  test("says which server rejected the password and lets the user retry", async ({ page }) => {
    const api = await mockApi(page);
    const dialog = await openConnectDialog(page, "en");
    await dialog.getByLabel("Email address").fill("olena@fastmail.example");
    await dialog.getByRole("group", { name: "Incoming mail (IMAP)" }).getByLabel("Server").fill("imap.fastmail.example");
    await dialog.getByRole("group", { name: "Outgoing mail (SMTP)" }).getByLabel("Server").fill("smtp.fastmail.example");
    await dialog.getByLabel("Password", { exact: true }).fill(REJECTED_MAIL_PASSWORD);
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(dialog.getByRole("alert")).toHaveText("The outgoing mail (SMTP) server rejected the username or password.");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email address")).toHaveValue("olena@fastmail.example");
    await expect(page.getByRole("listitem").filter({ hasText: "olena@fastmail.example" })).toHaveCount(0);
    expect(api.callsTo("POST", "/accounts/imap")).toHaveLength(1);

    await dialog.getByLabel("Password", { exact: true }).fill("the-right-app-password");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(api.callsTo("POST", "/accounts/imap")).toHaveLength(2);
    await expect(page.getByRole("listitem").filter({ hasText: "olena@fastmail.example" }).filter({ hasText: "IMAP ·" })).toBeVisible();
  });

  test("clears the form when the dialog is closed", async ({ page }) => {
    const api = await mockApi(page);
    const dialog = await openConnectDialog(page, "en");
    await dialog.getByLabel("Email address").fill("olena@fastmail.example");
    await dialog.getByLabel("Password", { exact: true }).fill("typed-but-never-sent");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Connect another mail account (IMAP)" }).click();
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Email address")).toHaveValue("");
    expect(api.callsTo("POST", "/accounts/imap")).toHaveLength(0);
  });
});

const expiredImap: AccountFixture = {
  ...imapAccount,
  status: "needs_reauth",
  status_reason: "authentication_failed",
  sync: { status: "error", last_synced_at: "2026-11-10T08:55:00Z", last_error_code: "provider_auth_required" },
};

for (const layout of [LAYOUTS[0]!, LAYOUTS[2]!]) {
  test.describe(`IMAP reconnect — ${layout.name}`, () => {
    test.use({ viewport: layout.viewport, hasTouch: layout.touch, isMobile: layout.touch });

    test("asks for the password only and never starts the OAuth flow", async ({ page }) => {
      const api = await mockApi(page, { accounts: [accounts[0]!, expiredImap] });
      await page.goto("/en/settings/accounts");
      const row = page.getByRole("listitem").filter({ hasText: "olena@fastmail.example" });
      await expect(row.getByText("Reconnect required")).toBeVisible();
      await expect(row.getByText(/no longer accepts the saved password/)).toBeVisible();
      await row.getByRole("button", { name: "Reconnect" }).click();

      const dialog = page.getByRole("dialog", { name: "Enter the mailbox password" });
      await expect(dialog).toContainText("olena@fastmail.example");
      await settle(page);
      await expectInViewport(page, dialog, "reconnect dialog");
      await expectNoHorizontalOverflow(page, "reconnect dialog");
      await expectNoOverflowInside(dialog, "reconnect dialog");
      await expect(dialog.locator("input, select, textarea")).toHaveCount(1);
      const password = dialog.getByLabel("Password");
      await expect(password).toHaveAttribute("type", "password");

      await password.fill(REJECTED_MAIL_PASSWORD);
      await dialog.getByRole("button", { name: "Reconnect" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("The incoming mail (IMAP) server rejected the username or password.");

      await password.fill("new-app-password");
      await dialog.getByRole("button", { name: "Reconnect" }).click();
      await expect(page.getByText("Mailbox reconnected")).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(row.getByText("Connected", { exact: true })).toBeVisible();
      await expect(row.getByText(/no longer accepts the saved password/)).toHaveCount(0);

      const calls = api.callsTo("POST", "/accounts/acc-imap/imap/credentials");
      expect(calls.map((call) => JSON.parse(call.body ?? "{}"))).toEqual([
        { password: REJECTED_MAIL_PASSWORD },
        { password: "new-app-password" },
      ]);
      expect(api.callsTo("POST", /\/reconnect$/)).toHaveLength(0);
    });
  });
}

test.describe("actions follow the capabilities of the mailbox", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // Threads 3, 6, 9… belong to acc-2 in the fixtures; here that is an IMAP mailbox without
  // Archive, Junk and Drafts folders.
  const bareImap: AccountFixture = {
    ...imapAccount,
    id: "acc-2",
    capabilities: { ...imapAccount.capabilities, archive: false, spam: false, drafts: false },
  };
  const mixed = [accounts[0]!, bareImap];

  test("the reader has no Archive or Spam for a mailbox without those folders", async ({ page }) => {
    const api = await mockApi(page, { accounts: mixed });
    await page.goto("/en/mail/inbox/thread-3");
    // The reading pane only: list rows have their own (hover) actions.
    const reader = page.locator("section").filter({ has: page.getByRole("button", { name: "More actions" }) });
    await expect(reader).toHaveCount(1);
    await expect(reader.getByRole("heading", { level: 1 })).toBeVisible();
    // The mailbox is known (its address is shown), so a missing button is a decision, not a loading state.
    await expect(reader.getByText("olena@fastmail.example")).toBeVisible();
    await expect(reader.getByRole("button", { name: "Move to trash" })).toBeVisible();
    await expect(reader.getByRole("button", { name: "Star", exact: true })).toBeVisible();
    await expect(reader.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await reader.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Mark as unread" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mark as spam" })).toHaveCount(0);
    await expect(page.getByRole("menuitem")).toHaveCount(1);
    await page.keyboard.press("Escape");

    // A conversation of the Gmail mailbox in the same list keeps both.
    await page.goto("/en/mail/inbox/thread-1");
    await expect(reader.getByRole("button", { name: "Archive" })).toBeVisible();
    await reader.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Mark as spam" })).toBeVisible();
    expect(api.callsTo("POST", /\/threads\/.*actions$/).filter((call) => /archive|spam/.test(call.body ?? ""))).toHaveLength(0);
  });

  test("the list row has no Archive shortcut for that mailbox", async ({ page }) => {
    await mockApi(page, { accounts: mixed });
    await page.goto("/en/mail/inbox");
    const rows = page.getByRole("list", { name: "Inbox" }).getByRole("listitem");
    const gmailRow = rows.nth(0);
    const imapRow = rows.nth(2);
    await gmailRow.hover();
    await expect(gmailRow.getByRole("button", { name: "Archive" })).toBeVisible();
    await imapRow.hover();
    await expect(imapRow.getByRole("button", { name: "Move to trash" })).toBeVisible();
    await expect(imapRow.getByRole("button", { name: "Archive" })).toHaveCount(0);
  });

  test("the folder list has no Drafts, Archive or Spam when that mailbox is selected", async ({ page }) => {
    await mockApi(page, { accounts: mixed });
    await page.goto("/en/mail/inbox?account=acc-2");
    const nav = page.getByRole("navigation", { name: "Folders" });
    await expect(nav.getByRole("link", { name: /^Inbox/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Trash" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^(Drafts|Archive|Spam)/ })).toHaveCount(0);
    await page.goto("/en/mail/inbox?account=acc-1");
    await expect(nav.getByRole("link", { name: /^(Drafts|Archive|Spam)/ })).toHaveCount(3);
  });

  test("the composer does not try to save drafts for a mailbox without a Drafts folder", async ({ page }) => {
    const api = await mockApi(page, { accounts: mixed });
    await page.goto("/en/mail/inbox?account=acc-2");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await expect(composer.getByRole("note")).toHaveText("This mailbox has no Drafts folder, so this message is not saved until you send it.");
    await composer.getByLabel("Subject").fill("Not stored as a draft");
    await composer.getByRole("textbox", { name: "Message" }).click();
    await page.keyboard.type("Hello");
    // Longer than the autosave delay: nothing is sent, and no save error appears.
    await page.waitForTimeout(2_500);
    expect(api.callsTo("POST", "/emails/drafts")).toHaveLength(0);
    await expect(composer.getByText("Not saved", { exact: true })).toHaveCount(0);
    await expect(composer.getByText("Draft saved", { exact: true })).toHaveCount(0);

    // Closing asks first, because the message cannot be kept.
    await composer.getByRole("button", { name: "Close", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Discard this message?" });
    await expect(confirm).toContainText("This mailbox cannot store drafts, so the message will be lost.");
    await confirm.getByRole("button", { name: "Keep editing" }).click();
    await expect(composer.getByLabel("Subject")).toHaveValue("Not stored as a draft");

    // Sending still works and does not reference a draft.
    await composer.getByLabel("To").fill("daniel@okafor.example");
    await composer.getByLabel("To").press("Enter");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect(page.getByText("Message sent")).toBeVisible();
    expect(api.callsTo("POST", "/emails/send")).toHaveLength(1);
    expect(api.callsTo("POST", "/emails/drafts")).toHaveLength(0);
    expect(api.callsTo("PUT", /\/emails\/drafts\//)).toHaveLength(0);
  });

  test("a mailbox with a Drafts folder still autosaves", async ({ page }) => {
    const api = await mockApi(page, { accounts: mixed });
    await page.goto("/en/mail/inbox?account=acc-1");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await expect(composer.getByRole("note")).toHaveCount(0);
    await composer.getByLabel("Subject").fill("Stored as a draft");
    await expect(composer.getByText("Draft saved")).toBeVisible();
    expect(api.callsTo("POST", "/emails/drafts")).toHaveLength(1);
  });
});
