import { describe, expect, it } from "vitest";
import {
  NATURAL_GOLFER_ACTIVITY_POLICY as policy,
  admitGolferActivity,
  golferActivityOwnerKey,
  projectGolferActivity,
  type ActivityClipPair,
  type ActivityQuality,
  type GolferActivityFacts,
  type GolferActivityProjection,
  type GolferActivityState,
} from "./golferActivity";

const copy = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function facts(t = 0, kind: "swing" | "putt" = "swing", actorId = "golfer:1"): GolferActivityFacts {
  const owner = { scopeId: "run:7/day:3/reconcile:2", actorId, shot: { shotId: "shot:1", holeId: "hole:4", shotNumber: 1, seed: 7, club: kind === "putt" ? "Putter" : "Driver", style: kind === "putt" ? "putt" : "straight_run", modelVersion: "m1" } };
  const key = golferActivityOwnerKey(owner)!;
  const addressMs = kind === "putt" ? 500 : 1000, contactMs = kind === "putt" ? 150 : 200, restMs = kind === "putt" ? 650 : 900;
  const durationMs = kind === "putt" ? 2850 : 7000, launch = addressMs + contactMs, endpoint = durationMs - restMs;
  const motionProgress = Math.max(0, Math.min(1, (t - launch) / (endpoint - launch))), firstContactT = kind === "putt" ? 0 : .6;
  return {
    version: 1, owner, currentOwner: copy(owner), authorityRevision: "epoch:2", currentAuthorityRevision: "epoch:2",
    root: { horizontal: "tiles", vertical: "yards", x: 10, y: 12, heightYards: 4 }, facingOctant: 2, targetOctant: 0,
    handedness: null, equipmentClass: null, movement: null,
    playback: {
      plan: { version: 1, scopeId: owner.scopeId, actorId, key, identity: copy(owner.shot), kind, durationMs, addressMs, contactMs, restMs, firstContactT },
      cursor: { version: 1, key, elapsedMs: t },
      frame: { key, shotId: owner.shot.shotId, progress: t / durationMs, motionProgress, phase: t === durationMs ? "complete" : t < addressMs ? "address" : t < launch ? "contact" : t >= endpoint ? "rest" : motionProgress < firstContactT ? "flight" : "roll", addressing: t < launch, complete: t === durationMs },
      retainedEvidence: { key, validated: true },
    },
    outcome: null, clips: [], mode: "overview", followExplicit: false, visibility: "visible", quality: "high", motionEnabled: true,
    paused: false, hidden: false, discontinuity: "none", presentationTimeMs: t,
  };
}
function withFacts(f: GolferActivityFacts, change: Partial<GolferActivityFacts>): GolferActivityFacts { return { ...f, ...change }; }
function available(kind: "swing" | "putt" = "swing"): ActivityClipPair {
  return { id: `adult-${kind}-e-rh`, role: kind, targetOctant: 0, handedness: "right", equipmentClass: kind === "putt" ? "putter" : "driver", row: 0, frames: kind === "putt" ? 4 : 8, contactFrame: kind === "putt" ? 2 : 5, mirror: false, validated: true };
}
function walk(distanceTiles: number, x = 10): GolferActivityFacts {
  const f = facts();
  return { ...f, owner: { ...f.owner, shot: null }, currentOwner: { ...f.currentOwner, shot: null }, root: { ...f.root, x }, playback: null, targetOctant: null,
    movement: { legal: true, segmentId: "segment:3", routeRevision: "route:1", currentRouteRevision: "route:1", distanceTiles, walkingOn: false } };
}

describe("projectGolferActivity — pinned pure foundation", () => {
  it.each([
    ["swing", 0, "settle", 0], ["swing", 599.999, "settle", 0], ["swing", 600, "address", 0], ["swing", 800, "backswing", 0],
    ["swing", 999.999, "backswing", 4], ["swing", 1000, "contact", 4], ["swing", 1199.999, "contact", 4], ["swing", 1200, "contact", 5],
    ["swing", 1200.001, "follow-through", 6], ["swing", 1350, "follow-through", 7], ["swing", 1500, "watch", 0], ["swing", 6100, "watch", 0], ["swing", 7000, "watch", 0],
    ["putt", 0, "settle", 0], ["putt", 300, "address", 0], ["putt", 400, "backswing", 0], ["putt", 499.999, "backswing", 1],
    ["putt", 500, "contact", 1], ["putt", 649.999, "contact", 1], ["putt", 650, "contact", 2], ["putt", 650.001, "follow-through", 3], ["putt", 800, "watch", 0],
  ] as const)("%s at %dms uses %s frame %d", (kind, t, phase, col) => {
    const result = projectGolferActivity(policy, facts(t, kind));
    expect(result.pose).toMatchObject({ phase, col, root: facts(t, kind).root });
    expect(result.nextState?.elapsedMs).toBe(t);
  });

  it("keeps exact contact and equal poses at 30/60/120Hz and all operating tiers", () => {
    for (const kind of ["swing", "putt"] as const) for (const hz of [30, 60, 120]) for (const _tier of ["1x", "2x", "4x"]) {
      let previous: GolferActivityState | null = null;
      const duration = facts(0, kind).playback!.plan.durationMs, launch = kind === "swing" ? 1200 : 650;
      for (let index = 0; index <= Math.ceil(duration * hz / 1000); index++) {
        const t = Math.min(duration, index * 1000 / hz), f = facts(t, kind), before = copy(f);
        const result = projectGolferActivity(policy, freeze(f), previous);
        expect(result.pose).toEqual(projectGolferActivity(policy, before).pose);
        if (t < launch && result.pose?.clipId === kind) expect(result.pose.col).toBeLessThan(kind === "swing" ? 5 : 2);
        expect(f).toEqual(before);
        previous = result.nextState;
      }
      expect(projectGolferActivity(policy, facts(launch, kind)).pose?.col).toBe(kind === "swing" ? 5 : 2);
    }
  });

  it("validates every owner field and current authority revision before pause", () => {
    const before = projectGolferActivity(policy, facts(900)).nextState;
    for (const field of ["scopeId", "actorId", "shotId", "holeId", "shotNumber", "seed", "club", "style", "modelVersion"]) {
      const f = copy(facts(900));
      const o = f.currentOwner as unknown as Record<string, unknown>;
      const target = field in o ? o : o.shot as Record<string, unknown>;
      target[field] = typeof target[field] === "number" ? (target[field] as number) + 1 : `${target[field]}:changed`;
      const r = projectGolferActivity(policy, { ...f, paused: true }, before);
      expect(r.nextState).toBeNull(); expect(r.pose?.clipId).toBe("idle"); expect(r.reason).toBe("owner-invalidated");
    }
    expect(projectGolferActivity(policy, withFacts(facts(900), { paused: true, currentAuthorityRevision: "new-epoch" }), before).reason).toBe("owner-invalidated");
    const a = facts().owner, b = facts().owner;
    expect(golferActivityOwnerKey({ ...a, scopeId: "a:b", actorId: "c" })).not.toBe(golferActivityOwnerKey({ ...b, scopeId: "a", actorId: "b:c" }));
  });

  it("uses target rather than facing; known hands require an exact available hand/equipment pair", () => {
    expect(projectGolferActivity(policy, facts(1200)).pose).toMatchObject({ row: 2, mirror: true, directionOctant: 0, renderedHandedness: null, fallbackReason: "legacy-unverified-strike" });
    const known = withFacts(facts(1200), { handedness: "right", equipmentClass: "driver" });
    expect(projectGolferActivity(policy, known).pose).toMatchObject({ clipId: "idle", phase: "watch", renderedHandedness: null, reaction: null });
    expect(projectGolferActivity(policy, { ...known, clips: [available()] }).pose).toMatchObject({ clipId: available().id, col: 5, mirror: false, renderedHandedness: "right", renderedEquipmentClass: "driver" });
    for (const changes of [{ handedness: "left" as const }, { equipmentClass: "iron" as const }, { targetOctant: 1 }, { targetOctant: null }, { equipmentClass: null }]) {
      expect(projectGolferActivity(policy, { ...known, ...changes, clips: [available()] }).pose?.clipId).toBe("idle");
    }
    expect(projectGolferActivity(policy, { ...facts(1200), equipmentClass: "none" }).reason).toBe("equipment-kind-mismatch");
    expect(projectGolferActivity(policy, { ...facts(1200), equipmentClass: "putter" }).reason).toBe("equipment-kind-mismatch");
  });

  it.each(["swing", "putt"] as const)("matches explicit generic %s motion without certifying a pictured equipment class", (role) => {
    const compatibleEquipmentClasses = role === "swing" ? ["driver", "iron", "wedge"] as const : ["putter"] as const;
    const pair: ActivityClipPair = { ...available(role), id: `generic-${role}`, equipmentClass: null, compatibleEquipmentClasses };
    for (const equipmentClass of compatibleEquipmentClasses) {
      const f = { ...facts(role === "swing" ? 1200 : 650, role), handedness: "right" as const, equipmentClass, clips: [pair] };
      expect(projectGolferActivity(policy, f).pose).toMatchObject({ clipId: pair.id, renderedHandedness: "right", renderedEquipmentClass: null, col: pair.contactFrame, fallbackReason: null });
      for (const changes of [{ handedness: "left" as const }, { targetOctant: 1 }, { targetOctant: null }, { equipmentClass: null }]) {
        expect(projectGolferActivity(policy, { ...f, ...changes }).pose?.clipId).toBe("idle");
      }
    }
    const f = { ...facts(role === "swing" ? 1200 : 650, role), handedness: "right" as const, equipmentClass: compatibleEquipmentClasses[0], clips: [pair, available(role)] };
    expect(projectGolferActivity(policy, f).pose?.renderedEquipmentClass).toBe(compatibleEquipmentClasses[0]);
  });

  it("rejects missing, ambiguous or role-incompatible generic compatibility lists", () => {
    const f = { ...facts(1200), handedness: "right" as const, equipmentClass: "driver" as const };
    for (const compatibleEquipmentClasses of [undefined, [], ["driver", "driver"], ["putter"], ["none"], ["unknown"], ["driver", "iron", "wedge", "putter"]]) {
      const pair = { ...available(), equipmentClass: null, compatibleEquipmentClasses };
      expect(projectGolferActivity(policy, { ...f, clips: [pair as ActivityClipPair] }).reason).toBe("invalid-carrier");
    }
    const pair: ActivityClipPair = { ...available(), equipmentClass: null, compatibleEquipmentClasses: ["iron"] };
    expect(projectGolferActivity(policy, { ...f, clips: [pair] }).pose?.clipId).toBe("idle");
    expect(projectGolferActivity(policy, { ...f, clips: [pair, { ...pair, id: "duplicate" }] }).reason).toBe("invalid-carrier");
  });

  it("rejects malformed JSON/carriers, invalid clip claims, evidence mismatches, and shared frame divergence", () => {
    const changes: ((f: Record<string, unknown>) => void)[] = [
      (f) => { f.extra = true; }, (f) => { f.presentationTimeMs = NaN; }, (f) => { f.quality = "ultra"; },
      (f) => { f.root = { ...(f.root as object), horizontal: "pixels" }; },
      (f) => { (f.playback as { cursor: { elapsedMs: number } }).cursor.elapsedMs = Infinity; },
      (f) => { f.clips = [{ ...available(), mirror: true }]; }, (f) => { f.clips = [{ ...available(), contactFrame: 4 }]; },
      (f) => { Object.defineProperty(f, "owner", { get() { throw Error("must not run"); }, enumerable: true }); },
      (f) => { f["hidden"] = undefined; }, (f) => { Object.setPrototypeOf(f, { inherited: true }); },
    ];
    for (const mutate of changes) { const f = copy(facts()) as unknown as Record<string, unknown>; mutate(f); expect(projectGolferActivity(policy, f as unknown as GolferActivityFacts).nextState).toBeNull(); }
    for (const change of [
      (f: GolferActivityFacts) => ({ ...f, playback: { ...f.playback!, retainedEvidence: { ...f.playback!.retainedEvidence, key: "other" } } }),
      (f: GolferActivityFacts) => ({ ...f, playback: { ...f.playback!, frame: { ...f.playback!.frame, phase: "rest" as const } } }),
      (f: GolferActivityFacts) => ({ ...f, playback: { ...f.playback!, cursor: { ...f.playback!.cursor, key: "other" } } }),
      (f: GolferActivityFacts) => ({ ...f, playback: { ...f.playback!, frame: { ...f.playback!.frame, progress: .5 } } }),
    ]) expect(projectGolferActivity(policy, change(facts(900))).reason).toBe("invalid-shared-playback");
  });

  it("preserves paused poses through both accessibility toggles; root/time changes still invalidate", () => {
    const f = facts(900), before = projectGolferActivity(policy, f).nextState;
    const paused = { ...f, paused: true, motionEnabled: false };
    const held = projectGolferActivity(policy, paused, before);
    expect(held.pose).toEqual(before?.pose);
    expect(projectGolferActivity(policy, { ...paused, motionEnabled: true }, held.nextState).pose).toEqual(before?.pose);
    expect(projectGolferActivity(policy, { ...paused, root: { ...f.root, x: 11 } }, before).nextState).toBeNull();
    expect(projectGolferActivity(policy, { ...facts(901), paused: true }, before).nextState).toBeNull();
    const idle = projectGolferActivity(policy, { ...f, motionEnabled: false }).nextState;
    expect(projectGolferActivity(policy, { ...f, paused: true }, idle).pose).toEqual(idle?.pose);
  });

  it("discards hidden, culled, reload, reveal and skip choreography even when paused", () => {
    const old = projectGolferActivity(policy, facts(900)).nextState;
    for (const changes of [{ hidden: true }, { visibility: "culled" as const }, ...["reload", "reveal", "skip"].map((discontinuity) => ({ discontinuity: discontinuity as "reload" | "reveal" | "skip" }))]) {
      const r = projectGolferActivity(policy, { ...facts(900), paused: true, ...changes }, old);
      expect(r.nextState).toBeNull(); expect(r.pose?.clipId).toBe("idle");
    }
    expect(projectGolferActivity(policy, { ...facts(900), mode: "follow", followExplicit: false }).reason).toBe("follow-not-explicit");
    expect(projectGolferActivity(policy, { ...facts(900), mode: "overview" }).nextState?.foreground).toBe(false);
    expect(projectGolferActivity(policy, { ...facts(900), mode: "follow", followExplicit: true }).nextState?.foreground).toBe(true);
  });

  it("only uses present legal movement and never invents a route or time-driven gait", () => {
    const f = walk(.2, 10.2), p = projectGolferActivity(policy, f);
    expect(p.pose).toMatchObject({ phase: "walk", clipId: "walk", col: 1, root: f.root });
    expect(projectGolferActivity(policy, { ...f, presentationTimeMs: 500 }, p.nextState).pose).toEqual(p.pose);
    expect(projectGolferActivity(policy, { ...f, movement: { ...f.movement!, walkingOn: true } }).pose?.phase).toBe("walk-on");
    expect(projectGolferActivity(policy, { ...f, movement: { ...f.movement!, currentRouteRevision: "new" } }).pose?.clipId).toBe("idle");
    expect(projectGolferActivity(policy, { ...f, movement: null }).pose?.clipId).toBe("idle");
    expect(projectGolferActivity(policy, { ...f, motionEnabled: false }).pose?.clipId).toBe("idle");
    expect(projectGolferActivity(policy, { ...walk(.4, 10.2), presentationTimeMs: 500 }, p.nextState).reason).toBe("movement-evidence-changed");
    expect(projectGolferActivity(policy, { ...f, paused: true, movement: { ...f.movement!, currentRouteRevision: "new" } }, p.nextState).reason).toBe("stale-route");
  });

  it("shows one static evidenced endpoint cue, suppresses unknown/repeated historical outcomes and low quality", () => {
    for (const kind of ["swing", "putt"] as const) {
      const start = facts(0, kind).playback!.plan.durationMs - 600;
      const before = projectGolferActivity(policy, facts(start - 1, kind)).nextState;
      const base = facts(start, kind);
      const f = { ...base, outcome: { key: base.playback!.plan.key, endpointObserved: true as const, evidenceId: "observed:1", result: "good" as const, eligible: true } };
      const cue = projectGolferActivity(policy, f, before);
      expect(cue.pose).toMatchObject({ phase: "reaction", clipId: "idle", col: 0, reaction: "nod" });
      expect(projectGolferActivity(policy, f, cue.nextState).pose).toEqual(cue.pose);
      expect(projectGolferActivity(policy, f).pose?.reaction).toBeNull();
      expect(projectGolferActivity(policy, { ...f, quality: "low" }, before).pose?.reaction).toBeNull();
      expect(projectGolferActivity(policy, { ...f, outcome: null }, before).pose?.reaction).toBeNull();
      expect(projectGolferActivity(policy, { ...f, discontinuity: "reload" }, before).nextState).toBeNull();
      expect(projectGolferActivity(policy, { ...f, outcome: { ...f.outcome, key: "other-shot" } }, before).nextState).toBeNull();
    }
  });

  it("caps retention without another clock and never mutates frozen authority or prior state", () => {
    const first = projectGolferActivity(policy, freeze(walk(0))).nextState!;
    const before = copy(first);
    expect(projectGolferActivity(policy, { ...walk(0), presentationTimeMs: 10000 }, freeze(first)).nextState).not.toBeNull();
    expect(projectGolferActivity(policy, { ...walk(0), presentationTimeMs: 10001 }, first).reason).toBe("retention-expired");
    expect(first).toEqual(before);
    for (const forbidden of ["pending", "events", "completion", "audio", "settlement", "hold", "debit"]) expect(projectGolferActivity(policy, facts()).nextState).not.toHaveProperty(forbidden);
  });

  it("rejects same-owner shared-plan resizing and motion-ratio corruption without advancing anything", () => {
    const old = projectGolferActivity(policy, facts(900)).nextState;
    const resized = copy(facts(1000));
    const plan = { ...resized.playback!.plan, durationMs: 9000 };
    const input = { ...resized, playback: { ...resized.playback!, plan, frame: { ...resized.playback!.frame, progress: 1000 / 9000 } } };
    expect(projectGolferActivity(policy, input, old).reason).toBe("shared-plan-changed");
    const changedRatio = facts(3000);
    expect(projectGolferActivity(policy, { ...changedRatio, playback: { ...changedRatio.playback!, frame: { ...changedRatio.playback!.frame, motionProgress: .9 } } }).reason).toBe("invalid-shared-playback");
  });
});

describe("actual bounded admission", () => {
  function replacementFacts(t: number, replacement: "owner" | "revision" | "current"): GolferActivityFacts {
    const f = facts(t, "swing", "actor:A");
    if (replacement === "revision") return { ...f, authorityRevision: "epoch:3", currentAuthorityRevision: "epoch:3" };
    if (replacement === "current") return f;
    const owner = { ...f.owner, shot: { ...f.owner.shot!, shotId: "shot:2" } }, key = golferActivityOwnerKey(owner)!;
    return { ...f, owner, currentOwner: copy(owner), playback: { ...f.playback!,
      plan: { ...f.playback!.plan, key, identity: copy(owner.shot) }, cursor: { ...f.playback!.cursor, key },
      frame: { ...f.playback!.frame, key, shotId: owner.shot.shotId }, retainedEvidence: { key, validated: true } } };
  }
  function cue(f: GolferActivityFacts, previous: GolferActivityState | null): GolferActivityProjection {
    return projectGolferActivity(policy, { ...f, outcome: { key: f.playback!.plan.key, endpointObserved: true, evidenceId: "observed:1", result: "good", eligible: true } }, previous);
  }

  it.each([
    ["foreground-cap", "owner"], ["foreground-cap", "revision"], ["foreground-cap", "current"],
    ["activity-cap", "owner"], ["activity-cap", "revision"], ["activity-cap", "current"],
    ["reaction-cap", "owner"], ["reaction-cap", "revision"], ["reaction-cap", "current"],
  ] as const)("%s failure removes only obsolete same-actor %s records", (failure, replacement) => {
    const oldA = projectGolferActivity(policy, facts(6399, "swing", "actor:A")).nextState!;
    let others: GolferActivityState[], candidate: GolferActivityProjection;
    if (failure === "foreground-cap") {
      others = [projectGolferActivity(policy, { ...facts(6400, "swing", "actor:B"), mode: "controlled" }).nextState!];
      candidate = projectGolferActivity(policy, { ...replacementFacts(6400, replacement), mode: "controlled" });
    } else if (failure === "activity-cap") {
      others = Array.from({ length: 4 }, (_, i) => projectGolferActivity(policy, facts(6400, "swing", `other:${i}`)).nextState!);
      candidate = projectGolferActivity(policy, { ...replacementFacts(6400, replacement), quality: "low" });
    } else {
      others = ["actor:B", "actor:C"].map((actorId) => cue(facts(6400, "swing", actorId), projectGolferActivity(policy, facts(6399, "swing", actorId)).nextState).nextState!);
      candidate = cue(replacementFacts(6400, replacement), projectGolferActivity(policy, replacementFacts(6399, replacement)).nextState);
      expect(candidate.pose?.reaction).toBe("nod");
    }
    const records = freeze([oldA, ...others]), before = copy(records);
    const result = admitGolferActivity(policy, records, freeze(candidate), 6400);
    expect(result.projection.reason).toBe(failure);
    expect(result.projection.pose).toMatchObject({ clipId: "idle", reaction: null, ownerKey: candidate.pose!.ownerKey, authorityRevision: candidate.pose!.authorityRevision });
    expect(result.projection.nextState).toBeNull();
    expect(result.records).toEqual(replacement === "current" ? before : others);
    expect(records).toEqual(before);
    expect(result.records.filter((state) => state.actorKey === oldA.actorKey)).toHaveLength(replacement === "current" ? 1 : 0);
  });

  it.each([ ["high", 16], ["medium", 8], ["low", 4] ] as const)("%s admits only %d of 150 actors without a pending queue", (quality, cap) => {
    let records: readonly GolferActivityState[] = [];
    for (let index = 0; index < 150; index++) {
      const projected = projectGolferActivity(policy, { ...facts(900, "swing", `actor:${index}`), quality });
      const admitted = admitGolferActivity(policy, freeze(records), freeze(projected), 900);
      records = admitted.records;
      expect(records.length).toBeLessThanOrEqual(cap);
      if (index >= cap) { expect(admitted.projection.nextState).toBeNull(); expect(admitted.projection.pose?.clipId).toBe("idle"); }
    }
    expect(records).toHaveLength(cap);
  });

  it("counts actual foreground owners, permits same-actor replacement, and discards culled records", () => {
    const f = { ...facts(900), mode: "follow" as const, followExplicit: true };
    const a = admitGolferActivity(policy, [], projectGolferActivity(policy, f), 900);
    const other = projectGolferActivity(policy, { ...facts(900, "swing", "other"), mode: "controlled" });
    expect(admitGolferActivity(policy, a.records, other, 900).projection.reason).toBe("foreground-cap");
    const replacement = admitGolferActivity(policy, a.records, projectGolferActivity(policy, f, a.records[0]), 900);
    expect(replacement.records).toHaveLength(1);
    const culled = projectGolferActivity(policy, { ...f, visibility: "culled" }, replacement.records[0]);
    expect(admitGolferActivity(policy, replacement.records, culled, 900).records).toHaveLength(0);
  });

  it("rejects duplicate actor/owner carriers and over128 records rather than trusting allocation claims", () => {
    const state = projectGolferActivity(policy, facts(900)).nextState!;
    const p = projectGolferActivity(policy, facts(900, "swing", "new"));
    expect(admitGolferActivity(policy, [state, state], p, 900).projection.reason).toBe("invalid-admission-records");
    const records = Array.from({ length: 129 }, (_, i) => projectGolferActivity(policy, facts(900, "swing", `actor:${i}`)).nextState!);
    expect(admitGolferActivity(policy, records, p, 900).projection.reason).toBe("invalid-admission-carrier");
    const accessor = { get pose() { throw Error("must not run"); }, nextState: null, reason: null };
    expect(admitGolferActivity(policy, [], accessor as unknown as GolferActivityProjection, 900).projection.reason).toBe("invalid-admission-carrier");
  });

  it("preserves admitted records on overflow and prunes only expired caller-time records", () => {
    const records = Array.from({ length: 16 }, (_, i) => projectGolferActivity(policy, facts(900, "swing", `actor:${i}`)).nextState!);
    const before = copy(records), candidate = projectGolferActivity(policy, facts(900, "swing", "overflow"));
    expect(admitGolferActivity(policy, freeze(records), candidate, 900).records).toEqual(before);
    const expired = admitGolferActivity(policy, records, projectGolferActivity(policy, { ...facts(900, "swing", "new"), presentationTimeMs: 10901 }), 10901);
    expect(expired.records).toHaveLength(1);
    const backwards = admitGolferActivity(policy, records, candidate, 899);
    expect(backwards.projection.reason).toBe("nonmonotonic-admission"); expect(backwards.records).toEqual(records);
    const invalidCandidate = admitGolferActivity(policy, records, { ...candidate, pose: {} as unknown as NonNullable<GolferActivityProjection["pose"]>, nextState: null }, 900);
    expect(invalidCandidate.projection.reason).toBe("invalid-admission-carrier"); expect(invalidCandidate.records).toEqual(records);
  });

  it("mixed quality cannot bypass actual global caps and forged actor keys cannot replace another actor", () => {
    const records = Array.from({ length: 4 }, (_, i) => projectGolferActivity(policy, { ...facts(900, "swing", `actor:${i}`), quality: "low" as const }).nextState!);
    expect(admitGolferActivity(policy, records, projectGolferActivity(policy, facts(900, "swing", "new")), 900).projection.reason).toBe("activity-cap");
    const forged = { ...projectGolferActivity(policy, facts(900, "swing", "forged")).nextState!, actorKey: records[0].actorKey };
    expect(admitGolferActivity(policy, records, { pose: forged.pose, nextState: forged, reason: null }, 900).projection.reason).toBe("invalid-admission-candidate");
    const over128 = Array.from({ length: 128 }, (_, i) => projectGolferActivity(policy, facts(900, "swing", `actor:${i}`)).nextState!);
    expect(admitGolferActivity(policy, over128, projectGolferActivity(policy, facts(900, "swing", "new")), 900).projection.reason).toBe("invalid-admission-records");
  });

  it.each([ ["high", 2], ["medium", 1], ["low", 0] ] as const)("%s counts actual static reaction cues against cap%d", (quality: ActivityQuality, cap) => {
    let records: readonly GolferActivityState[] = [];
    for (let i = 0; i < 3; i++) {
      const before = projectGolferActivity(policy, { ...facts(6399, "swing", `actor:${i}`), quality }).nextState;
      const base = facts(6400, "swing", `actor:${i}`);
      const f = { ...base, quality, outcome: { key: base.playback!.plan.key, endpointObserved: true as const, evidenceId: `outcome:${i}`, result: "good" as const, eligible: true } };
      const result = admitGolferActivity(policy, records, projectGolferActivity(policy, f, before), 6400);
      records = result.records;
      expect(records.filter((state) => state.pose.reaction !== null).length).toBeLessThanOrEqual(cap);
    }
  });
});
