import type { Course, Point, World } from "../models/types";
import { isOwnedTile } from "../estate/estate";
import { hashCanonicalValue } from "../../utils/canonical";
import {
  canonicalInvitedPreviewEvidenceId,
  createInvitedPreviewEvidence,
  normalizeInvitedPreviewEvidence,
  type InvitedPreviewEvidence,
  type InvitedPreviewShotEvidence,
} from "./invitedPreview";

/** Optional, separately versioned presentation state. Never a reward authority. */
export interface OpeningDemo {
  version: 1;
  cursor: number;
  candidate: InvitedPreviewEvidence | null;
  /** Eligible rough cells beside an actual recorded landing/next lie. */
  targetCells: number[];
  /** Frozen, non-geometry authority shared by the first visit and retest. */
  context?: OpeningFrozenContext;
  diagnosis?: OpeningDiagnosis;
  /** Cash immediately before the bounded redesign step. */
  editBaselineCash?: number;
  /** Actual committed terrain spend observed at retest. */
  editCost?: number;
  comparison?: OpeningComparison;
}

export interface OpeningShotMarker {
  previewId: string;
  golferId: string;
  golferName: string;
  shotId: string;
  shot: InvitedPreviewShotEvidence;
}

export interface OpeningFrozenContext {
  hash: string;
  previewId: string;
  runSeed: number;
  holeId: string;
  holeIndex: number;
  courseName: string;
  cohort: Array<{ id: string; name: string; archetype: string }>;
}

export type OpeningDiagnosis =
  | { kind: "supported"; previewId: string; golferId: string; golferName: string; shotId: string; regionId: string; anchor: Point; cells: number[] }
  | { kind: "none"; previewId: string; reason: "no-supported-region" };

export interface OpeningComparison {
  status: "positive" | "neutral" | "negative" | "no-meaningful-change" | "unsupported";
  baselinePreviewId: string;
  candidatePreviewId: string;
  contextHash: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  /** Null only for a legacy save that predates the committed-debit baseline. */
  terrainCost: number | null;
  measures: Array<{
    golferId: string;
    golferName: string;
    strokesBefore: number;
    strokesAfter: number;
    satisfactionBefore: number;
    satisfactionAfter: number;
    penaltiesBefore: number;
    penaltiesAfter: number;
    /**
     * Additive v1 presentation fields, derived only from retained resolved
     * shot receipts. They are absent on older saved comparisons: never infer
     * historical precision or treat them as a simulation/economy authority.
     */
    riskBefore?: number;
    riskAfter?: number;
    riskyLeavesBefore?: number;
    riskyLeavesAfter?: number;
  }>;
}

export interface OpeningPlaybackFrame extends OpeningShotMarker {
  index: number;
  total: number;
  progress: number;
  golfer: Point;
  ball: Point | null;
  landing: Point;
  rest: Point;
  complete: boolean;
}

export function openingShotId(previewId: string, golferId: string, shot: InvitedPreviewShotEvidence): string {
  return shot.id ?? `${previewId}:legacy-shot:${golferId}:${shot.shotNumber}`;
}

/** A row-major terrain id carried from invitation through paint and render. */
export interface OpeningTargetTile extends Point {
  id: number;
}

export function openingShots(evidence: InvitedPreviewEvidence | null): OpeningShotMarker[] {
  return evidence?.group.flatMap((golfer) => golfer.shots.map((shot) => ({
    previewId: evidence.id,
    golferId: golfer.id,
    golferName: golfer.name,
    shotId: openingShotId(evidence.id, golfer.id, shot),
    shot,
  }))) ?? [];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const mix = (from: Point, to: Point, progress: number): Point => ({ x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress });

/** Pure presentation projection. It interpolates retained endpoints; it never resolves a shot. */
export function openingPlaybackFrame(evidence: InvitedPreviewEvidence | null, cursor: number, phase: number): OpeningPlaybackFrame | null {
  const shots = openingShots(evidence);
  if (!shots.length) return null;
  const complete = cursor >= shots.length;
  const index = Math.max(0, Math.min(shots.length - 1, Math.floor(cursor)));
  const marker = shots[index];
  const progress = complete ? 1 : clamp01(phase);
  const flightProgress = Math.min(1, progress / 0.72);
  const rolloutProgress = Math.max(0, (progress - 0.72) / 0.28);
  const ball = progress < 0.72
    ? mix(marker.shot.from, marker.shot.landing, flightProgress)
    : mix(marker.shot.landing, marker.shot.rest, rolloutProgress);
  return {
    ...marker, index, total: shots.length, progress,
    golfer: progress >= 1 ? { ...marker.shot.rest } : { ...marker.shot.from },
    ball,
    landing: { ...marker.shot.landing },
    rest: { ...marker.shot.rest },
    complete,
  };
}

/** Read-only display reconciliation for the authoritative resolved-shot receipt. */
export function openingPenaltyTotal(evidence: InvitedPreviewEvidence | null): number {
  return openingShots(evidence).reduce((total, { shot }) => total + shot.penaltyStrokes, 0);
}

export function newOpeningDemo(): OpeningDemo {
  return { version: 1, cursor: 0, candidate: null, targetCells: [] };
}

export function freezeOpeningContext(evidence: InvitedPreviewEvidence): OpeningFrozenContext {
  const body = {
    previewId: evidence.id,
    runSeed: evidence.runSeed,
    holeId: evidence.holeId,
    holeIndex: evidence.holeIndex,
    courseName: evidence.courseName,
    cohort: evidence.group.map(({ id, name, archetype }) => ({ id, name, archetype })),
  };
  return { ...body, hash: hashCanonicalValue(body) };
}

/** Prefer a difficult next lie; otherwise offer widening beside a recorded landing.
 * This is an opportunity, never a promise of a better score. Only rough is eligible.
 */
export function openingTargetCells(course: Course, evidence: InvitedPreviewEvidence): number[] {
  const diagnosis = diagnoseOpening(course, evidence);
  return diagnosis.kind === "supported" ? diagnosis.cells : [];
}

/** Names only an observed shot and a bounded rough region beside its retained endpoint. */
export function diagnoseOpening(course: Course, evidence: InvitedPreviewEvidence): OpeningDiagnosis {
  const shots = openingShots(evidence);
  const candidates = [
    ...shots.filter(({ shot }) => shot.lieAfter === "rough" || shot.lieAfter === "deep_rough").map((marker) => ({ marker, point: marker.shot.rest })),
    ...shots.map((marker) => ({ marker, point: marker.shot.landing })),
  ];
  for (const { marker, point } of candidates) {
    const cells: number[] = [];
    for (let y = Math.floor(point.y) - 1; y <= Math.floor(point.y) + 1; y++) {
      for (let x = Math.floor(point.x) - 1; x <= Math.floor(point.x) + 1; x++) {
        if (x < 0 || y < 0 || x >= course.width || y >= course.height || !isOwnedTile(course, x, y)) continue;
        const index = y * course.width + x;
        if (course.tiles[index] === "rough" || course.tiles[index] === "deep_rough") cells.push(index);
      }
    }
    if (cells.length) {
      // The suggested first tile must be the tile that owns the recorded next
      // lie, not merely the first row-major tile in its surrounding box.  The
      // old order could make a player buy an unrelated corner and see no
      // routed decision change.  Preserve a small, paintable widening region
      // after that center tile for a deliberate wider version.
      const center = Math.floor(point.y) * course.width + Math.floor(point.x);
      const bounded = cells.sort((a, b) => {
        if (a === center) return -1;
        if (b === center) return 1;
        const ax = a % course.width + .5;
        const ay = Math.floor(a / course.width) + .5;
        const bx = b % course.width + .5;
        const by = Math.floor(b / course.width) + .5;
        return (ax - point.x) ** 2 + (ay - point.y) ** 2 - ((bx - point.x) ** 2 + (by - point.y) ** 2) || a - b;
      }).slice(0, 4);
      return {
        kind: "supported",
        previewId: evidence.id,
        golferId: marker.golferId,
        golferName: marker.golferName,
        shotId: marker.shotId,
        regionId: `landing-region:${evidence.holeId}:${bounded.join("-")}`,
        anchor: { ...point },
        cells: bounded,
      };
    }
  }
  return { kind: "none", previewId: evidence.id, reason: "no-supported-region" };
}

export function openingTargetTiles(course: Course, opening?: OpeningDemo): OpeningTargetTile[] {
  return opening?.targetCells.map((id) => ({ id, x: id % course.width, y: Math.floor(id / course.width) })) ?? [];
}

export function hasOpeningEdit(course: Course, opening: OpeningDemo): boolean {
  return opening.targetCells.some((index) => course.tiles[index] === "fairway");
}

/** Same resolver and seeded capabilities as the first invitation. Names are identity
 * labels: the old preview draws them after play, so route changes can change them.
 * Retain the first group's labels without changing any shot or score.
 */
export function retestOpening(course: Course, world: World, baseline: InvitedPreviewEvidence): InvitedPreviewEvidence | null {
  if ((world.runSeed >>> 0) !== baseline.runSeed) return null;
  const result = createInvitedPreviewEvidence(course, { ...world, runSeed: baseline.runSeed });
  if (!result || result.holeId !== baseline.holeId || result.holeIndex !== baseline.holeIndex) return null;
  const { id: _id, ...candidate } = result;
  candidate.group = candidate.group.map((golfer, index) => ({ ...golfer, name: baseline.group[index]?.name ?? golfer.name }));
  return { ...candidate, id: canonicalInvitedPreviewEvidenceId(candidate) };
}

const penaltyTotal = (golfer: InvitedPreviewEvidence["group"][number]) => golfer.shots.reduce((total, shot) => total + shot.penaltyStrokes, 0);

/**
 * A read-only summary of the shared shot resolver's retained endpoints.  It
 * is intentionally derived from evidence rather than becoming an economics
 * or simulation authority: a risky leave is a non-green next lie and risk
 * adds the existing penalty receipt plus a bounded terrain severity.
 */
export function openingRiskLeave(golfer: InvitedPreviewEvidence["group"][number]): { risk: number; riskyLeaves: number } {
  return golfer.shots.reduce((measure, shot) => {
    const severity = shot.lieAfter === "deep_rough" ? 2
      : shot.lieAfter === "rough" || shot.lieAfter === "sand" || shot.lieAfter === "water" ? 1
        : 0;
    return {
      risk: measure.risk + shot.penaltyStrokes + severity,
      riskyLeaves: measure.riskyLeaves + Number(severity > 0),
    };
  }, { risk: 0, riskyLeaves: 0 });
}

export function compareOpening(
  baseline: InvitedPreviewEvidence,
  candidate: InvitedPreviewEvidence,
  context: OpeningFrozenContext,
  terrainCost: number | null,
): OpeningComparison {
  const candidateContext = freezeOpeningContext({ ...candidate, id: baseline.id });
  const contextMatches = candidate.runSeed === context.runSeed
    && candidate.holeId === context.holeId
    && candidate.holeIndex === context.holeIndex
    && candidate.courseName === context.courseName
    && candidateContext.hash === context.hash;
  const measures = baseline.group.map((before, index) => {
    const after = candidate.group[index] ?? before;
    const beforeRisk = openingRiskLeave(before);
    const afterRisk = openingRiskLeave(after);
    return {
      golferId: before.id,
      golferName: before.name,
      strokesBefore: before.strokes,
      strokesAfter: after.strokes,
      satisfactionBefore: before.satisfaction,
      satisfactionAfter: after.satisfaction,
      penaltiesBefore: penaltyTotal(before),
      penaltiesAfter: penaltyTotal(after),
      riskBefore: beforeRisk.risk,
      riskAfter: afterRisk.risk,
      riskyLeavesBefore: beforeRisk.riskyLeaves,
      riskyLeavesAfter: afterRisk.riskyLeaves,
    };
  });
  let status: OpeningComparison["status"] = "unsupported";
  if (contextMatches) {
    if (candidate.holeFingerprint === baseline.holeFingerprint) status = "no-meaningful-change";
    else {
      const improvements = measures.reduce((count, row) => count + Number(row.strokesAfter < row.strokesBefore) + Number(row.satisfactionAfter > row.satisfactionBefore) + Number(row.penaltiesAfter < row.penaltiesBefore) + Number(row.riskAfter < row.riskBefore) + Number(row.riskyLeavesAfter < row.riskyLeavesBefore), 0);
      const harms = measures.reduce((count, row) => count + Number(row.strokesAfter > row.strokesBefore) + Number(row.satisfactionAfter < row.satisfactionBefore) + Number(row.penaltiesAfter > row.penaltiesBefore) + Number(row.riskAfter > row.riskBefore) + Number(row.riskyLeavesAfter > row.riskyLeavesBefore), 0);
      status = improvements > harms ? "positive" : harms > improvements ? "negative" : "neutral";
    }
  }
  return {
    status,
    baselinePreviewId: baseline.id,
    candidatePreviewId: candidate.id,
    contextHash: context.hash,
    beforeFingerprint: baseline.holeFingerprint,
    afterFingerprint: candidate.holeFingerprint,
    terrainCost: terrainCost == null ? null : Math.max(0, Number.isFinite(terrainCost) ? terrainCost : 0),
    measures,
  };
}

export function normalizeOpeningDemo(value: unknown): OpeningDemo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OpeningDemo>;
  if (candidate.version !== 1) return undefined;
  const contextCandidate = candidate.context as Partial<OpeningFrozenContext> | undefined;
  const context = contextCandidate && typeof contextCandidate.hash === "string" && typeof contextCandidate.previewId === "string" && Number.isInteger(contextCandidate.runSeed)
    && typeof contextCandidate.holeId === "string" && Number.isInteger(contextCandidate.holeIndex) && typeof contextCandidate.courseName === "string" && Array.isArray(contextCandidate.cohort)
    ? contextCandidate as OpeningFrozenContext : undefined;
  const diagnosisCandidate = candidate.diagnosis as OpeningDiagnosis | undefined;
  const diagnosis = diagnosisCandidate?.kind === "none" && typeof diagnosisCandidate.previewId === "string"
    ? diagnosisCandidate
    : diagnosisCandidate?.kind === "supported" && typeof diagnosisCandidate.previewId === "string" && typeof diagnosisCandidate.shotId === "string" && Array.isArray(diagnosisCandidate.cells)
      ? diagnosisCandidate : undefined;
  const comparisonCandidate = candidate.comparison as OpeningComparison | undefined;
  const comparison = comparisonCandidate && ["positive", "neutral", "negative", "no-meaningful-change", "unsupported"].includes(comparisonCandidate.status)
    && typeof comparisonCandidate.baselinePreviewId === "string" && typeof comparisonCandidate.candidatePreviewId === "string" && Array.isArray(comparisonCandidate.measures)
    ? comparisonCandidate : undefined;
  return {
    version: 1,
    cursor: typeof candidate.cursor === "number" && Number.isFinite(candidate.cursor) ? Math.max(0, Math.min(24, Math.floor(candidate.cursor))) : 0,
    candidate: normalizeInvitedPreviewEvidence(candidate.candidate),
    targetCells: Array.isArray(candidate.targetCells) ? [...new Set(candidate.targetCells.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < 1_000_000))].slice(0, 4) : [],
    ...(context ? { context } : {}),
    ...(diagnosis ? { diagnosis } : {}),
    ...(typeof candidate.editBaselineCash === "number" && Number.isFinite(candidate.editBaselineCash) ? { editBaselineCash: candidate.editBaselineCash } : {}),
    ...(typeof candidate.editCost === "number" && Number.isFinite(candidate.editCost) ? { editCost: Math.max(0, candidate.editCost) } : {}),
    ...(comparison ? { comparison } : {}),
  };
}
