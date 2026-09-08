import type { Golfer, Segment } from "./types";
import type { HoleReaction, LiveShotOutcome } from "./m47Types";
import type { Point } from "../models/types";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { dispersionClubIdForLabel } from "../rules/dispersionRegistry";
import { isValidGreenRollout } from "../greens/greenRollout";
import { isValidGreenPutting } from "../greens/greenPutting";
import { projectCommittedShot, type ShotTruthProjection } from "../rules/shotTruth";

export type CurrentShotEvidence =
  | { readonly phase: "unavailable"; readonly reason: "missing" | "malformed" | "ambiguous" }
  | { readonly phase: "intent"; readonly holeId: string; readonly shotId: string; readonly shotNumber: number; readonly club: string; readonly intent: LiveShotOutcome["intent"]; readonly flightProfile: LiveShotOutcome["flightProfile"]; readonly aim: Readonly<Point> }
  | { readonly phase: "result"; readonly holeId: string; readonly truth: ShotTruthProjection; readonly outcome: Readonly<LiveShotOutcome> }
  | { readonly phase: "reaction"; readonly holeId: string; readonly reaction: Readonly<HoleReaction> };

type CursorCarrier = Pick<Golfer, "segments" | "segIndex" | "segElapsed" | "scoredHoles" | "holeIds" | "shotOutcomes" | "holeReactions">;
const unavailable = (reason: "missing" | "malformed" | "ambiguous" = "missing"): CurrentShotEvidence => Object.freeze({ phase: "unavailable", reason });
const finitePoint = (p: Point | null | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const samePoint = (a: Point | null | undefined, b: Point | null | undefined): boolean => finitePoint(a) && finitePoint(b) && a.x === b.x && a.y === b.y;
const validFacts = (facts: LiveShotOutcome["facts"]): boolean => Array.isArray(facts) && facts.length <= 12 && facts.every((f) => !!f
  && ["capability-fit", "risk", "terrain", "next-shot", "context", "outcome"].includes(f.code) && typeof f.detail === "string");

function validOutcome(s: LiveShotOutcome): boolean {
  return !!s && s.version === 1 && typeof s.id === "string" && !!s.id && typeof s.holeId === "string" && !!s.holeId
    && Number.isInteger(s.shotNumber) && s.shotNumber > 0 && Number.isInteger(s.seed)
    && typeof s.club === "string" && dispersionClubIdForLabel(s.club) !== null
    && ["safe", "hero", "positional", "recovery", "approach"].includes(s.intent)
    && typeof s.intentId === "string" && ["normal", "draw", "fade", "punch", "flop", "backspin"].includes(s.technique)
    && typeof s.lieBefore === "string" && Number.isFinite(s.carryYards) && Number.isFinite(s.rollYards) && validFacts(s.facts)
    && (s.flightProfile == null || ["low", "standard", "high"].includes(s.flightProfile))
    && finitePoint(s.from) && finitePoint(s.aim) && finitePoint(s.landing) && finitePoint(s.rest)
    && typeof s.lieAfter === "string" && typeof s.holed === "boolean"
    && Number.isInteger(s.penaltyStrokes) && s.penaltyStrokes >= 0
    && (s.finalPosition == null || finitePoint(s.finalPosition))
    && (s.sharedOutcome == null || isValidSharedShotOutcome(s.sharedOutcome))
    && (s.greenRollout == null || isValidGreenRollout(s.greenRollout))
    && (s.greenPutting == null || isValidGreenPutting(s.greenPutting));
}

/**
 * Presentation selection is owned by the saved simulation itinerary cursor,
 * never by a renderer pose or the tail of a precomputed whole-round stream.
 * A unique retained trajectory is required to associate a shot. Historical
 * unannotated flights and automatic-putt animations do not invent metadata.
 */
export function currentShotEvidence(g: CursorCarrier | null | undefined): CurrentShotEvidence {
  if (!g || !Array.isArray(g.shotOutcomes) || !g.shotOutcomes.length) return unavailable();
  if (!Array.isArray(g.segments) || g.segments.length > 5000 || g.shotOutcomes.length > 240
    || !g.segments.every((s) => !!s && ["flight", "walk", "pause"].includes(s.kind)
      && finitePoint(s.from) && finitePoint(s.to) && Number.isFinite(s.dur) && s.dur >= 0
      && Number.isInteger(s.holeIndex) && s.holeIndex >= -1
      && (s.holeId == null || typeof s.holeId === "string")
      && (s.landing == null || finitePoint(s.landing))
      && (s.rollPath == null || Array.isArray(s.rollPath) && s.rollPath.length <= 2048 && s.rollPath.every(finitePoint)))
    || (g.holeIds != null && (!Array.isArray(g.holeIds) || !g.holeIds.every((id) => typeof id === "string")))
    || !Number.isInteger(g.segIndex) || g.segIndex < 0 || g.segIndex > g.segments.length
    || !Number.isFinite(g.segElapsed) || g.segElapsed < 0
    || !Number.isInteger(g.scoredHoles) || g.scoredHoles < 0 || g.scoredHoles > 36
    || !g.shotOutcomes.every(validOutcome)) return unavailable("malformed");
  const ids = new Set<string>(); const ordinals = new Set<string>();
  for (const shot of g.shotOutcomes) {
    const ordinal = `${shot.holeId}:${shot.shotNumber}`;
    if (ids.has(shot.id) || ordinals.has(ordinal)) return unavailable("ambiguous");
    ids.add(shot.id); ordinals.add(ordinal);
  }
  const holeId = (s: Segment): string | undefined => s.holeId ?? g.holeIds?.[s.holeIndex];
  const current = g.segments[g.segIndex];
  if (current && (!Number.isFinite(current.dur) || current.dur < g.segElapsed
    || !finitePoint(current.from) || !finitePoint(current.to))) return unavailable("malformed");
  const match = (s: Segment): LiveShotOutcome | CurrentShotEvidence => {
    if (!s.landing || !s.rollPath?.length || !holeId(s)) return unavailable();
    if (!finitePoint(s.landing) || !s.rollPath.every(finitePoint)) return unavailable("malformed");
    const candidates = g.shotOutcomes!.filter((o) => o.holeId === holeId(s)
      && samePoint(o.from, s.from) && samePoint(o.rest, s.to)
      && samePoint(o.greenRollout?.landing, s.landing)
      && o.greenRollout?.path.length === s.rollPath!.length
      && o.greenRollout.path.every((p, i) => samePoint(p, s.rollPath![i])));
    return candidates.length === 1 ? candidates[0] : unavailable(candidates.length ? "ambiguous" : "missing");
  };
  const next = g.segments[g.segIndex + 1];
  const addressing = current?.kind === "pause" && next?.kind === "flight"
    && holeId(current) === holeId(next) && samePoint(current.from, next.from);
  const activeFlight = current?.kind === "flight" ? current : addressing ? next : null;
  if (activeFlight) {
    const shot = match(activeFlight);
    if ("phase" in shot) return shot;
    return Object.freeze({ phase: "intent", holeId: shot.holeId, shotId: shot.id, shotNumber: shot.shotNumber,
      club: shot.club, intent: shot.intent, flightProfile: shot.sharedOutcome?.flight.profile ?? shot.flightProfile,
      aim: Object.freeze({ ...shot.aim }) });
  }
  // A crossed hole boundary is simulation-owned (advanceGolfer folds the score
  // here). It does not require identifying cosmetic automatic-putt flights.
  for (let i = g.segIndex - 1; i >= 0; i--) {
    const previous = g.segments[i];
    const following = g.segments[i + 1];
    if (previous.holeIndex < 0 || following?.holeIndex === previous.holeIndex) continue;
    const reactions = g.holeReactions;
    if (!Array.isArray(reactions) || !g.scoredHoles) break;
    const reaction = reactions[g.scoredHoles - 1];
    if (!reaction || reaction.holeId !== holeId(previous)) break;
    // A newer stroke on the current hole outranks a previous-hole reaction.
    if (g.segments.slice(i + 1, g.segIndex).some((s) => s.kind === "flight")) break;
    if (reactions.filter((r) => r?.holeId === reaction.holeId).length !== 1) return unavailable("ambiguous");
    if (reaction.version !== 1 || typeof reaction.thought !== "string" || !validFacts(reaction.facts)
      || (reaction.memory != null && typeof reaction.memory !== "string")
      || ![reaction.actualScore, reaction.expectedScore, reaction.satisfaction].every(Number.isFinite)
      || !["delighted", "pleased", "neutral", "frustrated", "unfair"].includes(reaction.outcome)) return unavailable("malformed");
    return Object.freeze({ phase: "reaction", holeId: reaction.holeId, reaction });
  }
  // Only an already-crossed uniquely identified flight can become a result.
  // Never infer automatic-putt identity from a render-only hint or order.
  for (let i = g.segIndex - 1; i >= 0; i--) {
    const segment = g.segments[i];
    if (segment.kind !== "flight") continue;
    const shot = match(segment);
    if ("phase" in shot) return shot;
    if (current && holeId(current) === shot.holeId) {
      return Object.freeze({ phase: "result", holeId: shot.holeId, truth: projectCommittedShot(shot), outcome: shot });
    }
    return unavailable();
  }
  return unavailable();
}

/** Compact telemetry: intent never leaks the already-computed future result. */
export function currentShotEvidenceText(evidence: CurrentShotEvidence) {
  return evidence.phase === "result"
    ? { phase: evidence.phase, holeId: evidence.holeId, truth: evidence.truth }
    : evidence;
}
