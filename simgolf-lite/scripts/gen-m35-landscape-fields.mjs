// Deterministic M35 material-field authoring.
//
// Each runtime patch repeats over an 8×8-tile world period. High works at
// four samples per output pixel, Medium at two, then box-downsamples into a
// compact palette-rich PNG. This is the reproducible CourseCraft-authored
// fallback required before any reviewed generated-art candidate is adopted.
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "src/assets/terrain/fields");
const QUALITIES = {
  high: { size: 512, workScale: 4 },
  medium: { size: 256, workScale: 2 },
  low: { size: 128, workScale: 1 },
};
const TERRAINS = [
  "fairway", "rough", "deep_rough", "sand", "waste_area",
  "water", "wetland", "green", "tee", "path",
];
const PALETTES = {
  parkland: {
    fairway: 0x58a84f, rough: 0x3e833f, deep_rough: 0x2d6834,
    sand: 0xd8c58e, waste_area: 0x9f8153, water: 0x337fab,
    wetland: 0x4d7962, green: 0x65b961, tee: 0x76ad5e, path: 0x8f8b82,
  },
  links: {
    fairway: 0x70a655, rough: 0x647b42, deep_rough: 0x747538,
    sand: 0xdfd19e, waste_area: 0xa49161, water: 0x326b91,
    wetland: 0x557667, green: 0x72ae59, tee: 0x8c9f58, path: 0x918b78,
  },
  desert: {
    fairway: 0x5ba552, rough: 0x8b884f, deep_rough: 0x706c3b,
    sand: 0xd5ae72, waste_area: 0xb08759, water: 0x3a96b5,
    wetland: 0x648667, green: 0x64ae55, tee: 0x8f8457, path: 0xa28d72,
  },
};

function hash32(value) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function terrainSeed(theme, terrain) {
  let value = 0x35c0a57;
  for (const char of `${theme}:${terrain}`) value = hash32(value ^ char.charCodeAt(0));
  return value;
}

function randomCell(x, y, seed) {
  return hash32(seed ^ Math.imul(x + 17, 0x9e3779b1) ^ Math.imul(y + 31, 0x85ebca6b)) / 0xffffffff;
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

function shadeColor(base, factor, tint = null, tintAmount = 0) {
  const source = rgb(base);
  const target = tint == null ? source : rgb(tint);
  return source.map((channel, index) => clamp(
    channel * factor * (1 - tintAmount) + target[index] * tintAmount,
  ));
}

function materialSample(theme, terrain, x, y, seed) {
  const base = PALETTES[theme][terrain];
  const macro = periodicNoise(x, y, 8, seed) - 0.5;
  const broad = periodicNoise(x, y, 3, seed ^ 0x51ed270b) - 0.5;
  const grain = periodicNoise(x, y, 32, seed ^ 0x68bc21eb) - 0.5;
  let factor = 1 + macro * 0.14 + broad * 0.1 + grain * 0.045;
  let tint = null;
  let tintAmount = 0;

  if (terrain === "fairway" || terrain === "green" || terrain === "tee") {
    const bands = terrain === "green" ? 10 : terrain === "tee" ? 6 : 8;
    const stripe = Math.floor(x * bands) % 2 === 0 ? 0.045 : -0.035;
    factor += stripe;
    const wear = periodicNoise(x, y, 16, seed ^ 0x27d4eb2f);
    if (wear > 0.76) {
      tint = 0xb8a56d;
      tintAmount = (wear - 0.76) * 0.18;
    }
  } else if (terrain === "water" || terrain === "wetland") {
    // Water must read as a level plane, not as a topographic height field.
    // Keep broad variation extremely quiet and use broken, mostly horizontal
    // ripple highlights instead of the old crossing sine grid.
    factor = 0.99 + macro * 0.035 + grain * 0.018;
    const ripple = Math.sin((
      y * 15
      + Math.sin(x * Math.PI * 2) * 0.12
      + Math.sin(x * Math.PI * 4) * 0.035
    ) * Math.PI * 2);
    const rippleGate = periodicNoise(x, y, 16, seed ^ 0x7f4a7c15);
    if (ripple > 0.88 && rippleGate > 0.48) {
      factor += (ripple - 0.88) * (terrain === "water" ? 0.52 : 0.32);
    }
    const glint = randomCell(Math.floor(x * 96), Math.floor(y * 96), seed ^ 0x165667b1);
    if (terrain === "water" && glint > 0.992) factor += 0.1;
    if (terrain === "wetland") {
      const reeds = periodicNoise(x, y, 24, seed ^ 0xa24baed5);
      if (reeds > 0.72) {
        tint = 0x899047;
        tintAmount = Math.min(0.32, (reeds - 0.72) * 1.1);
      }
    }
  } else if (terrain === "sand") {
    const rake = Math.sin((x * 20 + y * 6) * Math.PI * 2);
    factor += rake > 0.83 ? 0.08 : 0;
    const pebble = randomCell(Math.floor(x * 96), Math.floor(y * 96), seed);
    if (pebble > 0.94) {
      tint = 0x806f55;
      tintAmount = 0.35;
    }
  } else if (terrain === "path" || terrain === "waste_area") {
    const gravel = randomCell(Math.floor(x * 128), Math.floor(y * 128), seed);
    if (gravel > 0.89) factor += gravel > 0.96 ? 0.2 : -0.14;
  } else {
    const blade = randomCell(Math.floor(x * 96), Math.floor(y * 96), seed);
    const threshold = terrain === "deep_rough" ? 0.79 : 0.9;
    if (blade > threshold) {
      tint = theme === "links" ? 0xc0a650 : 0x9fac55;
      tintAmount = terrain === "deep_rough" ? 0.28 : 0.15;
    }
  }
  return shadeColor(base, factor, tint, tintAmount);
}

function generateField(theme, terrain, quality, config) {
  const png = new PNG({ width: config.size, height: config.size });
  const seed = terrainSeed(theme, terrain);
  const sampleCount = config.workScale * config.workScale;
  for (let py = 0; py < config.size; py++) {
    for (let px = 0; px < config.size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < config.workScale; sy++) {
        for (let sx = 0; sx < config.workScale; sx++) {
          const x = (px + (sx + 0.5) / config.workScale) / config.size;
          const y = (py + (sy + 0.5) / config.workScale) / config.size;
          const color = materialSample(theme, terrain, x, y, seed);
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
        }
      }
      const offset = (py * config.size + px) * 4;
      png.data[offset] = clamp(sum[0] / sampleCount);
      png.data[offset + 1] = clamp(sum[1] / sampleCount);
      png.data[offset + 2] = clamp(sum[2] / sampleCount);
      png.data[offset + 3] = 255;
    }
  }
  const directory = path.join(OUTPUT, theme, quality);
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${terrain}.png`);
  writeFileSync(destination, PNG.sync.write(png, {
    colorType: 2,
    inputColorType: 6,
    inputHasAlpha: true,
  }));
  return destination;
}

for (const theme of Object.keys(PALETTES)) {
  for (const [quality, config] of Object.entries(QUALITIES)) {
    for (const terrain of TERRAINS) {
      const destination = generateField(theme, terrain, quality, config);
      console.log(path.relative(ROOT, destination));
    }
  }
}
