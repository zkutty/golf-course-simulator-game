import { defineConfig } from "@playwright/test";
import release from "./playwright.release.config";

export default defineConfig({
  ...release,
  use: {
    ...release.use,
    trace: { mode: "retain-on-failure", snapshots: false, screenshots: true },
  },
});
