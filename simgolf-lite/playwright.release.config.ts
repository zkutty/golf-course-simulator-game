import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

const firefoxCiLaunchOptions = process.env.CI
  ? {
      firefoxUserPrefs: {
        "gfx.webrender.software": true,
        "webgl.force-enabled": true,
        "webgl.ignore-blocklist": true,
      },
    }
  : undefined;

export default defineConfig({
  ...base,
  testMatch: /.*(m28-release-candidate|m47-certification|zk813-profile-certification)\.e2e\.ts/,
  reporter: "list",
  projects: [
    { name: "chrome-stable", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], launchOptions: firefoxCiLaunchOptions },
    },
    { name: "webkit-safari-proxy", use: { ...devices["Desktop Safari"] } }
  ]
});
