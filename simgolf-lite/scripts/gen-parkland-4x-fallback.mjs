// Generate the deterministic CourseCraft-authored Parkland 4× production
// source, its complete SHA-256 manifest, and an inspectable contact sheet.
// No source-game pixels or external-provider assets are used. The independent
// 2× source under src/assets/terrain/materials remains the explicit rollback.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.env.COURSECRAFT_TERRAIN_OUTPUT_DIR
    || path.join(ROOT, "src/assets/terrain/parkland-4x"),
);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
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
    COURSECRAFT_TERRAIN_PROFILE: "parkland-4x-production",
  },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const files = readdirSync(output)
  .filter((name) => name.endsWith(".png"))
  .sort();

const terrainOrder = [
  "fairway", "tee", "green", "rough", "deep_rough",
  "waste_area", "path", "wetland", "water", "sand",
];
const columnOrder = [
  ...Array.from({ length: 6 }, (_, index) => `base_${index}`),
  ...["n", "e", "s", "w"].map((direction) => `edge_${direction}`),
  ...["ne", "se", "sw", "nw"].flatMap((direction) => [`outer_${direction}`, `inner_${direction}`]),
];
const previewWidth = 128;
const previewHeight = 64;
const gap = 4;
const sheet = new PNG({
  width: columnOrder.length * previewWidth + (columnOrder.length - 1) * gap,
  height: terrainOrder.length * previewHeight + (terrainOrder.length - 1) * gap,
  fill: true,
});
sheet.data.fill(28);
for (let row = 0; row < terrainOrder.length; row++) {
  for (let column = 0; column < columnOrder.length; column++) {
    const name = `parkland_${terrainOrder[row]}_${columnOrder[column]}.png`;
    const source = PNG.sync.read(readFileSync(path.join(output, name)));
    const targetX = column * (previewWidth + gap);
    const targetY = row * (previewHeight + gap);
    for (let y = 0; y < previewHeight; y++) for (let x = 0; x < previewWidth; x++) {
      // Exact 2× box mip with premultiplied-alpha colour averaging.
      let alpha = 0; let red = 0; let green = 0; let blue = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const offset = (((y * 2 + sy) * source.width) + x * 2 + sx) * 4;
        const a = source.data[offset + 3];
        alpha += a;
        red += source.data[offset] * a;
        green += source.data[offset + 1] * a;
        blue += source.data[offset + 2] * a;
      }
      const destination = (((targetY + y) * sheet.width) + targetX + x) * 4;
      const averageAlpha = Math.round(alpha / 4);
      sheet.data[destination] = alpha ? Math.round(red / alpha) : 0;
      sheet.data[destination + 1] = alpha ? Math.round(green / alpha) : 0;
      sheet.data[destination + 2] = alpha ? Math.round(blue / alpha) : 0;
      sheet.data[destination + 3] = averageAlpha;
    }
  }
}
const evidenceDirectory = path.join(output, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const contactSheet = PNG.sync.write(sheet);
writeFileSync(path.join(evidenceDirectory, "contact-sheet.png"), contactSheet);

const manifest = {
  version: 2,
  id: "parkland-terrain-4x-production-source",
  generatedBy: "scripts/gen-parkland-4x-fallback.mjs",
  algorithm: "scripts/gen-terrain-materials.mjs#parkland-4x-production",
  hashAlgorithm: "sha256",
  generatedImagePolicy: "coursecraft-authored-production-runtime",
  provenance: {
    author: "CourseCraft",
    externalProvider: "none",
    referencePixelsCopied: false,
  },
  review: {
    status: "production-contract-adopted",
    contactSheet: "evidence/contact-sheet.png",
    contactSheetBytes: contactSheet.length,
    contactSheetSha256: hash(contactSheet),
    rows: terrainOrder,
    columns: columnOrder,
    previewFrame: { width: previewWidth, height: previewHeight, downsample: "2x-premultiplied-box" },
  },
  files: Object.fromEntries(files.map((name) => {
    const buffer = readFileSync(path.join(output, name));
    return [name, { bytes: buffer.length, sha256: hash(buffer) }];
  })),
};
writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote deterministic SHA-256 manifest and contact sheet for ${files.length} Parkland 4x production frames`);
