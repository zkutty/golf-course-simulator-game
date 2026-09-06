import type { Course, Point, World } from "../models/types";
import { isOwnedTile } from "../estate/estate";
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
}

export interface OpeningShotMarker {
  golferName: string;
  shot: InvitedPreviewShotEvidence;
}

export function openingShots(evidence: InvitedPreviewEvidence | null): OpeningShotMarker[] {
  return evidence?.group.flatMap((golfer) => golfer.shots.map((shot) => ({ golferName: golfer.name, shot }))) ?? [];
}

export function newOpeningDemo(): OpeningDemo {
  return { version: 1, cursor: 0, candidate: null, targetCells: [] };
}

/** Prefer a difficult next lie; otherwise offer widening beside a recorded landing.
 * This is an opportunity, never a promise of a better score. Only rough is eligible.
 */
export function openingTargetCells(course: Course, evidence: InvitedPreviewEvidence): number[] {
  const shots = openingShots(evidence);
  const points = [
    ...shots.filter(({ shot }) => shot.lieAfter === "rough" || shot.lieAfter === "deep_rough").map(({ shot }) => shot.rest),
    ...shots.map(({ shot }) => shot.landing),
  ];
  for (const point of points) {
    const cells: number[] = [];
    for (let y = Math.floor(point.y) - 1; y <= Math.floor(point.y) + 1; y++) {
      for (let x = Math.floor(point.x) - 1; x <= Math.floor(point.x) + 1; x++) {
        if (x < 0 || y < 0 || x >= course.width || y >= course.height || !isOwnedTile(course, x, y)) continue;
        const index = y * course.width + x;
        if (course.tiles[index] === "rough" || course.tiles[index] === "deep_rough") cells.push(index);
      }
    }
    if (cells.length) return cells;
  }
  return [];
}

export function openingTargetPoints(course: Course, opening?: OpeningDemo): Point[] {
  return opening?.targetCells.map((index) => ({ x: index % course.width, y: Math.floor(index / course.width) })) ?? [];
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

export function normalizeOpeningDemo(value: unknown): OpeningDemo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OpeningDemo>;
  if (candidate.version !== 1) return undefined;
  return {
    version: 1,
    cursor: typeof candidate.cursor === "number" && Number.isFinite(candidate.cursor) ? Math.max(0, Math.min(24, Math.floor(candidate.cursor))) : 0,
    candidate: normalizeInvitedPreviewEvidence(candidate.candidate),
    targetCells: Array.isArray(candidate.targetCells) ? [...new Set(candidate.targetCells.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < 1_000_000))].slice(0, 9) : [],
  };
}
