import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { loadBiomeKeys } from "./biome-registry.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = join(root, "public");
const distRoot = join(root, "dist");
const manifestRelative = "atlases/biomes/manifest.json";
const MiB = 1024 * 1024;
const MAX_ATLAS_BYTES = 8 * MiB;
const MAX_SELECTED_BIOME_BYTES = 6 * MiB;
const MAX_CUMULATIVE_RESIDENCY_BYTES = 12 * MiB;
const MAX_INITIAL_CRITICAL_BYTES = 8 * MiB;
const REQUIRED_THEMES = loadBiomeKeys();
const REQUIRED_QUALITIES = ["high", "medium", "low"];
const REQUIRED_SEASONS = ["spring", "summer", "autumn", "winter"];
const SEASONAL_FRAME_FAMILIES = [
  "terrain-details",
  "natural-props",
  "buildings",
  "decorations",
  "construction",
  "condition",
  "weather",
];
const REQUIRED_FIELDS = [
  "fairway",
  "rough",
  "deep_rough",
  "sand",
  "waste_area",
  "water",
  "wetland",
  "green",
  "tee",
  "path",
];

const errors = [];
const shortHash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 12);
const toMiB = (bytes) => Number((bytes / MiB).toFixed(3));

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function readAsset(rootDirectory, name) {
  const path = join(rootDirectory, "atlases/biomes", name);
  assert(existsSync(path), `${relative(root, path)} is missing`);
  return existsSync(path) ? readFileSync(path) : null;
}

function validateHashedName(name, buffer, label) {
  if (!buffer) return;
  const expected = shortHash(buffer);
  assert(
    name.includes(`.${expected}.`),
    `${label} name ${name} does not contain its ${expected} content hash`,
  );
}

function validatePng(buffer, asset, label) {
  if (!buffer) return;
  const png = PNG.sync.read(buffer);
  assert(png.width === asset.width, `${label} width ${png.width} != manifest ${asset.width}`);
  assert(png.height === asset.height, `${label} height ${png.height} != manifest ${asset.height}`);
  assert(png.width <= 4096 && png.height <= 4096, `${label} exceeds the 4096px texture bound`);
}

function validateAtlas(rootDirectory, asset, label) {
  const json = readAsset(rootDirectory, asset.json);
  const image = readAsset(rootDirectory, asset.image);
  validateHashedName(asset.json, json, `${label} JSON`);
  validateHashedName(asset.image, image, `${label} image`);
  if (!json || !image) return { bytes: 0, frames: [] };
  assert(json.length === asset.jsonBytes, `${label} JSON byte count changed`);
  assert(image.length === asset.imageBytes, `${label} image byte count changed`);
  const total = json.length + image.length;
  assert(total < MAX_ATLAS_BYTES, `${label} is ${toMiB(total)} MiB; atlas limit is 8 MiB`);
  const sheet = JSON.parse(json);
  assert(sheet.meta?.image === asset.image, `${label} metadata points at ${sheet.meta?.image}`);
  assert(sheet.meta?.size?.w === asset.width, `${label} metadata width changed`);
  assert(sheet.meta?.size?.h === asset.height, `${label} metadata height changed`);
  validatePng(image, asset, label);
  const frames = Object.keys(sheet.frames ?? {});
  assert(frames.length === asset.frames, `${label} frame count ${frames.length} != manifest ${asset.frames}`);
  return { bytes: total, frames };
}

function validateField(rootDirectory, asset, label) {
  const image = readAsset(rootDirectory, asset.image);
  validateHashedName(asset.image, image, label);
  if (!image) return 0;
  assert(image.length === asset.bytes, `${label} byte count changed`);
  validatePng(image, asset, label);
  return image.length;
}

function validateTree(rootDirectory) {
  const manifestPath = join(rootDirectory, manifestRelative);
  assert(existsSync(manifestPath), `${relative(root, manifestPath)} is missing`);
  if (!existsSync(manifestPath)) return null;
  const manifestBuffer = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBuffer);
  assert(
    manifest.version === 1 || manifest.version === 2 || manifest.version === 3,
    `Unsupported biome manifest version ${String(manifest.version)}`,
  );
  assert(
    JSON.stringify(Object.keys(manifest.biomes).sort()) === JSON.stringify([...REQUIRED_THEMES].sort()),
    `${relative(root, manifestPath)} must contain exactly the registered biomes`,
  );

  const core = validateAtlas(rootDirectory, manifest.core.golfers, "core golfers");
  const bundles = {};
  for (const theme of REQUIRED_THEMES) {
    bundles[theme] = {};
    const tiers = manifest.biomes[theme] ?? {};
    assert(
      JSON.stringify(Object.keys(tiers).sort()) === JSON.stringify([...REQUIRED_QUALITIES].sort()),
      `${theme} must contain high, medium, and low tiers`,
    );
    for (const quality of REQUIRED_QUALITIES) {
      const tier = tiers[quality];
      if (!tier) continue;
      // v1 is the deployed compatibility shape. v2 separates base/seasonal;
      // v3 adds explicit owner/season and typed frame-family isolation.
      const bundle = manifest.version === 1 ? tier : tier.base;
      const seasonal = manifest.version === 1 ? {} : (tier.seasonal ?? {});
      assert(Boolean(bundle), `${theme}/${quality} must provide a base bundle`);
      if (!bundle) continue;
      const frameOwners = new Map();
      let bytes = core.bytes;
      for (const [kind, atlas] of [
        ["buildings", bundle.buildings],
        ["terrain", bundle.terrain],
        ["details", bundle.details],
        ["props", bundle.props],
      ]) {
        if (!atlas) continue;
        const result = validateAtlas(rootDirectory, atlas, `${theme}/${quality} ${kind}`);
        bytes += result.bytes;
        for (const frame of result.frames) {
          const previous = frameOwners.get(frame);
          assert(!previous, `${theme}/${quality} frame ${frame} is duplicated in ${previous} and ${kind}`);
          frameOwners.set(frame, kind);
        }
      }
      const fields = bundle.fields ?? {};
      const fieldNames = Object.keys(fields).sort();
      const expectedFields = quality === "low" ? [] : [...REQUIRED_FIELDS].sort();
      assert(
        JSON.stringify(fieldNames) === JSON.stringify(expectedFields),
        `${theme}/${quality} material fields must be ${quality === "low" ? "omitted" : "complete"}`,
      );
      for (const [terrain, field] of Object.entries(fields)) {
        bytes += validateField(rootDirectory, field, `${theme}/${quality} ${terrain} field`);
      }
      assert(
        bytes < MAX_SELECTED_BIOME_BYTES,
        `${theme}/${quality} selected payload is ${toMiB(bytes)} MiB; limit is 6 MiB`,
      );
      const overlays = {};
      let cumulativeResidencyBytes = bytes;
      assert(
        Object.keys(seasonal).every((season) => REQUIRED_SEASONS.includes(season)),
        `${theme}/${quality} has an unknown seasonal overlay`,
      );
      if (quality === "low") {
        assert(
          Object.keys(seasonal).length === 0,
          `${theme}/low must omit expensive seasonal detail layers`,
        );
      }
      for (const [season, overlay] of Object.entries(seasonal)) {
        let overlayBytes = 0;
        let overlayFrames = 0;
        const frameBundles = manifest.version === 2
          ? {
            "natural-props": overlay.props,
            "terrain-details": overlay.decals,
          }
          : (overlay.frames ?? {});
        if (manifest.version === 3) {
          assert(overlay.owner === theme, `${theme}/${quality}/${season} must retain same-biome ownership`);
          assert(overlay.season === season, `${theme}/${quality}/${season} declares season ${String(overlay.season)}`);
          assert(
            Object.keys(frameBundles).every((family) => SEASONAL_FRAME_FAMILIES.includes(family)),
            `${theme}/${quality}/${season} has an unknown seasonal frame family`,
          );
        }
        for (const [family, atlas] of Object.entries(frameBundles)) {
          if (!atlas) continue;
          const result = validateAtlas(rootDirectory, atlas, `${theme}/${quality}/${season} ${family}`);
          overlayBytes += result.bytes;
          overlayFrames += result.frames.length;
        }
        for (const [terrain, field] of Object.entries(overlay.materials ?? {})) {
          assert(REQUIRED_FIELDS.includes(terrain), `${theme}/${quality}/${season} has unknown material ${terrain}`);
          overlayBytes += validateField(
            rootDirectory,
            field,
            `${theme}/${quality}/${season} ${terrain} material`,
          );
        }
        const selectedBytes = bytes + overlayBytes;
        cumulativeResidencyBytes += overlayBytes;
        assert(
          selectedBytes < MAX_SELECTED_BIOME_BYTES,
          `${theme}/${quality}/${season} selected payload is ${toMiB(selectedBytes)} MiB; limit is 6 MiB`,
        );
        overlays[season] = {
          bytes: overlayBytes,
          mib: toMiB(overlayBytes),
          selectedBytes,
          selectedMiB: toMiB(selectedBytes),
          frames: overlayFrames,
          materials: Object.keys(overlay.materials ?? {}).length,
          frameFamilies: Object.keys(frameBundles).filter((family) => frameBundles[family]),
        };
      }
      assert(
        cumulativeResidencyBytes < MAX_CUMULATIVE_RESIDENCY_BYTES,
        `${theme}/${quality} cumulative seasonal residency is ${toMiB(cumulativeResidencyBytes)} MiB; limit is 12 MiB`,
      );
      bundles[theme][quality] = {
        bytes,
        mib: toMiB(bytes),
        frames: frameOwners.size,
        fields: fieldNames.length,
        overlays,
        cumulativeResidencyBytes,
        cumulativeResidencyMiB: toMiB(cumulativeResidencyBytes),
      };
    }
  }
  return { manifest, manifestBytes: manifestBuffer.length, coreBytes: core.bytes, bundles };
}

function collectInitialAppFiles() {
  const indexPath = join(distRoot, "index.html");
  if (!existsSync(indexPath)) return [];
  const index = readFileSync(indexPath, "utf8");
  const files = new Set(["index.html", "manifest.webmanifest", "sw.js"]);
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (/^(?:https?:|data:|#)/.test(url)) continue;
    files.add(url.replace(/^\.?\//, ""));
  }
  return [...files].filter((name) => existsSync(join(distRoot, name)));
}

function transferBytes(path) {
  const buffer = readFileSync(path);
  if (![".html", ".js", ".css", ".json", ".svg", ".webmanifest"].includes(extname(path))) {
    return buffer.length;
  }
  return brotliCompressSync(buffer, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

const publicReport = validateTree(publicRoot);
const distReport = existsSync(distRoot) ? validateTree(distRoot) : null;
let initialCritical = null;
if (distReport) {
  const appFiles = collectInitialAppFiles();
  const atlasFiles = new Set([
    manifestRelative,
    distReport.manifest.core.golfers.json,
    distReport.manifest.core.golfers.image,
  ].map((name) => name === manifestRelative ? name : `atlases/biomes/${name}`));
  const defaultTier = distReport.manifest.biomes[REQUIRED_THEMES[0]].high;
  const defaultBundle = distReport.manifest.version === 1 ? defaultTier : defaultTier.base;
  for (const atlas of [
    defaultBundle.buildings,
    defaultBundle.terrain,
    defaultBundle.details,
    defaultBundle.props,
  ].filter(Boolean)) {
    atlasFiles.add(`atlases/biomes/${atlas.json}`);
    atlasFiles.add(`atlases/biomes/${atlas.image}`);
  }
  for (const field of Object.values(defaultBundle.fields)) {
    atlasFiles.add(`atlases/biomes/${field.image}`);
  }
  const files = [...new Set([...appFiles, ...atlasFiles])];
  const bytes = files.reduce((sum, name) => sum + transferBytes(join(distRoot, name)), 0);
  assert(
    bytes < MAX_INITIAL_CRITICAL_BYTES,
    `Default initial critical transfer is ${toMiB(bytes)} MiB; limit is 8 MiB`,
  );
  initialCritical = { bytes, mib: toMiB(bytes), files: files.sort() };
}

const report = {
  ok: errors.length === 0,
  limitsMiB: { atlas: 8, selectedBiome: 6, cumulativeResidency: 12, initialCritical: 8 },
  public: publicReport && {
    coreMiB: toMiB(publicReport.coreBytes),
    bundles: publicReport.bundles,
  },
  dist: distReport && {
    coreMiB: toMiB(distReport.coreBytes),
    bundles: distReport.bundles,
  },
  initialCritical,
  errors,
};

mkdirSync(join(root, "artifacts/m35"), { recursive: true });
writeFileSync(join(root, "artifacts/m35/asset-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length) process.exitCode = 1;
