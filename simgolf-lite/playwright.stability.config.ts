import { defineConfig, devices } from "@playwright/test";
import { stabilityPreviewCommand } from "./scripts/zk682-run-stability.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const buildDirectory = process.env.ZK682_STABILITY_BUILD_DIR ?? "";
const receiptPath = process.env.ZK682_STABILITY_BUILD_RECEIPT ?? "";
const expectedCommit = process.env.ZK682_EXPECTED_COMMIT ?? "";
const buildId = process.env.ZK682_STABILITY_BUILD_ID ?? "";
if (!isAbsolute(buildDirectory) || !isAbsolute(receiptPath) || !/^[0-9a-f]{40}$/.test(expectedCommit) || !buildId) throw new Error("Use the stability runner to supply a fresh production build and full candidate identity");
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
if (receipt.candidateCommit !== expectedCommit || receipt.buildId !== buildId || receipt.buildDirectory !== buildDirectory || receipt.mode !== "e2e" || receipt.nodeEnv !== "production") throw new Error("Stability build receipt does not match this invocation");
if (createHash("sha256").update(readFileSync(join(buildDirectory, "index.html"))).digest("hex") !== receipt.indexSha256) throw new Error("Stability preview build differs from its fresh build receipt");
const port = Number(process.env.ZK682_STABILITY_PORT ?? 4176);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid stability preview port");
const preview = stabilityPreviewCommand(process.execPath, resolve(root, "node_modules/vite/bin/vite.js"), buildDirectory, port);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "zk682-stability.e2e.ts",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: join(process.env.COURSECRAFT_ZK682_STABILITY_DIR ?? resolve(root, "test-results"), "playwright"),
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ use: { channel: "chromium" } }],
  webServer: { command: preview, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120_000 },
});
