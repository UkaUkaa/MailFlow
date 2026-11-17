import { expect, type Locator, type Page } from "@playwright/test";

/** The page itself must never scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(size.scrollWidth, `${context}: documentElement scrollWidth`).toBeLessThanOrEqual(size.clientWidth);
  expect(size.bodyScrollWidth, `${context}: body scrollWidth`).toBeLessThanOrEqual(size.clientWidth);
}

/** The whole element lies inside the visible viewport (not clipped, not off-screen). */
export async function expectInViewport(page: Page, locator: Locator, context: string): Promise<void> {
  await expect(locator, context).toBeVisible();
  const viewport = page.viewportSize();
  // Retried briefly so that sheets and drawers can finish sliding in.
  await expect(async () => {
    const box = await locator.boundingBox();
    expect(box, `${context}: has a box`).not.toBeNull();
    if (!box || !viewport) return;
    expect(box.x, `${context}: left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y, `${context}: top edge`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, `${context}: right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height, `${context}: bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
  }).toPass({ timeout: 3_000 });
}

/** Primary controls must be comfortably tappable: at least 44x44 CSS px. */
export async function expectTouchTarget(locator: Locator, context: string, minimum = 44): Promise<void> {
  const count = await locator.count();
  expect(count, `${context}: at least one control`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible())) continue;
    const box = await item.boundingBox();
    expect(box, `${context} #${index}: has a box`).not.toBeNull();
    if (!box) continue;
    expect(box.width, `${context} #${index}: width`).toBeGreaterThanOrEqual(minimum - 0.5);
    expect(box.height, `${context} #${index}: height`).toBeGreaterThanOrEqual(minimum - 0.5);
  }
}

/** Two elements must not overlap each other. */
export async function expectNoOverlap(a: Locator, b: Locator, context: string): Promise<void> {
  const [first, second] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  if (!first || !second) return;
  const separate =
    first.x + first.width <= second.x + 0.5 ||
    second.x + second.width <= first.x + 0.5 ||
    first.y + first.height <= second.y + 0.5 ||
    second.y + second.height <= first.y + 0.5;
  expect(separate, `${context}: elements overlap`).toBe(true);
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
