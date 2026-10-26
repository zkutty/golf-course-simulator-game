import { describe, expect, it, vi } from "vitest";
import { createShotPacingPlan, shotPacingFrame } from "../live/shotPacing";
import { resolveObstacleCollision } from "../rules/obstacleCollision";
import { createRetainedShotMotion, type ShotMotionIdentityV1 } from "../rules/shotMotion";
import { golferActivityOwnerKey } from "./golferActivity";
import {
  classifyGolferReaction, scheduleGolferReactions, GOLFER_REACTION_POLICY as POLICY, GOLFER_REACTION_REASONS as REASON,
  type ClassifyGolferReactionInput, type GolferReactionActor, type GolferReactionBatch,
  type GolferReactionClassification, type GolferReactionPhysicalResult, type GolferReactionState,
} from "./golferReactions";

const pos = (x: number, y = 1) => ({ point: { x, y }, heightYards: 0 });
function fixture(options: { putt?: boolean; holed?: boolean; relief?: boolean; actor?: string; identity?: Partial<ShotMotionIdentityV1> } = {}): ClassifyGolferReactionInput {
  const putt = options.putt ?? false;
  const motion = createRetainedShotMotion({
    identity: { shotId: "shot-1", holeId: "hole-1", shotNumber: 1, seed: 123, club: putt ? "Putter" : "7 Iron", style: "normal", modelVersion: "physical_shot_v1", ...options.identity },
    yardsPerTile: 10, from: pos(1), landing: pos(putt ? 1 : 11), physicalRest: pos(12),
    flight: putt ? null : resolveObstacleCollision({ from: { x: 1, y: 1 }, to: { x: 11, y: 1 }, flight: { profile: "standard", apexHeightYards: 4 },
      width: 16, height: 16, yardsPerTile: 10, elevations: new Array(256).fill(0), obstacles: [], retainGeometry: true }).retained!,
    rollPath: [pos(putt ? 1 : 11), pos(12)], holed: options.holed ?? false, reliefPosition: options.relief ? { x: 10, y: 2 } : null,
  })!;
  expect(motion).not.toBeNull();
  const owner = { scopeId: "live:w3:d2:s123:e0", actorId: options.actor ?? "golfer:1", shot: { ...motion.identity } };
  const plan = createShotPacingPlan({ scopeId: owner.scopeId, actorId: owner.actorId, motion, distanceYards: putt ? 12 : 110 })!;
  const cursor = { version: 1 as const, key: plan.key, elapsedMs: plan.durationMs - plan.restMs };
  return { owner, currentOwner: owner, authorityRevision: "rev:1", currentAuthorityRevision: "rev:1", motion, retainedDistanceYards: putt ? 12 : 110,
    plan, cursor, frame: shotPacingFrame(plan, cursor)!,
    observation: { key: plan.key, authorityRevision: "rev:1", evidenceId: "endpoint:1", eventIndex: motion.events.length - 1, motionProgress: 1, position: pos(12) },
    physicalResult: { ownerKey: plan.key, authorityRevision: "rev:1", provenance: "per-shot", physicalRest: { position: pos(12), greenId: null, hazard: "none" }, penaltyStrokes: 0, reliefApplied: false, frozenAim: null },
  };
}
function at(input: ClassifyGolferReactionInput, elapsedMs: number): ClassifyGolferReactionInput {
  const cursor = { ...input.cursor, elapsedMs };
  return { ...input, cursor, frame: shotPacingFrame(input.plan, cursor)! };
}
function physical(input: ClassifyGolferReactionInput, patch: Partial<GolferReactionPhysicalResult>): ClassifyGolferReactionInput {
  return { ...input, physicalResult: { ...input.physicalResult!, ...patch } };
}
function aim(input: ClassifyGolferReactionInput, target = { x: 12, y: 1 }, pin = { x: 15, y: 1 }): ClassifyGolferReactionInput {
  return physical(input, { physicalRest: { ...input.physicalResult!.physicalRest, greenId: "green:1" }, frozenAim: {
    ownerKey: input.plan.key, authorityRevision: input.authorityRevision, frozenAt: "shot-acquisition", from: input.motion.from.point,
    target, greenGoal: { holeId: "hole-1", greenId: "green:1", pin },
  } });
}
function classification(input: ClassifyGolferReactionInput): GolferReactionClassification {
  const result = classifyGolferReaction(input);
  expect(result.classification, result.reason).not.toBeNull();
  return result.classification!;
}
function actor(input: ClassifyGolferReactionInput, elapsedMs: number, c: GolferReactionClassification | null = classification(input), patch: Partial<GolferReactionActor> = {}): GolferReactionActor {
  const value = at(input, elapsedMs);
  return { owner: value.owner, currentOwner: value.currentOwner, authorityRevision: value.authorityRevision, currentAuthorityRevision: value.currentAuthorityRevision,
    plan: value.plan, cursor: value.cursor, frame: value.frame, classification: c, visibility: "visible", paused: false, ...patch };
}
function batch(actors: readonly GolferReactionActor[], time: number, patch: Partial<GolferReactionBatch> = {}): GolferReactionBatch {
  return { scopeId: "live:w3:d2:s123:e0", authorityRevision: "rev:1", presentationTimeMs: time, quality: "high", motionEnabled: true, hidden: false, discontinuity: "none", actors, ...patch };
}
function prime(input: ClassifyGolferReactionInput, time = 1000) {
  const c = classification(input), start = input.plan.durationMs - POLICY.staticWindowMs;
  const previous = scheduleGolferReactions(null, batch([actor(input, start - 1, c)], time)).state;
  return { c, start, previous, result: scheduleGolferReactions(previous, batch([actor(input, start, c)], time + 1)) };
}
function eligible(result: ReturnType<typeof scheduleGolferReactions>) { return result.outputs.filter((o) => o.outcome?.eligible); }

describe("retained physical result mapping", () => {
  it.each([false, true])("requires exact endpoint observation for real retained %s putt", (putt) => {
    const input = fixture({ putt, holed: true }), end = input.plan.durationMs - input.plan.restMs;
    expect(classifyGolferReaction(at(input, end - Number.EPSILON * end)).reason).toBe(REASON.endpoint);
    expect(classification(at(input, end)).result).toBe("hole-out");
    expect(classification(at(input, input.plan.durationMs - 600)).result).toBe("hole-out");
    expect(input.motion.flight === null).toBe(putt);
  });
  it.each([null, { eventIndex: 0 }, { motionProgress: .999999 }, { position: pos(12.00000001) }, { key: "other" }, { authorityRevision: "old" }])("rejects absent/inexact observation %j", (patch) => {
    const input = fixture({ holed: true });
    const bad = { ...input, observation: patch === null ? null : { ...input.observation!, ...patch } } as ClassifyGolferReactionInput;
    expect(classifyGolferReaction(bad).classification).toBeNull();
  });
  it("does not infer hole-out from pin proximity, aggregate putts or relief destination", () => {
    const safe = fixture();
    expect(classification(aim(safe, { x: 12, y: 1 }, { x: 12, y: 1 })).result).toBe("exceptional");
    const aggregate = physical(fixture({ putt: true, holed: true }), { provenance: "aggregate-putts" });
    expect(classification(aggregate)).toMatchObject({ result: "neutral", reason: REASON.aggregate });
    const relief = fixture({ relief: true });
    expect(classification(aim(relief))).toMatchObject({ result: "neutral", reason: REASON.relief });
    expect(classifyGolferReaction({ ...safe, observation: null }).classification).toBeNull();
  });
  it.each(["bunker", "water", "out-of-bounds"] as const)("maps actual %s to one bad result", (hazard) => {
    const input = fixture();
    expect(classification(physical(aim(input), { physicalRest: { ...input.physicalResult!.physicalRest, hazard } }))).toMatchObject({ result: "bad", reason: REASON.bad });
  });
  it("uses actual penalty, even with relief; physical hole-out has primary priority", () => {
    expect(classification(physical(fixture({ relief: true }), { penaltyStrokes: 1 })).result).toBe("bad");
    expect(classification(physical(fixture({ holed: true }), { penaltyStrokes: 1 })).result).toBe("hole-out");
  });
  it("keeps ordinary safe, missing truth, unknown hazards and all non-holed putts neutral", () => {
    expect(classification(fixture())).toMatchObject({ result: "neutral", reason: REASON.neutral });
    expect(classification({ ...fixture(), physicalResult: null })).toMatchObject({ result: "neutral", reason: REASON.unknown });
    const unknown = fixture();
    expect(classification(physical(aim(unknown), { penaltyStrokes: null })).result).toBe("neutral");
    expect(classification(physical(aim(unknown), { reliefApplied: null })).result).toBe("neutral");
    expect(classification(aim(fixture({ putt: true })))).toMatchObject({ result: "neutral", reason: REASON.putt });
  });
  it("classifies good relative to frozen intended length, with a 1.5 tile ceiling", () => {
    expect(classification(aim(fixture()))).toMatchObject({ result: "good", metrics: { intendedLengthTiles: 11, aimErrorTiles: 0, goodErrorLimitTiles: 1.5 } });
    expect(classification(aim(fixture(), { x: 14, y: 1 })).result).toBe("neutral");
    const short = fixture(), shortAim = aim(short, { x: 2, y: 1 }, { x: 12, y: 1 });
    // The ball travelled eleven tiles, but this frozen target was only one tile away.
    expect(classification(shortAim)).toMatchObject({ result: "neutral", reason: REASON.offTarget, metrics: { intendedLengthTiles: 1, goodErrorLimitTiles: .15 } });
  });
  it("requires exact current frozen aim and the actual intended green", () => {
    const input = aim(fixture()), a = input.physicalResult!.frozenAim!;
    for (const frozenAim of [{ ...a, ownerKey: "stale" }, { ...a, authorityRevision: "old" }, { ...a, from: { x: 0, y: 1 } }, { ...a, greenGoal: null }, { ...a, greenGoal: { ...a.greenGoal!, greenId: "other" } }, { ...a, greenGoal: { ...a.greenGoal!, holeId: "other" } }]) {
      expect(classification(physical(input, { frozenAim }))).toMatchObject({ result: "neutral", reason: REASON.aim });
    }
  });
  it("exceptional needs normalized good aim, >=3 intended tiles and <=.3 actual pin tiles", () => {
    const input = fixture();
    expect(classification(aim(input, { x: 12, y: 1 }, { x: 12.299, y: 1 })).result).toBe("exceptional");
    expect(classification(aim(input, { x: 12, y: 1 }, { x: 12.301, y: 1 })).result).toBe("good");
    expect(classification(aim(input, { x: 14, y: 1 }, { x: 12, y: 1 })).result).toBe("neutral");
  });
  it("uses relative error on short approaches and withholds exceptional below3 intended tiles", () => {
    const original = fixture();
    const motion = createRetainedShotMotion({ identity: original.motion.identity, yardsPerTile: 10, from: pos(10), landing: pos(10), physicalRest: pos(12),
      flight: null, rollPath: [pos(10), pos(12)], holed: false })!;
    const plan = createShotPacingPlan({ scopeId: original.owner.scopeId, actorId: original.owner.actorId, motion, distanceYards: 20 })!;
    const cursor = { version: 1 as const, key: plan.key, elapsedMs: plan.durationMs - plan.restMs };
    const short = { ...original, motion, plan, cursor, frame: shotPacingFrame(plan, cursor)!, retainedDistanceYards: 20 };
    expect(classification(aim(short, { x: 12, y: 1 }, { x: 12, y: 1 }))).toMatchObject({ result: "good", metrics: { intendedLengthTiles: 2, goodErrorLimitTiles: .3 } });
    expect(classification(aim(short, { x: 12.3, y: 1 })).result).toBe("good");
    expect(classification(aim(short, { x: 12.4, y: 1 })).result).toBe("neutral");
  });
  it.each(["scopeId", "actorId", "shotId", "holeId", "shotNumber", "seed", "club", "style", "modelVersion"])("requires complete current owner: %s", (field) => {
    const input = fixture(), currentOwner = { ...input.owner, shot: { ...input.owner.shot! } };
    if (field === "scopeId" || field === "actorId") currentOwner[field] += ":other";
    else Object.assign(currentOwner.shot!, { [field]: typeof currentOwner.shot![field as keyof ShotMotionIdentityV1] === "number" ? 999 : "other" });
    expect(classifyGolferReaction({ ...input, currentOwner }).reason).toBe(REASON.owner);
  });
  it("rejects stale revision, incoherent actual playback and mismatched retained proof", () => {
    const input = fixture();
    expect(classifyGolferReaction({ ...input, currentAuthorityRevision: "old" }).reason).toBe(REASON.owner);
    expect(classifyGolferReaction({ ...input, frame: { ...input.frame, motionProgress: .5 } }).reason).toBe(REASON.playback);
    expect(classifyGolferReaction({ ...input, retainedDistanceYards: 100 }).reason).toBe(REASON.playback);
    expect(classifyGolferReaction(physical(input, { ownerKey: "stale" })).reason).toBe(REASON.owner);
    expect(classification(physical(input, { physicalRest: { ...input.physicalResult!.physicalRest, position: pos(13) } })).result).toBe("neutral");
  });
  it("rejects getters/nonfinite/invalid retained data without invoking accessors", () => {
    const getter = vi.fn(() => fixture());
    const bad = Object.defineProperty({}, "motion", { enumerable: true, get: getter });
    expect(classifyGolferReaction(bad as ClassifyGolferReactionInput).classification).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(classifyGolferReaction({ ...fixture(), retainedDistanceYards: NaN }).classification).toBeNull();
    const input = fixture();
    expect(classifyGolferReaction({ ...input, motion: { ...input.motion, events: [] } }).classification).toBeNull();
  });
  it("detaches and freezes full context; never parses freeform gameplay summaries", () => {
    const input = aim(fixture()), before = structuredClone(input), c = classification(input);
    expect(c.owner).not.toBe(input.owner); expect(c.physicalResult).not.toBe(input.physicalResult);
    expect(Object.isFrozen(c.physicalResult!.frozenAim!.greenGoal!.pin)).toBe(true);
    expect(c.ownerKey).toBe(golferActivityOwnerKey(input.owner));
    expect(input).toEqual(before);
    const decorated = { ...fixture(), lastHoleDelta: -3, facts: "excellent hole-out" };
    expect(classification(decorated).result).toBe("neutral");
  });
});

describe("bounded caller-driven reaction admission", () => {
  it.each([false, true])("uses only last600ms of shared rest (%s putt), with no added completion", (putt) => {
    const input = fixture({ putt, holed: true }), { result, start, c } = prime(input);
    expect(eligible(result)).toHaveLength(1);
    expect(result.outputs[0]!.outcome).toEqual({ key: input.plan.key, endpointObserved: true, evidenceId: c.evidenceId, result: "hole-out", eligible: true });
    expect(scheduleGolferReactions(result.state, batch([actor(input, start + 599, c)], 1600)).outputs[0]!.outcome?.eligible).toBe(true);
    expect(eligible(scheduleGolferReactions(result.state, batch([actor(input, input.plan.durationMs, c)], 1601)))).toHaveLength(0);
    expect(input.cursor.elapsedMs).toBe(input.plan.durationMs - input.plan.restMs);
  });
  it("does not admit at endpoint, first seen rest, missing proof, neutral, or late arriving evidence", () => {
    const input = fixture({ holed: true }), c = classification(input), end = input.cursor.elapsedMs, start = input.plan.durationMs - 600;
    expect(eligible(scheduleGolferReactions(null, batch([actor(input, end, c)], 0)))).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(null, batch([actor(input, start, c)], 0)))).toHaveLength(0);
    let state = scheduleGolferReactions(null, batch([actor(input, start - 1, null)], 0)).state;
    state = scheduleGolferReactions(state, batch([actor(input, start, null)], 1)).state;
    expect(eligible(scheduleGolferReactions(state, batch([actor(input, start + 1, c)], 2)))).toHaveLength(0);
    expect(eligible(prime(fixture()).result)).toHaveLength(0);
  });
  it("does not accept fabricated or serialized classifications/state as endpoint evidence", () => {
    const input = fixture({ holed: true }), { previous, start, c, result } = prime(input);
    expect(eligible(scheduleGolferReactions(previous, batch([actor(input, start, structuredClone(c))], 1001)))).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(structuredClone(result.state), batch([actor(input, start + 1, c)], 1002)))).toHaveLength(0);
  });
  it("consumes once; duplicate frames and replacement evidence cannot replay the cue", () => {
    const input = fixture({ holed: true }), { result, start, c } = prime(input);
    let state = result.state;
    for (let ms = 1; ms <= 3; ms++) { const next = scheduleGolferReactions(state, batch([actor(input, start + ms, c)], 1001 + ms)); expect(eligible(next)).toHaveLength(1); state = next.state; }
    const different = classification({ ...input, observation: { ...input.observation!, evidenceId: "changed" } });
    const changed = scheduleGolferReactions(state, batch([actor(input, start + 4, different)], 1005));
    expect(eligible(changed)).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(changed.state, batch([actor(input, start + 5, c)], 1006)))).toHaveLength(0);
  });
  it("caps a stalled upstream cursor at600 active milliseconds without advancing it", () => {
    const input = fixture({ holed: true }), { result, start, c } = prime(input);
    expect(eligible(scheduleGolferReactions(result.state, batch([actor(input, start, c)], 1600)))).toHaveLength(1);
    const expired = scheduleGolferReactions(result.state, batch([actor(input, start, c)], 1601));
    expect(eligible(expired)).toHaveLength(0); expect(expired.state!.records[0]!.elapsedMs).toBe(start);
  });
  it("enforces8s cooldown across consecutive shots, preserving actor identity", () => {
    const a = fixture({ holed: true }), first = prime(a), b = fixture({ holed: true, identity: { shotId: "shot-2", shotNumber: 2 } }), c = classification(b), start = b.plan.durationMs - 600;
    const before = scheduleGolferReactions(first.result.state, batch([actor(b, start - 1, c)], 9000));
    expect(eligible(scheduleGolferReactions(before.state, batch([actor(b, start, c)], 9001)))).toHaveLength(1); // exactly8000
    const early = scheduleGolferReactions(first.result.state, batch([actor(b, start - 1, c)], 8999));
    const blocked = scheduleGolferReactions(early.state, batch([actor(b, start, c)], 9000));
    expect(eligible(blocked)).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(blocked.state, batch([actor(b, start + 1, c)], 9001)))).toHaveLength(0);
  });
  it("holds one paused actor's cue/cooldown age while another actor advances", () => {
    const a = fixture({ holed: true }), first = prime(a), b = fixture({ holed: true, actor: "golfer:2" }), bc = classification(b), start = first.start;
    const paused = scheduleGolferReactions(first.result.state, batch([actor(a, start, first.c, { paused: true }), actor(b, start - 1, bc)], 5000));
    expect(eligible(paused)).toHaveLength(1);
    const other = scheduleGolferReactions(paused.state, batch([actor(a, start, first.c, { paused: true }), actor(b, start, bc)], 10000));
    expect(eligible(other)).toHaveLength(2);
    const resumed = scheduleGolferReactions(other.state, batch([actor(a, start + 1, first.c), actor(b, start + 100, bc)], 15000));
    expect(eligible(resumed).map((o) => o.actorKey)).toContain(JSON.stringify([a.owner.scopeId, a.owner.actorId]));
    expect(resumed.state!.records[0]!.lastCueAtMs).toBe(15000);
    const expired = scheduleGolferReactions(resumed.state, batch([actor(a, start + 2, first.c)], 15600));
    expect(eligible(expired)).toHaveLength(0);
  });
  it.each(["reload", "skip", "reveal"] as const)("discards %s and never cheers late", (discontinuity) => {
    const input = fixture({ holed: true }), first = prime(input);
    const discarded = scheduleGolferReactions(first.result.state, batch([actor(input, first.start, first.c)], 1002, { discontinuity }));
    expect(eligible(discarded)).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(discarded.state, batch([actor(input, first.start + 1, first.c)], 1003)))).toHaveLength(0);
  });
  it.each(["hidden", "culled", "absent"] as const)("discards %s ownership with no delayed cheer", (kind) => {
    const input = fixture({ holed: true }), first = prime(input);
    const discarded = scheduleGolferReactions(first.result.state, batch(kind === "absent" ? [] : [actor(input, first.start, first.c, { visibility: kind === "culled" ? "culled" : "visible" })], 1002, { hidden: kind === "hidden" }));
    expect(eligible(discarded)).toHaveLength(0);
    expect(discarded.state!.records.every((r) => r.ownerKey === null && r.active === null)).toBe(true);
    expect(eligible(scheduleGolferReactions(discarded.state, batch([actor(input, first.start + 1, first.c)], 1003)))).toHaveLength(0);
  });
  it("rejects stale actor revision/full-owner before a paused cue can be held", () => {
    const input = fixture({ holed: true }), first = prime(input);
    expect(eligible(scheduleGolferReactions(first.result.state, batch([actor(input, first.start, first.c, { paused: true, currentAuthorityRevision: "new" })], 1002)))).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(first.result.state, batch([actor(input, first.start, first.c, { paused: true, currentOwner: { ...input.owner, shot: { ...input.owner.shot!, seed: 999 } } })], 1002)))).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(first.result.state, batch([actor(input, first.start, first.c)], 1002, { authorityRevision: "new-session" })))).toHaveLength(0);
  });
  it("has no rewind replay, cursor movement while paused, or historical shot replay", () => {
    const input = fixture({ holed: true }), first = prime(input);
    const back = scheduleGolferReactions(first.result.state, batch([actor(input, first.start - 1, first.c)], 1002));
    expect(eligible(back)).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(back.state, batch([actor(input, first.start, first.c)], 1003)))).toHaveLength(0);
    expect(eligible(scheduleGolferReactions(first.result.state, batch([actor(input, first.start + 1, first.c, { paused: true })], 1002)))).toHaveLength(0);
    const old = fixture({ holed: true, identity: { shotId: "old-same-number" } });
    expect(eligible(scheduleGolferReactions(first.result.state, batch([actor(old, first.start - 1)], 1002)))).toHaveLength(0);
  });
  it.each([1, 3])("accepts new-hole shot%d after old-hole shot3 without carrying the old maximum", (shotNumber) => {
    const old = fixture({ holed: true, identity: { holeId: "hole-1", shotId: "hole1-shot3", shotNumber: 3 } }), first = prime(old);
    const next = fixture({ holed: true, identity: { holeId: "hole-2", shotId: `hole2-shot${shotNumber}`, shotNumber } }), c = classification(next);
    const start = next.plan.durationMs - 600;
    const before = scheduleGolferReactions(first.result.state, batch([actor(next, start - 1, c)], 9000));
    expect(before.state!.records[0]).toMatchObject({ holeId: "hole-2", shotNumber, ownerKey: next.plan.key, consumed: false });
    const shown = scheduleGolferReactions(before.state, batch([actor(next, start, c)], 9001));
    expect(eligible(shown)).toHaveLength(1);
    expect(shown.state!.records[0]!.shotNumber).toBe(shotNumber);
    // The new hole's own later shot remains orderable, starting from its own ordinal.
    const later = fixture({ holed: true, identity: { holeId: "hole-2", shotId: "later", shotNumber: shotNumber + 1 } });
    const laterBefore = scheduleGolferReactions(shown.state, batch([actor(later, start - 1)], 17000));
    expect(eligible(scheduleGolferReactions(laterBefore.state, batch([actor(later, start)], 17001)))).toHaveLength(1);
  });
  it.each([1, 3])("still rejects same-hole stale/equal shot%d after shot3 and preserves the ordinal", (shotNumber) => {
    const old = fixture({ holed: true, identity: { shotId: "hole1-shot3", shotNumber: 3 } }), first = prime(old);
    const stale = fixture({ holed: true, identity: { shotId: `stale${shotNumber}`, shotNumber } }), c = classification(stale), start = stale.plan.durationMs - 600;
    const before = scheduleGolferReactions(first.result.state, batch([actor(stale, start - 1, c)], 9000));
    expect(before.outputs[0]!.reason).toBe("discontinuous-playback");
    expect(before.state!.records[0]).toMatchObject({ holeId: "hole-1", shotNumber: 3, ownerKey: null });
    expect(eligible(scheduleGolferReactions(before.state, batch([actor(stale, start, c)], 9001)))).toHaveLength(0);
    const future = fixture({ holed: true, identity: { shotId: "future4", shotNumber: 4 } });
    const futureBefore = scheduleGolferReactions(before.state, batch([actor(future, start - 1)], 9002));
    expect(eligible(scheduleGolferReactions(futureBefore.state, batch([actor(future, start)], 9003)))).toHaveLength(1);
  });
  it("rejects presentation-time regression without replaying the active cue or erasing actor cooldown", () => {
    const input = fixture({ holed: true }), first = prime(input);
    const next = fixture({ holed: true, identity: { shotNumber: 2, shotId: "next" } }), c = classification(next);
    const regressed = scheduleGolferReactions(first.result.state, batch([actor(next, first.start - 1, c)], 1000));
    expect(regressed.reason).toBe("regressed-presentation-time"); expect(eligible(regressed)).toHaveLength(0);
    expect(regressed.state!.presentationTimeMs).toBe(1001);
    expect(regressed.state!.records[0]).toMatchObject({ ownerKey: null, active: null, lastCueAtMs: 1001 });
    const recovered = scheduleGolferReactions(regressed.state, batch([actor(next, first.start, c)], 1001));
    expect(eligible(recovered)).toHaveLength(0);
    const replay = scheduleGolferReactions(regressed.state, batch([actor(input, first.start + 1, first.c)], 1001));
    expect(eligible(replay)).toHaveLength(0);
    // Acquiring a valid pre-window frame after recovery still cannot bypass the8s actor cooldown.
    const before = scheduleGolferReactions(regressed.state, batch([actor(next, first.start - 1, c)], 2000));
    expect(eligible(scheduleGolferReactions(before.state, batch([actor(next, first.start, c)], 2001)))).toHaveLength(0);
    const expiredBefore = scheduleGolferReactions(regressed.state, batch([actor(next, first.start - 1, c)], 9000));
    expect(eligible(scheduleGolferReactions(expiredBefore.state, batch([actor(next, first.start, c)], 9001)))).toHaveLength(1);
  });
  it("timestamp regression preserves unrelated-actor cooldown tombstones, including repeated regressions", () => {
    const a = fixture({ actor: "a", holed: true }), b = fixture({ actor: "b", holed: true });
    const ac = classification(a), bc = classification(b), start = a.plan.durationMs - 600;
    const before = scheduleGolferReactions(null, batch([actor(a, start - 1, ac), actor(b, start - 1, bc)], 1000));
    const shown = scheduleGolferReactions(before.state, batch([actor(a, start, ac), actor(b, start, bc)], 1001));
    expect(eligible(shown)).toHaveLength(2);
    const regressed = scheduleGolferReactions(shown.state, batch([actor(a, start + 1, ac)], 999));
    const repeated = scheduleGolferReactions(regressed.state, batch([], 1000));
    expect(repeated.reason).toBe("regressed-presentation-time");
    expect(repeated.state!.records).toHaveLength(2);
    expect(repeated.state!.records.every((r) => r.lastCueAtMs === 1001 && r.active === null && r.ownerKey === null)).toBe(true);
    const nextB = fixture({ actor: "b", holed: true, identity: { shotId: "b-next", shotNumber: 2 } }), nextC = classification(nextB);
    const bBefore = scheduleGolferReactions(repeated.state, batch([actor(nextB, start - 1, nextC)], 2000));
    expect(eligible(scheduleGolferReactions(bBefore.state, batch([actor(nextB, start, nextC)], 2001)))).toHaveLength(0);
    expect(shown.state!.records.every((r) => r.active !== null && r.lastCueAtMs === 1001)).toBe(true);
  });
  it.each([["high", 2], ["medium", 1], ["low", 0]] as const)("coalesces100 actors by priority with %s cap%d", (quality, cap) => {
    const inputs = Array.from({ length: 100 }, (_, i) => i === 99 ? fixture({ actor: `a${i}`, holed: true }) : i === 98 ? aim(fixture({ actor: `a${i}` }), { x: 12, y: 1 }, { x: 12, y: 1 }) : i === 97 ? aim(fixture({ actor: `a${i}` })) : physical(fixture({ actor: `a${i}` }), { penaltyStrokes: 1 }));
    const cs = inputs.map(classification), start = inputs[0]!.plan.durationMs - 600;
    const previous = scheduleGolferReactions(null, batch(inputs.map((v, i) => actor(v, start - 1, cs[i]!)), 0, { quality })).state;
    const next = scheduleGolferReactions(previous, batch(inputs.map((v, i) => actor(v, start, cs[i]!)), 1, { quality }));
    expect(next.state!.records).toHaveLength(100); expect(eligible(next)).toHaveLength(cap);
    expect(eligible(next).map((o) => o.classification!.result).sort()).toEqual(cap === 2 ? ["exceptional", "hole-out"] : cap === 1 ? ["hole-out"] : []);
    expect(next.state!.records.every((r) => r.consumed)).toBe(true);
    expect(eligible(scheduleGolferReactions(next.state, batch(inputs.map((v, i) => actor(v, start + 1, cs[i]!)), 2, { quality: "high" })))).toHaveLength(cap);
  });
  it("enforces128 hard records, zero pending, expiry, and motion-off", () => {
    const input = fixture({ holed: true }), first = prime(input), c = first.c;
    expect(eligible(scheduleGolferReactions(first.previous, batch([actor(input, first.start, c)], 1001, { motionEnabled: false })))).toHaveLength(0);
    const retained = scheduleGolferReactions(null, batch([actor(input, 0, c)], 0));
    const expired = scheduleGolferReactions(retained.state, batch([actor(input, 1, c)], POLICY.maxRetentionMs + 1));
    expect(expired.state!.records[0]!.ownerKey).toBeNull();
    const actors = Array.from({ length: 129 }, (_, i) => actor(fixture({ actor: `a${i}`, holed: true }), 0));
    expect(scheduleGolferReactions(null, batch(actors, 0)).reason).toBe("invalid-batch");
    expect(scheduleGolferReactions(null, batch([actor(input, 0, c), actor(input, 0, c)], 0)).reason).toBe("invalid-or-duplicate-actor");
    expect(eligible(scheduleGolferReactions(first.result.state, batch([actor(input, first.start + 1, c)], 0)))).toHaveLength(0);
  });
  it("shares one cap across distinct LIVE/control scopes and revisions without flushing cooldowns", () => {
    const live = fixture({ holed: true }), raw = fixture({ actor: "controlled:1", holed: true });
    const controlOwner = { ...raw.owner, scopeId: "controlled:round-4" };
    const controlPlan = createShotPacingPlan({ scopeId: controlOwner.scopeId, actorId: controlOwner.actorId, motion: raw.motion, distanceYards: raw.retainedDistanceYards })!;
    const controlCursor = { ...raw.cursor, key: controlPlan.key };
    const control: ClassifyGolferReactionInput = { ...raw, owner: controlOwner, currentOwner: controlOwner, authorityRevision: "control:revision4", currentAuthorityRevision: "control:revision4",
      plan: controlPlan, cursor: controlCursor, frame: shotPacingFrame(controlPlan, controlCursor)!, observation: { ...raw.observation!, key: controlPlan.key, authorityRevision: "control:revision4" },
      physicalResult: { ...raw.physicalResult!, ownerKey: controlPlan.key, authorityRevision: "control:revision4" } };
    const lc = classification(live), cc = classification(control), start = live.plan.durationMs - 600;
    const session = { scopeId: "renderer:session1", authorityRevision: "renderer:lifecycle1", quality: "medium" as const };
    const before = scheduleGolferReactions(null, batch([actor(live, start - 1, lc), actor(control, start - 1, cc)], 0, session));
    const shown = scheduleGolferReactions(before.state, batch([actor(live, start, lc), actor(control, start, cc)], 1, session));
    expect(eligible(shown)).toHaveLength(1); expect(shown.state!.records).toHaveLength(2);
    expect(shown.state!.records.map((r) => r.authorityRevision).sort()).toEqual(["control:revision4", "rev:1"]);
    const continued = scheduleGolferReactions(shown.state, batch([actor(live, start + 1, lc), actor(control, start + 1, cc)], 2, { ...session, quality: "high" }));
    expect(eligible(continued)).toHaveLength(1); // Suppressed domain is consumed, never queued.
    expect(continued.state!.records.find((r) => r.active)!.lastCueAtMs).toBe(1);
  });
  it("preserves all128 cooldowns during overflow rather than evicting an actor into early replay", () => {
    // Medium admits one actor per frame. Build128 protected cooldowns without queues.
    let state: GolferReactionState | null = null;
    const inputs = Array.from({ length: 128 }, (_, i) => fixture({ actor: `protected:${i}`, holed: true }));
    let now = 0;
    for (const input of inputs) {
      const c = classification(input), start = input.plan.durationMs - 600;
      state = scheduleGolferReactions(state, batch([actor(input, start - 1, c)], now++, { quality: "medium" })).state;
      const next = scheduleGolferReactions(state, batch([actor(input, start, c)], now++, { quality: "medium" }));
      expect(eligible(next)).toHaveLength(1); state = next.state;
    }
    expect(state!.records).toHaveLength(128);
    const outsider = fixture({ actor: "overflow", holed: true }), oc = classification(outsider), start = outsider.plan.durationMs - 600;
    const overflow = scheduleGolferReactions(state, batch([actor(outsider, start - 1, oc)], now++));
    expect(overflow.outputs[0]!.reason).toBe("record-cap"); expect(overflow.state!.records).toHaveLength(128);
    const old = fixture({ actor: "protected:0", holed: true, identity: { shotNumber: 2, shotId: "second" } }), oldC = classification(old);
    const before = scheduleGolferReactions(overflow.state, batch([actor(old, start - 1, oldC)], now++));
    expect(eligible(scheduleGolferReactions(before.state, batch([actor(old, start, oldC)], now++)))).toHaveLength(0);
  });
  it("freezes cooldown active age across a paused domain, then requires8s after resuming", () => {
    const input = fixture({ holed: true }), first = prime(input);
    const held = scheduleGolferReactions(first.result.state, batch([actor(input, first.start, first.c, { paused: true })], 20000));
    const resumed = scheduleGolferReactions(held.state, batch([actor(input, first.start + 1, first.c)], 21000));
    // Resuming may advance the shared cursor; the held actor cooldown must not age during pause.
    const nextInput = fixture({ holed: true, identity: { shotNumber: 2, shotId: "next" } }), nc = classification(nextInput);
    const before = scheduleGolferReactions(resumed.state, batch([actor(nextInput, first.start - 1, nc)], 22000));
    expect(eligible(scheduleGolferReactions(before.state, batch([actor(nextInput, first.start, nc)], 22001)))).toHaveLength(0);
  });
  it("is deterministic, immutable and calls no RNG/gameplay clock", () => {
    const input = fixture({ holed: true }), first = prime(input), value = batch([actor(input, first.start + 1, first.c)], 1002), before = structuredClone(value), stateBefore = structuredClone(first.result.state);
    const rng = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("RNG forbidden"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock forbidden"); });
    try {
      const a = scheduleGolferReactions(first.result.state, value), b = scheduleGolferReactions(first.result.state, value);
      expect(a).toEqual(b); expect(value).toEqual(before); expect(first.result.state).toEqual(stateBefore);
      expect(Object.isFrozen(a.state!.records[0])).toBe(true); expect(Object.isFrozen(a.outputs[0]!.outcome)).toBe(true);
      expect(a.state!.records[0]!.active).toBe(first.c);
    } finally { rng.mockRestore(); clock.mockRestore(); }
  });
  it("invalid-batch recovery cannot erase a current actor cooldown", () => {
    const firstInput = fixture({ holed: true }), first = prime(firstInput);
    const invalid = scheduleGolferReactions(first.result.state, batch([null] as unknown as GolferReactionActor[], 1002));
    expect(invalid.state!.records[0]!.active).toBeNull(); expect(invalid.state!.records[0]!.lastCueAtMs).toBe(1001);
    const nextInput = fixture({ holed: true, identity: { shotId: "next", shotNumber: 2 } }), nc = classification(nextInput);
    const before = scheduleGolferReactions(invalid.state, batch([actor(nextInput, first.start - 1, nc)], 2000));
    expect(eligible(scheduleGolferReactions(before.state, batch([actor(nextInput, first.start, nc)], 2001)))).toHaveLength(0);
  });
  it("fails safely on malformed batches and untrusted restored scheduler state", () => {
    expect(scheduleGolferReactions(null, { ...batch([], 0), presentationTimeMs: NaN }).state).toBeNull();
    expect(scheduleGolferReactions(null, batch([null] as unknown as GolferReactionActor[], 0)).state).toBeNull();
    expect(scheduleGolferReactions({} as GolferReactionState, batch([], 0)).state!.records).toEqual([]);
  });
});
