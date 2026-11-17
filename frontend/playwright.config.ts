import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * The suite runs against a production build. Every `/api/v1` call is answered
 * by fixtures in `e2e/fixtures` (see mock-api.ts), so no backend is required.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-standalone.mjs",
    env: { PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    url: `http://127.0.0.1:${PORT}/en/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
