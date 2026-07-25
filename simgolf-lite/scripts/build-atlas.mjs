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
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src/assets/sprites");
const BUILDING_SRC = process.env.COURSECRAFT_BUILDING_SOURCE_DIR
  ? path.resolve(process.env.COURSECRAFT_BUILDING_SOURCE_DIR)
  : SRC;
const NATURAL_SRC = path.join(ROOT, "src/assets/props/natural");
const TERRAIN_SRC = path.join(ROOT, "src/assets/terrain/materials");
const TERRAIN_DETAILS_SRC = path.join(ROOT, "src/assets/terrain/details");
const OUT_DIR = process.env.COURSECRAFT_ATLAS_OUT_DIR
  ? path.resolve(process.env.COURSECRAFT_ATLAS_OUT_DIR)
  : path.join(ROOT, "public/atlases");
mkdirSync(OUT_DIR, { recursive: true });

const PAD = 2; // gutter to avoid bleeding when scaled
const MAX_W = 1024;

function buildAtlas(srcDir, outName, include = () => true, scale = "1") {
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
    const png = PNG.sync.read(readFileSync(path.join(srcDir, f)));
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

  const sheet = {
    frames,
    meta: {
      app: "simgolf-lite build-atlas",
      image: `${outName}.png`,
      format: "RGBA8888",
      size: { w: atlasW, h: atlasH },
      scale,
    },
  };

  writeFileSync(path.join(OUT_DIR, `${outName}.png`), PNG.sync.write(atlas));
  writeFileSync(path.join(OUT_DIR, `${outName}.json`), JSON.stringify(sheet, null, 2));
  console.log(
    `packed ${sprites.length} sheet(s) / ${Object.keys(frames).length} frame(s) into ${atlasW}x${atlasH} ${outName} atlas`
  );
}

buildAtlas(TERRAIN_SRC, "terrain", () => true, "2");
buildAtlas(TERRAIN_DETAILS_SRC, "terrain-details", () => true, "2");
buildAtlas(NATURAL_SRC, "natural-props");
buildAtlas(BUILDING_SRC, "buildings-decor", (name) => /^(clubhouse|pro_shop|snack_bar|cart_rental|(?:parkland|links|desert)_(?:clubhouse|pro_shop|snack_bar|cart_rental)_t[123]|(?:parkland|links|desert)_(?:fence|bench|tee_sign|lamp|bin|parked_cart|flower_bed|planter|ornamental_feature|bridge|boardwalk|bridge_approach))\.png$/.test(name));
buildAtlas(path.join(SRC, "golfers"), "golfers");
