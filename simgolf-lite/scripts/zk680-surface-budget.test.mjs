import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  analyzeSurfaceResidency,
  collectChunkFiles,
  DEFERRED_SURFACE_SOURCES,
  entryKeyForSource,
} from "./zk680-surface-budget.mjs";

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
    const report = analyzeSurfaceResidency(
      manifest,
      directory,
      precached.map((file) => JSON.stringify(file)).join("\n"),
    );
    assert.equal(report.ok, true);
    assert.equal(report.deferred.files.length, DEFERRED_SURFACE_SOURCES.length);

    manifest[DEFERRED_SURFACE_SOURCES[0]].isDynamicEntry = false;
    const broken = analyzeSurfaceResidency(manifest, directory, precached.map((file) => JSON.stringify(file)).join("\n"));
    assert.match(broken.errors.join("\n"), /not a dynamic Vite entry/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
