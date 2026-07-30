import { SUNO_AMBIENCE_PLAYLISTS, SUNO_MUSIC_PLAYLISTS } from "../../audio/sunoLibrary";
import {
  ATLAS_QUALITIES,
  ATLAS_SEASONAL_FRAME_FAMILIES,
  type AtlasBaseBundle,
  type AtlasBundleFile,
  type AtlasFieldFile,
  type AtlasManifest,
  type AtlasQuality,
  type AtlasSeasonalFrameFamily,
  type AtlasSeasonalOverlay,
} from "../../render/atlasManifest";
import { BUILDING_SPECS, buildingVisualFrame } from "../models/buildings";
import {
  BIOME_KEYS,
  CLIMATE_CALENDAR_SEASONS,
  biomeCompatibilityMetadataFor,
  climateStateFor,
  getBiomeDefinition,
  type LandTheme,
} from "../models/biomes";
import { DECORATION_KINDS, DECORATION_SPECS } from "../models/decorations";
import type { Building, Course, ObstacleType, Point } from "../models/types";
import { NATURAL_PROP_REGISTRY } from "../render/naturalProps";
import {
  SEASONAL_COVERAGE_CONTRACT,
  SEASONAL_VISUAL_FAMILIES,
  auditSeasonalCoverageContract,
} from "../render/seasonalCoverage";
import { TERRAIN_KINDS } from "../render/terrainMaterials";
import { createM22VisualReferenceCourse } from "./referenceCourse";

export const BIOME_AUTHORING_REPORT_VERSION = 2 as const;
export const BIOME_SELECTED_PAYLOAD_BUDGET_BYTES = 6 * 1024 * 1024;
export const BIOME_CUMULATIVE_RESIDENCY_BUDGET_BYTES = 12 * 1024 * 1024;
/** Seed owned by the underlying M21/M22 deterministic biome scene. */
export const BIOME_REFERENCE_SEED = 210225;
export const BIOME_REFERENCE_VIEWS = [
  "overview",
  "build",
  "golfer-follow",
  "direct-play",
] as const;
export const BIOME_REFERENCE_ROTATIONS = [0, 1, 2, 3] as const;

export type BiomeReferenceView = (typeof BIOME_REFERENCE_VIEWS)[number];
export type BiomeReferenceRotation = (typeof BIOME_REFERENCE_ROTATIONS)[number];

export interface BiomeCameraBookmark {
  readonly id: `${BiomeReferenceView}-r${BiomeReferenceRotation}`;
  readonly view: BiomeReferenceView;
  readonly rotation: BiomeReferenceRotation;
  readonly center: Point;
  readonly zoom: number;
  readonly focus: "whole-course" | "authoring-yard" | "golfer" | "ball-and-green";
}

export interface BiomeReferenceFixture {
  readonly id: `zk-564-${LandTheme}`;
  readonly biome: LandTheme;
  readonly seed: number;
  readonly source: {
    readonly issue: "ZK-564";
    readonly generator: "createBiomeAuthoringReferenceCourse";
    readonly registryContentVersion: number;
  };
  readonly course: Course;
  readonly bookmarks: readonly BiomeCameraBookmark[];
  readonly climateStates: ReturnType<typeof climateStateFor>[];
}

const OBSTACLE_TYPES = ["tree", "bush", "rock"] as const satisfies readonly ObstacleType[];

/**
 * The M22 visual fixture remains the authored scene owner. This wrapper adds a
 * stable audit strip and one representative obstacle of every natural-prop
 * family so future biome registrations cannot pass with generator luck alone.
 */
export function createBiomeAuthoringReferenceCourse(theme: LandTheme): Course {
  const base = createM22VisualReferenceCourse(theme);
  const tiles = [...base.tiles];
  const elevations = [...base.elevations];
  const firstHole = base.holes[0];
  const holes: Course["holes"] = [
    firstHole,
    {
      ...firstHole,
      tee: { x: 7, y: 16 },
      green: { x: 55, y: 18 },
      name: `${getBiomeDefinition(theme).label} North`,
      holeIndex: 2,
    },
    {
      ...firstHole,
      tee: { x: 7, y: 27 },
      green: { x: 55, y: 29 },
      name: `${getBiomeDefinition(theme).label} South`,
      holeIndex: 3,
    },
  ];
  for (const hole of holes.slice(1)) {
    if (!hole.tee || !hole.green) continue;
    for (let x = hole.tee.x; x <= hole.green.x; x++) {
      const center = Math.round(hole.tee.y + (hole.green.y - hole.tee.y) * ((x - hole.tee.x) / (hole.green.x - hole.tee.x)));
      for (let y = center - 1; y <= center + 1; y++) tiles[y * base.width + x] = "fairway";
    }
    tiles[hole.tee.y * base.width + hole.tee.x] = "tee";
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      tiles[(hole.green.y + dy) * base.width + hole.green.x + dx] = "green";
    }
  }
  const swatchPoints = TERRAIN_KINDS.map((terrain, index) => ({
    terrain,
    x: 3 + index * 5,
    y: 39,
  }));
  for (const swatch of swatchPoints) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const index = (swatch.y + dy) * base.width + swatch.x + dx;
        tiles[index] = swatch.terrain;
        elevations[index] = 0;
      }
    }
  }

  const auditObstaclePoints = [
    { type: "tree" as const, x: 54, y: 38 },
    { type: "bush" as const, x: 56, y: 38 },
    { type: "rock" as const, x: 58, y: 38 },
  ];
  for (const point of auditObstaclePoints) {
    tiles[point.y * base.width + point.x] = point.type === "tree" ? "rough" : "deep_rough";
    elevations[point.y * base.width + point.x] = 0;
  }
  const reserved = new Set([
    ...swatchPoints.flatMap((swatch) =>
      Array.from({ length: 6 }, (_, index) =>
        `${swatch.x + (index % 3)},${swatch.y + Math.floor(index / 3)}`)),
    ...auditObstaclePoints.map((point) => `${point.x},${point.y}`),
  ]);
  const obstacles = [
    ...base.obstacles.filter((obstacle) => !reserved.has(`${obstacle.x},${obstacle.y}`)),
    ...auditObstaclePoints,
  ];

  return {
    ...base,
    name: `ZK-564 ${getBiomeDefinition(theme).label} Authoring Reference`,
    theme,
    biomeCompatibility: biomeCompatibilityMetadataFor(theme),
    tiles,
    elevations,
    holes,
    obstacles,
  };
}

export function biomeCameraBookmarks(course: Course): readonly BiomeCameraBookmark[] {
  const hole = course.holes[0];
  const tee = hole?.tee ?? { x: Math.round(course.width * 0.25), y: Math.round(course.height * 0.5) };
  const green = hole?.green ?? { x: Math.round(course.width * 0.75), y: Math.round(course.height * 0.5) };
  const building = course.buildings[0] ?? { x: Math.round(course.width * 0.2), y: Math.round(course.height * 0.7) };
  const viewContracts: Readonly<Record<BiomeReferenceView, {
    center: Point;
    zoom: number;
    focus: BiomeCameraBookmark["focus"];
  }>> = {
    overview: {
      center: { x: course.width / 2, y: course.height / 2 },
      zoom: 0.5,
      focus: "whole-course",
    },
    build: {
      center: { x: building.x + 7, y: building.y + 2 },
      zoom: 1.35,
      focus: "authoring-yard",
    },
    "golfer-follow": {
      center: { x: tee.x, y: tee.y },
      zoom: 1.65,
      focus: "golfer",
    },
    "direct-play": {
      center: { x: (tee.x + green.x) / 2, y: (tee.y + green.y) / 2 },
      zoom: 1.8,
      focus: "ball-and-green",
    },
  };
  return BIOME_REFERENCE_VIEWS.flatMap((view) =>
    BIOME_REFERENCE_ROTATIONS.map((rotation): BiomeCameraBookmark => ({
      id: `${view}-r${rotation}`,
      view,
      rotation,
      ...viewContracts[view],
    })));
}

export function createBiomeReferenceFixture(theme: LandTheme): BiomeReferenceFixture {
  const course = createBiomeAuthoringReferenceCourse(theme);
  return {
    id: `zk-564-${theme}`,
    biome: theme,
    seed: BIOME_REFERENCE_SEED,
    source: {
      issue: "ZK-564",
      generator: "createBiomeAuthoringReferenceCourse",
      registryContentVersion: getBiomeDefinition(theme).compatibility.contentVersion,
    },
    course,
    bookmarks: biomeCameraBookmarks(course),
    climateStates: CLIMATE_CALENDAR_SEASONS.map((season) => climateStateFor(theme, season)),
  };
}

export interface BiomeAssetInventory {
  /** Atlas JSON URL -> frame names contained by that file. */
  readonly framesByJson: Readonly<Record<string, readonly string[]>>;
  /** Atlas URL -> SHA-256 of the referenced public file's actual bytes. */
  readonly sha256ByAsset: Readonly<Record<string, string>>;
}

export type BiomeAuditCategory =
  | "required"
  | "seasonal-contract"
  | "seasonal-enrichment"
  | "optional"
  | "fallback"
  | "over-budget";

export interface BiomeAuditFinding {
  readonly category: BiomeAuditCategory;
  readonly biome: LandTheme;
  readonly quality?: AtlasQuality;
  readonly asset: string;
  readonly detail: string;
}

export interface BiomePayloadTierReport {
  readonly biome: LandTheme;
  readonly quality: AtlasQuality;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly status: "within-budget" | "over-budget";
  readonly overByBytes: number;
  readonly baseBytes: number;
  readonly largestOverlayBytes: number;
  readonly cumulativeResidencyBytes: number;
  readonly residencyBudgetBytes: number;
  readonly residencyStatus: "within-budget" | "over-budget";
  readonly residencyOverByBytes: number;
}

export interface SeasonalContractAuditReport {
  readonly pass: boolean;
  readonly totalCells: number;
  readonly errors: readonly string[];
}

export interface BiomeCoverageReport {
  readonly biome: LandTheme;
  readonly terrain: readonly string[];
  readonly props: readonly string[];
  readonly structures: readonly string[];
  readonly decorations: readonly string[];
  readonly climateStates: readonly string[];
  readonly audioContexts: readonly string[];
  readonly cameraBookmarks: readonly string[];
}

export interface BiomeAuthoringAuditReport {
  readonly version: typeof BIOME_AUTHORING_REPORT_VERSION;
  readonly registryBiomes: readonly LandTheme[];
  readonly pass: boolean;
  readonly coverage: readonly BiomeCoverageReport[];
  readonly seasonalContract: SeasonalContractAuditReport;
  readonly payloads: readonly BiomePayloadTierReport[];
  readonly findings: readonly BiomeAuditFinding[];
  readonly counts: Readonly<Record<BiomeAuditCategory, number>>;
}

function bundleBytes(bundle: AtlasBundleFile | null): number {
  return bundle ? (bundle.jsonBytes ?? 0) + (bundle.imageBytes ?? 0) : 0;
}

function fieldBytes(field: AtlasFieldFile | undefined): number {
  return field?.bytes ?? 0;
}

function baseBytes(base: AtlasBaseBundle): number {
  return bundleBytes(base.buildings)
    + bundleBytes(base.terrain)
    + bundleBytes(base.details)
    + bundleBytes(base.props)
    + Object.values(base.fields).reduce((sum, field) => sum + fieldBytes(field), 0);
}

function atlasFrames(inventory: BiomeAssetInventory, bundle: AtlasBundleFile | null): readonly string[] {
  return bundle ? (inventory.framesByJson[bundle.json] ?? []) : [];
}

function namedDigest(path: string): string | null {
  return path.match(/\.([a-f0-9]{12})\.(?:json|png)$/u)?.[1] ?? null;
}

function allBundlePaths(bundle: AtlasBaseBundle): string[] {
  const bundleFiles = [bundle.buildings, bundle.terrain, bundle.details, bundle.props]
    .filter((item): item is AtlasBundleFile => item != null)
    .flatMap((item) => [item.json, item.image]);
  return [...bundleFiles, ...Object.values(bundle.fields).flatMap((item) => item ? [item.image] : [])];
}

function overlayPaths(overlay: AtlasSeasonalOverlay | null | undefined): string[] {
  if (!overlay) return [];
  const bundles = Object.values(overlay.frames)
    .filter((item): item is AtlasBundleFile => item != null)
    .flatMap((item) => [item.json, item.image]);
  return [...bundles, ...Object.values(overlay.materials).flatMap((item) => item ? [item.image] : [])];
}

function overlayBytes(overlay: AtlasSeasonalOverlay | null | undefined): number {
  if (!overlay) return 0;
  return Object.values(overlay.frames).reduce(
    (sum, bundle) => sum + bundleBytes(bundle),
    0,
  ) + Object.values(overlay.materials).reduce(
    (sum, field) => sum + fieldBytes(field),
    0,
  );
}

function hasMatchingContentDigest(inventory: BiomeAssetInventory, path: string): boolean {
  const expected = namedDigest(path);
  const actual = inventory.sha256ByAsset[path];
  return expected != null && typeof actual === "string" && actual.startsWith(expected);
}

function expectedBuildingFrames(theme: LandTheme): string[] {
  return Object.values(BUILDING_SPECS).flatMap((spec) => {
    const tiers = spec.type === "clubhouse" ? [1] as const : [1, 2, 3] as const;
    return tiers.map((tier) => buildingVisualFrame(
      { type: spec.type, tier, x: 0, y: 0 } as Building,
      theme,
    ));
  });
}

function expectedDecorationFrames(theme: LandTheme): string[] {
  const owner = getBiomeDefinition(theme).content.structures.decorations;
  return DECORATION_KINDS.map((kind) => DECORATION_SPECS[kind].visuals[owner].frame);
}

function expectedPropFrames(theme: LandTheme): string[] {
  const owner = getBiomeDefinition(theme).content.props.natural;
  return OBSTACLE_TYPES.flatMap((type) =>
    NATURAL_PROP_REGISTRY[owner][type].map((variant) => variant.frame));
}

function seasonalFrameMatchesFamily(
  biome: LandTheme,
  family: AtlasSeasonalFrameFamily,
  frame: string,
): boolean {
  if (!frame.startsWith(`${biome}_`)) return false;
  if (family === "natural-props") {
    return new RegExp(`^${biome}_(?:tree|bush|rock)_`, "u").test(frame);
  }
  if (family === "buildings") return expectedBuildingFrames(biome).includes(frame);
  if (family === "decorations") return expectedDecorationFrames(biome).includes(frame);
  if (family === "terrain-details") return true;
  return frame.startsWith(`${biome}_${family}_`);
}

function pushRequired(
  findings: BiomeAuditFinding[],
  condition: boolean,
  biome: LandTheme,
  quality: AtlasQuality | undefined,
  asset: string,
  detail: string,
): void {
  if (!condition) findings.push({ category: "required", biome, quality, asset, detail });
}

export function auditBiomeAuthoring(input: {
  manifest: AtlasManifest;
  inventory: BiomeAssetInventory;
  payloadBudgetBytes?: number;
  residencyBudgetBytes?: number;
  fixtures?: readonly BiomeReferenceFixture[];
  seasonalContract?: unknown;
}): BiomeAuthoringAuditReport {
  const budgetBytes = input.payloadBudgetBytes ?? BIOME_SELECTED_PAYLOAD_BUDGET_BYTES;
  const residencyBudgetBytes = input.residencyBudgetBytes
    ?? BIOME_CUMULATIVE_RESIDENCY_BUDGET_BYTES;
  const fixtures = input.fixtures ?? BIOME_KEYS.map(createBiomeReferenceFixture);
  const findings: BiomeAuditFinding[] = [];
  const payloads: BiomePayloadTierReport[] = [];
  const coverage: BiomeCoverageReport[] = [];
  const seasonalErrors = auditSeasonalCoverageContract(
    input.seasonalContract ?? SEASONAL_COVERAGE_CONTRACT,
  );
  for (const error of seasonalErrors) {
    const biome = BIOME_KEYS.find((candidate) => error.startsWith(`${candidate}`))
      ?? BIOME_KEYS[0];
    findings.push({
      category: "seasonal-contract",
      biome,
      asset: "seasonal-coverage",
      detail: error,
    });
  }
  const seasonalContract: SeasonalContractAuditReport = {
    pass: seasonalErrors.length === 0,
    totalCells: BIOME_KEYS.length
      * CLIMATE_CALENDAR_SEASONS.length
      * SEASONAL_VISUAL_FAMILIES.length,
    errors: seasonalErrors,
  };

  for (const biome of BIOME_KEYS) {
    const definition = getBiomeDefinition(biome);
    const fixture = fixtures.find((candidate) => candidate.biome === biome);
    pushRequired(findings, fixture != null, biome, undefined, "reference-fixture", "registered biome has no deterministic authoring fixture");
    if (!fixture) continue;

    const terrainCoverage = [...new Set(fixture.course.tiles)];
    const propCoverage = [...new Set(fixture.course.obstacles.map((obstacle) => obstacle.type))];
    const structureCoverage = [...new Set(fixture.course.buildings.map((building) => building.type))];
    const decorationCoverage = [...new Set((fixture.course.decorations ?? []).map((item) => item.kind))];
    const climateCoverage = fixture.climateStates.map((state) => state.calendarSeason);
    const audioCoverage = [definition.content.audio.designMusic, definition.content.audio.ambience];
    const cameraCoverage = fixture.bookmarks.map((bookmark) => bookmark.id);
    coverage.push({
      biome,
      terrain: terrainCoverage,
      props: propCoverage,
      structures: structureCoverage,
      decorations: decorationCoverage,
      climateStates: climateCoverage,
      audioContexts: audioCoverage,
      cameraBookmarks: cameraCoverage,
    });

    pushRequired(findings, TERRAIN_KINDS.every((terrain) => terrainCoverage.includes(terrain)), biome, undefined, "fixture.terrain", "fixture does not exercise every terrain");
    pushRequired(findings, OBSTACLE_TYPES.every((type) => propCoverage.includes(type)), biome, undefined, "fixture.props", "fixture does not exercise every natural prop family");
    pushRequired(findings, (Object.keys(BUILDING_SPECS) as Array<keyof typeof BUILDING_SPECS>).every((type) => structureCoverage.includes(type)), biome, undefined, "fixture.structures", "fixture does not exercise every structure");
    pushRequired(findings, DECORATION_KINDS.every((kind) => decorationCoverage.includes(kind)), biome, undefined, "fixture.decorations", "fixture does not exercise every decoration");
    pushRequired(findings, CLIMATE_CALENDAR_SEASONS.every((season) => climateCoverage.includes(season)), biome, undefined, "fixture.climate", "fixture does not exercise every climate state");
    pushRequired(findings, fixture.bookmarks.length === BIOME_REFERENCE_VIEWS.length * BIOME_REFERENCE_ROTATIONS.length, biome, undefined, "fixture.camera", "fixture is missing a view/rotation camera bookmark");
    for (const view of BIOME_REFERENCE_VIEWS) for (const rotation of BIOME_REFERENCE_ROTATIONS) {
      pushRequired(findings, fixture.bookmarks.some((bookmark) => bookmark.view === view && bookmark.rotation === rotation), biome, undefined, `fixture.camera.${view}.r${rotation}`, "camera bookmark is missing");
    }

    const music = SUNO_MUSIC_PLAYLISTS[definition.content.audio.designMusic];
    const ambience = SUNO_AMBIENCE_PLAYLISTS[definition.content.audio.ambience];
    pushRequired(findings, music.length > 0, biome, undefined, `audio.${definition.content.audio.designMusic}`, "design music context has no authored assets");
    pushRequired(findings, ambience.length > 0, biome, undefined, `audio.${definition.content.audio.ambience}`, "ambience context has no authored assets");
    pushRequired(findings, [...music, ...ambience].every((asset) => asset.id && asset.issue && asset.sourceUrl && asset.src), biome, undefined, "audio.provenance", "audio asset provenance is incomplete");

    const fallback = definition.compatibility.fallbackBiome;
    const validFallback = BIOME_KEYS.includes(fallback as LandTheme);
    pushRequired(findings, validFallback, biome, undefined, "compatibility.fallbackBiome", `fallback "${fallback}" is not a registered biome`);
    pushRequired(findings, fallback === biome, biome, undefined, "compatibility.fallbackBiome", `fallback "${fallback}" crosses biome ownership`);
    findings.push({
      category: "fallback",
      biome,
      asset: "compatibility.fallbackBiome",
      detail: validFallback
        ? `${biome} explicitly falls back to ${fallback} when optional presentation content is unavailable`
        : `${biome} names invalid fallback ${fallback}`,
    });

    for (const quality of ATLAS_QUALITIES) {
      const tier = input.manifest.biomes[biome]?.[quality];
      pushRequired(findings, tier != null, biome, quality, "atlas-tier", "registered biome has no quality tier");
      if (!tier) continue;
      const base = tier.base;
      const buildings = atlasFrames(input.inventory, base.buildings);
      const terrain = atlasFrames(input.inventory, base.terrain);
      const props = atlasFrames(input.inventory, base.props);
      pushRequired(findings, buildings.length > 0, biome, quality, "base.buildings", "building/decor atlas is missing or unreadable");
      pushRequired(findings, terrain.length > 0, biome, quality, "base.terrain", "terrain atlas is missing or unreadable");
      for (const frame of [...expectedBuildingFrames(biome), ...expectedDecorationFrames(biome)]) {
        pushRequired(findings, buildings.includes(frame), biome, quality, `frame.${frame}`, "required structure/decor frame is absent");
      }
      for (const terrainKind of TERRAIN_KINDS) {
        pushRequired(findings, terrain.some((frame) => frame.startsWith(`${definition.content.materials.terrain}_${terrainKind}_`)), biome, quality, `terrain.${terrainKind}`, "required terrain sprite family is absent");
      }

      if (quality === "low") {
        for (const prohibited of [
          ["base.details", base.details == null],
          ["base.props", base.props == null],
          ["base.fields", Object.keys(base.fields).length === 0],
        ] as const) {
          pushRequired(
            findings,
            prohibited[1],
            biome,
            quality,
            `low-policy.${prohibited[0]}`,
            `${prohibited[0]} must be omitted by the Low quality policy`,
          );
          findings.push({
            category: "optional",
            biome,
            quality,
            asset: prohibited[0],
            detail: prohibited[1]
              ? "intentionally omitted by the Low quality policy"
              : "prohibited expensive Low-quality content is present",
          });
        }
        pushRequired(
          findings,
          Object.keys(tier.seasonal).length === 0,
          biome,
          quality,
          "low-policy.seasonal",
          "seasonal overlays must be omitted by the Low quality policy",
        );
      } else {
        pushRequired(findings, base.details != null && atlasFrames(input.inventory, base.details).length > 0, biome, quality, "base.details", "detail atlas is required at Medium/High");
        pushRequired(findings, base.props != null && props.length > 0, biome, quality, "base.props", "natural-prop atlas is required at Medium/High");
        for (const frame of expectedPropFrames(biome)) {
          pushRequired(findings, props.includes(frame), biome, quality, `frame.${frame}`, "required natural-prop frame is absent");
        }
        for (const terrainKind of TERRAIN_KINDS) {
          pushRequired(findings, base.fields[terrainKind] != null, biome, quality, `field.${terrainKind}`, "material field is required at Medium/High");
        }
      }

      for (const [seasonName, overlay] of Object.entries(tier.seasonal)) {
        if (!overlay) continue;
        const supportedSeason = CLIMATE_CALENDAR_SEASONS.includes(
          seasonName as (typeof CLIMATE_CALENDAR_SEASONS)[number],
        );
        pushRequired(findings, supportedSeason, biome, quality, `seasonal.${seasonName}.season`, "overlay uses an unsupported calendar season");
        pushRequired(findings, overlay.owner === biome, biome, quality, `seasonal.${seasonName}.owner`, "seasonal overlay must have same-biome ownership");
        pushRequired(findings, overlay.season === seasonName, biome, quality, `seasonal.${seasonName}.identity`, "seasonal overlay identity does not match its manifest key");
        for (const [familyName, bundle] of Object.entries(overlay.frames)) {
          const family = familyName as AtlasSeasonalFrameFamily;
          const knownFamily = ATLAS_SEASONAL_FRAME_FAMILIES.includes(family);
          pushRequired(findings, knownFamily, biome, quality, `seasonal.${seasonName}.frames.${familyName}`, "overlay uses an unknown typed frame family");
          if (!knownFamily || !bundle) continue;
          const frames = atlasFrames(input.inventory, bundle);
          pushRequired(findings, frames.length > 0, biome, quality, `seasonal.${seasonName}.frames.${family}`, "seasonal frame bundle is missing or unreadable");
          for (const frame of frames) {
            pushRequired(
              findings,
              seasonalFrameMatchesFamily(biome, family, frame),
              biome,
              quality,
              `seasonal.${seasonName}.frames.${family}.${frame}`,
              "seasonal frame does not match its typed same-biome family",
            );
          }
        }
      }

      for (const path of [
        ...allBundlePaths(base),
        ...Object.values(tier.seasonal).flatMap(overlayPaths),
      ]) {
        pushRequired(
          findings,
          hasMatchingContentDigest(input.inventory, path),
          biome,
          quality,
          `provenance.${path}`,
          "referenced asset bytes do not match the SHA-256 prefix in its content-addressed URL",
        );
      }
      for (const season of CLIMATE_CALENDAR_SEASONS) {
        if (!tier.seasonal[season]) {
          findings.push({
            category: "seasonal-enrichment",
            biome,
            quality,
            asset: `seasonal.${season}`,
            detail: quality === "low" ? "seasonal overlay intentionally forbidden at Low quality" : "base-only fallback; authored overlay is optional",
          });
        }
      }

      const basePayloadBytes = bundleBytes(input.manifest.core.golfers) + baseBytes(base);
      const overlaySizes = Object.values(tier.seasonal).map(overlayBytes);
      const overlayPeak = Math.max(0, ...overlaySizes);
      const bytes = basePayloadBytes + overlayPeak;
      const cumulativeResidencyBytes = basePayloadBytes
        + overlaySizes.reduce((sum, size) => sum + size, 0);
      const status = bytes > budgetBytes ? "over-budget" : "within-budget";
      const overByBytes = Math.max(0, bytes - budgetBytes);
      const residencyStatus = cumulativeResidencyBytes > residencyBudgetBytes
        ? "over-budget"
        : "within-budget";
      const residencyOverByBytes = Math.max(
        0,
        cumulativeResidencyBytes - residencyBudgetBytes,
      );
      payloads.push({
        biome,
        quality,
        bytes,
        budgetBytes,
        status,
        overByBytes,
        baseBytes: basePayloadBytes,
        largestOverlayBytes: overlayPeak,
        cumulativeResidencyBytes,
        residencyBudgetBytes,
        residencyStatus,
        residencyOverByBytes,
      });
      if (status === "over-budget") {
        findings.push({
          category: "over-budget",
          biome,
          quality,
          asset: "selected-payload",
          detail: `${bytes} bytes exceeds ${budgetBytes} byte budget by ${overByBytes} byte${overByBytes === 1 ? "" : "s"}`,
        });
      }
      if (residencyStatus === "over-budget") {
        findings.push({
          category: "over-budget",
          biome,
          quality,
          asset: "cumulative-residency",
          detail: `${cumulativeResidencyBytes} bytes exceeds ${residencyBudgetBytes} byte residency budget by ${residencyOverByBytes} byte${residencyOverByBytes === 1 ? "" : "s"}`,
        });
      }
    }
  }

  pushRequired(findings, input.manifest.generatedBy === "scripts/build-atlas.mjs", BIOME_KEYS[0], undefined, "manifest.provenance", "manifest generator provenance is missing or unexpected");
  for (const path of [input.manifest.core.golfers.json, input.manifest.core.golfers.image]) {
    pushRequired(
      findings,
      hasMatchingContentDigest(input.inventory, path),
      BIOME_KEYS[0],
      undefined,
      `provenance.${path}`,
      "core asset bytes do not match the SHA-256 prefix in its content-addressed URL",
    );
  }
  const counts = {
    required: findings.filter((finding) => finding.category === "required").length,
    "seasonal-contract": findings.filter((finding) => finding.category === "seasonal-contract").length,
    "seasonal-enrichment": findings.filter((finding) => finding.category === "seasonal-enrichment").length,
    optional: findings.filter((finding) => finding.category === "optional").length,
    fallback: findings.filter((finding) => finding.category === "fallback").length,
    "over-budget": findings.filter((finding) => finding.category === "over-budget").length,
  };
  return {
    version: BIOME_AUTHORING_REPORT_VERSION,
    registryBiomes: BIOME_KEYS,
    pass: counts.required === 0
      && counts["seasonal-contract"] === 0
      && counts["over-budget"] === 0,
    coverage,
    seasonalContract,
    payloads,
    findings,
    counts,
  };
}
