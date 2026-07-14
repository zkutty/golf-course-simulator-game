import { describe, expect, it } from "vitest";
import { PerfWindow } from "./perfStats";

describe("PerfWindow", () => {
  it("reports mean, p95, max, and fps over the window", () => {
    const w = new PerfWindow(100);
    for (let i = 0; i < 100; i++) {
      w.push({ totalMs: i < 95 ? 10 : 30, sections: {} });
    }
    const s = w.summary();
    expect(s.frames).toBe(100);
    expect(s.meanMs).toBeCloseTo(11, 1);
    expect(s.p95Ms).toBe(30);
    expect(s.maxMs).toBe(30);
    expect(s.fps).toBeCloseTo(1000 / s.meanMs, 3);
  });

  it("rolls: old samples fall out of the window", () => {
    const w = new PerfWindow(10);
    for (let i = 0; i < 10; i++) w.push({ totalMs: 100, sections: {} });
    for (let i = 0; i < 10; i++) w.push({ totalMs: 5, sections: {} });
    expect(w.summary().meanMs).toBe(5);
  });

  it("tracks per-section means, decaying sections that stop reporting", () => {
    const w = new PerfWindow(10);
    for (let i = 0; i < 10; i++) w.push({ totalMs: 10, sections: { golfers: 4, fx: 1 } });
    let s = w.summary();
    expect(s.sections.golfers).toBeCloseTo(4, 5);
    expect(s.sections.fx).toBeCloseTo(1, 5);
    // fx stops being reported: after a full window it should vanish.
    for (let i = 0; i < 10; i++) w.push({ totalMs: 10, sections: { golfers: 4 } });
    s = w.summary();
    expect(s.sections.golfers).toBeCloseTo(4, 5);
    expect(s.sections.fx).toBeUndefined();
  });

  it("is safe when empty and after reset", () => {
    const w = new PerfWindow(10);
    expect(w.summary().frames).toBe(0);
    expect(w.summary().fps).toBe(0);
    w.push({ totalMs: 10, sections: {} });
    w.reset();
    expect(w.summary().frames).toBe(0);
  });
});
