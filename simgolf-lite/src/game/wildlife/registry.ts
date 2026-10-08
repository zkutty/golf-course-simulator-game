import type { WildlifeProfile, WildlifeRegistry } from "./contracts";
import { WILDLIFE_ANIMATION_FAMILIES, WILDLIFE_BIOMES, WILDLIFE_CLIPS, WILDLIFE_FAMILIES, WILDLIFE_HABITATS, WILDLIFE_REVIEW_ROLES } from "./contracts";

/** Closed ZK-657 authoring roster. Every profile is planned; no assets or runtime activation. */
function profile(biome: WildlifeProfile["biome"], setting: WildlifeProfile["setting"], species: WildlifeProfile["species"]): WildlifeProfile {
  return {
    biome, setting,
    ownership: { profile: biome, bundleOwner: biome, delivery: "planned", fallback: "omit" },
    provenance: { status: "pending", assetReferences: [], reviews: Object.fromEntries(WILDLIFE_REVIEW_ROLES.map(role => [role, "pending"])) as WildlifeProfile["provenance"]["reviews"] },
    species,
  };
}

export const WILDLIFE_REGISTRY: WildlifeRegistry = {
  "parkland": profile("parkland", "playable", [
    {"id": "woodland-deer","label": "Woodland deer","scales": ["L"],"silhouette": "four-legged narrow body, upright ears","anchors": ["G"],"family": "A","clips": ["idle","slow-walk"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-edge","habitatDescription": "Remote woodland edge","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "cottontail-rabbits","label": "Cottontail rabbits","scales": ["S"],"silhouette": "rounded body, short tail, upright ears","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 2},"habitat": "meadow-margin","habitatDescription": "Shrubby meadow margin","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "tree-squirrels","label": "Tree squirrels","scales": ["S"],"silhouette": "curved bushy tail, compact body","anchors": ["P","G"],"family": "C","clips": ["perch","branch-walk"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-support","habitatDescription": "Woodland branch/floor beyond play","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "mallards","label": "Mallards","scales": ["S"],"silhouette": "low broad waterbird hull","anchors": ["W","F"],"family": "D","clips": ["quiet-flight"],"adultGroup": {"min": 2,"max": 4},"habitat": "sheltered-pond","habitatDescription": "Sheltered pond outside golf carry/corridor","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": true,"audio": {"treatment": "distant-call","description": "Sparse distant quack, no feeding calls"},"exclusionTiles": 5},
    {"id": "shoreline-heron","label": "Shoreline heron","scales": ["M"],"silhouette": "long legs, long bill, folded-neck profile","anchors": ["P","F"],"family": "E","clips": ["perch","stand","quiet-flight"],"adultGroup": {"min": 1,"max": 1},"habitat": "wet-edge-support","habitatDescription": "Remote natural wet-shore perch","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
  ]),
  "links": profile("links", "playable", [
    {"id": "brown-hares","label": "Brown hares","scales": ["M"],"silhouette": "longer legs/ears than rabbits","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 2},"habitat": "dune-margin","habitatDescription": "Remote dune-grass margin","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "european-rabbits","label": "European rabbits","scales": ["S"],"silhouette": "compact round haunches, shorter ears","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 3},"habitat": "dune-margin","habitatDescription": "Remote grassy dune edge","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "oystercatchers","label": "Oystercatchers","scales": ["S"],"silhouette": "stout straight bill and contrasting body blocks","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "coastal-rock","habitatDescription": "Remote coastal rock perch or flyover","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": true,"audio": {"treatment": "distant-call","description": "Single distant call"},"exclusionTiles": 3},
    {"id": "herring-gull-flocks","label": "Herring gull flocks","scales": ["Flight","M"],"silhouette": "broad tapered wings, substantial bill","anchors": ["F","P"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 3,"max": 5},"habitat": "coastal-rock","habitatDescription": "Outer coastal flyover/remote rock","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Sparse distant gull call, no food-seeking chorus"},"exclusionTiles": 5},
  ]),
  "desert": profile("desert", "playable", [
    {"id": "black-tailed-jackrabbits","label": "Black-tailed jackrabbits","scales": ["M"],"silhouette": "very long ears/legs, narrow dark tail tip","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 2},"habitat": "scrub-wash","habitatDescription": "Remote scrub/wash edge","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "gambel-s-quail","label": "Gambel's quail","scales": ["S"],"silhouette": "compact body, curved topknot","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 2,"max": 4},"habitat": "natural-rock","habitatDescription": "Low natural rock/scrub perch or quiet flyover","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": true,"audio": {"treatment": "distant-call","description": "Sparse distant contact call"},"exclusionTiles": 5},
    {"id": "greater-roadrunners","label": "Greater roadrunners","scales": ["M"],"silhouette": "long tail, crest, low horizontal body","anchors": ["G","P","F"],"family": "F","clips": ["perch","quiet-flight","remote-travel"],"adultGroup": {"min": 1,"max": 1},"habitat": "scrub-wash","habitatDescription": "Remote open scrub away from lizards","activity": ["morning","late-day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "desert-spiny-lizards","label": "Desert spiny lizards","scales": ["XS"],"silhouette": "low pointed body, long tapering tail","anchors": ["G"],"family": "G","clips": ["rest","slow-crawl"],"adultGroup": {"min": 1,"max": 2},"habitat": "natural-rock","habitatDescription": "Remote sunlit natural rock","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": true,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
  ]),
  "tropical-coastal-resort": profile("tropical-coastal-resort", "staged", [
    {"id": "geckos","label": "Geckos","scales": ["XS"],"silhouette": "flattened body, splayed toes, tapering tail","anchors": ["G","P"],"family": "G","clips": ["rest","slow-crawl"],"adultGroup": {"min": 1,"max": 2},"habitat": "rock-bark","habitatDescription": "Remote volcanic rock/natural bark","activity": ["dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "ghost-crabs","label": "Ghost crabs","scales": ["XS"],"silhouette": "broad low carapace, sideways leg spread","anchors": ["G"],"family": "H","clips": ["still","lateral-scuttle"],"adultGroup": {"min": 1,"max": 3},"habitat": "ocean-beach","habitatDescription": "Remote ocean beach above waterline","activity": ["dusk","night"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "white-egrets","label": "White egrets","scales": ["M"],"silhouette": "long legs/neck and narrow bill","anchors": ["P","F"],"family": "E","clips": ["perch","stand","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "wet-edge-support","habitatDescription": "Remote lagoon/wet-edge natural perch","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "fruit-doves","label": "Fruit doves","scales": ["S"],"silhouette": "rounded dove body, small head, short bill","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "canopy","habitatDescription": "Remote broad-leaf canopy","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Sparse soft distant dove call"},"exclusionTiles": 3},
  ]),
  "temperate-japan": profile("temperate-japan", "staged", [
    {"id": "sika-deer","label": "Sika deer","scales": ["L"],"silhouette": "compact deer body, upright ears, restrained coat pattern","anchors": ["G"],"family": "A","clips": ["idle","slow-walk"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-edge","habitatDescription": "Remote woodland edge","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "japanese-hares","label": "Japanese hares","scales": ["M"],"silhouette": "long-ear/long-leg outline, quiet neutral coat","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 2},"habitat": "clearing-margin","habitatDescription": "Remote woodland clearing margin","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "green-pheasants","label": "Green pheasants","scales": ["M"],"silhouette": "long tapering tail and small head","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-support","habitatDescription": "Low natural woodland-edge perch or flyover","activity": ["morning"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": true,"audio": {"treatment": "distant-call","description": "Sparse distant call"},"exclusionTiles": 3},
    {"id": "grey-herons","label": "Grey herons","scales": ["M"],"silhouette": "long legs/bill, folded neck","anchors": ["P","F"],"family": "E","clips": ["perch","stand","quiet-flight"],"adultGroup": {"min": 1,"max": 1},"habitat": "wet-edge-support","habitatDescription": "Remote stream/pond natural perch","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
  ]),
  "alpine-mountain": profile("alpine-mountain", "staged", [
    {"id": "alpine-marmots","label": "Alpine marmots","scales": ["M"],"silhouette": "squat body, short ears, heavy low tail","anchors": ["G"],"family": "I","clips": ["rest","slow-walk"],"adultGroup": {"min": 1,"max": 3},"habitat": "meadow-rock","habitatDescription": "Remote meadow beside natural rock","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": true,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent; no alarm whistle"},"exclusionTiles": 5},
    {"id": "mountain-hares","label": "Mountain hares","scales": ["M"],"silhouette": "long ears/hind legs, seasonal coat with persistent outline","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 2},"habitat": "meadow-margin","habitatDescription": "Remote meadow/conifer margin","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
    {"id": "rock-ptarmigan","label": "Rock ptarmigan","scales": ["S"],"silhouette": "rounded body, short bill/tail","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "natural-rock","habitatDescription": "Remote high natural rock or quiet flyover","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": true,"restrictedGroundNestingPresentation": true,"audio": {"treatment": "distant-call","description": "Sparse distant call"},"exclusionTiles": 3},
    {"id": "ravens","label": "Ravens","scales": ["M","Flight"],"silhouette": "heavy bill, wedge-like tail, broad wing profile","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-support","habitatDescription": "Remote rock/conifer perch or ridge flyover","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Single soft distant call"},"exclusionTiles": 3},
  ]),
  "heathland": profile("heathland", "staged", [
    {"id": "european-rabbits","label": "European rabbits","scales": ["S"],"silhouette": "round haunches, shorter ears","anchors": ["G"],"family": "B","clips": ["idle","gentle-hop"],"adultGroup": {"min": 1,"max": 3},"habitat": "sandy-heather-edge","habitatDescription": "Remote grass/heather edge","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "roe-deer","label": "Roe deer","scales": ["L"],"silhouette": "slim deer body, prominent upright ears","anchors": ["G"],"family": "A","clips": ["idle","slow-walk"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-edge","habitatDescription": "Remote woodland/heather margin","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "stonechats","label": "Stonechats","scales": ["S"],"silhouette": "small upright bird, compact head and tail","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "gorse-support","habitatDescription": "Remote gorse natural perch","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Sparse distant short call"},"exclusionTiles": 3},
    {"id": "nightjars","label": "Nightjars","scales": ["Flight","S"],"silhouette": "pointed wings, long tail, low profile","anchors": ["F","P"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 1},"habitat": "clearing-margin","habitatDescription": "Remote clearing flight/branch","activity": ["dusk"],"seasons": ["summer"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": true,"audio": {"treatment": "distant-call","description": "Brief distant non-courtship call; omit if recording context is uncertain"},"exclusionTiles": 3},
    {"id": "sand-lizards","label": "Sand lizards","scales": ["XS"],"silhouette": "low long body with stripe/block pattern","anchors": ["G"],"family": "G","clips": ["rest","slow-crawl"],"adultGroup": {"min": 1,"max": 2},"habitat": "sandy-heather-edge","habitatDescription": "Remote sandy/heather edge natural rock","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": true,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 3},
  ]),
  "australian-sandbelt": profile("australian-sandbelt", "staged", [
    {"id": "eastern-grey-kangaroo-mobs","label": "Eastern grey kangaroo mobs","scales": ["L"],"silhouette": "long hind feet, small forearms, heavy balancing tail","anchors": ["G"],"family": "J","clips": ["rest","calm-hop"],"adultGroup": {"min": 3,"max": 5},"habitat": "woodland-edge","habitatDescription": "Remote woodland/meadow edge","activity": ["dawn","dusk"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent"},"exclusionTiles": 5},
    {"id": "laughing-kookaburras","label": "Laughing kookaburras","scales": ["M"],"silhouette": "large blocky head/bill, broad tail","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 2},"habitat": "woodland-support","habitatDescription": "Remote eucalyptus branch","activity": ["morning","late-day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Brief distant natural call, no comic laugh or territorial scene"},"exclusionTiles": 3},
    {"id": "sulphur-crested-cockatoos","label": "Sulphur-crested cockatoos","scales": ["M"],"silhouette": "curved bill and upright crest outline","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 2,"max": 4},"habitat": "woodland-support","habitatDescription": "Remote woodland perch/flyover","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Softened sparse distant call, no sustained screech"},"exclusionTiles": 5},
    {"id": "australian-magpies","label": "Australian magpies","scales": ["M"],"silhouette": "long straight bill, sturdy body, contrasting shape blocks","anchors": ["P","F"],"family": "F","clips": ["perch","quiet-flight"],"adultGroup": {"min": 1,"max": 3},"habitat": "woodland-support","habitatDescription": "Remote open-woodland natural perch","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": false,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "distant-call","description": "Sparse distant warble; no swooping/alarm"},"exclusionTiles": 5},
    {"id": "blue-tongue-lizards","label": "Blue-tongue lizards","scales": ["S"],"silhouette": "thick low body, short legs, tapering tail","anchors": ["G"],"family": "G","clips": ["rest","slow-crawl"],"adultGroup": {"min": 1,"max": 2},"habitat": "warm-woodland-floor","habitatDescription": "Remote warm rock/woodland floor","activity": ["day"],"seasons": ["spring","summer","autumn","winter"],"mildWeatherOnly": true,"restrictedGroundNestingPresentation": false,"audio": {"treatment": "silent","description": "Silent; no tongue threat display"},"exclusionTiles": 3},
  ]),
};

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/** Exact authoring pins keep this closed roster from granting new content/rights by implication. */
function compareContract(expected: unknown, actual: unknown, path: string, errors: string[]): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { errors.push(`${path}: array is required`); return; }
    if (actual.length !== expected.length) errors.push(`${path}: expected ${expected.length} entries`);
    expected.forEach((item, index) => compareContract(item, actual[index], `${path}[${index}]`, errors));
  } else if (record(expected)) {
    if (!record(actual)) { errors.push(`${path}: object is required`); return; }
    for (const key of Object.keys(actual)) if (!Object.hasOwn(expected, key)) errors.push(`${path}.${key}: unsupported field`);
    for (const [key, item] of Object.entries(expected)) {
      if (!Object.hasOwn(actual, key)) errors.push(`${path}.${key}: own field is required`);
      compareContract(item, actual[key], `${path}.${key}`, errors);
    }
  } else if (actual !== expected) {
    errors.push(`${path}: expected ${JSON.stringify(expected)}`);
  }
}

export function auditWildlifeRegistry(value: unknown = WILDLIFE_REGISTRY): readonly string[] {
  const errors: string[] = [];
  // Semantic checks are independent of the canonical data, including when it is the input.
  if (!record(value)) return ["wildlife: object is required"];
  const expectedCounts = [5, 4, 4, 4, 4, 4, 5, 5];
  const restrictedBirds = ["Mallards", "Gambel's quail", "Oystercatchers", "Green pheasants", "Rock ptarmigan", "Nightjars"];
  const text = (item: unknown): item is string => typeof item === "string" && item.trim().length > 0;
  const members = (item: unknown, allowed: readonly string[]): item is string[] => Array.isArray(item)
    && item.length > 0 && new Set(item).size === item.length && item.every(member => allowed.includes(member));
  for (const key of Object.keys(value)) if (!WILDLIFE_BIOMES.includes(key as WildlifeProfile["biome"])) errors.push(`wildlife.${key}: unsupported biome`);
  WILDLIFE_BIOMES.forEach((biome, index) => {
    const path = `wildlife.${biome}`;
    const candidate = value[biome];
    if (!record(candidate)) { errors.push(`${path}: profile is required`); return; }
    if (candidate.biome !== biome || candidate.setting !== (index < 3 ? "playable" : "staged")) errors.push(`${path}: biome/setting identity is incompatible`);
    compareContract({ profile: biome, bundleOwner: biome, delivery: "planned", fallback: "omit" }, candidate.ownership, `${path}.ownership`, errors);
    compareContract({ status: "pending", assetReferences: [], reviews: Object.fromEntries(WILDLIFE_REVIEW_ROLES.map(role => [role, "pending"])) }, candidate.provenance, `${path}.provenance`, errors);
    if (!Array.isArray(candidate.species)) { errors.push(`${path}.species: array is required`); return; }
    if (candidate.species.length !== expectedCounts[index]) errors.push(`${path}.species: closed roster count must be ${expectedCounts[index]}`);
    const ids = new Set<string>();
    for (const [speciesIndex, item] of candidate.species.entries()) {
      const speciesPath = `${path}.species[${speciesIndex}]`;
      if (!record(item)) { errors.push(`${speciesPath}: species is required`); continue; }
      if (!text(item.id) || ids.has(item.id)) errors.push(`${speciesPath}.id: nonempty unique id is required`);
      else ids.add(item.id);
      if (!text(item.label) || !text(item.silhouette) || !text(item.habitatDescription)) errors.push(`${speciesPath}: label/silhouette/habitat description is required`);
      if (!members(item.scales, ["XS", "S", "M", "L", "Flight"])) errors.push(`${speciesPath}.scales: unsupported scale`);
      if (!members(item.anchors, ["G", "W", "P", "F"])) errors.push(`${speciesPath}.anchors: unsupported attachment`);
      if (!WILDLIFE_HABITATS.includes(item.habitat as never)) errors.push(`${speciesPath}.habitat: unsupported habitat`);
      if (!members(item.activity, ["dawn", "morning", "day", "late-day", "dusk", "night"])) errors.push(`${speciesPath}.activity: unsupported window`);
      if (!members(item.seasons, ["spring", "summer", "autumn", "winter"])) errors.push(`${speciesPath}.seasons: unsupported season`);
      if (typeof item.mildWeatherOnly !== "boolean") errors.push(`${speciesPath}.mildWeatherOnly: boolean is required`);
      if (item.label === "Nightjars" && (!Array.isArray(item.seasons) || item.seasons.length !== 1 || item.seasons[0] !== "summer")) errors.push(`${speciesPath}.seasons: nightjars are summer-only`);
      const restricted = restrictedBirds.includes(item.label as string);
      if (item.restrictedGroundNestingPresentation !== restricted) errors.push(`${speciesPath}: ground-nesting restriction must match the roster`);
      const validFamily = WILDLIFE_FAMILIES.includes(item.family as never);
      if (!validFamily) errors.push(`${speciesPath}.family: unsupported animation family`);
      if (!members(item.clips, WILDLIFE_CLIPS)) errors.push(`${speciesPath}.clips: prohibited or unknown clip`);
      else if (validFamily) {
        const family = item.family as keyof typeof WILDLIFE_ANIMATION_FAMILIES;
        const allowed: string[] = WILDLIFE_ANIMATION_FAMILIES[family].map(cycle => cycle.clip);
        if (biome === "desert" && item.label === "Greater roadrunners") allowed.push("remote-travel");
        if (item.clips.some(clip => !allowed.includes(clip))) errors.push(`${speciesPath}.clips: clip is incompatible with its animation family`);
        if (restricted && item.clips.some(clip => clip !== "quiet-flight" && (item.label === "Mallards" || clip !== "perch"))) errors.push(`${speciesPath}.clips: restricted birds permit only quiet flight/natural perch; mallards are flight-only pending review`);
        const anchors = Array.isArray(item.anchors) ? item.anchors : [];
        if (item.clips.includes("quiet-flight") && !anchors.includes("F")) errors.push(`${speciesPath}.clips: flight requires a flight pivot`);
        if (item.clips.includes("perch") && !anchors.includes("P")) errors.push(`${speciesPath}.clips: perch requires natural-support attachment`);
      }
      const group = record(item.adultGroup) ? item.adultGroup : {};
      if (!Number.isInteger(group.min) || !Number.isInteger(group.max) || (group.min as number) < 1 || (group.max as number) > 5 || (group.max as number) < (group.min as number)) errors.push(`${speciesPath}.adultGroup: bounded ordered adult range is required`);
      if ((item.label === "Herring gull flocks" || item.label === "Eastern grey kangaroo mobs") && group.min !== 3) errors.push(`${speciesPath}.adultGroup: mob/flock minimum is three, never a solitary fallback`);
      const buffer = Array.isArray(item.scales) && item.scales.includes("L") || (group.max as number) > 2 ? 5 : 3;
      if (item.exclusionTiles !== buffer) errors.push(`${speciesPath}.exclusionTiles: required remote buffer is ${buffer}`);
      if (!record(item.audio) || !["silent", "distant-call"].includes(item.audio.treatment as string) || !text(item.audio.description)) errors.push(`${speciesPath}.audio: silent or sparse distant-call treatment is required`);
      else if (item.audio.description.startsWith("Silent") !== (item.audio.treatment === "silent")) errors.push(`${speciesPath}.audio: silence must match the roster description`);
    }
  });
  compareContract(WILDLIFE_REGISTRY, value, "wildlife", errors);
  return errors;
}

/** Pure boundary for malformed imported authoring ownership; never normalizes to another biome. */
export function auditWildlifeOwnership(value: unknown, playableBiomes: readonly string[]): readonly string[] {
  const errors: string[] = [];
  if (!record(value)) return ["wildlife.ownership: object is required"];
  for (const key of Object.keys(value)) if (!playableBiomes.includes(key)) errors.push(`${key}: wildlife ownership is not a playable biome`);
  for (const biome of playableBiomes) {
    if (!WILDLIFE_BIOMES.includes(biome as WildlifeProfile["biome"])) { errors.push(`${biome}: wildlife profile is missing`); continue; }
    if (!(["parkland", "links", "desert"] as readonly string[]).includes(biome)) errors.push(`${biome}: staged wildlife setting cannot become playable`);
    compareContract({ profile: biome, bundleOwner: biome, delivery: "planned", fallback: "omit" }, value[biome], `${biome}: wildlife ownership`, errors);
  }
  return errors;
}
