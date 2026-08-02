import type { Course, Hole, PinRotation, Point } from "../models/types";
import type { PlayerRoundCourseSnapshot, PlayerProSkills } from "../models/playerProTypes";
import { createGreenRoundSnapshot } from "./greenSurface";
import { estimateAutomaticPutts } from "./greenPutting";
import { sampleGreenRolloutSurface } from "./greenRollout";

export type PinFairnessCohort = "scratch" | "bogey" | "casual";
export type PinFairnessWarningCode =
  | "EXCESSIVE_LOCAL_SLOPE"
  | "EDGE_PROXIMITY"
  | "SEVERE_FALL_LINE"
  | "TIER_ACCESS"
  | "ROLL_OFF_EXPOSURE";

export interface PinFairnessWarning {
  code: PinFairnessWarningCode;
  severity: number;
  message: string;
}

export interface PinCohortConsequence {
  expectedPutts: number;
  scoreDelta: number;
  paceMinutesDelta: number;
  satisfactionDelta: number;
  complaintRisk: number;
}

export interface PinFairnessAnalysis {
  legal: boolean;
  blockingReasons: string[];
  warnings: PinFairnessWarning[];
  localSlope: number;
  edgeClearanceTiles: number;
  fallLineDrop: number;
  tierAccess: number;
  rollOffExposure: number;
  difficulty: number;
  tournamentReadiness: number;
  cohorts: Record<PinFairnessCohort, PinCohortConsequence>;
}

export interface PinRotationFairness {
  rotation: PinRotation;
  configuredHoles: number;
  legalHoles: number;
  difficulty: number;
  tournamentReadiness: number;
  paceMinutesDelta: number;
  satisfactionDelta: number;
  complaintRisk: number;
  warnings: Array<{ holeId: string; holeName: string; warning: PinFairnessWarning }>;
  cohorts: Record<PinFairnessCohort, PinCohortConsequence>;
}

const COHORT_SKILLS: Readonly<Record<PinFairnessCohort, Pick<PlayerProSkills, "putting" | "shortGame">>> = Object.freeze({
  scratch: Object.freeze({ putting: 82, shortGame: 76 }),
  bogey: Object.freeze({ putting: 56, shortGame: 52 }),
  casual: Object.freeze({ putting: 36, shortGame: 42 }),
});

const COHORT_BASELINES: Readonly<Record<PinFairnessCohort, number>> = Object.freeze({
  scratch: 1.45,
  bogey: 1.45,
  casual: 1.45,
});

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const round = (value: number, places = 3) => Number(value.toFixed(places));

function inBounds(course: Pick<Course, "width" | "height">, point: Point): boolean {
  return Number.isInteger(point.x)
    && Number.isInteger(point.y)
    && point.x >= 0
    && point.y >= 0
    && point.x < course.width
    && point.y < course.height;
}

/**
 * The physical gate is deliberately narrow. A whole authoritative green tile
 * provides the minimum cup footprint; demanding slope, tiers, edges, and fall
 * lines remain legal and are handled as warnings and consequences.
 */
export function pinPhysicalBlockers(course: Pick<Course, "width" | "height" | "tiles">, pin: Point | null): string[] {
  if (!pin) return [];
  if (!inBounds(course, pin)) return ["Cup is outside the playable course grid."];
  if (course.tiles[pin.y * course.width + pin.x] !== "green") {
    return ["Cup lacks the required usable green coverage and clearance."];
  }
  return [];
}

function terrainAt(course: Pick<Course, "width" | "height" | "tiles">, point: Point): string {
  if (point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) return "out_of_bounds";
  return String(course.tiles[Math.floor(point.y) * course.width + Math.floor(point.x)] ?? "out_of_bounds");
}

function heightAt(course: Course, point: Point): number {
  return sampleGreenRolloutSurface({
    width: course.width,
    height: course.height,
    tiles: course.tiles,
    elevations: course.elevations,
    holes: course.holes.map((candidate, index) => ({ id: candidate.id ?? `hole-${index + 1}`, green: candidate.green })),
    greenSurface: course.greenSurface,
    greenProgram: course.greenProgram,
    greenLocalState: course.greenLocalState,
  }, course.greenSurface, point).height;
}

function snapshotForPin(course: Course, hole: Hole, pin: Point): PlayerRoundCourseSnapshot {
  const holeId = hole.id ?? `hole-${Math.max(0, course.holes.indexOf(hole)) + 1}`;
  return {
    courseId: course.activeCourseId ?? "course-primary",
    courseName: course.name ?? "Course",
    theme: course.theme ?? "parkland",
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile,
    tiles: course.tiles.slice(),
    elevations: course.elevations.slice(),
    obstacles: [],
    holes: [{
      id: holeId,
      name: hole.name ?? holeId,
      par: hole.parMode === "MANUAL" ? hole.parManual ?? 4 : 4,
      tee: hole.tee ?? pin,
      pin,
      waypoints: hole.waypoints?.map((point) => ({ ...point })) ?? [],
    }],
    greenSnapshot: createGreenRoundSnapshot(course),
  };
}

function edgeClearance(course: Course, pin: Point): number {
  let nearest = 4.25;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (dx === 0 && dy === 0) continue;
    const distance = Math.hypot(dx, dy);
    if (distance >= nearest) continue;
    const x = pin.x + dx;
    const y = pin.y + dy;
    if (x < 0 || y < 0 || x >= course.width || y >= course.height || course.tiles[y * course.width + x] !== "green") nearest = distance;
  }
  return nearest;
}

function averageConsequences(rows: readonly PinCohortConsequence[]): PinCohortConsequence {
  const average = (key: keyof PinCohortConsequence) => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
  return {
    expectedPutts: round(average("expectedPutts"), 2),
    scoreDelta: round(average("scoreDelta"), 2),
    paceMinutesDelta: round(average("paceMinutesDelta"), 2),
    satisfactionDelta: round(average("satisfactionDelta"), 1),
    complaintRisk: round(average("complaintRisk"), 3),
  };
}

export function analyzePinFairness(course: Course, hole: Hole, pin: Point | null, rotation: PinRotation = "A"): PinFairnessAnalysis {
  const blockingReasons = pinPhysicalBlockers(course, pin);
  const emptyCohorts = Object.fromEntries((Object.keys(COHORT_SKILLS) as PinFairnessCohort[]).map((cohort) => [cohort, {
    expectedPutts: 2,
    scoreDelta: 0,
    paceMinutesDelta: 0,
    satisfactionDelta: 0,
    complaintRisk: 0,
  }])) as Record<PinFairnessCohort, PinCohortConsequence>;
  if (!pin || blockingReasons.length > 0) return {
    legal: false,
    blockingReasons,
    warnings: [],
    localSlope: 0,
    edgeClearanceTiles: 0,
    fallLineDrop: 0,
    tierAccess: 0,
    rollOffExposure: 0,
    difficulty: 1,
    tournamentReadiness: 0,
    cohorts: emptyCohorts,
  };

  const sample = sampleGreenRolloutSurface({
    width: course.width,
    height: course.height,
    tiles: course.tiles,
    elevations: course.elevations,
    holes: course.holes.map((candidate, index) => ({ id: candidate.id ?? `hole-${index + 1}`, green: candidate.green })),
    greenSurface: course.greenSurface,
    greenProgram: course.greenProgram,
    greenLocalState: course.greenLocalState,
  }, course.greenSurface, pin);
  const localSlope = Math.hypot(sample.gradient.x, sample.gradient.y);
  const direction = localSlope > .001
    ? { x: -sample.gradient.x / localSlope, y: -sample.gradient.y / localSlope }
    : { x: 1, y: 0 };
  let lowest = sample.height;
  let tierAccess = 0;
  let rollOffExposure = 0;
  for (const distance of [.5, 1, 1.5, 2, 2.5]) {
    const down = { x: pin.x + direction.x * distance, y: pin.y + direction.y * distance };
    const up = { x: pin.x - direction.x * distance, y: pin.y - direction.y * distance };
    if (terrainAt(course, down) === "green") lowest = Math.min(lowest, heightAt(course, down));
    else if (distance <= 2.5) rollOffExposure = Math.max(rollOffExposure, clamp((3 - distance) / 2.5));
    for (const point of [down, up]) {
      if (terrainAt(course, point) === "green") tierAccess = Math.max(tierAccess, Math.abs(heightAt(course, point) - sample.height));
    }
  }
  const fallLineDrop = Math.max(0, sample.height - lowest);
  const edgeClearanceTiles = edgeClearance(course, pin);
  const edgeRisk = clamp((2.25 - edgeClearanceTiles) / 1.75);
  rollOffExposure = clamp(rollOffExposure * clamp(fallLineDrop / .8 + localSlope / 1.6));

  const snapshot = snapshotForPin(course, hole, pin);
  const leaveTiles = 6 / Math.max(1, course.yardsPerTile);
  const rest = { x: pin.x - direction.x * leaveTiles, y: pin.y - direction.y * leaveTiles };
  const expected = Object.fromEntries((Object.keys(COHORT_SKILLS) as PinFairnessCohort[]).map((cohort) => {
    const estimate = estimateAutomaticPutts({
      snapshot,
      holeId: snapshot.holes[0].id,
      rest,
      skills: COHORT_SKILLS[cohort],
    });
    return [cohort, estimate.expectedPutts] as const;
  })) as Record<PinFairnessCohort, number>;
  const difficulty = clamp(
    localSlope * .32
    + fallLineDrop * .18
    + tierAccess * .12
    + edgeRisk * .16
    + rollOffExposure * .22
    + clamp((expected.casual - COHORT_BASELINES.casual) / .9) * .25,
  );
  const warningLabel = `Pin ${rotation}`;
  const warnings: PinFairnessWarning[] = [];
  if (localSlope > .72) warnings.push({ code: "EXCESSIVE_LOCAL_SLOPE", severity: clamp((localSlope - .55) / 1.15), message: `${warningLabel}: excessive local slope raises automatic-putt difficulty for every cohort.` });
  if (edgeClearanceTiles < 1.75) warnings.push({ code: "EDGE_PROXIMITY", severity: edgeRisk, message: `${warningLabel}: only ${edgeClearanceTiles.toFixed(1)} tiles of edge clearance; misses are less recoverable.` });
  if (fallLineDrop > .45) warnings.push({ code: "SEVERE_FALL_LINE", severity: clamp((fallLineDrop - .3) / 1.2), message: `${warningLabel}: severe fall line drops ${fallLineDrop.toFixed(2)} elevation units from the cup.` });
  if (tierAccess > 1.05) warnings.push({ code: "TIER_ACCESS", severity: clamp((tierAccess - .8) / 1.6), message: `${warningLabel}: tier access changes ${tierAccess.toFixed(2)} elevation units around the cup.` });
  if (rollOffExposure > .28) warnings.push({ code: "ROLL_OFF_EXPOSURE", severity: rollOffExposure, message: `${warningLabel}: the downhill fall line exposes likely roll-off beyond the usable green.` });

  const cohorts = Object.fromEntries((Object.keys(COHORT_SKILLS) as PinFairnessCohort[]).map((cohort) => {
    const scoreDelta = Math.max(0, expected[cohort] - COHORT_BASELINES[cohort]);
    const skillSensitivity = cohort === "scratch" ? .7 : cohort === "bogey" ? .9 : 1.08;
    const fairnessSensitivity = cohort === "scratch" ? 1 : cohort === "bogey" ? .82 : .62;
    return [cohort, {
      expectedPutts: round(expected[cohort], 2),
      scoreDelta: round(scoreDelta, 2),
      paceMinutesDelta: round(scoreDelta * .72 + difficulty * (cohort === "casual" ? .28 : .18), 2),
      satisfactionDelta: round(-(scoreDelta * 5.5 * skillSensitivity + difficulty * 2.4 * fairnessSensitivity), 1),
      complaintRisk: round(clamp(scoreDelta * .26 * skillSensitivity + difficulty * .18 * fairnessSensitivity), 3),
    }] as const;
  })) as Record<PinFairnessCohort, PinCohortConsequence>;
  const tournamentReadiness = clamp(1 - difficulty * .52 - rollOffExposure * .22 - warnings.reduce((sum, warning) => sum + warning.severity, 0) * .045);
  return {
    legal: true,
    blockingReasons,
    warnings,
    localSlope: round(localSlope),
    edgeClearanceTiles: round(edgeClearanceTiles, 2),
    fallLineDrop: round(fallLineDrop),
    tierAccess: round(tierAccess),
    rollOffExposure: round(rollOffExposure),
    difficulty: round(difficulty),
    tournamentReadiness: round(tournamentReadiness),
    cohorts,
  };
}

export function analyzePinRotation(course: Course, rotation: PinRotation): PinRotationFairness {
  const analyses = course.holes.flatMap((hole, index) => {
    const pin = hole.pinPositions?.[rotation] ?? (rotation === "A" ? hole.green : null) ?? null;
    return pin ? [{ hole, holeId: hole.id ?? `hole-${index + 1}`, analysis: analyzePinFairness(course, hole, pin, rotation) }] : [];
  });
  const legal = analyses.filter((entry) => entry.analysis.legal);
  const average = (read: (analysis: PinFairnessAnalysis) => number) => legal.length
    ? legal.reduce((sum, entry) => sum + read(entry.analysis), 0) / legal.length
    : 0;
  const cohorts = Object.fromEntries((Object.keys(COHORT_SKILLS) as PinFairnessCohort[]).map((cohort) => [
    cohort,
    averageConsequences(legal.map((entry) => entry.analysis.cohorts[cohort])),
  ])) as Record<PinFairnessCohort, PinCohortConsequence>;
  return {
    rotation,
    configuredHoles: analyses.length,
    legalHoles: legal.length,
    difficulty: round(average((analysis) => analysis.difficulty)),
    tournamentReadiness: round(average((analysis) => analysis.tournamentReadiness)),
    paceMinutesDelta: round(average((analysis) => analysis.cohorts.casual.paceMinutesDelta), 2),
    satisfactionDelta: round(average((analysis) => analysis.cohorts.casual.satisfactionDelta), 1),
    complaintRisk: round(average((analysis) => analysis.cohorts.casual.complaintRisk)),
    warnings: legal.flatMap((entry) => entry.analysis.warnings.map((warning) => ({
      holeId: entry.holeId,
      holeName: entry.hole.name ?? entry.holeId,
      warning,
    }))),
    cohorts,
  };
}
