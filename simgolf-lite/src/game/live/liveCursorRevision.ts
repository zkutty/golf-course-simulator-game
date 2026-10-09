import type { Golfer } from "./types";
import { captureShotTelemetrySnapshot, type ShotTelemetryGolfer } from "./shotTelemetrySnapshot";

/** App-only lookup: no backing Map or mutable container escapes this boundary. */
export interface ShotTelemetryLookupV1 {
  get(id: number): Readonly<ShotTelemetryGolfer> | undefined;
}

function freezeDetached(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeDetached(child);
  Object.freeze(value);
}

/**
 * Hook-owned latest projection under the audited App's read-only alias contract.
 * Every maybe-writer must invalidate BEFORE mutation; live roots are never keys
 * or retained inputs. The existing public mutable snapshot API remains separate.
 */
export class LiveCursorRevisionOwner {
  private generation = 0;
  private latest: { generation: number; lookup: ShotTelemetryLookupV1 } | undefined;

  invalidate = (): void => {
    this.latest = undefined;
    this.generation = this.generation === Number.MAX_SAFE_INTEGER ? 0 : this.generation + 1;
  };

  capture(golfers: readonly Golfer[]): ShotTelemetryLookupV1 {
    if (this.latest?.generation === this.generation) return this.latest.lookup;
    const generation = this.generation;
    // Existing JSON detachment/normalization and duplicate-ID ordering authority.
    const values = captureShotTelemetrySnapshot(golfers);
    for (const value of values.values()) freezeDetached(value);
    const lookup = Object.freeze({ get: (id: number) => values.get(id) });
    if (generation === this.generation) this.latest = { generation, lookup };
    return lookup;
  }
}
