// Packs sprite PNGs into checked-in atlases (Pixi spritesheet format), so
// builds and deploys need no image tooling. Simple shelf packing,
// deterministic order.
//
// - src/assets/terrain/materials/*.png -> public/atlases/terrain.png/json
// - src/assets/props/natural/*.png     -> public/atlases/natural-props.png/json
// - building sources                  -> public/atlases/buildings-decor.png/json
// - src/assets/sprites/golfers/*.png  -> public/atlases/golfers.png/json
//
// Grid sheets (ZKU-153): a file named `name.grid{C}x{R}.png` is packed as one
// image but emits C*R frames named `name_{row}_{col}`, each (w/C)x(h/R).
// Plain files emit a single frame named after the file.
//
// Usage: npm run build:atlas
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src/assets/sprites");
const BUILDING_SRC = process.env.COURSECRAFT_BUILDING_SOURCE_DIR
  ? path.resolve(process.env.COURSECRAFT_BUILDING_SOURCE_DIR)
  : SRC;
const NATURAL_SRC = path.join(ROOT, "src/assets/props/natural");
const TERRAIN_SRC = path.join(ROOT, "src/assets/terrain/materials");
const PARKLAND_4X_SRC = path.join(ROOT, "src/assets/terrain/parkland-4x");
const TERRAIN_DETAILS_SRC = path.join(ROOT, "src/assets/terrain/details");
const LANDSCAPE_FIELDS_SRC = path.join(ROOT, "src/assets/terrain/fields");
// Optional authoring convention. A season can supply only the small, typed
// families it changes; absent directories mean "use the same-biome base".
// src/assets/seasonal/<biome>/<quality>/<season>/
//   terrain-material-fields, terrain-details, natural-props, buildings,
//   decorations, construction, condition, weather
const SEASONAL_OVERLAYS_SRC = path.join(ROOT, "src/assets/seasonal");
const OUT_DIR = process.env.COURSECRAFT_ATLAS_OUT_DIR
  ? path.resolve(process.env.COURSECRAFT_ATLAS_OUT_DIR)
  : path.join(ROOT, "public/atlases");
if (OUT_DIR === path.join(ROOT, "public/atlases") && process.env.COURSECRAFT_BUILDING_SOURCE_DIR) {
  throw new Error("production atlas builds cannot override the approved src/assets source");
}
mkdirSync(OUT_DIR, { recursive: true });
const BIOME_OUT_DIR = path.join(OUT_DIR, "biomes");
const themes = loadBiomeKeys();
const themePattern = themes.map((theme) => theme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const PAD = 2; // gutter to avoid bleeding when scaled
const MAX_W = 1024;

const PARKLAND_TERRAIN_MODE = process.env.COURSECRAFT_PARKLAND_TERRAIN_MODE || "production-4x";
if (!new Set(["production-4x", "legacy-2x"]).has(PARKLAND_TERRAIN_MODE)) {
  throw new Error(`COURSECRAFT_PARKLAND_TERRAIN_MODE must be production-4x or legacy-2x, got ${PARKLAND_TERRAIN_MODE}`);
}

function shortHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

function fullHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function boxDownsample(source, divisor) {
  if (divisor === 1) return source;
  if (!Number.isInteger(divisor) || divisor < 1 || source.width % divisor || source.height % divisor) {
    throw new Error(`invalid deterministic mip divisor ${divisor} for ${source.width}x${source.height}`);
  }
  const target = new PNG({ width: source.width / divisor, height: source.height / divisor });
  const samples = divisor * divisor;
  for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
    let alpha = 0; let red = 0; let green = 0; let blue = 0;
    for (let sy = 0; sy < divisor; sy++) for (let sx = 0; sx < divisor; sx++) {
      const sourceOffset = ((((y * divisor) + sy) * source.width) + x * divisor + sx) * 4;
      const a = source.data[sourceOffset + 3];
      alpha += a;
      red += source.data[sourceOffset] * a;
      green += source.data[sourceOffset + 1] * a;
      blue += source.data[sourceOffset + 2] * a;
    }
    const targetOffset = (y * target.width + x) * 4;
    target.data[targetOffset] = alpha ? Math.round(red / alpha) : 0;
    target.data[targetOffset + 1] = alpha ? Math.round(green / alpha) : 0;
    target.data[targetOffset + 2] = alpha ? Math.round(blue / alpha) : 0;
    target.data[targetOffset + 3] = Math.round(alpha / samples);
  }
  return target;
}

function buildAtlas(srcDir, outName, include = () => true, scale = "1", options = {}) {
  if (!existsSync(srcDir)) {
    console.error(`no sprite directory ${srcDir} — run npm run gen:sprites first`);
    process.exit(1);
  }
  const files = readdirSync(srcDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".png") && include(f.name))
    .map((f) => f.name)
    .sort();
  if (files.length === 0) {
    console.error(`no sprites found in ${srcDir} — run npm run gen:sprites first`);
    process.exit(1);
  }

  const sprites = files.map((f) => {
    const sourcePng = PNG.sync.read(readFileSync(path.join(srcDir, f)));
    const png = boxDownsample(sourcePng, options.mipDivisor ?? 1);
    const gridMatch = /^(.*)\.grid(\d+)x(\d+)\.png$/.exec(f);
    if (gridMatch) {
      const cols = Number(gridMatch[2]);
      const rows = Number(gridMatch[3]);
      if (png.width % cols !== 0 || png.height % rows !== 0) {
        console.error(`${f}: ${png.width}x${png.height} not divisible by grid ${cols}x${rows}`);
        process.exit(1);
      }
      return { name: gridMatch[1], png, cols, rows };
    }
    return { name: f.replace(/\.png$/, ""), png, cols: 1, rows: 1 };
  });

  // Shelf packing (row by row) of whole sheets.
  const maxWidth = options.maxWidth ?? MAX_W;
  let x = PAD;
  let y = PAD;
  let shelfH = 0;
  let atlasW = 0;
  for (const s of sprites) {
    if (x + s.png.width + PAD > maxWidth) {
      x = PAD;
      y += shelfH + PAD;
      shelfH = 0;
    }
    s.x = x;
    s.y = y;
    x += s.png.width + PAD;
    shelfH = Math.max(shelfH, s.png.height);
    atlasW = Math.max(atlasW, x);
  }
  const atlasH = y + shelfH + PAD;

  const atlas = new PNG({ width: atlasW, height: atlasH });
  const frames = {};
  for (const s of sprites) {
    PNG.bitblt(s.png, atlas, 0, 0, s.png.width, s.png.height, s.x, s.y);
    const fw = s.png.width / s.cols;
    const fh = s.png.height / s.rows;
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const name = s.cols === 1 && s.rows === 1 ? s.name : `${s.name}_${r}_${c}`;
        frames[name] = {
          frame: { x: s.x + c * fw, y: s.y + r * fh, w: fw, h: fh },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
          sourceSize: { w: fw, h: fh },
        };
      }
    }
  }

  const pngBuffer = PNG.sync.write(atlas, options.pngWriteOptions);
  const imageName = options.hashed
    ? `${outName}.${shortHash(pngBuffer)}.png`
    : `${outName}.png`;
  const sheet = {
    frames,
    meta: {
      app: "simgolf-lite build-atlas",
      image: imageName,
      format: "RGBA8888",
      size: { w: atlasW, h: atlasH },
      scale,
    },
  };

  const outputDirectory = options.outDir ?? OUT_DIR;
  mkdirSync(outputDirectory, { recursive: true });
  const jsonBuffer = Buffer.from(`${JSON.stringify(sheet, null, 2)}\n`);
  const jsonName = options.hashed
    ? `${outName}.${shortHash(jsonBuffer)}.json`
    : `${outName}.json`;
  writeFileSync(path.join(outputDirectory, imageName), pngBuffer);
  writeFileSync(path.join(outputDirectory, jsonName), jsonBuffer);
  console.log(
    `packed ${sprites.length} sheet(s) / ${Object.keys(frames).length} frame(s) into ${atlasW}x${atlasH} ${outName} atlas`
  );
  return {
    json: jsonName,
    image: imageName,
    jsonBytes: jsonBuffer.length,
    imageBytes: pngBuffer.length,
    frames: Object.keys(frames).length,
    width: atlasW,
    height: atlasH,
    scale,
    mipDivisor: options.mipDivisor ?? 1,
  };
}

function hasPng(srcDir) {
  return existsSync(srcDir) && readdirSync(srcDir, { withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name.endsWith(".png"));
}

function buildOptionalAtlas(srcDir, outName, scale = "1") {
  return hasPng(srcDir)
    ? buildAtlas(srcDir, outName, () => true, scale, { hashed: true, outDir: BIOME_OUT_DIR })
    : null;
}

buildAtlas(TERRAIN_SRC, "terrain", () => true, "2");
buildAtlas(TERRAIN_DETAILS_SRC, "terrain-details", () => true, "2");
buildAtlas(NATURAL_SRC, "natural-props");
buildAtlas(BUILDING_SRC, "buildings-decor", (name) => new RegExp(`^(clubhouse|pro_shop|snack_bar|cart_rental|(?:${themePattern})_(?:clubhouse|pro_shop|snack_bar|cart_rental)_t[123]|(?:${themePattern})_(?:fence|bench|tee_sign|lamp|bin|parked_cart|flower_bed|planter|ornamental_feature|bridge|boardwalk|bridge_approach))\\.png$`).test(name));
buildAtlas(path.join(SRC, "golfers"), "golfers");

// M35 delivery contract: one immutable, content-hashed bundle per biome and
// quality tier. The stable manifest is the only discovery URL; the service
// worker runtime-caches selected bundles instead of precaching every biome.
if (OUT_DIR === path.join(ROOT, "public/atlases")) rmSync(BIOME_OUT_DIR, { recursive: true, force: true });
mkdirSync(BIOME_OUT_DIR, { recursive: true });
const qualities = ["high", "medium", "low"];
const seasons = ["spring", "summer", "autumn", "winter"];
const manifest = {
  version: 3,
  generatedBy: "scripts/build-atlas.mjs",
  assetContracts: {},
  core: {},
  biomes: {},
};
if (PARKLAND_TERRAIN_MODE === "production-4x") {
  const sourceManifestPath = path.join(PARKLAND_4X_SRC, "manifest.json");
  if (!existsSync(sourceManifestPath)) {
    throw new Error("Parkland 4x production source is absent; run npm run gen:terrain:parkland-4x or select COURSECRAFT_PARKLAND_TERRAIN_MODE=legacy-2x");
  }
  const sourceManifestBuffer = readFileSync(sourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBuffer.toString("utf8"));
  manifest.assetContracts.parklandTerrain = {
    id: "parkland-terrain-4x",
    mode: "production-4x",
    source: "src/assets/terrain/parkland-4x",
    sourceManifestSha256: fullHash(sourceManifestBuffer),
    frameSetSha256: fullHash(Buffer.from(JSON.stringify(sourceManifest.files ?? {}))),
    lods: {
      high: { name: "detail", sourceScale: 4, mipDivisor: 1 },
      medium: { name: "normal", sourceScale: 4, mipDivisor: 2 },
      low: { name: "overview", sourceScale: 4, mipDivisor: 4 },
    },
    rollback: {
      mode: "legacy-2x",
      source: "src/assets/terrain/materials",
      environment: "COURSECRAFT_PARKLAND_TERRAIN_MODE=legacy-2x",
    },
  };
} else {
  manifest.assetContracts.parklandTerrain = {
    id: "parkland-terrain-4x",
    mode: "legacy-2x",
    source: "src/assets/terrain/materials",
    rollbackActive: true,
  };
}
manifest.core.golfers = buildAtlas(
  path.join(SRC, "golfers"),
  "core-golfers",
  () => true,
  "1",
  { hashed: true, outDir: BIOME_OUT_DIR },
);

function copyFieldAsset(theme, quality, terrain) {
  const source = path.join(LANDSCAPE_FIELDS_SRC, theme, quality, `${terrain}.png`);
  if (!existsSync(source)) return null;
  const buffer = readFileSync(source);
  const name = `field-${theme}-${quality}-${terrain}.${shortHash(buffer)}.png`;
  writeFileSync(path.join(BIOME_OUT_DIR, name), buffer);
  const png = PNG.sync.read(buffer);
  return { image: name, bytes: buffer.length, width: png.width, height: png.height };
}

function copySeasonalMaterials(theme, quality, season) {
  const sourceDirectory = path.join(
    SEASONAL_OVERLAYS_SRC,
    theme,
    quality,
    season,
    "terrain-material-fields",
  );
  if (!hasPng(sourceDirectory)) return {};
  return Object.fromEntries(readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const terrain = name.replace(/\.png$/, "");
      const buffer = readFileSync(path.join(sourceDirectory, name));
      const outputName = `seasonal-material-${theme}-${quality}-${season}-${terrain}.${shortHash(buffer)}.png`;
      writeFileSync(path.join(BIOME_OUT_DIR, outputName), buffer);
      const png = PNG.sync.read(buffer);
      return [terrain, { image: outputName, bytes: buffer.length, width: png.width, height: png.height }];
    }));
}

function buildSeasonalOverlays(theme, quality) {
  // Low remains a deliberately base-only tier: no fields, prop variants, or
  // decal dressing can silently grow its transfer/GPU budget.
  if (quality === "low") return {};
  const frameFamilies = [
    ["terrain-details", "2"],
    ["natural-props", "1"],
    ["buildings", "1"],
    ["decorations", "1"],
    ["construction", "1"],
    ["condition", "1"],
    ["weather", "2"],
  ];
  return Object.fromEntries(seasons.map((season) => {
    const root = path.join(SEASONAL_OVERLAYS_SRC, theme, quality, season);
    const materials = copySeasonalMaterials(theme, quality, season);
    const frames = Object.fromEntries(frameFamilies.map(([family, scale]) => [
      family,
      buildOptionalAtlas(
        path.join(root, family),
        `seasonal-${family}-${theme}-${quality}-${season}`,
        scale,
      ),
    ]).filter(([, bundle]) => bundle));
    const overlay = { owner: theme, season, materials, frames };
    return Object.keys(materials).length > 0 || Object.keys(frames).length > 0
      ? [season, overlay]
      : null;
  }).filter(Boolean));
}

for (const theme of themes) {
  manifest.biomes[theme] = {};
  for (const quality of qualities) {
    const buildings = buildAtlas(
      BUILDING_SRC,
      `buildings-decor-${theme}-${quality}`,
      (name) => new RegExp(
        `^(clubhouse|pro_shop|snack_bar|cart_rental|${theme}_(?:clubhouse|pro_shop|snack_bar|cart_rental)_t[123]|${theme}_(?:fence|bench|tee_sign|lamp|bin|parked_cart|flower_bed|planter|ornamental_feature|bridge|boardwalk|bridge_approach))\\.png$`,
      ).test(name),
      "1",
      { hashed: true, outDir: BIOME_OUT_DIR },
    );
    const productionParkland = theme === "parkland" && PARKLAND_TERRAIN_MODE === "production-4x";
    const terrainSource = productionParkland ? PARKLAND_4X_SRC : TERRAIN_SRC;
    const mipDivisor = productionParkland ? ({ high: 1, medium: 2, low: 4 })[quality] : 1;
    const terrainScale = productionParkland ? ({ high: "4", medium: "2", low: "1" })[quality] : "2";
    const terrain = buildAtlas(
      terrainSource,
      `terrain-${theme}-${quality}`,
      (name) => name.startsWith(`${theme}_`),
      terrainScale,
      {
        hashed: true,
        outDir: BIOME_OUT_DIR,
        mipDivisor,
        maxWidth: productionParkland && quality === "high" ? 2048 : MAX_W,
        // Filtered DEFLATE is materially smaller for the 4x clustered source
        // than pngjs's RLE-biased default, without changing a decoded pixel.
        pngWriteOptions: productionParkland ? { deflateLevel: 9, deflateStrategy: 0 } : undefined,
      },
    );
    const details = quality === "low"
      ? null
      : buildAtlas(
        TERRAIN_DETAILS_SRC,
        `terrain-details-${theme}-${quality}`,
        (name) => name.startsWith(`${theme}_`) && (quality === "high" || name.endsWith("_0.png")),
        "2",
        { hashed: true, outDir: BIOME_OUT_DIR },
      );
    const props = quality === "low"
      ? null
      : buildAtlas(
        NATURAL_SRC,
        `natural-props-${theme}-${quality}`,
        (name) => name.startsWith(`${theme}_`),
        "1",
        { hashed: true, outDir: BIOME_OUT_DIR },
      );
    const fields = quality === "low"
      ? {}
      : Object.fromEntries(
        ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"]
          .map((terrainName) => [terrainName, copyFieldAsset(theme, quality, terrainName)])
          .filter(([, asset]) => asset),
      );
    manifest.biomes[theme][quality] = {
      base: { buildings, terrain, details, props, fields },
      seasonal: buildSeasonalOverlays(theme, quality),
    };
  }
}
writeFileSync(
  path.join(BIOME_OUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
