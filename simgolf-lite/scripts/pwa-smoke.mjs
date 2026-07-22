import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const STRICT_CSP = "default-src 'self'; base-uri 'self'; connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://cloudflareinsights.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; img-src 'self' data: blob:; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob:";

const port = Number(process.env.COURSECRAFT_PWA_PORT ?? 4175);
const basePath = process.env.COURSECRAFT_PWA_BASE ?? "/golf-course-simulator-game/";
const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
const baseURL = process.env.COURSECRAFT_PWA_URL ?? `http://127.0.0.1:${port}${normalizedBase}`;

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

let preview = null;
if (!process.env.COURSECRAFT_PWA_URL) {
  await run("npm", ["run", "build"], { env: { ...process.env, VITE_BASE: normalizedBase } });
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  preview = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, baseURL).pathname);
    if (!pathname.startsWith(normalizedBase)) { response.writeHead(404).end(); return; }
    const relative = pathname.slice(normalizedBase.length) || "index.html";
    let file = join(dist, relative);
    try {
      if (!(await stat(file)).isFile()) file = join(dist, "index.html");
    } catch { file = join(dist, "index.html"); }
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "content-security-policy": STRICT_CSP,
    });
    response.end(body);
  });
  await new Promise((resolve, reject) => { preview.once("error", reject); preview.listen(port, "127.0.0.1", resolve); });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("service-worker ready timeout")), 15_000))]); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const registration = await page.evaluate(async () => {
    const active = await navigator.serviceWorker.ready;
    return { controlled: Boolean(navigator.serviceWorker.controller), scope: active.scope, scriptURL: active.active?.scriptURL ?? "" };
  });
  if (!registration.controlled) throw new Error("Service worker did not control the app after reload");
  if (!registration.scope.endsWith(normalizedBase)) throw new Error(`Service-worker scope ${registration.scope} does not match ${normalizedBase}`);
  if (!registration.scriptURL.endsWith(`${normalizedBase}sw.js`)) throw new Error(`Service worker loaded from wrong path: ${registration.scriptURL}`);

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const response = await fetch(link.href);
    return { url: response.url, body: await response.json() };
  });
  if (!manifest.url.includes(`${normalizedBase}manifest.webmanifest`)) throw new Error(`Manifest loaded from wrong path: ${manifest.url}`);
  if (manifest.body.start_url !== "./" || manifest.body.scope !== "./") throw new Error("Manifest is not deploy-subpath relative");

  await page.getByRole("button", { name: "Quick Start" }).click();
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  const courseCanvas = page.locator(".cc-pixi-stage canvas");
  await courseCanvas.waitFor({ state: "visible", timeout: 15_000 });
  const pixels = PNG.sync.read(await courseCanvas.screenshot());
  const colors = new Set();
  const pixelStride = Math.max(1, Math.floor((pixels.width * pixels.height) / 20_000));
  for (let pixel = 0; pixel < pixels.width * pixels.height; pixel += pixelStride) {
    const offset = pixel * 4;
    colors.add(`${pixels.data[offset]},${pixels.data[offset + 1]},${pixels.data[offset + 2]},${pixels.data[offset + 3]}`);
    if (colors.size >= 16) break;
  }
  if (colors.size < 16) throw new Error(`Course canvas did not contain a rendered scene (${colors.size} sampled colors)`);
  if (pageErrors.length) throw new Error(`Gameplay emitted page errors: ${pageErrors.join(" | ")}`);

  await page.evaluate(() => localStorage.setItem("coursecraft_pwa_probe", "offline-save"));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  if (!(await page.title()).startsWith("CourseCraft")) throw new Error("Offline shell did not load");
  const saved = await page.evaluate(() => localStorage.getItem("coursecraft_pwa_probe"));
  if (saved !== "offline-save") throw new Error("Offline local save probe was lost");
  console.log(`PWA smoke passed at ${baseURL}: strict-CSP gameplay render, scoped install, offline reload, and local save persistence`);
} finally {
  await browser.close();
  preview?.close?.();
}
