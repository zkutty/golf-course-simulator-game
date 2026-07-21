// Convert the retained M22 4×4 chroma-key source sheet into deterministic,
// alpha-cleaned theme/tier sprite sources consumed by build-atlas.mjs.
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src/assets/props/source/m22-structures-decor-magenta.png");
const OUT = path.join(ROOT, "src/assets/sprites");
const source = PNG.sync.read(readFileSync(SOURCE));
const key = [source.data[0], source.data[1], source.data[2]];
const cells = [
  "clubhouse", "pro_shop", "snack_bar", "cart_rental",
  "fence", "bench", "tee_sign", "lamp",
  "bin", "parked_cart", "flower_bed", "planter",
  "ornamental_feature", "bridge", "boardwalk", "bridge_approach",
];
const themes = {
  parkland: { warm: 1.03, cool: .98, sat: 1 },
  links: { warm: .91, cool: 1.08, sat: .76 },
  desert: { warm: 1.14, cool: .82, sat: .88 },
};

function cell(index) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const x0 = Math.round(col * source.width / 4);
  const x1 = Math.round((col + 1) * source.width / 4);
  const y0 = Math.round(row * source.height / 4);
  const y1 = Math.round((row + 1) * source.height / 4);
  const png = new PNG({ width: x1 - x0, height: y1 - y0 });
  PNG.bitblt(source, png, x0, y0, png.width, png.height, 0, 0);
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]; const g = png.data[i + 1]; const b = png.data[i + 2];
    const keyDistance = Math.hypot(r - key[0], g - key[1], b - key[2]);
    const alpha = Math.max(0, Math.min(255, Math.round((keyDistance - 20) / 75 * 255)));
    png.data[i + 3] = Math.min(png.data[i + 3], alpha);
    if (alpha < 255) {
      const strength = 1 - alpha / 255;
      // Despill the sampled key rather than assuming literal #ff00ff.
      png.data[i] = Math.max(0, Math.round(r - key[0] * .2 * strength));
      png.data[i + 1] = Math.max(0, Math.round(g - key[1] * .2 * strength));
      png.data[i + 2] = Math.max(0, Math.round(b - key[2] * .2 * strength));
    }
  }
  return trim(png, 8);
}

function trim(png, pad) {
  let minX = png.width; let minY = png.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.data[(y * png.width + x) * 4 + 3] < 8) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return png;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(png.width - 1, maxX + pad); maxY = Math.min(png.height - 1, maxY + pad);
  const out = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });
  PNG.bitblt(png, out, minX, minY, out.width, out.height, 0, 0);
  return out;
}

function grade(input, theme, tier = 1) {
  const cfg = themes[theme];
  const out = new PNG({ width: input.width, height: input.height });
  input.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;
    const r = out.data[i]; const g = out.data[i + 1]; const b = out.data[i + 2];
    const gray = (r + g + b) / 3;
    const tierLift = 1 + (tier - 1) * .035;
    out.data[i] = Math.min(255, Math.round((gray + (r - gray) * cfg.sat) * cfg.warm * tierLift));
    out.data[i + 1] = Math.min(255, Math.round((gray + (g - gray) * cfg.sat) * tierLift));
    out.data[i + 2] = Math.min(255, Math.round((gray + (b - gray) * cfg.sat) * cfg.cool * tierLift));
  }
  // Tiny authored-looking brass tier badge; stays clear of the ground anchor.
  if (tier > 1) {
    const y = Math.max(3, Math.round(out.height * .08));
    const start = Math.max(3, Math.round(out.width * .08));
    for (let badge = 0; badge < tier; badge++) for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const x = start + badge * 9 + dx;
      const p = (y + dy) * out.width * 4 + x * 4;
      out.data[p] = 232; out.data[p + 1] = 193; out.data[p + 2] = 90; out.data[p + 3] = 255;
    }
  }
  return out;
}

function resizeToFit(input, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / input.width, maxHeight / input.height);
  if (scale === 1) return input;
  const width = Math.max(1, Math.round(input.width * scale));
  const height = Math.max(1, Math.round(input.height * scale));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.min(input.width - 1, Math.floor(x / scale));
    const sourceY = Math.min(input.height - 1, Math.floor(y / scale));
    const from = (sourceY * input.width + sourceX) * 4;
    const to = (y * width + x) * 4;
    out.data[to] = input.data[from];
    out.data[to + 1] = input.data[from + 1];
    out.data[to + 2] = input.data[from + 2];
    out.data[to + 3] = input.data[from + 3];
  }
  return out;
}

for (let i = 0; i < cells.length; i++) {
  const name = cells[i];
  const base = cell(i);
  const isBuilding = i < 4;
  for (const theme of Object.keys(themes)) {
    const tiers = isBuilding && name !== "clubhouse" ? [1, 2, 3] : [1];
    for (const tier of tiers) {
      const suffix = isBuilding ? `_t${tier}` : "";
      const maxWidth = isBuilding ? (name === "clubhouse" ? 256 : 192) : 128;
      const maxHeight = isBuilding ? 256 : 192;
      const frame = resizeToFit(grade(base, theme, tier), maxWidth, maxHeight);
      writeFileSync(path.join(OUT, `${theme}_${name}${suffix}.png`), PNG.sync.write(frame));
    }
  }
}

console.log(`processed ${cells.length} M22 source cells into theme/tier sprite frames`);
