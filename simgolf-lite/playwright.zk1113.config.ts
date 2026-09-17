import { defineConfig, devices } from "@playwright/test";

/** Isolated selected-preview probe; never shares M14's onboarding server. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/zk1113-preview-flight.e2e.ts",
  timeout: 120_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4176",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --mode e2e --host 127.0.0.1 --port 4176",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
