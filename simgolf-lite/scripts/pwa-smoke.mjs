import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const STRICT_CSP = "default-src 'self'; base-uri 'self'; connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://cloudflareinsights.com; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data: blob:; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";

const port = Number(process.env.COURSECRAFT_PWA_PORT ?? 4175);
const basePath = process.env.COURSECRAFT_PWA_BASE ?? "/";
const trimmedBase = basePath.replace(/^\/+|\/+$/g, "");
const normalizedBase = trimmedBase ? `/${trimmedBase}/` : "/";
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

// Match perf-smoke: prefer an explicitly provided or preinstalled Chromium so the
// gate runs in sandboxes whose browser build differs from the Playwright default.
const execCandidate = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(execCandidate ? { executablePath: execCandidate } : {}),
});
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

  const cachedVisionAssets = () => page.evaluate(async () => {
    const keys = (await caches.keys()).filter((key) => key.startsWith("coursecraft-"));
    const requests = (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))).flat();
    return requests.map((request) => request.url).filter((url) => url.includes("/vision/"));
  });
  if ((await cachedVisionAssets()).length) throw new Error("Vision media was precached before the Vision page was opened");

  // Reproduce the ZK-756 report: an older build cached screenshot artwork at
  // the stable, unversioned path. The current page must request its build-
  // revision URL instead of allowing that legacy response to win cache-first.
  await page.evaluate(async () => {
    const cacheKey = (await caches.keys()).find((key) => key.startsWith("coursecraft-"));
    if (!cacheKey) throw new Error("CourseCraft cache was not created");
    const cache = await caches.open(cacheKey);
    const staleArtwork = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await cache.put(new URL("vision/parkland.jpg", location.href), new Response(staleArtwork, {
      headers: { "content-type": "image/jpeg", "x-coursecraft-fixture": "stale-vision-art" },
    }));
  });

  await page.goto(new URL("?view=vision", baseURL).href, { waitUntil: "domcontentloaded" });
  await page.getByTestId("vision-page").waitFor({ state: "visible" });
  await page.locator("#vision-biomes").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const parklandSource = await page.locator('[data-biome-id="parkland"] img').evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error("Parkland artwork is not an image");
    const source = new URL(image.currentSrc);
    return { revision: source.searchParams.get("v"), width: image.naturalWidth };
  });
  if (!parklandSource.revision || parklandSource.width < 768) {
    throw new Error(`Versioned Parkland artwork bypass failed: ${JSON.stringify(parklandSource)}`);
  }
  const viewedVisionAssets = await cachedVisionAssets();
  if (!viewedVisionAssets.some((url) => new URL(url).pathname.endsWith("/vision/coursecraft-world.jpg"))) {
    throw new Error("The viewed Vision hero was not stored in the runtime cache");
  }
  if (!viewedVisionAssets.some((url) => new URL(url).pathname.includes("/vision/parkland") && new URL(url).searchParams.has("v"))) {
    throw new Error("A viewed core Vision gallery image was not stored in the runtime cache");
  }

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const response = await fetch(link.href);
    return { url: response.url, body: await response.json() };
  });
  if (!manifest.url.includes(`${normalizedBase}manifest.webmanifest`)) throw new Error(`Manifest loaded from wrong path: ${manifest.url}`);
  if (manifest.body.start_url !== "./" || manifest.body.scope !== "./") throw new Error("Manifest is not deploy-subpath relative");

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
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
  const loadedBiomeAssets = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => url.includes("/atlases/biomes/")));
  if (!loadedBiomeAssets.some((url) => url.includes("parkland"))) {
    throw new Error("Selected Parkland biome bundle was not loaded");
  }
  if (loadedBiomeAssets.some((url) => url.includes("terrain-links") || url.includes("field-links") || url.includes("terrain-desert") || url.includes("field-desert"))) {
    throw new Error("Unselected biome assets were downloaded during Parkland startup");
  }
  const cachedBiomeAssets = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter((key) => key.startsWith("coursecraft-"));
    const requests = (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))).flat();
    return requests.map((request) => request.url).filter((url) => url.includes("/atlases/biomes/"));
  });
  if (!cachedBiomeAssets.some((url) => url.endsWith("/atlases/biomes/manifest.json"))) {
    throw new Error("Stable biome manifest was not available in the PWA cache");
  }
  if (cachedBiomeAssets.some((url) => url.includes("terrain-links") || url.includes("field-links") || url.includes("terrain-desert") || url.includes("field-desert"))) {
    throw new Error("Runtime cache leaked an unselected biome bundle");
  }
  for (const loaded of loadedBiomeAssets) {
    if (!cachedBiomeAssets.includes(loaded)) {
      throw new Error(`Loaded biome asset was not isolated in the runtime cache: ${loaded}`);
    }
  }

  await page.evaluate(() => localStorage.setItem("coursecraft_pwa_probe", "offline-save"));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  if (!(await page.title()).startsWith("CourseCraft")) throw new Error("Offline shell did not load");
  const saved = await page.evaluate(() => localStorage.getItem("coursecraft_pwa_probe"));
  if (saved !== "offline-save") throw new Error("Offline local save probe was lost");
  const offlineBundleResponses = await page.evaluate(async (urls) => Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    }),
  ), loadedBiomeAssets);
  if (offlineBundleResponses.some((ok) => !ok)) {
    throw new Error("Previously loaded biome assets were not available offline");
  }
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("heading", { name: "Choose your game" }).waitFor({ state: "visible" });
  if (pageErrors.length) throw new Error(`Offline New Game emitted page errors: ${pageErrors.join(" | ")}`);
  console.log(`PWA smoke passed at ${baseURL}: strict-CSP gameplay render, Vision cache-on-demand, selected-biome cache isolation, scoped install, offline reload, deferred New Game, and local save persistence`);
} finally {
  await browser.close();
  preview?.close?.();
}
