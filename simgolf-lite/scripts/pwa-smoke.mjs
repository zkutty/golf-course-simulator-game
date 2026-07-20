import { chromium } from "playwright";

const baseURL = process.env.COURSECRAFT_PWA_URL ?? "http://127.0.0.1:4175";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: "networkidle" });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!controlled) throw new Error("Service worker did not control the app after reload");
  await page.evaluate(() => localStorage.setItem("coursecraft_pwa_probe", "offline-save"));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  if (!(await page.title()).startsWith("CourseCraft")) throw new Error("Offline shell did not load");
  const saved = await page.evaluate(() => localStorage.getItem("coursecraft_pwa_probe"));
  if (saved !== "offline-save") throw new Error("Offline local save probe was lost");
  console.log("PWA smoke passed: controlled install, offline reload, and local save persistence");
} finally {
  await browser.close();
}
