// Generate the deterministic CourseCraft-authored Parkland 4× contract fixture.
// This is an isolated fallback/certification source, not a provider or review
// result. The existing @2× source remains the runtime fallback until a future
// art review promotes a different source through the normal atlas pipeline.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.env.COURSECRAFT_TERRAIN_OUTPUT_DIR
    || path.join(ROOT, "art/parkland-4x-fallback"),
);
const result = spawnSync(process.execPath, [
  path.join(ROOT, "scripts/gen-terrain-materials.mjs"),
], {
  cwd: ROOT,
  env: {
    ...process.env,
    COURSECRAFT_TERRAIN_OUTPUT_DIR: output,
    COURSECRAFT_TERRAIN_WIDTH: "256",
    COURSECRAFT_TERRAIN_HEIGHT: "128",
    COURSECRAFT_TERRAIN_THEMES: "parkland",
  },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const files = readdirSync(output)
  .filter((name) => name.endsWith(".png"))
  .sort();
const manifest = {
  version: 1,
  id: "parkland-terrain-4x-generated-source",
  generatedBy: "scripts/gen-parkland-4x-fallback.mjs",
  hashAlgorithm: "sha256",
  generatedImagePolicy: "review-only-not-runtime",
  files: Object.fromEntries(files.map((name) => {
    const buffer = readFileSync(path.join(output, name));
    return [name, { bytes: buffer.length, sha256: hash(buffer) }];
  })),
};
writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote deterministic SHA-256 manifest for ${files.length} Parkland 4x source frames`);
