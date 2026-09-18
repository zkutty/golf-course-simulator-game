// Original CourseCraft terrain sources for M19-M21. These deterministic @2×
// rasters use hard value bands, sparse theme-specific texture, fixed NW
// lighting, and no borrowed/traced source pixels.
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";

const DEFAULT_OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/assets/terrain/materials");
const OUT = path.resolve(process.env.COURSECRAFT_TERRAIN_OUTPUT_DIR || DEFAULT_OUT);
mkdirSync(OUT, { recursive: true });
const W = Number(process.env.COURSECRAFT_TERRAIN_WIDTH || 128);
const H = Number(process.env.COURSECRAFT_TERRAIN_HEIGHT || 64);
const PROFILE = process.env.COURSECRAFT_TERRAIN_PROFILE || "legacy-2x";
const PRODUCTION_4X = PROFILE === "parkland-4x-production";
if (!Number.isInteger(W) || !Number.isInteger(H) || W < 2 || H < 2 || W % 2 !== 0 || H % 2 !== 0) {
  throw new Error(`terrain dimensions must be positive even integers, got ${W}x${H}`);
}
if (PRODUCTION_4X && (W !== 256 || H !== 128)) {
  throw new Error(`parkland-4x-production requires 256x128 frames, got ${W}x${H}`);
}
const THEMES = {
  parkland: {
    colors: { fairway: "#55a959", rough: "#3e823f", deep_rough: "#34743a", sand: "#d9c58e", waste_area: "#a98757", water: "#347faf", wetland: "#4f806b", green: "#63b96a", tee: "#62a85b", path: "#9a907e" },
    special: { fairway: "#3f8746", rough: "#2d6a34", deep_rough: "#285f31", sand: "#aa8956", waste_area: "#735737", water: "#6f9fa9", wetland: "#315949", green: "#4a9952", tee: "#e7dfc5", path: "#6f6658" },
    texture: "parkland",
    salt: 0,
    deepRoughFleckThreshold: 6,
    dryTexture: false,
    fescueTexture: false,
  },
  links: {
    colors: { fairway: "#719d52", rough: "#668348", deep_rough: "#827c3f", sand: "#e3d6a4", waste_area: "#a58d5e", water: "#2b6f9e", wetland: "#4e7a69", green: "#70a95b", tee: "#769252", path: "#918676" },
    special: { fairway: "#587e43", rough: "#536b3e", deep_rough: "#b09a4d", sand: "#b6a879", waste_area: "#756342", water: "#8fb3bf", wetland: "#36594e", green: "#538a4c", tee: "#ddd5b9", path: "#655d53" },
    texture: "links",
    salt: 1009,
    deepRoughFleckThreshold: 10,
    dryTexture: false,
    fescueTexture: true,
  },
  desert: {
    colors: { fairway: "#55a24c", rough: "#9b8052", deep_rough: "#79663d", sand: "#dcb97c", waste_area: "#b18a55", water: "#3a9ec2", wetland: "#5b8b68", green: "#62b455", tee: "#5d9a4d", path: "#a89778" },
    special: { fairway: "#3c873d", rough: "#755d3b", deep_rough: "#5f4d31", sand: "#b57d45", waste_area: "#805a35", water: "#8fc8c4", wetland: "#3b6748", green: "#438f43", tee: "#e2d1ad", path: "#735f4a" },
    texture: "desert",
    salt: 2027,
    deepRoughFleckThreshold: 6,
    dryTexture: true,
    fescueTexture: false,
  },
};
const registeredBiomes = loadBiomeKeys();
if (JSON.stringify(Object.keys(THEMES).sort()) !== JSON.stringify([...registeredBiomes].sort())) {
  throw new Error("Terrain authoring profiles must cover every registered biome");
}
const TERRAIN_SALT = { rough: 0, deep_rough: 1, fairway: 2, sand: 3, water: 4, green: 5, tee: 6, path: 7, waste_area: 8, wetland: 9 };
const BOUNDARY_COLORS = {
  parkland: { sand: "#987747", water: "#60775d", wetland: "#385747", path: "#675f53" },
  links: { sand: "#a38c57", water: "#657565", wetland: "#465b4d", path: "#675f53" },
  desert: { sand: "#a8733e", water: "#677e67", wetland: "#405b43", path: "#705d49" },
};
const EDGES = ["n", "e", "s", "w"];
const CORNERS = ["ne", "se", "sw", "nw"];
const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const shade = (color, factor) => color.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))));
const quantize = (color, step = 8) => color.map((channel) => Math.max(0, Math.min(255, Math.round(channel / step) * step)));

function put(png, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const index = (y * W + x) * 4;
  png.data[index] = color[0]; png.data[index + 1] = color[1]; png.data[index + 2] = color[2]; png.data[index + 3] = alpha;
}
function inside(x, y) {
  return Math.abs((x + 0.5 - W / 2) / (W / 2)) + Math.abs((y + 0.5 - H / 2) / (H / 2)) <= 1;
}
function hash(x, y, seed) {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263) ^ Math.imul(seed + 7, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}
function save(png, name) { writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(png)); }

function baseTile(theme, config, terrain, variant, themeSalt) {
  const png = new PNG({ width: W, height: H });
  const base = rgb(config.colors[terrain]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    // The 4x production profile starts at a 3x3 cluster lattice. This both
    // enforces the documented minimum cluster size and avoids incompressible
    // single-pixel salt in the critical runtime atlas.
    const h = hash(
      PRODUCTION_4X ? Math.floor(x / 3) : x,
      PRODUCTION_4X ? Math.floor(y / 3) : y,
      variant * 97 + TERRAIN_SALT[terrain] * 13 + themeSalt,
    );
    let factor = h % 59 === 0 ? 1.045 : h % 47 === 0 ? 0.96 : 1;
    if (terrain === "fairway" && ((x + y * 2 + variant * 11) % 38 < 2)) factor *= 1.025;
    if (terrain === "green" && ((x - y + variant * 7 + 256) % 44 < 2)) factor *= 1.02;
    if (terrain === "rough" && h % 73 < 4) factor *= h % 2 ? 1.07 : 0.94;
    if (terrain === "deep_rough" && h % 61 < config.deepRoughFleckThreshold) factor *= h % 2 ? 1.13 : 0.9;
    if ((terrain === "sand" || terrain === "waste_area") && h % 67 < 4) factor *= h % 2 ? 0.79 : 1.09;
    if (terrain === "path" && h % 53 < 5) factor *= h % 2 ? 0.82 : 1.1;
    if (config.dryTexture && (terrain === "rough" || terrain === "waste_area") && h % 53 < 3) factor *= 1.13;
    if (config.fescueTexture && terrain === "deep_rough" && (x + y * 3 + variant) % 19 < 2) factor *= 1.08;
    if (terrain === "water" || terrain === "wetland") {
      factor *= 0.99 + (variant % 3) * 0.005;
      if ((x * 3 + y + variant * 17) % 58 < 3) factor *= 1.09;
    }
    let color = shade(base, factor);
    if (PRODUCTION_4X) {
      // Work in deliberate 2-6 px clusters instead of single-pixel noise. The
      // cluster lattice is offset per variant, so the six bases share a
      // palette hierarchy without exposing a repeated cell-sized stamp.
      const clusterX = Math.floor((x + variant * 5) / 3);
      const clusterY = Math.floor((y + variant * 3) / 2);
      const cluster = hash(clusterX, clusterY, 0x472 + TERRAIN_SALT[terrain] * 29 + variant * 131);
      const glint = rgb(config.special[terrain]);
      if ((terrain === "rough" || terrain === "deep_rough") && cluster % (terrain === "deep_rough" ? 17 : 31) === 0) {
        color = shade(glint, cluster % 2 ? 1.08 : 0.83);
      } else if ((terrain === "fairway" || terrain === "green" || terrain === "tee") && cluster % 79 < 3) {
        color = shade(base, cluster % 2 ? 1.075 : 0.92);
      } else if ((terrain === "sand" || terrain === "waste_area" || terrain === "path") && cluster % 43 < 4) {
        color = shade(glint, cluster % 3 === 0 ? 0.76 : 1.08);
      } else if (terrain === "wetland" && cluster % 23 < 3) {
        color = shade(glint, 0.82 + (cluster % 4) * 0.08);
      }

      // Broken horizontal highlights keep water level while introducing a
      // readable shallow/deep hierarchy. They intentionally do not alter the
      // collision/topology mask owned by the simulation.
      if (terrain === "water") {
        const ripple = hash(Math.floor(x / 7), Math.floor(y / 2), 0x5ea + variant * 17);
        if (ripple % 37 < 3 && x % 7 < 5) color = shade(glint, 1.14);
        if (ripple % 101 === 0 && x % 9 < 3) color = shade(base, 1.22);
      }
      // Sparse wear/rake clusters are long enough to read as authored marks,
      // not salt-and-pepper dithering.
      if (terrain === "sand" && ((x + y * 3 + variant * 19) % 53) < 2) color = shade(base, 0.91);
      if (terrain === "path" && ((x * 2 - y + variant * 13 + 1024) % 67) < 2) color = shade(base, 0.86);
    }
    put(png, x, y, PRODUCTION_4X ? quantize(color) : color);
  }
  save(png, `${theme}_${terrain}_base_${variant}`);
}

function edgeDistance(x, y, direction) {
  const dx = (x + 0.5 - W / 2) / (W / 2);
  const dy = (y + 0.5 - H / 2) / (H / 2);
  if (direction === "n") return 1 - (dx - dy);
  if (direction === "e") return 1 - (dx + dy);
  if (direction === "s") return 1 - (-dx + dy);
  return 1 - (-dx - dy);
}
function cornerPoint(direction) {
  if (direction === "ne") return [W - 1, H / 2];
  if (direction === "se") return [W / 2, H - 1];
  if (direction === "sw") return [0, H / 2];
  return [W / 2, 0];
}
function transition(theme, config, terrain, kind, direction, themeSalt) {
  const png = new PNG({ width: W, height: H });
  const accent = rgb(BOUNDARY_COLORS[theme][terrain] ?? config.special[terrain]);
  const base = rgb(config.colors[terrain]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    let visible = false;
    let factor = 1;
    if (kind === "edge") {
      const distance = edgeDistance(x, y, direction);
      const wave = ((hash(
        PRODUCTION_4X ? Math.floor(x / 3) : x,
        PRODUCTION_4X ? Math.floor(y / 3) : y,
        TERRAIN_SALT[terrain] * 19 + themeSalt,
      ) % 5) - 2) / 250;
      visible = distance >= 0 && distance < 0.13 + wave;
      factor = distance < 0.035 ? 0.7 : distance < 0.075 ? 0.9 : 1.04;
    } else {
      const [cx, cy] = cornerPoint(direction);
      const nx = (x - cx) / 24;
      const ny = (y - cy) / 12;
      const radius = nx * nx + ny * ny;
      visible = kind === "outer" ? radius < 1 : radius > 0.35 && radius < 1.15;
      factor = kind === "inner" ? 0.86 : 1.04;
    }
    if (!visible) continue;
    let color = shade(accent, factor);
    let alpha = kind === "inner" ? 150 : 215;
    if ((terrain === "water" || terrain === "wetland") && kind === "edge") {
      const distance = edgeDistance(x, y, direction);
      color = distance > 0.08 ? shade(rgb(config.special[terrain]), 1.12) : shade(accent, factor);
      alpha = distance > 0.08 ? 150 : 230;
    }
    if (PRODUCTION_4X && kind === "edge") {
      const distance = edgeDistance(x, y, direction);
      // Generic material vocabulary is deliberately layered here; the
      // pair-specific owner, widths, and depths still come from the world-space
      // contour renderer. These bands supply the high-density pixels sampled
      // by that contract and remain render-only.
      if (terrain === "water" || terrain === "wetland") {
        if (distance < 0.028) color = shade(rgb("#594b35"), 0.8); // dark bank
        else if (distance < 0.058) color = shade(rgb("#7f8461"), 0.82); // turf shelf/reeds
        else if (distance < 0.092) color = shade(accent, 1.18); // shallow band
        else color = shade(rgb(config.colors[terrain]), 0.79); // deep plane
        alpha = distance > 0.1 ? 176 : 236;
      } else if (terrain === "sand") {
        if (distance < 0.028) color = shade(rgb("#665039"), 0.86); // exposed soil
        else if (distance < 0.065) color = shade(accent, 0.9); // recessed lip
        else color = shade(base, 1.04); // floor
        alpha = distance < 0.014 ? 232 : 218;
      } else if (terrain === "path") {
        if (distance < 0.038) color = shade(rgb("#756b57"), 0.82); // shoulder
        else if (distance < 0.078) color = shade(accent, 1.08); // gravel edge
        else color = shade(base, 0.96); // compact core
      } else if (terrain === "fairway" || terrain === "green" || terrain === "tee") {
        if (distance < 0.036) color = shade(accent, 0.76); // fringe
        else if (distance < 0.08) color = shade(base, 0.9); // collar
        else color = shade(base, 1.035);
      } else if (terrain === "rough" || terrain === "deep_rough" || terrain === "waste_area") {
        const cluster = hash(Math.floor(x / 3), Math.floor(y / 2), 0x472 + TERRAIN_SALT[terrain]);
        if (cluster % 13 < (terrain === "deep_rough" ? 4 : 2)) color = shade(accent, cluster % 2 ? 1.1 : 0.76);
        alpha = distance > 0.095 ? 170 : 222;
      }
    }
    put(png, x, y, PRODUCTION_4X ? quantize(color) : color, alpha);
    if (terrain === "sand" && kind === "edge" && hash(x, y, 3 + themeSalt) % (PRODUCTION_4X ? 23 : 13) === 0) {
      // A 2x2 overhang/soil cluster survives the medium and overview mips.
      const fleck = shade(base, 0.68);
      put(png, x, y, fleck, 235);
      if (PRODUCTION_4X) {
        put(png, x + 1, y, fleck, 220);
        put(png, x, y + 1, fleck, 210);
      }
    }
  }
  save(png, `${theme}_${terrain}_${kind}_${direction}`);
}

const requestedThemes = process.env.COURSECRAFT_TERRAIN_THEMES
  ? new Set(process.env.COURSECRAFT_TERRAIN_THEMES.split(",").map((theme) => theme.trim()).filter(Boolean))
  : null;
let count = 0;
for (const [theme, config] of Object.entries(THEMES)) {
  if (requestedThemes && !requestedThemes.has(theme)) continue;
  const themeSalt = config.salt;
  for (const terrain of Object.keys(config.colors)) {
    for (let variant = 0; variant < 6; variant++) baseTile(theme, config, terrain, variant, themeSalt);
    for (const direction of EDGES) transition(theme, config, terrain, "edge", direction, themeSalt);
    for (const direction of CORNERS) {
      transition(theme, config, terrain, "outer", direction, themeSalt);
      transition(theme, config, terrain, "inner", direction, themeSalt);
    }
    count += 18;
  }
}
console.log(`wrote ${count} ${W}x${H} ${PROFILE} terrain sources to ${OUT}`);
