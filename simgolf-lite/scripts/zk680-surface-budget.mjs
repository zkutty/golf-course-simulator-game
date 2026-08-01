import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const distRoot = join(root, "dist");

/** Sources deliberately deferred from the game/simulation entry bundle. */
export const DEFERRED_SURFACE_SOURCES = [
  "src/ui/StartMenu.tsx",
  "src/ui/NewGameWizard.tsx",
  "src/ui/VisionPage.tsx",
  "src/ui/SaveLoadModal.tsx",
  "src/ui/SettingsModal.tsx",
  "src/ui/retention/RetentionHub.tsx",
  "src/ui/help/GolfopediaModal.tsx",
];

// Initial residency includes every file imported by the browser entry graph.
// Atlas/media selected by the renderer have their own m35 manifest audit.
export const SURFACE_RESIDENCY_BUDGETS = {
  initialCriticalBrotliBytes: 1280 * 1024,
  deferredSurfaceBrotliBytes: 700 * 1024,
  individualSurfaceBrotliBytes: 350 * 1024,
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function entryKeyForSource(manifest, source) {
  return Object.entries(manifest).find(([, entry]) => entry.src === source)?.[0] ?? null;
}

/** Resolves a manifest entry's JS/CSS/assets and its static import closure. */
export function collectChunkFiles(manifest, entryKey, seen = new Set()) {
  if (!entryKey || seen.has(entryKey)) return new Set();
  seen.add(entryKey);
  const entry = manifest[entryKey];
  if (!entry) return new Set();
  const files = new Set([entry.file, ...asArray(entry.css), ...asArray(entry.assets)]);
  for (const imported of asArray(entry.imports)) {
    for (const file of collectChunkFiles(manifest, imported, seen)) files.add(file);
  }
  return files;
}

export function isTransferText(file) {
  return [".html", ".js", ".css", ".json", ".svg", ".webmanifest"].includes(extname(file));
}

export function transferBytes(buffer, file) {
  if (!isTransferText(file)) return buffer.length;
  return brotliCompressSync(buffer, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

export function bytesForFiles(rootDirectory, files) {
  return [...files].reduce((total, file) => {
    const path = join(rootDirectory, file);
    if (!existsSync(path)) throw new Error(`Build output is missing ${file}`);
    return total + transferBytes(readFileSync(path), file);
  }, 0);
}

function manifestEntry(manifest) {
  return Object.entries(manifest).find(([, entry]) => entry.isEntry)?.[0] ?? null;
}

function sorted(values) {
  return [...values].sort();
}

export function analyzeSurfaceResidency(manifest, rootDirectory, serviceWorkerSource = "") {
  const errors = [];
  const initialEntry = manifestEntry(manifest);
  if (!initialEntry) errors.push("Vite manifest has no application entry");
  const initialFiles = collectChunkFiles(manifest, initialEntry);
  initialFiles.add("index.html");

  const surfaces = {};
  const allDeferredFiles = new Set();
  for (const source of DEFERRED_SURFACE_SOURCES) {
    const key = entryKeyForSource(manifest, source);
    if (!key) {
      errors.push(`Deferred surface ${source} is not emitted by Vite`);
      continue;
    }
    const entry = manifest[key];
    if (!entry.isDynamicEntry) errors.push(`Deferred surface ${source} is not a dynamic Vite entry`);
    const files = collectChunkFiles(manifest, key);
    const rootIsInitial = initialFiles.has(entry.file);
    if (rootIsInitial) errors.push(`Deferred surface ${source} remains in the initial entry graph`);
    const deferredFiles = new Set([...files].filter((file) => !initialFiles.has(file)));
    for (const file of deferredFiles) allDeferredFiles.add(file);
    const bytes = bytesForFiles(rootDirectory, deferredFiles);
    if (bytes > SURFACE_RESIDENCY_BUDGETS.individualSurfaceBrotliBytes) {
      errors.push(`${source} deferred transfer is ${bytes} B; limit is ${SURFACE_RESIDENCY_BUDGETS.individualSurfaceBrotliBytes} B`);
    }
    const uncached = [...deferredFiles].filter((file) => !serviceWorkerSource.includes(JSON.stringify(file)));
    if (uncached.length) errors.push(`${source} deferred code is not precached for offline use: ${uncached.join(", ")}`);
    surfaces[source] = { files: sorted(deferredFiles), brotliBytes: bytes, offlineCodeCached: uncached.length === 0 };
  }

  const initialBrotliBytes = bytesForFiles(rootDirectory, initialFiles);
  const deferredBrotliBytes = bytesForFiles(rootDirectory, allDeferredFiles);
  if (initialBrotliBytes > SURFACE_RESIDENCY_BUDGETS.initialCriticalBrotliBytes) {
    errors.push(`Initial critical transfer is ${initialBrotliBytes} B; limit is ${SURFACE_RESIDENCY_BUDGETS.initialCriticalBrotliBytes} B`);
  }
  if (deferredBrotliBytes > SURFACE_RESIDENCY_BUDGETS.deferredSurfaceBrotliBytes) {
    errors.push(`Deferred app-surface transfer is ${deferredBrotliBytes} B; limit is ${SURFACE_RESIDENCY_BUDGETS.deferredSurfaceBrotliBytes} B`);
  }

  return {
    ok: errors.length === 0,
    budgets: SURFACE_RESIDENCY_BUDGETS,
    initial: { files: sorted(initialFiles), brotliBytes: initialBrotliBytes },
    deferred: { files: sorted(allDeferredFiles), brotliBytes: deferredBrotliBytes },
    surfaces,
    errors,
  };
}

function run() {
  const manifestPath = join(distRoot, ".vite", "manifest.json");
  const workerPath = join(distRoot, "sw.js");
  if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}; run vite build first`);
  if (!existsSync(workerPath)) throw new Error(`Missing ${workerPath}; run inject-sw-assets first`);
  const report = analyzeSurfaceResidency(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    distRoot,
    readFileSync(workerPath, "utf8"),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
