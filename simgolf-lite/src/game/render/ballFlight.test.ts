import { describe, expect, it } from "vitest";
import {
  AIR_FRAC,
  apexHeightPx,
  ballFlightPose,
  landingBehavior,
} from "./ballFlight";

const fairway = landingBehavior("fairway");
const sand = landingBehavior("sand");
const water = landingBehavior("water");
const green = landingBehavior("green");

describe("ballFlightPose — air phase", () => {
  it("starts and rests on the ground, apex mid-air", () => {
    const start = ballFlightPose(0, 20, "swing", fairway);
    expect(start.groundFrac).toBe(0);
    expect(start.heightPx).toBe(0);
    const apex = ballFlightPose(AIR_FRAC / 2, 20, "swing", fairway);
    expect(apex.heightPx).toBeCloseTo(apexHeightPx(20, "swing"), 5);
    const end = ballFlightPose(1, 20, "swing", fairway);
    expect(end.groundFrac).toBeCloseTo(1, 6);
    expect(end.heightPx).toBe(0);
  });

  it("shadow weakens as the ball rises and returns at touchdown", () => {
    const low = ballFlightPose(0.03, 20, "swing", fairway);
    const high = ballFlightPose(AIR_FRAC / 2, 20, "swing", fairway);
    expect(high.shadow).toBeLessThan(low.shadow);
    const grounded = ballFlightPose(0.99, 20, "swing", fairway);
    expect(grounded.shadow).toBeGreaterThanOrEqual(0.75);
  });

  it("touches down short of the rest point, then rolls forward only", () => {
    const touchdown = ballFlightPose(AIR_FRAC, 20, "swing", fairway);
    expect(touchdown.groundFrac).toBeLessThan(1);
    let prev = touchdown.groundFrac;
    for (let t = AIR_FRAC; t <= 1.0001; t += 0.02) {
      const p = ballFlightPose(t, 20, "swing", fairway);
      expect(p.groundFrac).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p.groundFrac;
    }
    expect(prev).toBeCloseTo(1, 6);
  });

  it("marks the ground phase with landed", () => {
    expect(ballFlightPose(AIR_FRAC - 0.01, 20, "swing", fairway).landed).toBe(false);
    expect(ballFlightPose(AIR_FRAC + 0.01, 20, "swing", fairway).landed).toBe(true);
  });
});

describe("ballFlightPose — surfaces", () => {
  it("fairway bounces, sand plugs dead", () => {
    let fairwayHopped = false;
    let sandHopped = false;
    for (let t = AIR_FRAC + 0.01; t < 1; t += 0.01) {
      if (ballFlightPose(t, 20, "swing", fairway).heightPx > 0.5) fairwayHopped = true;
      if (ballFlightPose(t, 20, "swing", sand).heightPx > 0) sandHopped = true;
    }
    expect(fairwayHopped).toBe(true);
    expect(sandHopped).toBe(false);
    // Sand barely rolls.
    expect(ballFlightPose(AIR_FRAC, 20, "swing", sand).groundFrac).toBeGreaterThan(0.98);
  });

  it("water swallows the ball at touchdown", () => {
    const mid = ballFlightPose(AIR_FRAC + 0.2, 20, "swing", water);
    expect(mid.hidden).toBe(true);
    expect(mid.shadow).toBe(0);
    // In the air it is still visible.
    expect(ballFlightPose(0.5, 20, "swing", water).hidden).toBe(false);
  });

  it("green checks up quickly (short roll)", () => {
    const g = ballFlightPose(AIR_FRAC, 20, "swing", green);
    const f = ballFlightPose(AIR_FRAC, 20, "swing", fairway);
    expect(g.groundFrac).toBeGreaterThan(f.groundFrac); // lands closer to the pin
  });

  it("landing fx per surface", () => {
    expect(fairway.fx).toBe("grass");
    expect(sand.fx).toBe("sand");
    expect(water.fx).toBe("splash");
    expect(green.fx).toBe("check");
  });
});

describe("ballFlightPose — putts and apex scaling", () => {
  it("putts stay on the ground the whole way", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = ballFlightPose(t, 2, "putt", green);
      expect(p.heightPx).toBe(0);
      expect(p.shadow).toBe(1);
    }
    expect(ballFlightPose(1, 2, "putt", green).groundFrac).toBeCloseTo(1, 6);
  });

  it("apex grows with distance and is capped", () => {
    expect(apexHeightPx(4, "swing")).toBeLessThan(apexHeightPx(20, "swing"));
    expect(apexHeightPx(500, "swing")).toBe(64);
    expect(apexHeightPx(30, "putt")).toBe(0);
  });

  it("degenerate zero-length flights stay sane", () => {
    const p = ballFlightPose(0.5, 0, "swing", fairway);
    expect(p.groundFrac).toBeGreaterThanOrEqual(0);
    expect(p.groundFrac).toBeLessThanOrEqual(1);
    expect(Number.isFinite(p.heightPx)).toBe(true);
  });
});
