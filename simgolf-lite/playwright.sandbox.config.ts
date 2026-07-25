// Sandbox-only override: this container ships Playwright browser build 1194 at
// /opt/pw-browsers, while @playwright/test 1.61 expects 1228. Point the launcher
// at the installed full Chromium instead of the missing headless shell.
// Not part of the committed test configuration.
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    launchOptions: {
      ...(base.use?.launchOptions ?? {}),
      executablePath: "/opt/pw-browsers/chromium",
    },
  },
});
