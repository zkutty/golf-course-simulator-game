import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// Root may run this same regression against an immutable parent checkout.
const ROOT = path.resolve(process.env.COURSECRAFT_ATLAS_URL_TEST_ROOT
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const QUALITIES = ["high", "medium", "low"];
const SEMANTICS = ["fairway", "rough", "deep_rough", "green", "tee"];
const BASE = "https://coursecraft.example/nested/";

test("bundled atlas texture URLs remain same-origin and preserve every image byte", async () => {
  // Build the real URL modules with Vite's normal asset plugins and default
  // inline limit. Do not override the limit: doing so would conceal the CSP bug.
  // This narrow bundle is separate from the full production build/budget gate.
  const result = await build({
    configFile: false,
    root: ROOT,
    base: BASE,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        // These URL-only test entries need their real exports as consumers.
        preserveEntrySignatures: "strict",
        input: Object.fromEntries(QUALITIES.map((quality) => [quality,
          path.join(ROOT, `src/render/parklandComposableAssets/${quality}.ts`)])),
      },
    },
  });
  assert.ok(!Array.isArray(result) && "output" in result);
  const entries = result.output.filter((output) => output.type === "chunk" && output.isEntry);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...QUALITIES].sort());
  let checked = 0;
  for (const entry of entries) {
    // Each actual source module contains only URL constants and erased types.
    // An absolute build base lets the emitted code run unchanged in this realm.
    const { default: urls } = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString("base64")}`);
    assert.deepEqual(Object.keys(urls.semantics).sort(), [...SEMANTICS].sort());
    const textures = [
      [urls.undercoat, `parkland-composable-v1/${entry.name}/undercoat.png`],
      ...SEMANTICS.map((semantic) => [urls.semantics[semantic],
        `parkland-composable-v1/${entry.name}/semantic-${semantic}.png`]),
      [urls.pairAtlas, `parkland-pair-atlas-v2/${entry.name}-pair-atlas.png`],
    ];
    for (const [value, relative] of textures) {
      const label = `${entry.name}: ${relative}`;
      const url = new URL(value);
      assert.equal(url.origin, new URL(BASE).origin, label);
      assert.ok(url.href.startsWith(BASE), label);
      assert.equal(url.search, "", label);
      assert.equal(url.hash, "", label);
      const filename = url.href.slice(BASE.length);
      const emitted = result.output.find((output) => output.type === "asset" && output.fileName === filename);
      assert.ok(emitted, `missing emitted texture: ${label}`);
      const original = await readFile(path.join(ROOT, "src/assets/terrain", relative));
      assert.deepEqual(Buffer.from(emitted.source), original, label);
      checked++;
    }
  }
  assert.equal(checked, 21);
});
