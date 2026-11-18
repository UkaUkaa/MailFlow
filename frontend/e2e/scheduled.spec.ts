import { expect, test, type Page } from "@playwright/test";
import { makeOutboxItem } from "./fixtures/data";
import { expectInViewport, expectNoHorizontalOverflow, expectTouchTarget } from "./fixtures/helpers";
import { mockApi } from "./fixtures/mock-api";

/** One viewport per layout: single pane, navigation rail, three panes. */
const DEVICES = [
  { name: "phone", phone: true, use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  { name: "tablet", phone: false, use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
  { name: "desktop", phone: false, use: { viewport: { width: 1440, height: 900 } } },
] as const;

function sendPayload(body: string | null): Record<string, unknown> {
  const match = /name="payload"\r\n\r\n([\s\S]*?)\r\n--/.exec(body ?? "");
  return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

/** `YYYY-MM-DDTHH:mm` for a `datetime-local` field, a few days ahead (the browser runs in UTC). */
function inputValue(daysAhead: number, time: string): string {
  const day = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${day}T${time}`;
}

async function compose(page: Page, subject: string, body: string) {
  await page.goto("/en/mail/inbox");
  await page.getByRole("button", { name: "Compose" }).locator("visible=true").first().click();
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByLabel("To").fill("daniel@okafor.example,");
  await composer.getByLabel("Subject").fill(subject);
  await composer.getByRole("textbox", { name: "Message" }).click();
  await page.keyboard.type(body);
  return composer;
}

/** Opens the Scheduled view the way each layout offers it: drawer on phones, the column otherwise. */
async function openScheduled(page: Page, phone: boolean, linkName: string | RegExp) {
  if (phone) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: linkName }).click();
  } else {
    await page.locator("aside.mf-sidebar").getByRole("link", { name: linkName }).click();
  }
  await expect(page).toHaveURL(/\/en\/mail\/scheduled$/);
}

for (const device of DEVICES) {
  test.describe(`send later and undo send (${device.name})`, () => {
    test.use(device.use);
    /** A preset or the exact-time row: a sheet button on phones, a menu item otherwise. */
    const choice = (page: Page, name: string | RegExp) => page.getByRole(device.phone ? "button" : "menuitem", { name });

    test("schedules with a preset, reschedules and cancels back into the composer", async ({ page }) => {
      const api = await mockApi(page);
      const composer = await compose(page, "Lunch on Thursday", "See you at 12:30.");
      await expect(composer.getByText("Draft saved")).toBeVisible();

      const trigger = composer.getByRole("button", { name: "Schedule for later" });
      if (device.phone) await expectTouchTarget(trigger, "send later trigger");
      await trigger.click();
      await expectInViewport(page, choice(page, /Tomorrow morning/), "send later choices");
      await expectNoHorizontalOverflow(page, "send later choices");
      await choice(page, /Tomorrow morning/).click();

      await expect(page.getByText(/^Send scheduled for /)).toBeVisible();
      await expect(composer).toHaveCount(0);
      const sends = api.callsTo("POST", "/emails/send");
      expect(sends).toHaveLength(1);
      const scheduled = sendPayload(sends[0]?.body ?? null);
      expect(scheduled).toMatchObject({ subject: "Lunch on Thursday", draft_id: "draft-1" });
      // Tomorrow 08:00 in the browser's zone (UTC in this suite), sent as an ISO UTC string.
      expect(String(scheduled.send_at)).toMatch(/T08:00:00\.000Z$/);
      expect(new Date(String(scheduled.send_at)).getTime()).toBeGreaterThan(Date.now());

      await openScheduled(page, device.phone, "Scheduled, 1 message");
      const row = page.getByRole("list", { name: "Scheduled" }).getByRole("listitem");
      await expect(row).toHaveCount(1);
      await expect(row.getByText("To: daniel@okafor.example")).toBeVisible();
      await expect(row.getByText("Lunch on Thursday")).toBeVisible();
      await expect(row.getByText("See you at 12:30.")).toBeVisible();
      await expect(row.getByText(/^Sends .*8:00/)).toBeVisible();
      await expectNoHorizontalOverflow(page, "scheduled view");
      if (device.phone) {
        // Single pane with the bottom navigation; no reading pane beside the list.
        await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
        await expectTouchTarget(row.getByRole("button"), "scheduled row actions");
      }

      // Reschedule to an exact time through the same picker.
      await row.getByRole("button", { name: "Reschedule" }).click();
      await choice(page, "Pick date & time").click();
      const picker = page.getByRole("dialog", { name: "Pick date & time" });
      await expectInViewport(page, picker, "exact time dialog");
      await picker.getByRole("button", { name: "Reschedule" }).click();
      await expect(picker.getByRole("alert")).toHaveText("Choose a date and time.");
      const value = inputValue(3, "09:30");
      await picker.getByLabel("Date and time").fill(value);
      await picker.getByRole("button", { name: "Reschedule" }).click();
      await expect(page.getByText(/^Send rescheduled for /)).toBeVisible();
      await expect(row.getByText(/^Sends .*9:30/)).toBeVisible();
      const patches = api.callsTo("PATCH", "/outbox/out-1");
      expect(patches).toHaveLength(1);
      expect(JSON.parse(patches[0]?.body ?? "{}")).toEqual({ send_at: `${value}:00.000Z` });

      // Cancel: asks first, then the message comes back in the composer.
      await row.getByRole("button", { name: "Cancel send" }).click();
      const confirm = page.getByRole("dialog", { name: "Cancel this send?" });
      await confirm.getByRole("button", { name: "Cancel send" }).click();
      const reopened = page.getByRole("dialog", { name: "New message" });
      await expect(reopened).toBeVisible();
      await expect(reopened.getByLabel("Subject")).toHaveValue("Lunch on Thursday");
      await expect(reopened.getByText("daniel@okafor.example")).toBeVisible();
      await expect(reopened.getByRole("textbox", { name: "Message" })).toContainText("See you at 12:30.");
      expect(api.callsTo("POST", "/outbox/out-1/cancel")).toHaveLength(1);

      // Sending it again uses the kept draft and a fresh idempotency key.
      await reopened.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("Message sent")).toBeVisible();
      const again = api.callsTo("POST", "/emails/send");
      expect(again).toHaveLength(2);
      expect(sendPayload(again[1]?.body ?? null)).toMatchObject({ subject: "Lunch on Thursday", draft_id: "draft-1" });
      expect(sendPayload(again[1]?.body ?? null)).not.toHaveProperty("send_at");
      expect(again[1]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(again[1]?.headers["idempotency-key"]).not.toBe(again[0]?.headers["idempotency-key"]);
      await expect(page.getByRole("heading", { name: "Nothing scheduled" })).toBeVisible();
    });

    test("undoes a send and reopens the composer with its content and files", async ({ page }) => {
      const api = await mockApi(page, { settings: { undo_send_seconds: 20 } });
      const composer = await compose(page, "Notes from today", "Draft of the notes.");
      await composer.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
      await expect(composer.getByText("notes.txt")).toBeVisible();
      await composer.getByRole("button", { name: "Send", exact: true }).click();

      await expect(composer).toHaveCount(0);
      await expect(page.getByText("Sending…")).toBeVisible();
      const undo = page.getByRole("button", { name: "Undo" });
      await expectInViewport(page, undo, "undo button");
      if (device.phone) await expectTouchTarget(undo, "undo button");
      await expectNoHorizontalOverflow(page, "undo toast");
      // Held for the undo window: neither reported as sent nor listed as scheduled.
      await expect(page.getByText("Message sent")).toHaveCount(0);
      await undo.click();
      await expect(page.getByText("Sending…")).toHaveCount(0);

      const reopened = page.getByRole("dialog", { name: "New message" });
      await expect(reopened).toBeVisible();
      await expect(reopened.getByLabel("Subject")).toHaveValue("Notes from today");
      await expect(reopened.getByText("daniel@okafor.example")).toBeVisible();
      await expect(reopened.getByRole("textbox", { name: "Message" })).toContainText("Draft of the notes.");
      await expect(reopened.getByText("notes.txt")).toBeVisible();
      expect(api.callsTo("POST", "/outbox/out-1/cancel")).toHaveLength(1);

      await reopened.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("Sending…")).toBeVisible();
      const sends = api.callsTo("POST", "/emails/send");
      expect(sends).toHaveLength(2);
      expect(sends[1]?.body).toContain('name="files"; filename="notes.txt"');
      expect(sends[1]?.headers["idempotency-key"]).not.toBe(sends[0]?.headers["idempotency-key"]);
    });

    test("changes the undo window in settings", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto("/en/settings/appearance");
      const group = page.getByRole("group", { name: "Undo send" });
      await expect(group.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
      if (device.phone) await expectTouchTarget(group.getByRole("button"), "undo send options", 40);
      await group.getByRole("button", { name: "10 seconds" }).click();
      await expect(group.getByRole("button", { name: "10 seconds" })).toHaveAttribute("aria-pressed", "true");
      await expect(group.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => api.callsTo("PATCH", "/settings").length).toBe(1);
      expect(JSON.parse(api.callsTo("PATCH", "/settings")[0]?.body ?? "{}")).toEqual({ undo_send_seconds: 10 });
      await expectNoHorizontalOverflow(page, "appearance settings");
    });
  });
}

test.describe("undo window", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reports the message as sent when the window passes without Undo", async ({ page }) => {
    const api = await mockApi(page, { settings: { undo_send_seconds: 5 } });
    const composer = await compose(page, "Short window", "Goes out in five seconds.");
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Sending…")).toBeVisible();
    await expect(page.getByText("Message sent")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(api.callsTo("POST", /^\/outbox\/.*\/cancel$/)).toHaveLength(0);
  });

  test("says it is too late when the message has already gone out", async ({ page }) => {
    const api = await mockApi(page, { settings: { undo_send_seconds: 20 } });
    const composer = await compose(page, "Already gone", "Too quick to stop.");
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Sending…")).toBeVisible();
    api.startSending();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Too late — the message was already sent")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "New message" })).toHaveCount(0);
  });
});

test.describe("scheduled view at 320px", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  const outbox = [
    makeOutboxItem("out-a", {
      subject: "Supercalifragilisticexpialidocious_and_unbreakable_subject_token_0123456789_0123456789",
      to: [{ name: null, email: "billing-department-notifications-noreply@a-very-long-domain-name-for-testing.example.com" }],
      attachment_count: 3,
    }),
    makeOutboxItem("out-b", { status: "failed", error_code: "provider_auth_required", send_at: "2027-03-02T08:00:00Z" }),
    makeOutboxItem("out-c", { status: "failed", error_code: "provider_unavailable", send_at: "2027-03-03T08:00:00Z", account_id: "acc-2" }),
  ];

  for (const locale of ["en", "uk"] as const) {
    test(`fits a phone without sideways scrolling (${locale})`, async ({ page }) => {
      await mockApi(page, { outbox });
      await page.goto(`/${locale}/mail/scheduled`);
      const rows = page.getByRole("list").filter({ hasText: "Quarterly report" }).getByRole("listitem");
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(1).getByRole("status")).toHaveText(
        locale === "en" ? "Couldn't send. Reconnect the mailbox and retry." : "Не вдалося надіслати. Підключіть скриньку знову та повторіть спробу.",
      );
      await expect(rows.nth(2).getByRole("status")).toHaveText(locale === "en" ? "Couldn't send this message." : "Не вдалося надіслати цей лист.");
      await expectNoHorizontalOverflow(page, `${locale} scheduled list`);
      await expectTouchTarget(rows.getByRole("button"), `${locale} row actions`);

      await rows.first().getByRole("button", { name: locale === "en" ? "Reschedule" : "Перенести" }).click();
      const sheet = page.getByRole("dialog", { name: locale === "en" ? "Reschedule send" : "Перенести надсилання" });
      await expectInViewport(page, sheet, `${locale} reschedule sheet`);
      await expectTouchTarget(sheet.getByRole("button"), `${locale} reschedule choices`);
      await expectNoHorizontalOverflow(page, `${locale} reschedule sheet`);
    });
  }

  test("follows the mailbox filter", async ({ page }) => {
    await mockApi(page, { outbox });
    await page.goto("/en/mail/scheduled?account=acc-2");
    await expect(page.getByRole("list", { name: "Scheduled" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("1 message")).toBeVisible();
  });
});
