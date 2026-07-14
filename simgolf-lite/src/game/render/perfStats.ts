/**
 * Render performance stats (ZKU-160) — pure rolling-window frame metrics.
 *
 * The renderer pushes one sample per frame (total ms + named section
 * timings); the HUD reads mean/p95/fps over the window. Fixed-size ring
 * buffer — no allocation churn after construction.
 */

export interface FrameSample {
  totalMs: number;
  sections: Record<string, number>;
}

export interface PerfSummary {
  frames: number;
  fps: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  sections: Record<string, number>; // mean ms per section
}

export class PerfWindow {
  private size: number;
  private totals: Float64Array;
  private idx = 0;
  private count = 0;
  private sectionSums = new Map<string, number>();
  private sectionBuffers = new Map<string, Float64Array>();

  constructor(size = 120) {
    this.size = size;
    this.totals = new Float64Array(size);
  }

  push(sample: FrameSample): void {
    const replacing = this.count === this.size;
    this.totals[this.idx] = sample.totalMs;
    for (const [name, ms] of Object.entries(sample.sections)) {
      let buf = this.sectionBuffers.get(name);
      if (!buf) {
        buf = new Float64Array(this.size);
        this.sectionBuffers.set(name, buf);
        this.sectionSums.set(name, 0);
      }
      const prev = buf[this.idx];
      buf[this.idx] = ms;
      this.sectionSums.set(name, (this.sectionSums.get(name) ?? 0) + ms - (replacing ? prev : 0));
    }
    // Sections absent from this sample decay their slot to zero.
    for (const [name, buf] of this.sectionBuffers) {
      if (!(name in sample.sections)) {
        const prev = buf[this.idx];
        buf[this.idx] = 0;
        if (replacing) this.sectionSums.set(name, (this.sectionSums.get(name) ?? 0) - prev);
      }
    }
    this.idx = (this.idx + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  summary(): PerfSummary {
    const n = this.count;
    if (n === 0) {
      return { frames: 0, fps: 0, meanMs: 0, p95Ms: 0, maxMs: 0, sections: {} };
    }
    const values: number[] = [];
    for (let i = 0; i < n; i++) values.push(this.totals[i]);
    values.sort((a, b) => a - b);
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / n;
    const p95 = values[Math.min(n - 1, Math.floor(n * 0.95))];
    const sections: Record<string, number> = {};
    for (const [name, s] of this.sectionSums) {
      const m = s / n;
      if (m > 0.005) sections[name] = m;
    }
    return {
      frames: n,
      fps: mean > 0 ? 1000 / mean : 0,
      meanMs: mean,
      p95Ms: p95,
      maxMs: values[n - 1],
      sections,
    };
  }

  reset(): void {
    this.idx = 0;
    this.count = 0;
    this.totals.fill(0);
    this.sectionBuffers.clear();
    this.sectionSums.clear();
  }
}
