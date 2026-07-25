// Original CourseCraft biome ground-detail sprites. These deterministic
// @2x sources provide a production-safe baseline while PixelLab candidates
// remain isolated behind human review.
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/assets/terrain/details");
const SIZE = 64;
mkdirSync(OUT, { recursive: true });

const BASE_COLORS = {
  flowerGold: [232, 193, 76],
  flowerWhite: [230, 230, 207],
  leafDark: [91, 59, 34],
  leafLight: [142, 91, 43],
  reedDark: [78, 88, 40],
  reedLight: [132, 132, 57],
  stoneDark: [87, 88, 79],
  stone: [137, 139, 127],
  stoneLight: [177, 178, 162],
  sandDark: [151, 125, 76],
  sand: [207, 185, 126],
};
const PALETTES = {
  parkland: {
    ...BASE_COLORS,
    darkGrass: [31, 82, 42],
    grass: [52, 111, 54],
    grassLight: [91, 143, 67],
    straw: [144, 132, 67],
  },
  links: {
    ...BASE_COLORS,
    darkGrass: [71, 89, 48],
    grass: [101, 119, 59],
    grassLight: [153, 145, 73],
    straw: [180, 157, 75],
  },
  desert: {
    ...BASE_COLORS,
    darkGrass: [91, 76, 42],
    grass: [128, 104, 52],
    grassLight: [170, 137, 72],
    straw: [183, 145, 76],
  },
};
let COLORS = PALETTES.parkland;

function put(png, x, y, color, alpha = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const index = (y * SIZE + x) * 4;
  png.data[index] = color[0];
  png.data[index + 1] = color[1];
  png.data[index + 2] = color[2];
  png.data[index + 3] = alpha;
}

function line(png, x0, y0, x1, y1, color, width = 1) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let oy = -width; oy <= width; oy++) for (let ox = -width; ox <= width; ox++) {
      if (ox * ox + oy * oy <= width * width) put(png, x + ox, y + oy, color);
    }
  }
}

function ellipse(png, cx, cy, rx, ry, color, alpha = 255) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(png, x, y, color, alpha);
    }
  }
}

function grass(png, variant, tall = false) {
  const blades = tall ? 9 : 7;
  for (let i = 0; i < blades; i++) {
    const x = 18 + i * (tall ? 3.6 : 4.4) + ((i + variant) % 2);
    const height = (tall ? 21 : 12) + ((i * 7 + variant * 3) % (tall ? 8 : 5));
    const lean = ((i * 5 + variant * 3) % 7) - 3;
    line(png, x, 52, x + lean, 52 - height, i % 3 === 0 ? COLORS.grassLight : COLORS.darkGrass, 1);
  }
  ellipse(png, 31, 53, tall ? 18 : 16, 3, COLORS.darkGrass, 155);
}

function flowers(png, variant) {
  grass(png, variant, false);
  for (let i = 0; i < 5; i++) {
    const x = 20 + ((i * 9 + variant * 5) % 26);
    const y = 37 + ((i * 7 + variant * 3) % 11);
    line(png, x, 52, x, y + 2, COLORS.grass, 0);
    const petal = (i + variant) % 2 ? COLORS.flowerGold : COLORS.flowerWhite;
    put(png, x - 2, y, petal); put(png, x + 2, y, petal);
    put(png, x, y - 2, petal); put(png, x, y + 2, petal);
    put(png, x, y, COLORS.leafDark);
  }
}

function leafLitter(png, variant) {
  for (let i = 0; i < 8; i++) {
    const x = 15 + ((i * 13 + variant * 7) % 34);
    const y = 43 + ((i * 5 + variant * 3) % 12);
    ellipse(png, x, y, 3 + (i % 2), 1.5, i % 3 ? COLORS.leafLight : COLORS.leafDark);
    line(png, x - 2, y + 1, x + 2, y - 1, COLORS.leafDark, 0);
  }
}

function reeds(png, variant) {
  for (let i = 0; i < 8; i++) {
    const x = 16 + i * 4.5;
    const height = 22 + ((i * 5 + variant * 4) % 14);
    line(png, x, 54, x + ((i + variant) % 3) - 1, 54 - height, i % 2 ? COLORS.reedDark : COLORS.reedLight, 1);
    if ((i + variant) % 3 === 0) ellipse(png, x, 52 - height, 1.8, 4, COLORS.leafDark);
  }
  ellipse(png, 31, 54, 19, 3, COLORS.reedDark, 130);
}

function stones(png, variant, small = false) {
  const count = small ? 10 : 6;
  for (let i = 0; i < count; i++) {
    const x = 13 + ((i * 13 + variant * 9) % 39);
    const y = 43 + ((i * 7 + variant * 3) % 12);
    const rx = (small ? 2 : 4) + (i % 3);
    const ry = Math.max(1.5, rx * 0.5);
    ellipse(png, x, y + 1, rx, ry, COLORS.stoneDark, 180);
    ellipse(png, x, y, rx, ry, i % 2 ? COLORS.stone : COLORS.stoneLight);
    line(png, x - rx + 1, y - 1, x + 1, y - ry + 1, COLORS.stoneLight, 0);
  }
}

function bunkerTuft(png, variant) {
  for (let i = 0; i < 7; i++) {
    const x = 17 + i * 5;
    const height = 12 + ((i * 5 + variant * 3) % 8);
    line(png, x, 53, x + ((i + variant) % 5) - 2, 53 - height, i % 2 ? COLORS.straw : COLORS.darkGrass, 1);
  }
  ellipse(png, 32, 54, 18, 3, COLORS.sandDark, 105);
}

function fescue(png, variant) {
  for (let i = 0; i < 11; i++) {
    const x = 12 + i * 4.1;
    const height = 20 + ((i * 9 + variant * 5) % 19);
    const lean = ((i * 7 + variant * 4) % 11) - 5;
    line(png, x, 55, x + lean, 55 - height, i % 3 ? COLORS.straw : COLORS.grassLight, 1);
  }
  ellipse(png, 32, 55, 22, 3, COLORS.darkGrass, 140);
}

function scrub(png, variant) {
  const centerX = 31 + variant * 2;
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 1.25 + variant * 0.23;
    const length = 10 + ((i * 7 + variant * 3) % 9);
    line(
      png,
      centerX,
      53,
      centerX + Math.cos(angle) * length,
      53 - Math.abs(Math.sin(angle)) * length,
      i % 3 === 0 ? COLORS.grassLight : COLORS.straw,
      1,
    );
  }
  ellipse(png, centerX, 54, 14, 3, COLORS.sandDark, 120);
}

function render(theme, kind, variant) {
  COLORS = PALETTES[theme];
  const png = new PNG({ width: SIZE, height: SIZE });
  if (kind === "short_grass") grass(png, variant, false);
  else if (kind === "tall_grass") grass(png, variant, true);
  else if (kind === "fescue") fescue(png, variant);
  else if (kind === "flowers") flowers(png, variant);
  else if (kind === "leaf_litter") leafLitter(png, variant);
  else if (kind === "reeds") reeds(png, variant);
  else if (kind === "shore_stones") stones(png, variant, false);
  else if (kind === "pebbles") stones(png, variant, true);
  else if (kind === "bunker_tuft") bunkerTuft(png, variant);
  else scrub(png, variant);
  writeFileSync(path.join(OUT, `${theme}_${kind}_${variant}.png`), PNG.sync.write(png));
}

const kinds = [
  "short_grass",
  "tall_grass",
  "fescue",
  "flowers",
  "leaf_litter",
  "reeds",
  "shore_stones",
  "pebbles",
  "bunker_tuft",
  "scrub",
];
for (const theme of Object.keys(PALETTES)) {
  for (const kind of kinds) for (let variant = 0; variant < 2; variant++) render(theme, kind, variant);
}
console.log(`wrote ${Object.keys(PALETTES).length * kinds.length * 2} original @2x biome terrain-detail sources to ${OUT}`);
