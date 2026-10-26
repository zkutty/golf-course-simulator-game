import { describe, expect, it } from "vitest";
import type { PlayerShotTrace } from "../../game/models/playerProTypes";
import { createPlayerShotPlaybackDriver } from "./usePlayerShotPlayback";
import { createRetainedShotMotion } from "../../game/rules/shotMotion";
import { resolveObstacleCollision } from "../../game/rules/obstacleCollision";

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
});
