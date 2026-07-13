// Generates the procedural placeholder sprite tier per ART_GUIDE.md.
// Deterministic pixel art: chunky silhouettes, NW light, 1px darkened
// outline, <=4 value steps. Replace any output with hand-made art of the
// same filename — nothing else changes.
//
// Usage: npm run gen:sprites
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/assets/sprites");
mkdirSync(OUT, { recursive: true });

const W = 64;
const H = 96;

function makeCanvas() {
  return new PNG({ width: W, height: H });
}
function put(png, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = a;
}
function getA(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return 0;
  return png.data[((png.width * y + x) << 2) + 3];
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const darken = ([r, g, b], f) => [Math.round(r * f), Math.round(g * f), Math.round(b * f)];

// Filled ellipse with NW-lit two-step shading + light dither.
function blob(png, cx, cy, rx, ry, base, seedOffset = 0) {
  const lit = darken(base, 1.16);
  const shad = darken(base, 0.8);
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      // NW highlight / SE shadow bands
      const l = nx * 0.7 + ny * 0.7; // -1.4 (NW) .. 1.4 (SE)
      let c = base;
      if (l < -0.45) c = lit;
      else if (l > 0.55) c = shad;
      // deterministic dither speckle on band edges
      if (((x * 7 + y * 13 + seedOffset) % 11 === 0) && Math.abs(l) < 0.7) c = darken(c, 0.93);
      put(png, x, y, c);
    }
  }
}

// 1px outline around all opaque pixels (darkened sample of the base color).
function outline(png, base) {
  const o = darken(base, 0.55);
  const marks = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (getA(png, x, y) > 0) continue;
      if (getA(png, x + 1, y) || getA(png, x - 1, y) || getA(png, x, y + 1) || getA(png, x, y - 1)) {
        marks.push([x, y]);
      }
    }
  }
  marks.forEach(([x, y]) => put(png, x, y, o));
}

function save(png, name) {
  writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(png));
  console.log(`wrote ${name}.png`);
}

// --- Trees (two species variants) --------------------------------------
function tree(name, canopy, tall) {
  const png = makeCanvas();
  const trunk = hex("#5d4330");
  const trunkShad = darken(trunk, 0.75);
  // trunk: 6px wide column from ground (y=94) up
  const topY = tall ? 38 : 46;
  for (let y = topY; y <= 94; y++) {
    for (let x = 29; x <= 34; x++) {
      put(png, x, y, x >= 33 ? trunkShad : trunk);
    }
  }
  // canopy: three stacked lobes
  const c = hex(canopy);
  if (tall) {
    blob(png, 32, 30, 17, 14, c, 1);
    blob(png, 22, 42, 12, 10, darken(c, 0.94), 2);
    blob(png, 43, 44, 12, 10, darken(c, 0.9), 3);
  } else {
    blob(png, 32, 40, 20, 16, c, 1);
    blob(png, 20, 50, 11, 9, darken(c, 0.93), 2);
    blob(png, 45, 51, 11, 9, darken(c, 0.9), 3);
  }
  outline(png, c);
  save(png, name);
}

// --- Bush ---------------------------------------------------------------
function bush(name, canopy) {
  const png = makeCanvas();
  const c = hex(canopy);
  blob(png, 26, 82, 13, 10, c, 4);
  blob(png, 40, 84, 12, 9, darken(c, 0.93), 5);
  blob(png, 33, 76, 11, 8, darken(c, 1.02), 6);
  outline(png, c);
  save(png, name);
}

// --- Rock ---------------------------------------------------------------
function rock(name) {
  const png = makeCanvas();
  const c = hex("#8d8d84");
  blob(png, 30, 85, 15, 9, c, 7);
  blob(png, 42, 88, 9, 6, darken(c, 0.88), 8);
  blob(png, 25, 80, 8, 5, darken(c, 1.12), 9);
  outline(png, c);
  save(png, name);
}

// --- Terrain diamond variants (ZKU-148) ---------------------------------
// Grayscale dithered 64x32 diamonds, tinted at runtime by terrain color ×
// slope shade — one variant set serves every terrain. Per-terrain override
// frames (e.g. "diamond_sand_0") can be added later without code changes.
function diamondVariant(name, seed) {
  const png = new PNG({ width: 64, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x + 0.5 - 32) / 32;
      const dy = (y + 0.5 - 16) / 16;
      if (Math.abs(dx) + Math.abs(dy) > 1) continue;
      // deterministic speckle noise (hand-dithered feel, <=4 value steps)
      const h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
      const n = ((h ^ (h >> 13)) % 100) / 100;
      let v = 232;
      if (n > 0.82) v = 218;
      else if (n > 0.62) v = 225;
      else if (n < 0.06) v = 244;
      // faint edge darkening keeps the tile grid readable
      if (Math.abs(dx) + Math.abs(dy) > 0.94) v -= 14;
      put(png, x, y, [v, v, v]);
    }
  }
  writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(png));
  console.log(`wrote ${name}.png`);
}

// --- Terrain edge-transition strips (ZKU-148) ----------------------------
// White scalloped bands along one diamond edge, alpha-faded inward; tinted
// at runtime with the SPILLING (higher-priority) terrain's color and drawn
// on the lower-priority neighbor. Frames are named by SCREEN edge:
// ur (upper-right), lr (lower-right), ll (lower-left), ul (upper-left).
function edgeStrip(name, edge) {
  const png = new PNG({ width: 64, height: 32 });
  const DEPTH = 7; // band depth in "diamond units" of 1/16
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x + 0.5 - 32) / 32; // -1..1
      const dy = (y + 0.5 - 16) / 16; // -1..1
      if (Math.abs(dx) + Math.abs(dy) > 1) continue;
      // Distance from the chosen edge across the diamond (edges of
      // |dx|+|dy|<=1 satisfy ±dx ± dy = 1).
      let d;
      if (edge === "ur") d = 1 - (dx - dy); // top-right edge: dx>=0, dy<=0
      else if (edge === "lr") d = 1 - (dx + dy); // lower-right: dx>=0, dy>=0
      else if (edge === "ll") d = 1 - (-dx + dy); // lower-left
      else d = 1 - (-dx + -dy); // upper-left
      // scalloped inner boundary: wavy depth along the edge direction
      const along = edge === "ur" || edge === "ll" ? dx + dy : dx - dy; // -1..1 along the edge
      const wave = Math.sin(along * Math.PI * 3) * 0.09 + Math.sin(along * Math.PI * 7 + 1.7) * 0.05;
      const depth = (DEPTH / 16) * (1 + wave);
      if (d < 0 || d > depth) continue;
      const t = 1 - d / depth; // 1 at the edge, 0 at the inner boundary
      const a = t > 0.55 ? 255 : t > 0.25 ? 170 : 90; // stepped alpha, no smooth gradient
      put(png, x, y, [255, 255, 255], a);
    }
  }
  writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(png));
  console.log(`wrote ${name}.png`);
}

tree("tree", "#3f8a3f", true);
tree("tree2", "#5aa348", false);
bush("bush", "#4f9440");
rock("rock");
diamondVariant("diamond0", 1);
diamondVariant("diamond1", 2);
diamondVariant("diamond2", 3);
edgeStrip("edge_ur", "ur");
edgeStrip("edge_lr", "lr");
edgeStrip("edge_ll", "ll");
edgeStrip("edge_ul", "ul");
console.log("done");
