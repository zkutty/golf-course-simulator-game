import { describe, expect, it } from "vitest";
import { buildFlyoverKeys, sampleFlyover } from "./flyover";

const tee = { x: 10, y: 30 };
const green = { x: 40, y: 30 };
const corridor = [
  { x: 30, y: 32 }, // drive landing
  { x: 40, y: 30 }, // approach = green
];

describe("buildFlyoverKeys", () => {
  it("starts wide behind the tee and settles tight behind the green", () => {
    const keys = buildFlyoverKeys(tee, green, corridor, 0.6, 1.8);
    const first = keys[0];
    const last = keys[keys.length - 1];
    expect(first.at).toBe(0);
    expect(first.zoom).toBe(0.6);
    expect(first.x).toBeLessThan(tee.x); // pulled back opposite the shot line
    expect(last.at).toBe(1);
    expect(last.zoom).toBe(1.8);
    expect(last.x).toBeGreaterThan(green.x); // behind the green, past it
  });

  it("holds over the first landing zone", () => {
    const keys = buildFlyoverKeys(tee, green, corridor, 0.6, 1.8);
    const landingKeys = keys.filter((k) => Math.hypot(k.x - 30, k.y - 32) < 0.01);
    expect(landingKeys.length).toBe(2); // arrival + end-of-hold
    expect(landingKeys[1].at - landingKeys[0].at).toBeGreaterThan(0.08);
  });

  it("has strictly increasing timing capped at 1", () => {
    for (const c of [corridor, [], [{ x: 12, y: 30 }, { x: 13, y: 30 }, { x: 35, y: 40 }]]) {
      const keys = buildFlyoverKeys(tee, green, c, 0.6, 1.8);
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i].at).toBeGreaterThan(keys[i - 1].at);
      }
      expect(keys[keys.length - 1].at).toBeLessThanOrEqual(1);
    }
  });

  it("degenerates gracefully with no corridor (straight tee→green)", () => {
    const keys = buildFlyoverKeys(tee, green, [], 0.6, 1.8);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    const mid = sampleFlyover(keys, 0.5);
    expect(mid.x).toBeGreaterThan(tee.x);
    expect(mid.x).toBeLessThan(green.x + 4.01);
  });
});

describe("sampleFlyover", () => {
  const keys = buildFlyoverKeys(tee, green, corridor, 0.6, 1.8);

  it("is continuous: no jumps bigger than the frame step allows", () => {
    let prev = sampleFlyover(keys, 0);
    for (let t = 0.002; t <= 1; t += 0.002) {
      const s = sampleFlyover(keys, t);
      const jump = Math.hypot(s.x - prev.x, s.y - prev.y);
      expect(jump).toBeLessThan(1.2); // tiles per 14ms — smooth glide
      expect(Math.abs(s.zoom - prev.zoom)).toBeLessThan(0.05);
      prev = s;
    }
  });

  it("clamps outside 0..1 to the endpoints", () => {
    expect(sampleFlyover(keys, -1)).toEqual(keys[0]);
    const end = sampleFlyover(keys, 2);
    expect(end.x).toBe(keys[keys.length - 1].x);
    expect(end.zoom).toBe(keys[keys.length - 1].zoom);
  });

  it("progresses monotonically down the hole", () => {
    let prevX = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const s = sampleFlyover(keys, t);
      expect(s.x).toBeGreaterThanOrEqual(prevX - 0.6); // small easing wiggle ok
      prevX = Math.max(prevX, s.x);
    }
  });
});
