import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  analyzeSurfaceResidency,
  auditImmutableAssetCachePolicy,
  collectChunkFiles,
  DEFERRED_SURFACE_SOURCES,
  entryKeyForSource,
} from "./zk680-surface-budget.mjs";

const immutableAssetCachePolicy = [
  'const matchOptions = relativePath.startsWith("assets/") ? { ignoreVary: true } : undefined;',
  "caches.match(event.request, matchOptions)",
].join("\n");

test("service worker ignores Vary only for immutable content-hashed assets", () => {
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.deepEqual(auditImmutableAssetCachePolicy(source), []);
  assert.deepEqual(auditImmutableAssetCachePolicy(source.replace(immutableAssetCachePolicy.split("\n")[0], "const matchOptions = { ignoreVary: true };")), [
    "Service worker must ignore Vary only when matching immutable content-hashed assets",
  ]);
  assert.deepEqual(auditImmutableAssetCachePolicy(`${source}\ncaches.match(event.request, { ignoreVary: true });`), [
    "Service worker must preserve Vary-sensitive matching outside immutable assets",
  ]);
});

test("bug report launcher styles stay initial while dialog styles stay deferred", () => {
  const launcherCss = readFileSync(new URL("../src/ui/bugReportLauncher.css", import.meta.url), "utf8");
  const dialogCss = readFileSync(new URL("../src/ui/bugReport.css", import.meta.url), "utf8");
  assert.match(launcherCss, /\.cc-bug-report-launcher\s*\{[^}]*position:\s*fixed/s);
  assert.doesNotMatch(dialogCss, /\.cc-bug-report-launcher/);
});

test("collectChunkFiles includes static dependencies but excludes dynamic entries", () => {
  const manifest = {
    "index.html": { file: "assets/index.js", isEntry: true, imports: ["shared"] },
    shared: { file: "assets/shared.js", css: ["assets/shared.css"] },
    "src/ui/StartMenu.tsx": {
      src: "src/ui/StartMenu.tsx",
      file: "assets/start-menu.js",
      isDynamicEntry: true,
      imports: ["shared"],
    },
  };

  assert.equal(entryKeyForSource(manifest, "src/ui/StartMenu.tsx"), "src/ui/StartMenu.tsx");
  assert.deepEqual(
    [...collectChunkFiles(manifest, "src/ui/StartMenu.tsx")].sort(),
    ["assets/shared.css", "assets/shared.js", "assets/start-menu.js"],
  );
  assert.deepEqual(
    [...collectChunkFiles(manifest, "index.html")].sort(),
    ["assets/index.js", "assets/shared.css", "assets/shared.js"],
  );
});

test("surface residency requires every lazy entry to stay out of initial files and the offline precache", () => {
  const directory = mkdtempSync(join(tmpdir(), "zk680-surface-budget-"));
  try {
    const manifest = {
      "index.html": { file: "assets/index.js", isEntry: true, imports: ["shared"] },
      shared: { file: "assets/shared.js" },
    };
    const precached = ["assets/index.js", "assets/shared.js"];
    for (const [index, source] of DEFERRED_SURFACE_SOURCES.entries()) {
      const file = `assets/surface-${index}.js`;
      manifest[source] = { src: source, file, isDynamicEntry: true };
      precached.push(file);
    }
    mkdirSync(join(directory, "assets"));
    for (const file of [...precached, "index.html"]) {
      const path = join(directory, file);
      writeFileSync(path, "export default 1;");
    }
    const serviceWorkerSource = `${precached.map((file) => JSON.stringify(file)).join("\n")}\n${immutableAssetCachePolicy}`;
    const report = analyzeSurfaceResidency(
      manifest,
      directory,
      serviceWorkerSource,
    );
    assert.equal(report.ok, true);
    assert.equal(report.deferred.files.length, DEFERRED_SURFACE_SOURCES.length);
    assert.equal(report.surfaces["src/ui/HUD.tsx"].offlineCodeCached, true);
    assert.equal(report.surfaces["src/ui/HUD.tsx"].files.length, 1);

    manifest[DEFERRED_SURFACE_SOURCES[0]].isDynamicEntry = false;
    const broken = analyzeSurfaceResidency(manifest, directory, serviceWorkerSource);
    assert.match(broken.errors.join("\n"), /not a dynamic Vite entry/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
