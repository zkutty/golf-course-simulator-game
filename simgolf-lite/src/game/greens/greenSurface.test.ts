import { describe, expect, it } from "vitest";
import { elevationAtFrozenPoint } from "../models/shotSlope";
import {
  GREEN_SURFACE_MAX_OFFSET_FIXED,
  GREEN_SURFACE_MAX_TILES,
  canonicalGreenSurfaceJson,
  createGreenProgram,
  createGreenRoundSnapshot,
  decodeGreenRoundSnapshot,
  frozenGreenElevation,
  greenGeometryVersion,
  greenSurfaceHash,
  normalizeGreenLocalState,
  normalizeGreenProgram,
  normalizeGreenSurfaceV1,
  validateGreenLocalState,
  validateGreenProgram,
  validateGreenSurfaceV1,
  withNormalizedGreenContract,
} from "./greenSurface";

const shaped = [1, 2, 3, 4, 5, 6, 7, 8, -1, -2, -3, -4, -5, -6, -7, -8];

function carrier() {
  return {
    width: 3,
    height: 2,
    tiles: ["green", "rough", "green", "fairway", "green", "rough"] as const,
    elevations: [2, 0, 1, 0, 3, 0],
    holes: [{ id: "hole-b" }, { id: "hole-a" }],
  };
}

describe("M62 deterministic fine-green contract", () => {
  it("normalizes sparse contour tiles to one canonical row-major representation", () => {
    const input = {
      version: 99,
      tiles: [
        { x: 1, y: 1, offsets: shaped },
        { x: 0, y: 0, offsets: shaped.map((value) => value * 2) },
        { x: 0, y: 0, offsets: shaped },
        { x: 1, y: 0, offsets: shaped },
        { x: 2, y: 0, offsets: Array(16).fill(0) },
      ],
    };
    const reversed = { ...input, tiles: [...input.tiles].reverse() };
    const normalized = normalizeGreenSurfaceV1(input, carrier());
    expect(normalized).toMatchObject({
      version: 1,
      samplesPerAxis: 4,
      fixedPointScale: 1024,
      interpolation: "bilinear",
    });
    expect(normalized.tiles).toEqual([
      { x: 0, y: 0, offsets: shaped },
      { x: 1, y: 1, offsets: shaped },
    ]);
    expect(normalizeGreenSurfaceV1(reversed, carrier())).toEqual(normalized);
    expect(validateGreenSurfaceV1(normalized, carrier())).toEqual({ ok: true, value: normalized });
    expect(JSON.parse(canonicalGreenSurfaceJson(normalized))).toEqual(normalized);
    expect(greenSurfaceHash(normalized)).toBe(greenSurfaceHash(normalizeGreenSurfaceV1(reversed, carrier())));
  });

  it("rejects noncanonical, malformed, non-green, and oversized strict inputs", () => {
    const valid = normalizeGreenSurfaceV1({ tiles: [
      { x: 0, y: 0, offsets: shaped },
      { x: 2, y: 0, offsets: shaped },
    ] }, carrier());
    expect(validateGreenSurfaceV1({ ...valid, tiles: [...valid.tiles].reverse() }, carrier())).toMatchObject({ ok: false, error: { code: "noncanonical" } });
    expect(validateGreenSurfaceV1({ ...valid, tiles: [{ x: 1, y: 0, offsets: shaped }] }, carrier())).toMatchObject({ ok: false, error: { code: "invalid-tile" } });
    expect(validateGreenSurfaceV1({ ...valid, tiles: [{ x: 0, y: 0, offsets: shaped.slice(1) }] }, carrier())).toMatchObject({ ok: false, error: { code: "invalid-offset" } });
    expect(validateGreenSurfaceV1({ ...valid, tiles: Array(GREEN_SURFACE_MAX_TILES + 1).fill(valid.tiles[0]) }, carrier())).toMatchObject({ ok: false, error: { code: "oversized" } });

    const cleaned = normalizeGreenSurfaceV1({ tiles: [{
      x: 0,
      y: 0,
      offsets: [Infinity, -Infinity, 99_999, -99_999, ...Array(12).fill(0)],
    }] }, carrier());
    expect(cleaned.tiles[0].offsets).toEqual([
      0,
      0,
      GREEN_SURFACE_MAX_OFFSET_FIXED,
      -GREEN_SURFACE_MAX_OFFSET_FIXED,
      ...Array(12).fill(0),
    ]);
  });

  it("bounds policy and local condition while giving legacy holes healthy balanced defaults", () => {
    expect(createGreenProgram("balanced")).toEqual({
      version: 1,
      preset: "balanced",
      targetSpeedFeet: 9.5,
      targetFirmness: 0.5,
      mowingHeightMillimeters: 3.5,
      rollingPasses: 1,
      irrigationTarget: 0.58,
    });
    const program = normalizeGreenProgram({
      version: 7,
      preset: "custom",
      targetSpeedFeet: Infinity,
      targetFirmness: 9,
      mowingHeightMillimeters: -4,
      rollingPasses: 90,
      irrigationTarget: -1,
    });
    expect(program).toEqual({
      version: 1,
      preset: "custom",
      targetSpeedFeet: 9.5,
      targetFirmness: 1,
      mowingHeightMillimeters: 2,
      rollingPasses: 2,
      irrigationTarget: 0.2,
    });
    expect(validateGreenProgram(program).ok).toBe(true);

    const local = normalizeGreenLocalState({ holes: [
      { holeId: "hole-b", health: -2, moisture: 9, compaction: Infinity, wear: 0.12349 },
      { holeId: "missing", health: 0 },
    ] }, carrier());
    expect(local.lastAdvancedAbsoluteDay).toBe(-1);
    expect(local.holes).toMatchObject([
      { holeId: "hole-a", health: 1, moisture: 0.58, compaction: 0, wear: 0 },
      { holeId: "hole-b", health: 0, moisture: 1, compaction: 0, wear: 0.123 },
    ]);
    expect(local.holes.every((hole) => hole.zones?.map((zone) => zone.zone).join(",") === "landing,pin")).toBe(true);
    expect(validateGreenLocalState(local, carrier()).ok).toBe(true);
    const earlyV26 = {
      version: 1 as const,
      holes: local.holes.map(({ zones: _zones, ...hole }) => hole),
    };
    expect(validateGreenLocalState(earlyV26, carrier())).toEqual({ ok: true, value: local });
  });

  it("freezes every green input and rejects geometry tampering", () => {
    const normalized = withNormalizedGreenContract({
      ...carrier(),
      greenSurface: normalizeGreenSurfaceV1({ tiles: [{ x: 0, y: 0, offsets: shaped }] }, carrier()),
      greenProgram: createGreenProgram("championship"),
      greenLocalState: { version: 1 as const, holes: [
        { holeId: "hole-a", health: 0.9, moisture: 0.4, compaction: 0.2, wear: 0.1 },
        { holeId: "hole-b", health: 0.8, moisture: 0.5, compaction: 0.3, wear: 0.2 },
      ] },
    });
    const snapshot = createGreenRoundSnapshot(normalized);
    const originalText = JSON.stringify(snapshot);
    normalized.greenSurface.tiles[0].offsets[0] = 999;
    normalized.greenProgram.targetSpeedFeet = 6;
    normalized.greenLocalState.holes[0].health = 0;
    expect(JSON.stringify(snapshot)).toBe(originalText);
    expect(snapshot.geometryVersion).not.toBe(greenGeometryVersion(normalized));
    expect(decodeGreenRoundSnapshot(snapshot, carrier())).toEqual({ ok: true, value: snapshot });
    expect(decodeGreenRoundSnapshot({ ...snapshot, geometryVersion: "green-v1-tampered" }, carrier())).toMatchObject({ ok: false, error: { code: "geometry-mismatch" } });

    const frozen = frozenGreenElevation({ ...normalized, elevations: carrier().elevations });
    expect(elevationAtFrozenPoint(frozen, { x: 0, y: 0 })).toBe(2);
    expect(frozen.greenSurface.samplesPerAxis).toBe(4);
  });

  it("includes dimensions and flat coarse-green coverage in geometry identity", () => {
    const base = {
      width: 3,
      height: 2,
      tiles: ["green", "rough", "rough", "rough", "rough", "rough"],
    };
    const same = { ...base, tiles: [...base.tiles] };
    const addedFlatGreen = {
      ...base,
      tiles: ["green", "rough", "rough", "rough", "green", "rough"],
    };
    const reshaped = { width: 2, height: 3, tiles: [...base.tiles] };
    const surface = normalizeGreenSurfaceV1(undefined, base);

    expect(greenGeometryVersion({ ...base, greenSurface: surface }))
      .toBe(greenGeometryVersion({ ...same, greenSurface: surface }));
    expect(greenGeometryVersion({ ...addedFlatGreen, greenSurface: surface }))
      .not.toBe(greenGeometryVersion({ ...base, greenSurface: surface }));
    expect(greenGeometryVersion({ ...reshaped, greenSurface: surface }))
      .not.toBe(greenGeometryVersion({ ...base, greenSurface: surface }));
  });
});
