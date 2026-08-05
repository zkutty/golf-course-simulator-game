import { canonicalJson } from "../../utils/canonical";
import { terrainCostMult } from "../balance/difficulty";
import { isOwnedTile } from "../estate/estate";
import { buildingTiles } from "../models/buildings";
import { canPlaceDecoration, decorationCost, decorationTiles } from "../models/decorations";
import { ELEVATION_MAX, ELEVATION_MIN } from "../models/elevation";
import {
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
  resolvedObstaclePlantId,
} from "../models/plantRegistry";
import {
  computeElevationChangeCost,
  computeTerrainChangeBreakdown,
} from "../models/terrainEconomics";
import type {
  Course,
  Decoration,
  DecorationRotation,
  Hole,
  Obstacle,
  Point,
  World,
} from "../models/types";
import { isTerrainUnlocked } from "../progression/progression";
import { sha256Hex, validateHoleTemplateV1 } from "./serialization";
import {
  HOLE_TEMPLATE_PLAN_VERSION,
  type HoleTemplatePlacement,
  type HoleTemplatePlacementBlocker,
  type HoleTemplatePlacementPlanV1,
  type HoleTemplatePlacementPlanningResult,
  type HoleTemplateQuoteV1,
  type HoleTemplateRotation,
  type HoleTemplateTargetVersions,
  type HoleTemplateV1,
  type ResolvedHoleTemplatePlacement,
} from "./types";

const MAX_HOLES = 36;
const SCALE_TOLERANCE = 0.001;
const HOLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,95}$/;

export interface PlanHoleTemplatePlacementInput {
  course: Course;
  world: World;
  template: unknown;
  placement: HoleTemplatePlacement;
  targetVersions: HoleTemplateTargetVersions;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function pointOrder(a: Point, b: Point): number {
  return a.y - b.y || a.x - b.x;
}

function uniqueSortedPoints(points: readonly Point[]): Point[] {
  const values = new Map<string, Point>();
  for (const point of points) values.set(pointKey(point), { x: point.x, y: point.y });
  return [...values.values()].sort(pointOrder);
}

function money(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function inCourse(course: Course, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}

function allHolePoints(hole: Pick<Hole, "tee" | "green" | "teeBoxes" | "pinPositions" | "waypoints">): Point[] {
  return [
    hole.tee,
    hole.green,
    ...Object.values(hole.teeBoxes ?? {}),
    ...Object.values(hole.pinPositions ?? {}),
    ...(hole.waypoints ?? []),
  ].filter((point): point is Point => !!point);
}

function rejectionBlocker(
  code: HoleTemplatePlacementBlocker["code"],
  message: string,
  action: string,
  path?: string,
): HoleTemplatePlacementBlocker {
  return { code, message, action, ...(path ? { path } : {}) };
}

function addBlocker(
  blockers: HoleTemplatePlacementBlocker[],
  blocker: HoleTemplatePlacementBlocker,
): void {
  const existing = blockers.find((value) => value.code === blocker.code && value.path === blocker.path);
  if (!existing) {
    blockers.push({ ...blocker, ...(blocker.points ? { points: uniqueSortedPoints(blocker.points) } : {}) });
    return;
  }
  if (blocker.points?.length) existing.points = uniqueSortedPoints([...(existing.points ?? []), ...blocker.points]);
}

function validateCourse(course: Course, world: World): HoleTemplatePlacementBlocker[] {
  const blockers: HoleTemplatePlacementBlocker[] = [];
  const dimensionsValid = Number.isInteger(course.width) && Number.isInteger(course.height) && course.width > 0 && course.height > 0;
  if (!dimensionsValid || !Array.isArray(course.tiles) || !Array.isArray(course.elevations) || course.tiles.length !== course.width * course.height || course.elevations.length !== course.width * course.height) {
    blockers.push(rejectionBlocker("invalid_course", "The target course grid is not a complete row-major terrain and elevation snapshot.", "Normalize or reload the target course before planning.", "course"));
  }
  if (!Number.isFinite(course.yardsPerTile) || course.yardsPerTile <= 0 || !Array.isArray(course.holes) || !Array.isArray(course.obstacles) || !Array.isArray(course.buildings)) {
    blockers.push(rejectionBlocker("invalid_course", "The target course metadata is incomplete.", "Normalize or reload the target course before planning.", "course"));
  }
  if (!Number.isFinite(world.cash) || !Number.isFinite(world.reputation)) {
    blockers.push(rejectionBlocker("invalid_course", "The target economy snapshot is invalid.", "Reload the current world economy before planning.", "world"));
  }
  return blockers;
}

function validatePlacement(placement: HoleTemplatePlacement): HoleTemplatePlacementBlocker[] {
  const blockers: HoleTemplatePlacementBlocker[] = [];
  if (!placement || !placement.origin || !Number.isInteger(placement.origin.x) || !Number.isInteger(placement.origin.y)) {
    blockers.push(rejectionBlocker("invalid_placement", "Placement origin must contain integer tile coordinates.", "Choose a tile-aligned placement origin.", "placement.origin"));
  }
  if (placement.rotation !== 0 && placement.rotation !== 1 && placement.rotation !== 2 && placement.rotation !== 3) {
    blockers.push(rejectionBlocker("invalid_placement", "Placement rotation must be 0, 1, 2, or 3 quarter-turns.", "Choose a supported quarter-turn rotation.", "placement.rotation"));
  }
  if (placement.mirrorX !== undefined && typeof placement.mirrorX !== "boolean") {
    blockers.push(rejectionBlocker("invalid_placement", "Horizontal mirroring must be true or false.", "Choose whether to mirror the blueprint.", "placement.mirrorX"));
  }
  if (placement.elevationPolicy !== "template-relief" && placement.elevationPolicy !== "preserve-estate-relief") {
    blockers.push(rejectionBlocker("invalid_placement", "Select a supported elevation policy.", "Choose template-relief or preserve-estate-relief.", "placement.elevationPolicy"));
  }
  if (placement.baseElevation !== undefined && !Number.isInteger(placement.baseElevation)) {
    blockers.push(rejectionBlocker("invalid_placement", "Base elevation must be an integer step.", "Use an integer base elevation or omit it for automatic fitting.", "placement.baseElevation"));
  }
  if (placement.elevationPolicy === "preserve-estate-relief" && placement.baseElevation !== undefined) {
    blockers.push(rejectionBlocker("invalid_placement", "Preserve-estate-relief cannot also specify a base elevation.", "Remove baseElevation or choose template-relief.", "placement.baseElevation"));
  }
  if (typeof placement.holeId !== "string" || !HOLE_ID_PATTERN.test(placement.holeId)) {
    blockers.push(rejectionBlocker("invalid_placement", "The installed hole needs a portable 2–96 character identity.", "Choose a unique ID containing letters, numbers, dot, dash, or underscore.", "placement.holeId"));
  }
  if (placement.holeName !== undefined && (typeof placement.holeName !== "string" || placement.holeName.trim().length === 0 || placement.holeName.length > 160)) {
    blockers.push(rejectionBlocker("invalid_placement", "Hole name overrides must contain 1–160 characters.", "Enter a shorter hole name or remove the override.", "placement.holeName"));
  }
  return blockers;
}

function validateVersions(versions: HoleTemplateTargetVersions): HoleTemplatePlacementBlocker[] {
  const keys = ["terrainVersion", "obstaclesVersion", "markersVersion", "economyVersion"] as const;
  return keys.flatMap((key) => Number.isSafeInteger(versions?.[key]) && versions[key] >= 0
    ? []
    : [rejectionBlocker("invalid_target_versions", `${key} must be a non-negative safe integer.`, "Read a fresh GameState version snapshot before planning.", `targetVersions.${key}`)]);
}

export function transformedHoleTemplateSize(
  template: Pick<HoleTemplateV1, "width" | "height">,
  rotation: HoleTemplateRotation,
): { width: number; height: number } {
  return rotation % 2 === 0
    ? { width: template.width, height: template.height }
    : { width: template.height, height: template.width };
}

export function transformHoleTemplatePoint(
  point: Point,
  template: Pick<HoleTemplateV1, "width" | "height">,
  placement: Pick<HoleTemplatePlacement, "origin" | "rotation" | "mirrorX">,
): Point {
  const mirroredX = placement.mirrorX ? template.width - 1 - point.x : point.x;
  const local = placement.rotation === 0
    ? { x: mirroredX, y: point.y }
    : placement.rotation === 1
      ? { x: template.height - 1 - point.y, y: mirroredX }
      : placement.rotation === 2
        ? { x: template.width - 1 - mirroredX, y: template.height - 1 - point.y }
        : { x: point.y, y: template.width - 1 - mirroredX };
  return { x: placement.origin.x + local.x, y: placement.origin.y + local.y };
}

function transformDecorationRotation(
  rotation: DecorationRotation,
  placement: Pick<HoleTemplatePlacement, "rotation" | "mirrorX">,
): DecorationRotation {
  const vectors: Record<DecorationRotation, Point> = {
    0: { x: 1, y: 0 }, 1: { x: 0, y: 1 }, 2: { x: -1, y: 0 }, 3: { x: 0, y: -1 },
  };
  let vector = vectors[rotation];
  if (placement.mirrorX) vector = { x: -vector.x, y: vector.y };
  for (let step = 0; step < placement.rotation; step++) vector = { x: -vector.y, y: vector.x };
  return vector.x === 1 ? 0 : vector.y === 1 ? 1 : vector.x === -1 ? 2 : 3;
}

function transformHole(template: HoleTemplateV1, placement: ResolvedHoleTemplatePlacement): Hole {
  const transformMap = (values: Record<string, Point | null> | undefined) => values
    ? Object.fromEntries(Object.entries(values).map(([key, point]) => [key, point ? transformHoleTemplatePoint(point, template, placement) : null]))
    : undefined;
  return {
    id: placement.holeId,
    name: placement.holeName?.trim() || template.title,
    tee: transformHoleTemplatePoint(template.hole.tee, template, placement),
    green: transformHoleTemplatePoint(template.hole.green, template, placement),
    ...(template.hole.teeBoxes ? { teeBoxes: transformMap(template.hole.teeBoxes) } : {}),
    ...(template.hole.pinPositions ? { pinPositions: transformMap(template.hole.pinPositions) } : {}),
    ...(template.hole.waypoints ? { waypoints: template.hole.waypoints.map((point) => transformHoleTemplatePoint(point, template, placement)) } : {}),
    ...(template.hole.parByTee ? { parByTee: structuredClone(template.hole.parByTee) } : {}),
    parMode: template.hole.parMode,
    ...(template.hole.parManual !== undefined ? { parManual: template.hole.parManual } : {}),
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function buildQuote(values: Omit<HoleTemplateQuoteV1, "currency" | "precision" | "subtotal" | "total">): HoleTemplateQuoteV1 {
  const rounded = {
    terrainConstruction: money(values.terrainConstruction),
    terrainSalvageCredit: money(values.terrainSalvageCredit),
    earthwork: money(values.earthwork),
    siteClearing: money(values.siteClearing),
    naturalFeatureSalvageCredit: money(values.naturalFeatureSalvageCredit),
    naturalFeatures: money(values.naturalFeatures),
    decorations: money(values.decorations),
  };
  const subtotal = money(
    rounded.terrainConstruction - rounded.terrainSalvageCredit + rounded.earthwork
    + rounded.siteClearing - rounded.naturalFeatureSalvageCredit
    + rounded.naturalFeatures + rounded.decorations,
  );
  return { currency: "USD", precision: 2, ...rounded, subtotal, total: Math.max(0, subtotal) };
}

type HoleTemplatePlanIdentityMaterial = Pick<
  HoleTemplatePlacementPlanV1,
  "format" | "version" | "template" | "placement" | "transformedSize" | "targetVersions" | "quote" | "mutations"
>;

/** Canonical bytes covered by the documented SHA-256 plan identity. */
export function canonicalHoleTemplatePlanIdentityJson(plan: HoleTemplatePlanIdentityMaterial): string {
  return canonicalJson({
    format: plan.format,
    version: plan.version,
    template: plan.template,
    placement: plan.placement,
    transformedSize: plan.transformedSize,
    targetVersions: plan.targetVersions,
    quote: plan.quote,
    mutations: plan.mutations,
  });
}

/**
 * Pure fail-closed planner. It reads snapshots and returns proposed mutations;
 * it never mutates Course, World, GameState versions, or cash.
 */
export function planHoleTemplatePlacement(input: PlanHoleTemplatePlacementInput): HoleTemplatePlacementPlanningResult {
  const validation = validateHoleTemplateV1(input.template);
  if (!validation.ok) {
    return {
      status: "rejected",
      blockers: validation.issues.map((item) => rejectionBlocker(
        item.code === "unsupported_version" ? "unsupported_version" : "invalid_template",
        item.message,
        "Correct this field and validate the HoleTemplate V1 document again.",
        item.path,
      )),
    };
  }
  const rejection = [
    ...validateCourse(input.course, input.world),
    ...validatePlacement(input.placement),
    ...validateVersions(input.targetVersions),
  ];
  if (rejection.length > 0) return { status: "rejected", blockers: rejection };

  const { course, world } = input;
  const template = validation.value;
  const blockers: HoleTemplatePlacementBlocker[] = [];
  const warnings: string[] = [];
  if (!template.provenance.rightsAttested) addBlocker(blockers, rejectionBlocker("rights_attestation_required", "Rights to use the blueprint source have not been attested.", "Confirm you have the right to use the source before applying this plan.", "template.provenance.rightsAttested"));
  if (Math.abs(template.yardsPerTile - course.yardsPerTile) > SCALE_TOLERANCE) addBlocker(blockers, rejectionBlocker("scale_mismatch", `Template scale is ${template.yardsPerTile} yards per tile; the course uses ${course.yardsPerTile}.`, "Re-author the blueprint at the target course scale.", "template.yardsPerTile"));
  if (course.holes.length >= MAX_HOLES) addBlocker(blockers, rejectionBlocker("hole_capacity", `The estate already contains the maximum of ${MAX_HOLES} holes.`, "Remove an unused estate hole before applying this plan."));
  if (course.holes.some((hole) => hole.id === input.placement.holeId)) addBlocker(blockers, rejectionBlocker("duplicate_hole_id", `Hole identity "${input.placement.holeId}" is already in use.`, "Choose a unique installed hole ID.", "placement.holeId"));

  const transformedSize = transformedHoleTemplateSize(template, input.placement.rotation);
  const transformedCells = template.cells.map((source) => ({ source, target: transformHoleTemplatePoint(source, template, input.placement) }));
  const inBoundsCells = transformedCells.filter(({ target }) => inCourse(course, target));
  const transformedObstacles = template.obstacles.map((obstacle) => ({ source: obstacle, target: transformHoleTemplatePoint(obstacle, template, input.placement) }));
  const addDecorations: Decoration[] = template.decorations.map((decoration) => ({
    ...decoration,
    ...transformHoleTemplatePoint(decoration, template, input.placement),
    rotation: transformDecorationRotation(decoration.rotation, input.placement),
    origin: "player",
  }));

  const provisionalPlacement: ResolvedHoleTemplatePlacement = {
    origin: { ...input.placement.origin },
    rotation: input.placement.rotation,
    mirrorX: input.placement.mirrorX ?? false,
    elevationPolicy: input.placement.elevationPolicy,
    baseElevation: null,
    holeId: input.placement.holeId,
    ...(input.placement.holeName !== undefined ? { holeName: input.placement.holeName } : {}),
  };
  const addHole = transformHole(template, provisionalPlacement);
  const affectedPoints = uniqueSortedPoints([
    ...transformedCells.map(({ target }) => target),
    ...transformedObstacles.map(({ target }) => target),
    ...addDecorations.flatMap(decorationTiles),
    ...allHolePoints(addHole),
  ]);
  const outside = affectedPoints.filter((point) => !inCourse(course, point));
  if (outside.length > 0) addBlocker(blockers, { code: "out_of_bounds", message: "The transformed blueprint extends beyond the estate grid.", action: "Move or rotate the blueprint until every authored feature is inside the estate.", points: outside });
  const affectedInside = affectedPoints.filter((point) => inCourse(course, point));
  const unowned = affectedInside.filter((point) => !isOwnedTile(course, point.x, point.y));
  if (unowned.length > 0) addBlocker(blockers, { code: "unowned_land", message: "The blueprint uses land that the club does not own.", action: "Purchase every parcel beneath the transformed blueprint.", points: unowned });
  const locked = inBoundsCells.filter(({ source }) => !isTerrainUnlocked(source.terrain, world.reputation)).map(({ target }) => target);
  if (locked.length > 0) addBlocker(blockers, { code: "locked_terrain", message: "The template uses terrain that this club has not unlocked.", action: "Increase club reputation or replace the locked terrain in the blueprint.", points: locked });

  const automaticBase = median(inBoundsCells.map(({ source, target }) => course.elevations[target.y * course.width + target.x] - source.elevationOffset));
  const resolvedBase = input.placement.elevationPolicy === "template-relief"
    ? input.placement.baseElevation ?? automaticBase
    : null;
  const placement: ResolvedHoleTemplatePlacement = { ...provisionalPlacement, baseElevation: resolvedBase };
  const costMult = terrainCostMult(world.difficulty);
  let terrainConstruction = 0;
  let terrainSalvageCredit = 0;
  let earthwork = 0;
  const terrainMutations: HoleTemplatePlacementPlanV1["mutations"]["terrain"] = [];
  const elevationMutations: HoleTemplatePlacementPlanV1["mutations"]["elevations"] = [];
  const plannedCells = inBoundsCells.map(({ source, target }) => {
    const index = target.y * course.width + target.x;
    const beforeTerrain = course.tiles[index];
    const beforeElevation = course.elevations[index];
    const afterElevation = input.placement.elevationPolicy === "preserve-estate-relief"
      ? beforeElevation
      : resolvedBase! + source.elevationOffset;
    if (afterElevation < ELEVATION_MIN || afterElevation > ELEVATION_MAX) addBlocker(blockers, { code: "relief_out_of_range", message: "Template relief would exceed the supported estate elevation range.", action: "Choose a different base elevation or preserve the estate relief.", points: [target] });
    const terrainQuote = computeTerrainChangeBreakdown(beforeTerrain, source.terrain, costMult, course.theme);
    terrainConstruction += terrainQuote.gross;
    terrainSalvageCredit += terrainQuote.salvage;
    earthwork += computeElevationChangeCost(afterElevation - beforeElevation, costMult, course.theme).net;
    if (beforeTerrain !== source.terrain) terrainMutations.push({ ...target, index, before: beforeTerrain, after: source.terrain });
    if (beforeElevation !== afterElevation) elevationMutations.push({ ...target, index, before: beforeElevation, after: afterElevation });
    return { ...target, index, terrain: source.terrain, elevation: afterElevation };
  });

  const affectedKeys = new Set(affectedInside.map(pointKey));
  const buildingConflicts = course.buildings.flatMap(buildingTiles).filter((point) => affectedKeys.has(pointKey(point)));
  if (buildingConflicts.length > 0) addBlocker(blockers, { code: "building_conflict", message: "The blueprint overlaps an existing building.", action: "Move the placement or relocate the conflicting building.", points: buildingConflicts });
  const decorationConflicts = (course.decorations ?? []).flatMap(decorationTiles).filter((point) => affectedKeys.has(pointKey(point)));
  if (decorationConflicts.length > 0) addBlocker(blockers, { code: "decoration_conflict", message: "The blueprint overlaps existing course decoration.", action: "Move the placement or remove the conflicting decoration.", points: decorationConflicts });
  const holeConflicts = course.holes.flatMap(allHolePoints).filter((point) => affectedKeys.has(pointKey(point)));
  if (holeConflicts.length > 0) addBlocker(blockers, { code: "hole_conflict", message: "The blueprint overlaps an existing hole route or marker.", action: "Move the placement away from existing hole geometry.", points: holeConflicts });

  const removeObstacles = course.obstacles.filter((obstacle) => affectedKeys.has(pointKey(obstacle))).map((obstacle) => ({ ...obstacle })).sort(pointOrder);
  const protectedTrees = world.constraints?.protectedTrees ? removeObstacles.filter((obstacle) => obstacle.type === "tree") : [];
  if (protectedTrees.length > 0) addBlocker(blockers, { code: "protected_tree", message: "Protected trees cannot be cleared for this placement.", action: "Move the blueprint so protected trees remain untouched.", points: protectedTrees });
  let siteClearing = 0;
  let naturalFeatureSalvageCredit = 0;
  for (const obstacle of removeObstacles) {
    const quote = naturalFeatureRemovalQuote({ theme: course.theme, obstacle, costMult });
    siteClearing += quote.gross;
    naturalFeatureSalvageCredit += quote.salvage;
  }

  const addObstacles: Obstacle[] = transformedObstacles.map(({ source, target }) => {
    const plantId = source.type === "rock" ? undefined : resolvedObstaclePlantId(course.theme, source);
    return { ...target, type: source.type, origin: "player" as const, ...(plantId ? { plantId } : {}) };
  }).sort(pointOrder);
  let naturalFeatures = 0;
  const terrainAfter = new Map(plannedCells.map((cell) => [cell.index, cell.terrain] as const));
  for (const obstacle of addObstacles) {
    naturalFeatures += naturalFeatureInstallationQuote({ theme: course.theme, obstacleType: obstacle.type, plantId: obstacle.plantId, costMult }).gross;
    if (inCourse(course, obstacle)) {
      const terrain = terrainAfter.get(obstacle.y * course.width + obstacle.x) ?? course.tiles[obstacle.y * course.width + obstacle.x];
      if (terrain === "water" || terrain === "wetland") addBlocker(blockers, { code: "invalid_natural_feature", message: "An imported natural feature would be installed in water or wetland.", action: "Move that feature onto dry authored terrain.", points: [obstacle] });
    }
  }

  const cellsByIndex = new Map(plannedCells.map((cell) => [cell.index, cell] as const));
  let stagedCourse: Course = {
    ...course,
    tiles: course.tiles.map((terrain, index) => cellsByIndex.get(index)?.terrain ?? terrain),
    elevations: course.elevations.map((elevation, index) => cellsByIndex.get(index)?.elevation ?? elevation),
    obstacles: course.obstacles.filter((obstacle) => !affectedKeys.has(pointKey(obstacle))).concat(addObstacles),
    holes: [...course.holes, addHole],
    decorations: [...(course.decorations ?? [])],
  };
  let decorationBuild = 0;
  for (const decoration of addDecorations) {
    decorationBuild += decorationCost(decoration, course.theme, costMult);
    const validationResult = canPlaceDecoration(stagedCourse, decoration);
    if (!validationResult.ok) addBlocker(blockers, { code: "invalid_decoration", message: `Imported ${decoration.kind.replaceAll("_", " ")} cannot be placed: ${validationResult.reason}.`, action: "Adjust the decoration footprint or its authored terrain.", points: decorationTiles(decoration) });
    stagedCourse = { ...stagedCourse, decorations: [...(stagedCourse.decorations ?? []), decoration] };
  }

  const quote = buildQuote({ terrainConstruction, terrainSalvageCredit, earthwork, siteClearing, naturalFeatureSalvageCredit, naturalFeatures, decorations: decorationBuild });
  if (quote.total > world.cash) addBlocker(blockers, rejectionBlocker("insufficient_funds", `This build costs $${quote.total.toLocaleString()} and the club has $${money(world.cash).toLocaleString()}.`, "Increase available cash or reduce the blueprint build cost."));
  if (template.confidence.scale < 0.8) warnings.push("Scale confidence is low; verify tee-to-pin yardage before applying the plan.");
  if (template.confidence.terrain < 0.75) warnings.push("Some terrain boundaries have low confidence.");
  if (template.confidence.elevation < 0.65 && input.placement.elevationPolicy === "template-relief") warnings.push("Elevation confidence is low; consider preserving the estate relief.");
  if (template.provenance.redistribution === "private_only" || template.provenance.redistribution === "unknown") warnings.push("This blueprint is local-only and cannot be redistributed.");

  const hasTerrainMutation = terrainMutations.length > 0 || elevationMutations.length > 0;
  const hasObstacleMutation = removeObstacles.length > 0 || addObstacles.length > 0 || addDecorations.length > 0;
  const beforeVersions = { ...input.targetVersions };
  const afterVersions = {
    terrainVersion: beforeVersions.terrainVersion + (hasTerrainMutation ? 1 : 0),
    obstaclesVersion: beforeVersions.obstaclesVersion + (hasObstacleMutation ? 1 : 0),
    markersVersion: beforeVersions.markersVersion + 1,
    economyVersion: beforeVersions.economyVersion + 1,
  };
  const withoutIdentity: Omit<HoleTemplatePlacementPlanV1, "identity" | "blockers" | "warnings" | "canApply"> = {
    format: "coursecraft-hole-placement-plan",
    version: HOLE_TEMPLATE_PLAN_VERSION,
    template,
    placement,
    transformedSize,
    targetVersions: beforeVersions,
    quote,
    mutations: {
      terrain: terrainMutations.sort((a, b) => a.index - b.index),
      elevations: elevationMutations.sort((a, b) => a.index - b.index),
      removeObstacles,
      addObstacles,
      addDecorations: addDecorations.map((decoration) => ({ ...decoration })),
      addHole,
      cashDelta: money(-quote.total),
      versions: { before: beforeVersions, after: afterVersions },
    },
  };
  const identity = { algorithm: "SHA-256" as const, value: sha256Hex(canonicalHoleTemplatePlanIdentityJson(withoutIdentity)) };
  return {
    status: "planned",
    plan: {
      ...withoutIdentity,
      identity,
      blockers,
      warnings,
      canApply: blockers.length === 0,
    },
  };
}

/** Positional convenience for preview callers; target versions remain mandatory. */
export function previewHoleTemplatePlacement(
  course: Course,
  world: World,
  template: unknown,
  placement: HoleTemplatePlacement,
  targetVersions: HoleTemplateTargetVersions,
): HoleTemplatePlacementPlanningResult {
  return planHoleTemplatePlacement({ course, world, template, placement, targetVersions });
}
