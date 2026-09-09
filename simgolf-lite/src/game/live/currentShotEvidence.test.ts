import { describe, expect, it } from "vitest";
import { currentShotEvidence, currentShotEvidenceText } from "./currentShotEvidence";
import { currentShotEvidenceCues } from "../render/shotTruthCues";
import { createM47CertificationCourse } from "../testing/m47Certification";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import { createGolferCapabilities } from "./capabilities";
import { generateStrategicHolePlan } from "./strategicOptions";
import type { LiveShotOutcome, HoleReaction } from "./m47Types";
import type { Segment } from "./types";

type Carrier = NonNullable<Parameters<typeof currentShotEvidence>[0]>;
const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
const course = createM47CertificationCourse(9);
const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
const capabilities = createGolferCapabilities({ personality, seed: 42 });
const plan = generateStrategicHolePlan({ course, hole: course.holes[0], par: 4, personality, capabilities, snapshot });
function shot(profile: "low" | "standard" | "high" = "standard"): LiveShotOutcome {
  return resolveLiveShot({ snapshot, capabilities, holeId: snapshot.holes[0].id, shotNumber: 1, from: snapshot.holes[0].tee,
    lie: "tee", intent: { ...plan.chosen, technique: "normal", flightProfile: profile }, seed: 1108 });
}
function carrier(outcome = shot()): Carrier {
  const base = { from: outcome.from, to: outcome.from, dur: 1, holeIndex: 0, holeId: outcome.holeId };
  return { segments: [
    { ...base, kind: "pause" },
    { ...base, kind: "flight", to: outcome.rest, landing: outcome.greenRollout!.landing, rollPath: outcome.greenRollout!.path, shot: "swing" },
    { ...base, kind: "walk", from: outcome.rest, to: outcome.rest },
  ], segIndex: 0, segElapsed: 0, scoredHoles: 0, shotOutcomes: [outcome], holeReactions: [] };
}
const reaction = (holeId: string): HoleReaction => ({ version: 1, holeId, expectedScore: 4, actualScore: 5, satisfaction: 60, outcome: "neutral", facts: [], thought: "The hole felt fair." });

describe("current-shot evidence is owned by the simulation cursor", () => {
  it("exposes only intention before/during flight, then the exact crossed result; never the future tail", () => {
    const g = carrier();
    const future = { ...shot(), id: "future-shot", holeId: "future-hole" };
    g.shotOutcomes!.push(future);
    const before = JSON.stringify(g);
    for (const index of [0, 1]) {
      const intent = currentShotEvidence({ ...g, segIndex: index });
      expect(intent).toMatchObject({ phase: "intent", holeId: snapshot.holes[0].id });
      expect(JSON.stringify(currentShotEvidenceText(intent))).not.toMatch(/penaltyStrokes|physicalRest|future-shot/);
    }
    const result = currentShotEvidence({ ...g, segIndex: 2 });
    expect(result.phase).toBe("result");
    if (result.phase === "result") {
      expect(result.outcome).toBe(g.shotOutcomes![0]);
      expect(result.truth.physicalRest).toEqual(g.shotOutcomes![0].sharedOutcome!.physicalRest);
    }
    expect(JSON.stringify(g)).toBe(before);
    expect(currentShotEvidence(JSON.parse(before))).toEqual(currentShotEvidence(g));
  });

  it.each(["low", "standard", "high"] as const)("carries only retained %s flight and rollout into localized result cues", (profile) => {
    const s = shot(profile);
    const evidence = currentShotEvidence({ ...carrier(s), segIndex: 2 });
    expect(evidence).toMatchObject({ phase: "result", truth: { flight: { profile }, rollPath: s.greenRollout!.path } });
    expect(currentShotEvidenceCues(evidence, "en").join(" ").toLowerCase()).toContain(`${profile} flight`);
    expect(currentShotEvidenceCues(evidence, "pseudo").every((line) => line.startsWith("⟦"))).toBe(true);
  });

  it("retains obstacle and relief evidence without conflating the drop and physical rest", () => {
    const s = shot();
    const shared = s.sharedOutcome!;
    const position = { x: 2, y: 2 };
    const clearance = { point: { x: 3, y: 3 }, pathHeightYards: 1, requiredHeightYards: 2, clearanceYards: -1, obstacleType: "tree" as const, relationship: "through" as const };
    shared.collision = { kind: "obstacle", point: clearance.point, obstacleType: "tree", distanceFromStartYards: 10, clearance };
    shared.flight.clearance = [clearance];
    shared.ruling = { ...shared.ruling, status: "penalty", penaltyKind: "out_of_bounds", penaltyStrokes: 1 };
    shared.relief = { status: "resolved", type: "stroke_and_distance", selectedCandidateId: "return", finalPosition: position,
      candidates: [{ id: "return", type: "stroke_and_distance", position, order: 0, legal: true, distanceFromReferenceYards: 0 }] };
    shared.finalPosition = position;
    s.penaltyStrokes = 1; s.rest = position; s.finalPosition = position;
    const evidence = currentShotEvidence({ ...carrier(s), segIndex: 2 });
    expect(evidence).toMatchObject({ phase: "result", truth: { collisionKind: "obstacle", penaltyStrokes: 1, reliefType: "stroke_and_distance", finalPosition: position, physicalRest: s.greenRollout!.rest } });
    const cues = currentShotEvidenceCues(evidence, "en").join(" ");
    expect(cues).toContain("Recorded obstacle contact");
    expect(cues).toContain("Stroke-and-distance relief");
  });

  it("selects one completed reaction only after the scored boundary, then prioritizes the next intent", () => {
    const g = carrier(); const first = g.shotOutcomes![0];
    g.holeReactions = [reaction(first.holeId), reaction("next-hole")];
    g.segments.push({ kind: "walk", from: first.rest, to: { x: 3, y: 3 }, dur: 1, holeIndex: 1, holeId: "next-hole" });
    expect(currentShotEvidence({ ...g, segIndex: 3, scoredHoles: 0 }).phase).toBe("unavailable");
    expect(currentShotEvidence({ ...g, segIndex: 3, scoredHoles: 1 })).toMatchObject({ phase: "reaction", holeId: first.holeId });
    const next = { ...shot(), id: "next-shot", holeId: "next-hole" };
    const nextSegments = carrier(next).segments.map((s) => ({ ...s, holeIndex: 1 }));
    g.segments.push(...nextSegments); g.shotOutcomes!.push(next);
    const evidence = currentShotEvidence({ ...g, segIndex: 4, scoredHoles: 1 });
    expect(evidence).toMatchObject({ phase: "intent", holeId: "next-hole" });
    expect(evidence).not.toHaveProperty("reaction");
    expect(evidence).not.toHaveProperty("truth");
  });

  it("does not identify historical unannotated or partially missing flights", () => {
    const g = carrier();
    const { landing: _landing, rollPath: _path, ...legacyFlight } = g.segments[1];
    g.segments[1] = legacyFlight;
    expect(currentShotEvidence({ ...g, segIndex: 1 })).toEqual({ phase: "unavailable", reason: "missing" });
    expect(currentShotEvidence({ ...g, segIndex: 2 })).toEqual({ phase: "unavailable", reason: "missing" });
    expect(currentShotEvidence({ ...g, shotOutcomes: undefined }).phase).toBe("unavailable");
  });

  it("keeps valid legacy rules-less evidence explicit across JSON restart", () => {
    const s = shot(); s.sharedOutcome = undefined;
    const g = { ...carrier(s), segIndex: 2 };
    expect(currentShotEvidence(JSON.parse(JSON.stringify(g)))).toMatchObject({ phase: "result", truth: { source: "legacy-trace", flight: null, collisionKind: null, reliefStatus: "unknown" } });
  });

  it("never uses render hints to identify automatic putts, but accepts a scored crossed-hole reaction", () => {
    const g = carrier(); const s = g.shotOutcomes![0];
    const cosmetic: Segment = { kind: "flight", from: s.rest, to: s.rest, dur: 1, holeIndex: 0, holeId: s.holeId, shot: "putt" };
    g.segments.push(cosmetic, { ...cosmetic, kind: "walk" }, { ...cosmetic, kind: "walk", holeIndex: 1, holeId: "next-hole" });
    g.holeReactions = [reaction(s.holeId)];
    for (const segIndex of [3, 4]) {
      expect(currentShotEvidence({ ...g, segIndex }).phase).toBe("unavailable");
      expect(currentShotEvidence({ ...g, segIndex, segments: g.segments.map((segment) => ({ ...segment, shot: "swing" })) }).phase).toBe("unavailable");
    }
    expect(currentShotEvidence({ ...g, segIndex: 5, scoredHoles: 1 })).toMatchObject({ phase: "reaction", holeId: s.holeId });
    expect(currentShotEvidence({ ...g, segIndex: 5, scoredHoles: 0 }).phase).toBe("unavailable");
    expect(currentShotEvidence({ ...g, segIndex: 0, scoredHoles: 0 })).toMatchObject({ phase: "intent" });
  });

  it.each(["duplicate-id", "duplicate-ordinal", "duplicate-geometry"])("fails closed for %s", (kind) => {
    const g = carrier(); const s = g.shotOutcomes![0];
    g.shotOutcomes!.push({ ...s, id: kind === "duplicate-id" ? s.id : "different", shotNumber: kind === "duplicate-ordinal" ? s.shotNumber : 2 });
    expect(currentShotEvidence(g)).toEqual({ phase: "unavailable", reason: "ambiguous" });
  });

  it.each(["cursor", "point", "path", "flight", "reaction"])("fails closed for malformed %s metadata", (kind) => {
    const g = carrier();
    if (kind === "cursor") g.segIndex = NaN;
    if (kind === "point") g.shotOutcomes![0].from.x = Infinity;
    if (kind === "path") g.segments[1].rollPath = { length: 1 } as unknown as Segment["rollPath"];
    if (kind === "flight") g.shotOutcomes![0].sharedOutcome!.flight.apexHeightYards = NaN;
    if (kind === "reaction") {
      const id = g.shotOutcomes![0].holeId;
      g.holeReactions = [{ ...reaction(id), actualScore: NaN }];
      g.scoredHoles = 1; g.segIndex = g.segments.length;
    }
    expect(currentShotEvidence(g)).toEqual({ phase: "unavailable", reason: "malformed" });
  });

  it("fails closed for duplicate reactions and wrong-hole associations", () => {
    const g = carrier(); const id = g.shotOutcomes![0].holeId;
    expect(currentShotEvidence({ ...g, segIndex: g.segments.length, scoredHoles: 1, holeReactions: [reaction(id), reaction(id)] })).toEqual({ phase: "unavailable", reason: "ambiguous" });
    g.segments[1].holeId = "wrong-hole";
    expect(currentShotEvidence({ ...g, segIndex: 1 }).phase).toBe("unavailable");
  });
});
