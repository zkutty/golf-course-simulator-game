// Deterministic path cross-section material authoring for ZK-1210.
//
// The compositor owns placement and masks; this script owns only repeat-safe
// material fields.  Every source texture is generated from a stable theme/role
// seed, so rebuilding changes neither pixels nor content-addressed URLs.
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "src/assets/terrain/fields");
const QUALITIES = {
  high: { size: 512, samples: 4 },
  medium: { size: 256, samples: 2 },
};
const ROLES = ["shoulder", "edge"];
const PALETTES = {
  parkland: { shoulder: 0x5b994b, edge: 0xb99b67 },
  links: { shoulder: 0x7f9450, edge: 0xba9f6d },
  desert: { shoulder: 0x82904f, edge: 0xc09360 },
};

const registeredBiomes = loadBiomeKeys();
if (JSON.stringify(Object.keys(PALETTES).sort()) !== JSON.stringify([...registeredBiomes].sort())) {
  throw new Error("path material palettes must cover every registered biome");
}

function hash32(value) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function seedFor(theme, role) {
  let seed = 0x1210a55e;
  for (const character of `${theme}:${role}:v1`) seed = hash32(seed ^ character.charCodeAt(0));
  return seed;
}

function randomCell(x, y, seed) {
  return hash32(seed ^ Math.imul(x + 19, 0x9e3779b1) ^ Math.imul(y + 43, 0x85ebca6b)) / 0xffffffff;
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function periodicNoise(x, y, frequency, seed) {
  const fx = x * frequency;
  const fy = y * frequency;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const wrap = (value) => ((value % frequency) + frequency) % frequency;
  const sample = (ix, iy) => randomCell(wrap(ix), wrap(iy), seed);
  const a = sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx;
  const b = sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

function rgb(hex) {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function sample(theme, role, x, y, seed) {
  const base = rgb(PALETTES[theme][role]);
  const broad = periodicNoise(x, y, 5, seed) - 0.5;
  const grain = periodicNoise(x, y, role === "edge" ? 36 : 24, seed ^ 0x63d83595) - 0.5;
  let factor = 1 + broad * 0.13 + grain * (role === "edge" ? 0.1 : 0.06);
  let tint = null;
  let mix = 0;

  if (role === "shoulder") {
    // Fine alternating cut passes keep the shoulder distinctly turf-like,
    // while the broken gate prevents a stripe-grid reading at map scale.
    const cut = Math.sin((x * 10 + periodicNoise(x, y, 3, seed ^ 0x190db19d) * 0.18) * Math.PI * 2);
    const gate = periodicNoise(x, y, 14, seed ^ 0x71b3c86f);
    factor += cut > 0.64 && gate > 0.34 ? 0.07 : cut < -0.74 ? -0.035 : 0;
    const blade = randomCell(Math.floor(x * 96), Math.floor(y * 96), seed ^ 0x2b7e1516);
    if (blade > 0.988) {
      tint = theme === "desert" ? 0xb4a95e : 0x9eb55c;
      mix = 0.22;
    }
  } else {
    // Coarse, warm mineral chips distinguish the narrow edge from both grass
    // outside it and the compacted gray path core inside it.
    const chip = randomCell(Math.floor(x * 128), Math.floor(y * 128), seed ^ 0x4f1bbcdc);
    if (chip > 0.936) {
      tint = chip > 0.979 ? 0x685c4b : 0xe1c88b;
      mix = chip > 0.979 ? 0.42 : 0.27;
      factor += chip > 0.979 ? -0.08 : 0.05;
    }
  }
  return base.map((channel, index) => clamp(
    channel * factor * (1 - mix) + (tint === null ? channel : rgb(tint)[index]) * mix,
  ));
}

function generate(theme, role, quality, config) {
  const png = new PNG({ width: config.size, height: config.size });
  const seed = seedFor(theme, role);
  const sampleCount = config.samples * config.samples;
  for (let py = 0; py < config.size; py++) for (let px = 0; px < config.size; px++) {
    const sum = [0, 0, 0];
    for (let sy = 0; sy < config.samples; sy++) for (let sx = 0; sx < config.samples; sx++) {
      const color = sample(
        theme,
        role,
        (px + (sx + 0.5) / config.samples) / config.size,
        (py + (sy + 0.5) / config.samples) / config.size,
        seed,
      );
      sum[0] += color[0]; sum[1] += color[1]; sum[2] += color[2];
    }
    const offset = (py * config.size + px) * 4;
    png.data[offset] = clamp(sum[0] / sampleCount);
    png.data[offset + 1] = clamp(sum[1] / sampleCount);
    png.data[offset + 2] = clamp(sum[2] / sampleCount);
    png.data[offset + 3] = 255;
  }
  const directory = path.join(OUTPUT, theme, quality);
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `path-${role}.png`);
  writeFileSync(destination, PNG.sync.write(png, {
    colorType: 2,
    inputColorType: 6,
    inputHasAlpha: true,
  }));
  return destination;
}

for (const theme of Object.keys(PALETTES)) {
  for (const [quality, config] of Object.entries(QUALITIES)) {
    for (const role of ROLES) console.log(path.relative(ROOT, generate(theme, role, quality, config)));
  }
}
