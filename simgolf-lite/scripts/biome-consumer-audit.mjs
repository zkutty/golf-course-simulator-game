import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const biomeKeys = loadBiomeKeys();
const errors = [];
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const routedConsumers = [
  "src/game/gen/generateWildLand.ts",
  "src/game/models/terrainEconomics.ts",
  "src/game/sim/shots/landingPenalty.ts",
  "src/game/estate/estate.ts",
  "src/game/playerPro/playerPro.ts",
  "src/game/live/livePhysics.ts",
  "src/App.tsx",
  "src/game/render/terrainRelief.ts",
  "src/game/render/naturalProps.ts",
  "src/game/models/buildings.ts",
  "src/game/models/decorations.ts",
  "src/game/render/terrainMaterials.ts",
  "src/game/render/terrainDetails.ts",
  "src/game/render/groundCover.ts",
  "src/game/render/materialFields.ts",
  "src/game/render/landscapeGeometry.ts",
  "src/game/render/scenicSurround.ts",
  "src/ui/NewGameWizard.tsx",
  "src/App.tsx",
  "src/ui/ScenarioSelect.tsx",
  "src/audio/environment.ts",
  "src/game/scenarioAuthoring/templates.ts",
  "src/game/contentPackages/packageFormat.ts",
  "src/game/contentPackages/library.ts",
  "src/render/atlas.ts",
  "src/ui/courseVibe.ts",
];
for (const relative of routedConsumers) {
  const source = read(relative);
  if (!/(?:BIOME_|getBiomeDefinition|isLandTheme|normalizeBiomeKey|validateBiomeCompatibilityMetadata)/.test(source)) {
    errors.push(`${relative}: production biome consumer is not registry-routed`);
  }
}

const noLiteralEnumerations = [
  "src/game/scenarioAuthoring/templates.ts",
  "src/game/testing/releaseBalanceCli.ts",
  "src/ui/NewGameWizard.tsx",
  "scripts/build-atlas.mjs",
  "scripts/m35-asset-audit.mjs",
  "scripts/perf-smoke.mjs",
];
const escaped = biomeKeys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const allKeysPattern = new RegExp(
  `\\[(?=[^\\]]*["']${escaped[0]}["'])(?=[^\\]]*["']${escaped[1] ?? escaped[0]}["'])(?=[^\\]]*["']${escaped[2] ?? escaped[0]}["'])[^\\]]*\\]`,
);
for (const relative of noLiteralEnumerations) {
  if (allKeysPattern.test(read(relative))) {
    errors.push(`${relative}: hard-coded biome enumeration bypasses BIOME_KEYS`);
  }
}

const noThemeBranches = [
  "src/game/render/landscapeGeometry.ts",
  "src/game/render/scenicSurround.ts",
  "src/ui/NewGameWizard.tsx",
  "src/ui/HUD.tsx",
  "src/ui/courseVibe.ts",
  "scripts/gen-m35-landscape-fields.mjs",
  "scripts/gen-terrain-materials.mjs",
];
for (const relative of noThemeBranches) {
  if (/\btheme\s*[!=]==?\s*["'](?:parkland|links|desert)["']/.test(read(relative))) {
    errors.push(`${relative}: hard-coded theme branch bypasses BIOME_DEFINITIONS`);
  }
}

const hudSource = read("src/ui/HUD.tsx");
if (/(?:Everyday Parkland|Punishing Links|Beginner-friendly Parkland)/.test(hudSource)) {
  errors.push("src/ui/HUD.tsx: course vibe identity must come from the biome registry");
}

// Save/package normalization must now resolve through the registry and reject
// unsupported keys. ZK-563 removed the last fixed current-schema allowlist.
const saveSource = read("src/utils/save.ts");
const saveAllowlist = `oneOf<LandTheme>(rawCourse.theme, ["parkland", "links", "desert"], "parkland")`;
const saveAllowlistCount = saveSource.split(saveAllowlist).length - 1;
if (saveAllowlistCount !== 0) {
  errors.push("src/utils/save.ts: fixed legacy biome allowlists are forbidden after ZK-563");
}
if (!/normalizeBiomeKey\s*\(\s*rawCourse\.theme/.test(saveSource)
  || !/validateBiomeCompatibilityMetadata\s*\(/.test(saveSource)) {
  errors.push("src/utils/save.ts: save biome identity and metadata must fail closed through the registry");
}

const noCrossBiomeFallback = [
  "src/game/render/naturalProps.ts",
  "src/game/models/buildings.ts",
  "src/game/models/decorations.ts",
  "src/ui/PixiStage.tsx",
];
for (const relative of noCrossBiomeFallback) {
  const source = read(relative);
  if (/fallback[^;\n]{0,120}parkland|visuals\.parkland|NATURAL_PROP_REGISTRY\.parkland/i.test(source)) {
    errors.push(`${relative}: registered biome may silently cross-fallback to Parkland`);
  }
}

if (errors.length) {
  console.error(`Biome consumer audit failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Biome consumer audit passed for ${biomeKeys.length} registered biome(s).`);
