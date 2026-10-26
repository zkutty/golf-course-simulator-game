import { describe, expect, it } from "vitest";
import type { PlayerShotTrace } from "../../game/models/playerProTypes";
import { createPlayerShotPlaybackDriver } from "./usePlayerShotPlayback";
import { createRetainedShotMotion } from "../../game/rules/shotMotion";
import { resolveObstacleCollision } from "../../game/rules/obstacleCollision";
import { playerShotActivityIsCurrent } from "../../game/playerPro/shotPlayback";
import { shotPacingFrame } from "../../game/live/shotPacing";
import type { PlayerPlayableRound } from "../../game/models/playerProTypes";

const at = (x: number) => ({ point: { x, y: 1 }, heightYards: 0 });
const flight = resolveObstacleCollision({ from: { x: 1, y: 1 }, to: { x: 11, y: 1 }, flight: { profile: "standard", apexHeightYards: 4 },
  width: 16, height: 16, yardsPerTile: 10, elevations: new Array(256).fill(0), obstacles: [], retainGeometry: true }).retained!;
const motion = createRetainedShotMotion({ identity: { shotId: "s1", holeId: "h1", shotNumber: 1, seed: 1, club: "Driver", style: "normal", modelVersion: "physical_shot_v1" },
  yardsPerTile: 10, from: at(1), landing: at(11), physicalRest: at(12), flight, rollPath: [at(11), at(12)], holed: true })!;
const shot = { id: "s1", club: "Driver", carryYards: 250, rollYards: 10, sharedOutcome: { motion } } as unknown as PlayerShotTrace;

describe("Player Pro independent presentation driver", () => {
  it("keeps the address stationary, advances intermediate motion and claims completion exactly once", () => {
    const clock = createPlayerShotPlaybackDriver(shot);
    const events: string[] = [];
    let completions = 0;
    for (let index = 0; index < 500; index += 1) {
      const next = clock.advance(20);
      events.push(...next.events.map((event) => event.kind));
      if (next.complete) completions += 1;
      if (next.frame.addressing) expect(next.frame.motionProgress).toBe(0);
      if (next.frame.progress > .3 && next.frame.progress < .9) expect(next.frame.motionProgress).toBeGreaterThan(0);
    }
    expect(events).toEqual(["contact", "first_contact", "hole_out"]);
    expect(completions).toBe(1);
    expect(clock.advance(1000).complete).toBe(false);
  });

  it("freezes paused/modal/hidden time, caps background gaps and resumes the same shot cursor", () => {
    const clock = createPlayerShotPlaybackDriver(shot, { version: 1, shotId: "s1", progress: .65 });
    const before = clock.cursor();
    expect(clock.advance(60_000, true).frame.progress).toBe(.65);
    expect(clock.cursor()).toEqual(before);
    const resumed = clock.advance(60_000);
    expect(resumed.frame.progress).toBeCloseTo(.65 + 100 / clock.plan.durationMs);
    expect(resumed.events).toEqual([]);
    const restored = createPlayerShotPlaybackDriver(shot, JSON.parse(JSON.stringify(clock.cursor())));
    const resumedEvents: string[] = [];
    for (let index = 0; index < 500; index += 1) resumedEvents.push(...restored.advance(20).events.map((event) => event.kind));
    expect(resumedEvents).toEqual(["first_contact", "hole_out"]);
  });

  it("skip/reduced motion use final authority once without a burst of skipped sounds", () => {
    const clock = createPlayerShotPlaybackDriver(shot);
    expect(clock.advance(0, false, true)).toMatchObject({ frame: { complete: true, progress: 1, motionProgress: 1 }, complete: true, events: [] });
    expect(clock.advance(0, false, true).complete).toBe(false);
    expect(clock.advance(20).events).toEqual([]);
    const hidden = createPlayerShotPlaybackDriver(shot);
    expect(hidden.advance(100, false, true, true).frame.progress).toBe(0);
    const other = { ...shot, id: "s2", sharedOutcome: { ...shot.sharedOutcome!, motion: { ...motion, identity: { ...motion.identity, shotId: "s2" } } } };
    const next = createPlayerShotPlaybackDriver(other, { version: 1, shotId: "s1", progress: .9 });
    expect(next.cursor()).toEqual({ version: 1, shotId: "s2", progress: 0 });
  });

  it("reload at a completed cursor claims one pending finish without replaying contact or scores", () => {
    const clock = createPlayerShotPlaybackDriver(shot, { version: 1, shotId: "s1", progress: 1 });
    expect(clock.advance(0)).toMatchObject({ complete: true, events: [] });
    expect(clock.advance(0)).toMatchObject({ complete: false, events: [] });
  });

  it.each(["swing", "putt"] as const)("snapshots actual%s shared cursors at launch±epsilon with full actor/round/hand identity", (kind) => {
    const retained = kind === "swing" ? motion : createRetainedShotMotion({ identity: { ...motion.identity, club: "Putter", style: "putt" }, yardsPerTile: 10,
      from: at(1), landing: at(1), physicalRest: at(3), flight: null, rollPath: [at(1), at(3)], reliefPosition: null, holed: false })!;
    const trace = { ...shot, club: retained.identity.club, carryYards: kind === "swing" ? shot.carryYards : 0, rollYards: kind === "swing" ? shot.rollYards : 20,
      sharedOutcome: { ...shot.sharedOutcome!, motion: retained } };
    for (const offset of [-.001, 0, .001]) {
      const driver = createPlayerShotPlaybackDriver(trace, undefined, "round:7", "participant:3", "left");
      const launch = driver.plan.addressMs + driver.plan.contactMs, target = launch + offset;
      while (driver.sample()!.cursor.elapsedMs < target) driver.advance(Math.min(100, target - driver.sample()!.cursor.elapsedMs));
      const sample = driver.sample()!;
      expect(sample).toMatchObject({ roundId: "round:7", actorId: "participant:3", handedness: "left", owner: { scopeId: "round:7", actorId: "participant:3", shot: retained.identity },
        origin: { horizontal: "tiles", vertical: "yards", x: 1, y: 1, heightYards: 0 }, equipmentClass: kind === "putt" ? "putter" : "driver" });
      expect(sample.cursor.elapsedMs).toBeCloseTo(target, 10);
      expect(sample.frame).toEqual(shotPacingFrame(driver.plan, sample.cursor));
      expect(sample.frame.progress).toBe(driver.frame().progress);
      expect(sample.frame.motionProgress).toBe(driver.frame().motionProgress);
      expect(sample.frame.addressing).toBe(offset < 0);
      if (offset <= 0) expect(sample.frame.motionProgress).toBe(0);
      if (offset > 0) expect(sample.frame.motionProgress).toBeGreaterThan(0);
      expect(sample.plan.key).toBe(sample.key); expect(sample.retainedEvidence.key).toBe(sample.key);
      expect(sample.plan).not.toBe(driver.plan); expect(sample.owner.shot).not.toBe(retained.identity);
      expect(Object.isFrozen(sample)).toBe(true); expect(Object.isFrozen(sample.origin)).toBe(true); expect(Object.isFrozen(sample.frame)).toBe(true);
      expect(JSON.parse(JSON.stringify(sample))).toEqual(sample);
    }
  });

  it("keeps legacy hand unknown, snapshots only primitives, and cannot affect events/completion/checkpoints", () => {
    const source = structuredClone(shot), nested = { mutable: 1 }, callback = () => source;
    const sampled = createPlayerShotPlaybackDriver(source, undefined, "round:1", "actor:1"), reference = createPlayerShotPlaybackDriver(shot, undefined, "round:1", "actor:1");
    Object.assign(source.sharedOutcome!.motion!.from.point, { nested, callback });
    const before = JSON.stringify(source);
    const first = sampled.sample()!;
    expect(first.handedness).toBeNull(); expect(Object.keys(first.origin)).toEqual(["horizontal", "vertical", "x", "y", "heightYards"]);
    expect(first.origin).not.toHaveProperty("nested"); expect(first.targetWorld).not.toHaveProperty("callback");
    for (let index = 0; index < 500; index++) {
      const result = sampled.advance(20), other = reference.advance(20);
      sampled.sample(); sampled.sample();
      expect(result).toEqual(other); expect(sampled.cursor()).toEqual(reference.cursor());
    }
    expect(JSON.stringify(source)).toBe(before); expect(first.cursor.elapsedMs).toBe(0);
    expect(sampled.sample()!.frame.complete).toBe(true);
    expect(sampled.sample()).not.toHaveProperty("round"); expect(sampled.sample()).not.toHaveProperty("motion");
  });

  it("preserves pause/hidden/skip/reload samples without adding an advancement or historical event", () => {
    const driver = createPlayerShotPlaybackDriver(shot, { version: 1, shotId: shot.id, progress: .4 }, "round:1", "actor:1", "right"), before = driver.sample();
    driver.advance(1000, true); expect(driver.sample()).toEqual(before);
    driver.advance(1000, false, true, true); expect(driver.sample()).toEqual(before);
    expect(driver.advance(0, true, true)).toMatchObject({ complete: true, events: [] });
    expect(driver.sample()!.frame.complete).toBe(true);
    const restored = createPlayerShotPlaybackDriver(shot, driver.cursor(), "round:1", "actor:1", "right");
    expect(restored.sample()).toEqual(driver.sample());
    expect(restored.advance(0)).toMatchObject({ complete: true, events: [] });
    expect(restored.advance(0)).toMatchObject({ complete: false, events: [] });
  });

  it("rejects changed round, participant, hand and every retained field even under unchanged round/shot ids", () => {
    const driver = createPlayerShotPlaybackDriver(shot, undefined, "round:1", "actor:1", "right"), sample = driver.sample();
    const round = { id: "round:1", phase: "flight", pendingShot: shot, handedness: "right" } as PlayerPlayableRound;
    expect(playerShotActivityIsCurrent(sample, round, "actor:1")).toBe(true);
    expect(playerShotActivityIsCurrent(sample, { ...round, id: "other-round" }, "actor:1")).toBe(false);
    expect(playerShotActivityIsCurrent(sample, round, "other-actor")).toBe(false);
    expect(playerShotActivityIsCurrent(sample, { ...round, handedness: "left" }, "actor:1")).toBe(false);
    expect(playerShotActivityIsCurrent(sample, { ...round, phase: "awaiting_shot" }, "actor:1")).toBe(false);
    for (const key of Object.keys(motion.identity)) {
      const changed = structuredClone(shot), identity = changed.sharedOutcome!.motion!.identity as unknown as Record<string, string | number>;
      identity[key] = typeof identity[key] === "number" ? (identity[key] as number) + 1 : `${identity[key]}:new`;
      expect(playerShotActivityIsCurrent(sample, { ...round, pendingShot: changed }, "actor:1")).toBe(false);
    }
  });
});
