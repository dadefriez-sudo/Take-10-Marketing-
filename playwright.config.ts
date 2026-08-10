// The test process needs the same env as the server (CRON_SECRET, DATABASE_URL).
import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

import { existsSync } from "node:fs";

const PRESET_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ??
  (existsSync(PRESET_CHROMIUM) ? PRESET_CHROMIUM : undefined);

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    // The container preinstalls Chromium, but its build number won't match
    // whatever this Playwright version expects, so point at it explicitly
    // instead of downloading a second copy.
    launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
