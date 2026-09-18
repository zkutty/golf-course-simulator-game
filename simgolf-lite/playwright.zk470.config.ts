import { defineConfig, devices } from "@playwright/test";

/** Dedicated local port so ZK-470 always exercises this isolated worktree. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/zk470-placement-heightfield-matrix.e2e.ts",
  timeout: 180_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --mode e2e --host 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
