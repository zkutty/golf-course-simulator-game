import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  workers: 1,
  use: { ...base.use, baseURL: "http://127.0.0.1:4177", trace: "off", video: "off" },
  webServer: { command: "npm run dev -- --mode e2e --host 127.0.0.1 --port 4177", url: "http://127.0.0.1:4177", reuseExistingServer: true },
});
