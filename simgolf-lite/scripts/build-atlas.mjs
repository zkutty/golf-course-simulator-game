// Packs src/assets/sprites/*.png into public/atlases/props.png + props.json
// (Pixi spritesheet format). Simple shelf packing, deterministic order.
// Outputs are checked in so builds and deploys need no image tooling.
//
// Usage: npm run build:atlas
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src/assets/sprites");
const OUT_DIR = path.join(ROOT, "public/atlases");
mkdirSync(OUT_DIR, { recursive: true });

const PAD = 2; // gutter to avoid bleeding when scaled
const MAX_W = 1024;

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".png"))
  .sort();
if (files.length === 0) {
  console.error("no sprites found in src/assets/sprites — run npm run gen:sprites first");
  process.exit(1);
}

const sprites = files.map((f) => ({
  name: f.replace(/\.png$/, ""),
  png: PNG.sync.read(readFileSync(path.join(SRC, f))),
}));

// Shelf packing (row by row).
let x = PAD;
let y = PAD;
let shelfH = 0;
let atlasW = 0;
for (const s of sprites) {
  if (x + s.png.width + PAD > MAX_W) {
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
  frames[s.name] = {
    frame: { x: s.x, y: s.y, w: s.png.width, h: s.png.height },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: s.png.width, h: s.png.height },
    sourceSize: { w: s.png.width, h: s.png.height },
  };
}

const sheet = {
  frames,
  meta: {
    app: "simgolf-lite build-atlas",
    image: "props.png",
    format: "RGBA8888",
    size: { w: atlasW, h: atlasH },
    scale: "1",
  },
};

writeFileSync(path.join(OUT_DIR, "props.png"), PNG.sync.write(atlas));
writeFileSync(path.join(OUT_DIR, "props.json"), JSON.stringify(sheet, null, 2));
console.log(`packed ${sprites.length} sprites into ${atlasW}x${atlasH} props atlas`);
