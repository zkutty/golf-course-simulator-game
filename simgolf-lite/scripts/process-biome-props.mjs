// Split the three original M21 chroma-key concept sheets into atlas-ready,
// transparent natural-prop sources. The output is deterministic so art can
// be rebuilt and audited without touching gameplay save data.
import { PNG } from "pngjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = path.join(ROOT, "src/assets/props/processed");
const OUTPUT = path.join(ROOT, "src/assets/props/natural");
mkdirSync(OUTPUT, { recursive: true });

const SHEETS = {
  parkland: [
    "tree_oak", "tree_birch", "tree_pine", "tree_fir",
    "tree_dogwood", "bush_hedge", "bush_wild_shrub", "bush_reeds",
    "bush_wildflowers", "rock_stump", "rock_granite", "rock_angular",
  ],
  links: [
    "tree_wind_pine", "tree_hawthorn", "bush_golden_fescue", "bush_dune_grass",
    "bush_gorse", "bush_heather", "bush_marram", "rock_driftwood",
    "rock_coastal_stone", "rock_slate", "rock_dune_boulder", "bush_salt_shrub",
  ],
  desert: [
    "tree_saguaro", "bush_prickly_pear", "bush_barrel_cactus", "tree_palo_verde",
    "tree_mesquite", "tree_palm", "bush_creosote", "bush_agave",
    "bush_dry_grass", "rock_sandstone", "rock_red_outcrop", "rock_volcanic",
  ],
};
if (JSON.stringify(Object.keys(SHEETS).sort()) !== JSON.stringify([...loadBiomeKeys()].sort())) {
  throw new Error("Natural-prop source sheets must cover every registered biome");
}

function alphaAt(png, x, y) {
  return png.data[(y * png.width + x) * 4 + 3];
}

function split(theme, names) {
  const sheet = PNG.sync.read(readFileSync(path.join(INPUT, `${theme}-sheet.png`)));
  const cellW = Math.floor(sheet.width / 4);
  const cellH = Math.floor(sheet.height / 3);
  for (let index = 0; index < names.length; index++) {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const x1 = col === 3 ? sheet.width : x0 + cellW;
    const y1 = row === 2 ? sheet.height : y0 + cellH;
    let minX = x1;
    let minY = y1;
    let maxX = x0;
    let maxY = y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (alphaAt(sheet, x, y) <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (maxX < minX || maxY < minY) throw new Error(`${theme} cell ${index} is empty`);
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const scale = Math.min(184 / cropH, 120 / cropW, 1);
    const drawW = Math.max(1, Math.round(cropW * scale));
    const drawH = Math.max(1, Math.round(cropH * scale));
    const out = new PNG({ width: drawW + 8, height: drawH + 8 });
    // Bilinear downsample at pixel centers. The chroma-key helper already
    // produced a soft matte, so this preserves clean antialiased edges.
    for (let oy = 0; oy < drawH; oy++) for (let ox = 0; ox < drawW; ox++) {
      const sx = minX + (ox + 0.5) / scale - 0.5;
      const sy = minY + (oy + 0.5) / scale - 0.5;
      const ax = Math.max(x0, Math.min(x1 - 1, Math.floor(sx)));
      const ay = Math.max(y0, Math.min(y1 - 1, Math.floor(sy)));
      const bx = Math.min(x1 - 1, ax + 1);
      const by = Math.min(y1 - 1, ay + 1);
      const tx = sx - Math.floor(sx);
      const ty = sy - Math.floor(sy);
      const dst = ((oy + 4) * out.width + ox + 4) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const a = sheet.data[(ay * sheet.width + ax) * 4 + channel];
        const b = sheet.data[(ay * sheet.width + bx) * 4 + channel];
        const c = sheet.data[(by * sheet.width + ax) * 4 + channel];
        const d = sheet.data[(by * sheet.width + bx) * 4 + channel];
        out.data[dst + channel] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      }
    }
    writeFileSync(path.join(OUTPUT, `${theme}_${names[index]}.png`), PNG.sync.write(out));
  }
}

for (const [theme, names] of Object.entries(SHEETS)) split(theme, names);
console.log(`wrote ${Object.values(SHEETS).flat().length} M21 natural-prop sources to ${OUTPUT}`);
