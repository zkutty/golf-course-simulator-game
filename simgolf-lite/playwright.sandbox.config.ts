// Sandbox-only override. Not part of the committed test configuration — it exists
// so the browser suites can run inside a network-restricted agent container.
//
// This container ships Playwright browser build 1194 at /opt/pw-browsers, while
// @playwright/test 1.61 resolves build 1228, so the default headless-shell launch
// fails. Point the launcher at the installed full Chromium instead.
//
// Known remaining limitation: index.html loads Merriweather/Nunito from
// fonts.googleapis.com, which this container cannot reach — Chromium's request is
// reset even when routed through the environment's HTTPS proxy. Every spec ending
// in `expect(errors).toEqual([])` therefore fails on net::ERR_CONNECTION_RESET
// after otherwise completing, so treat that specific error as environmental here.
// See docs/M35_CERTIFICATION.md §4.
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
