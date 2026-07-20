// Original CourseCraft terrain sources for M19-M21. These deterministic @2×
// rasters use hard value bands, sparse theme-specific texture, fixed NW
// lighting, and no borrowed/traced source pixels.
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/assets/terrain/materials");
mkdirSync(OUT, { recursive: true });
const W = 128;
const H = 64;
const THEMES = {
  parkland: {
    colors: { fairway: "#55a959", rough: "#3e823f", deep_rough: "#296733", sand: "#d9c58e", waste_area: "#a98757", water: "#347faf", wetland: "#4f806b", green: "#63b96a", tee: "#62a85b", path: "#9a907e" },
    special: { fairway: "#3f8746", rough: "#2d6a34", deep_rough: "#1e542a", sand: "#aa8956", waste_area: "#735737", water: "#6f9fa9", wetland: "#315949", green: "#4a9952", tee: "#e7dfc5", path: "#6f6658" },
    texture: "parkland",
  },
  links: {
    colors: { fairway: "#719d52", rough: "#668348", deep_rough: "#827c3f", sand: "#e3d6a4", waste_area: "#a58d5e", water: "#2b6f9e", wetland: "#4e7a69", green: "#70a95b", tee: "#769252", path: "#918676" },
    special: { fairway: "#587e43", rough: "#536b3e", deep_rough: "#b09a4d", sand: "#b6a879", waste_area: "#756342", water: "#8fb3bf", wetland: "#36594e", green: "#538a4c", tee: "#ddd5b9", path: "#655d53" },
    texture: "links",
  },
  desert: {
    colors: { fairway: "#55a24c", rough: "#9b8052", deep_rough: "#79663d", sand: "#dcb97c", waste_area: "#b18a55", water: "#3a9ec2", wetland: "#5b8b68", green: "#62b455", tee: "#5d9a4d", path: "#a89778" },
    special: { fairway: "#3c873d", rough: "#755d3b", deep_rough: "#5f4d31", sand: "#b57d45", waste_area: "#805a35", water: "#8fc8c4", wetland: "#3b6748", green: "#438f43", tee: "#e2d1ad", path: "#735f4a" },
    texture: "desert",
  },
};
const TERRAIN_SALT = { rough: 0, deep_rough: 1, fairway: 2, sand: 3, water: 4, green: 5, tee: 6, path: 7, waste_area: 8, wetland: 9 };
const EDGES = ["n", "e", "s", "w"];
const CORNERS = ["ne", "se", "sw", "nw"];
const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const shade = (color, factor) => color.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))));

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
    const h = hash(x, y, variant * 97 + TERRAIN_SALT[terrain] * 13 + themeSalt);
    let factor = h % 43 === 0 ? 1.08 : h % 29 === 0 ? 0.92 : 1;
    if (terrain === "fairway" && ((x + y * 2 + variant * 11) % 26 < 3)) factor *= 1.045;
    if (terrain === "green" && ((x - y + variant * 7 + 256) % 32 < 2)) factor *= 1.035;
    if (terrain === "deep_rough" && h % 67 < (config.texture === "links" ? 8 : 4)) factor *= 1.12;
    if ((terrain === "sand" || terrain === "waste_area") && h % 71 < 3) factor *= 0.82;
    if (terrain === "path" && h % 61 < 4) factor *= h % 2 ? 0.8 : 1.12;
    if (config.texture === "desert" && (terrain === "rough" || terrain === "waste_area") && h % 53 < 3) factor *= 1.13;
    if (config.texture === "links" && terrain === "deep_rough" && (x + y * 3 + variant) % 19 < 2) factor *= 1.08;
    if (terrain === "water" || terrain === "wetland") {
      factor *= 0.985 + (variant % 3) * 0.008;
      if ((x * 3 + y + variant * 17) % 113 < 2) factor *= 1.1;
    }
    put(png, x, y, shade(base, factor));
  }
  save(png, `${theme}_${terrain}_base_${variant}`);
}

function edgeDistance(x, y, direction) {
  const dx = (x + 0.5 - 64) / 64;
  const dy = (y + 0.5 - 32) / 32;
  if (direction === "n") return 1 - (dx - dy);
  if (direction === "e") return 1 - (dx + dy);
  if (direction === "s") return 1 - (-dx + dy);
  return 1 - (-dx - dy);
}
function cornerPoint(direction) {
  if (direction === "ne") return [127, 32];
  if (direction === "se") return [64, 63];
  if (direction === "sw") return [0, 32];
  return [64, 0];
}
function transition(theme, config, terrain, kind, direction, themeSalt) {
  const png = new PNG({ width: W, height: H });
  const accent = rgb(config.special[terrain]);
  const base = rgb(config.colors[terrain]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    let visible = false;
    let factor = 1;
    if (kind === "edge") {
      const distance = edgeDistance(x, y, direction);
      const wave = ((hash(x, y, TERRAIN_SALT[terrain] * 19 + themeSalt) % 5) - 2) / 250;
      visible = distance >= 0 && distance < 0.13 + wave;
      factor = distance < 0.035 ? 0.75 : 1;
    } else {
      const [cx, cy] = cornerPoint(direction);
      const nx = (x - cx) / 24;
      const ny = (y - cy) / 12;
      const radius = nx * nx + ny * ny;
      visible = kind === "outer" ? radius < 1 : radius > 0.35 && radius < 1.15;
      factor = kind === "inner" ? 0.86 : 1.04;
    }
    if (!visible) continue;
    const color = terrain === "water" || terrain === "wetland" || terrain === "tee" ? accent : shade(accent, factor);
    put(png, x, y, color, kind === "inner" ? 150 : terrain === "water" || terrain === "wetland" ? 95 : 205);
    if (terrain === "sand" && kind === "edge" && hash(x, y, 3 + themeSalt) % 13 === 0) put(png, x, y, shade(base, 0.68), 235);
  }
  save(png, `${theme}_${terrain}_${kind}_${direction}`);
}

let count = 0;
for (const [theme, config] of Object.entries(THEMES)) {
  const themeSalt = theme === "parkland" ? 0 : theme === "links" ? 1009 : 2027;
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
console.log(`wrote ${count} original @2x terrain sources to ${OUT}`);
