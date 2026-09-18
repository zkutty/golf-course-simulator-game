import { describe, expect, it } from "vitest";
import { ELEVATION_STEP_PX, ISO_ROTATIONS, isoToTile, tileCenterIso } from "./iso";

/**
 * Coordinate-only counterpart to the ZK-470 browser matrix.  Rendering may
 * smooth the heightfield, but interaction remains anchored to authoritative
 * integer cell elevations; this deliberately asserts that contract instead
 * of making visual and gameplay surfaces identical.
 */
describe("ZK-470 placement/heightfield coordinate matrix", () => {
  const checkpoints = [
    { label: "flat patch", x: 18, y: 12, elevation: 0 },
    { label: "slope", x: 24, y: 18, elevation: 3 },
    { label: "shoulder", x: 27, y: 18, elevation: 2 },
    { label: "bunker rim", x: 31, y: 21, elevation: 1 },
    { label: "water bank", x: 35, y: 24, elevation: 0 },
    { label: "structure footprint", x: 40, y: 28, elevation: 1 },
  ] as const;

  it("round-trips visible cell centers and interior edges through every cardinal rotation", () => {
    for (const rotation of ISO_ROTATIONS) {
      for (const checkpoint of checkpoints) {
        const center = tileCenterIso(checkpoint.x, checkpoint.y, checkpoint.elevation, rotation);
        expect(
          isoToTile(center.x, center.y + checkpoint.elevation * ELEVATION_STEP_PX, rotation),
          `${checkpoint.label} center at ${rotation}°`,
        ).toEqual({ x: checkpoint.x, y: checkpoint.y });

        // An interior point close to the visual east edge must still resolve
        // to this cell after applying the same authoritative elevation lift.
        const edge = tileCenterIso(checkpoint.x + 0.42, checkpoint.y, checkpoint.elevation, rotation);
        expect(
          isoToTile(edge.x, edge.y + checkpoint.elevation * ELEVATION_STEP_PX, rotation),
          `${checkpoint.label} edge at ${rotation}°`,
        ).toEqual({ x: checkpoint.x, y: checkpoint.y });
      }
    }
  });
});
