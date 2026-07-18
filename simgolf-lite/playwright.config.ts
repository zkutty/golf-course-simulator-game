import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
    launchOptions: !process.env.CI && existsSync(macChrome) ? { executablePath: macChrome } : {},
  },
  webServer: {
    command: "npm run dev -- --mode e2e --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
