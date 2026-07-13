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

tree("tree", "#3f8a3f", true);
tree("tree2", "#5aa348", false);
bush("bush", "#4f9440");
rock("rock");
console.log("done");
