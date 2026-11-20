import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/mock-api";

test.use({ viewport: { width: 1440, height: 900 } });

function sendPayload(body: string | null): Record<string, unknown> {
  const match = /name="payload"\r\n\r\n([\s\S]*?)\r\n--/.exec(body ?? "");
  return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}

test.describe("composer", () => {
  test("composes, autosaves a draft and sends exactly once", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await expect(composer).toBeVisible();

    await composer.getByLabel("To").fill("daniel@okafor.example");
    await composer.getByLabel("To").press("Enter");
    await composer.getByLabel("Subject").fill("Lunch on Thursday");
    await composer.getByRole("textbox", { name: "Message" }).click();
    await page.keyboard.type("See you at 12:30.");
    await composer.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.type(" Bring the report.");

    // Draft is stored at the provider after a pause in typing.
    await expect(composer.getByText("Draft saved")).toBeVisible();
    const draft = JSON.parse(api.callsTo("POST", "/emails/drafts")[0]?.body ?? "{}") as Record<string, unknown>;
    expect(draft).toMatchObject({ account_id: "acc-1", subject: "Lunch on Thursday", mode: "new" });

    const send = composer.getByRole("button", { name: "Send" }).last();
    await send.dblclick();
    await expect(page.getByText("Message sent")).toBeVisible();
    await expect(composer).toHaveCount(0);

    const sends = api.callsTo("POST", "/emails/send");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sends[0]?.headers["content-type"]).toContain("multipart/form-data");
    const payload = sendPayload(sends[0]?.body ?? null);
    expect(payload).toMatchObject({
      account_id: "acc-1",
      to: [{ name: null, email: "daniel@okafor.example" }],
      subject: "Lunch on Thursday",
      mode: "new",
      draft_id: "draft-1",
    });
    expect(String(payload.body_html)).toContain("See you at 12:30.");
    expect(String(payload.body_html)).toContain("<strong>");
  });

  test("refuses to send without recipients or with invalid addresses", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await composer.getByLabel("Subject").fill("Hello");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect(composer.getByRole("alert")).toContainText("Add at least one recipient.");

    await composer.getByLabel("To").fill("not-an-address");
    await composer.getByLabel("To").press("Enter");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect(composer.getByRole("alert")).toContainText("Fix or remove the invalid addresses");
    expect(api.callsTo("POST", "/emails/send")).toHaveLength(0);
  });

  test("asks before sending without a subject", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await composer.getByLabel("To").fill("daniel@okafor.example,");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect(page.getByRole("dialog", { name: "Send without a subject?" })).toBeVisible();
    await page.getByRole("button", { name: "Send anyway" }).click();
    await expect.poll(() => api.callsTo("POST", "/emails/send").length).toBe(1);
  });

  test("prefills a reply-all with recipients, subject and the quoted original", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-1");
    await page.getByRole("button", { name: "Reply all" }).first().click();
    const composer = page.getByRole("dialog", { name: "Reply all" });
    await expect(composer.getByText("Marta Shevchenko")).toBeVisible();
    await expect(composer.getByText("Daniel Okafor")).toBeVisible();
    // The user's own address is never added to a reply.
    await expect(composer.getByText("Olena Kovalenko")).toHaveCount(0);
    await expect(composer.getByLabel("Subject")).toHaveValue("Re: Q4 planning notes and next steps");
    await expect(composer.getByText("The original message will be included")).toBeVisible();

    await composer.getByRole("textbox", { name: "Message" }).click();
    await page.keyboard.type("Thanks!");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect.poll(() => api.callsTo("POST", "/emails/send").length).toBe(1);
    const payload = sendPayload(api.callsTo("POST", "/emails/send")[0]?.body ?? null);
    expect(payload).toMatchObject({ mode: "reply_all", source_message_id: "thread-1-m3", account_id: "acc-1" });
    expect(String(payload.body_html)).toContain("Thanks!");
    expect(String(payload.body_html)).toContain("<blockquote>");
  });

  test("forwards with the original attachments", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox/thread-1");
    await page.getByRole("button", { name: "Forward" }).first().click();
    const composer = page.getByRole("dialog", { name: "Forward" });
    await expect(composer.getByLabel("Subject")).toHaveValue("Fwd: Q4 planning notes and next steps");
    await expect(composer.getByText("chart.png")).toBeVisible();
    await composer.getByRole("button", { name: /Remove attachment: chart.png/ }).click();
    await composer.getByLabel("To").fill("daniel@okafor.example,");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect.poll(() => api.callsTo("POST", "/emails/send").length).toBe(1);
    expect(sendPayload(api.callsTo("POST", "/emails/send")[0]?.body ?? null)).toMatchObject({
      mode: "forward",
      forward_attachment_ids: ["thread-1-a1"],
    });
  });

  test("attaches files and sends them as multipart parts", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    await composer.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(composer.getByText("notes.txt")).toBeVisible();
    await composer.getByLabel("To").fill("daniel@okafor.example,");
    await composer.getByLabel("Subject").fill("Notes");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect.poll(() => api.callsTo("POST", "/emails/send").length).toBe(1);
    expect(api.callsTo("POST", "/emails/send")[0]?.body).toContain('name="files"; filename="notes.txt"');
  });

  test("attaches files dropped on a new message", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Compose" }).click();
    const composer = page.getByRole("dialog", { name: "New message" });
    const dataTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["hello"], "dropped.txt", { type: "text/plain" }));
      return transfer;
    });
    const body = composer.getByRole("textbox", { name: "Message" });
    await body.dispatchEvent("dragenter", { dataTransfer });
    await expect(composer.getByText("Drop files to attach them")).toBeVisible();
    await body.dispatchEvent("dragover", { dataTransfer });
    await body.dispatchEvent("drop", { dataTransfer });
    await expect(composer.getByRole("list", { name: "Attachments" }).getByText("dropped.txt")).toBeVisible();
    await expect(body).not.toContainText("dropped.txt");

    await composer.getByLabel("To").fill("daniel@okafor.example,");
    await composer.getByLabel("Subject").fill("Dropped");
    await composer.getByRole("button", { name: "Send" }).last().click();
    await expect.poll(() => api.callsTo("POST", "/emails/send").length).toBe(1);
    expect(api.callsTo("POST", "/emails/send")[0]?.body).toContain('name="files"; filename="dropped.txt"');
  });

  test("keeps the message as a draft when closed and deletes it when discarded", async ({ page }) => {
    const api = await mockApi(page);
    await page.goto("/en/mail/inbox");
    await page.getByRole("button", { name: "Compose" }).click();
    let composer = page.getByRole("dialog", { name: "New message" });
    await composer.getByLabel("Subject").fill("Unfinished thought");
    await composer.getByRole("button", { name: "Save and close" }).last().click();
    await expect(page.getByText("Draft saved")).toBeVisible();
    await expect(composer).toHaveCount(0);
    expect(api.callsTo("POST", "/emails/drafts")).toHaveLength(1);

    await page.getByRole("button", { name: "Compose" }).click();
    composer = page.getByRole("dialog", { name: "New message" });
    await composer.getByLabel("Subject").fill("Throw away");
    await expect(composer.getByText("Draft saved")).toBeVisible();
    await composer.getByRole("button", { name: "Discard" }).click();
    const confirm = page.getByRole("dialog", { name: "Discard this message?" });
    await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(composer).toHaveCount(0);
    await expect.poll(() => api.callsTo("DELETE", /^\/emails\/drafts\//).length).toBe(1);
  });
});
