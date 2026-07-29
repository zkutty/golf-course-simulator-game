import { describe, expect, it } from "vitest";
import {
  CONTROLLED_ROUND_SNAPSHOT_V2_MAX_COMPONENTS,
  CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES,
  buildConnectedPenaltyComponentMap,
  classificationForComponent,
  createControlledRoundSnapshotV2,
  decodeControlledRoundSnapshotV2,
  parseControlledRoundSnapshotV2,
  serializeControlledRoundSnapshotV2,
  type ControlledRoundSnapshotV2,
} from "./roundSnapshot";

function fixture() {
  const width = 5;
  const height = 4;
  const inBounds = [
    false, true, true, true, false,
    true, true, true, true, true,
    true, true, true, true, true,
    false, true, true, true, false,
  ];
  const penaltyMask = [
    false, true, false, false, false,
    false, true, false, true, false,
    false, false, false, true, false,
    false, true, false, false, false,
  ];
  return { width, height, inBounds, penaltyMask };
}

function expectError(
  value: ReturnType<typeof decodeControlledRoundSnapshotV2>,
  code: string,
) {
  expect(value.ok).toBe(false);
  if (!value.ok) expect(value.error.code).toBe(code);
}

describe("controlled-round snapshot v2", () => {
  it("serializes byte-identically for logically identical inputs", () => {
    const base = fixture();
    const first = createControlledRoundSnapshotV2({
      ...base,
      holeClassifications: [
        { holeId: "hole-b", red: [3], yellow: [1, 2] },
        { holeId: "hole-a", red: [2, 1], yellow: [3] },
      ],
    });
    const second = createControlledRoundSnapshotV2({
      width: base.width,
      height: base.height,
      inBounds: base.inBounds.slice(),
      penaltyMask: base.penaltyMask.slice(),
      holeClassifications: [
        { holeId: "hole-a", red: [1, 2], yellow: [3] },
        { holeId: "hole-b", red: [3], yellow: [2, 1] },
      ],
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const firstText = serializeControlledRoundSnapshotV2(first.value);
    const secondText = serializeControlledRoundSnapshotV2(second.value);
    expect(firstText).toEqual(secondText);
  });

  it("round-trips maps and assigns connected components by row-major first cell", () => {
    const base = fixture();
    const connected = buildConnectedPenaltyComponentMap(base.penaltyMask, base.width, base.height);
    expect(connected).toEqual({
      ok: true,
      value: {
        values: [
          0, 1, 0, 0, 0,
          0, 1, 0, 2, 0,
          0, 0, 0, 2, 0,
          0, 3, 0, 0, 0,
        ],
        components: [
          { id: 1, firstCell: 1, tileCount: 2 },
          { id: 2, firstCell: 8, tileCount: 2 },
          { id: 3, firstCell: 16, tileCount: 1 },
        ],
      },
    });

    const created = createControlledRoundSnapshotV2({
      ...base,
      holeClassifications: [{ holeId: "hole-1", red: [1, 3], yellow: [2] }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const serialized = serializeControlledRoundSnapshotV2(created.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = parseControlledRoundSnapshotV2(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.inBounds).toEqual(base.inBounds);
    expect(parsed.value.penaltyComponents).toEqual(connected.ok ? connected.value.values : []);
    expect(parsed.value.components).toEqual(connected.ok ? connected.value.components : []);
  });

  it("stabilizes hole and component classifications", () => {
    const base = fixture();
    const created = createControlledRoundSnapshotV2({
      ...base,
      holeClassifications: [
        { holeId: "hole-10", red: [3, 1], yellow: [2] },
        { holeId: "hole-02", red: [], yellow: [3, 1] },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.holeClassifications).toEqual([
      { holeId: "hole-02", red: [], yellow: [1, 3] },
      { holeId: "hole-10", red: [1, 3], yellow: [2] },
    ]);
    expect(classificationForComponent(created.value.holeClassifications[1], 3)).toBe("red");
    expect(classificationForComponent(created.value.holeClassifications[1], 2)).toBe("yellow");
    expect(classificationForComponent(created.value.holeClassifications[1], 99)).toBeNull();
  });

  it("rejects hostile, truncated, overflowed, oversized, and disconnected RLE safely", () => {
    const base = createControlledRoundSnapshotV2({
      width: 2,
      height: 2,
      inBounds: [true, true, true, true],
      penaltyMask: [true, false, false, true],
      holeClassifications: [],
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    expectError(decodeControlledRoundSnapshotV2({ ...base.value, inBoundsRle: "1:3" }), "rle-truncated");
    expectError(decodeControlledRoundSnapshotV2({ ...base.value, inBoundsRle: "1:5" }), "rle-overflow");
    expectError(decodeControlledRoundSnapshotV2({ ...base.value, inBoundsRle: "1:!" }), "rle-malformed");
    expectError(
      decodeControlledRoundSnapshotV2({ ...base.value, inBoundsRle: `1:${"z".repeat(40)}` }),
      "rle-overflow",
    );
    expectError(
      decodeControlledRoundSnapshotV2({ ...base.value, inBoundsRle: "1:1,".repeat(70_000) }),
      "rle-oversized",
    );

    const disconnected: ControlledRoundSnapshotV2 = {
      ...base.value,
      penaltyComponentsRle: "1:1,0:2,1:1",
      penaltyComponentCount: 1,
    };
    expectError(decodeControlledRoundSnapshotV2(disconnected), "invalid-component-map");

    expectError(
      parseControlledRoundSnapshotV2("x".repeat(CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES + 1)),
      "snapshot-oversized",
    );
    expectError(parseControlledRoundSnapshotV2("{"), "invalid-json");
  });

  it("keeps the maximally fragmented 220x140, 36-hole estate under the numeric cap", () => {
    const width = 220;
    const height = 140;
    const cells = width * height;
    const inBounds = Array.from({ length: cells }, (_, index) => (index + Math.floor(index / width)) % 2 === 0);
    const penaltyMask = inBounds.slice();
    const connected = buildConnectedPenaltyComponentMap(penaltyMask, width, height);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.value.components).toHaveLength(CONTROLLED_ROUND_SNAPSHOT_V2_MAX_COMPONENTS);

    const red = connected.value.components.filter((item) => item.id % 2 === 1).map((item) => item.id);
    const yellow = connected.value.components.filter((item) => item.id % 2 === 0).map((item) => item.id);
    const created = createControlledRoundSnapshotV2({
      width,
      height,
      inBounds,
      penaltyMask,
      holeClassifications: Array.from({ length: 36 }, (_, index) => ({
        holeId: `hole-${String(index + 1).padStart(2, "0")}`,
        red,
        yellow,
      })),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const serialized = serializeControlledRoundSnapshotV2(created.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(new TextEncoder().encode(serialized.value).byteLength)
      .toBeLessThanOrEqual(CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES);
  });
});
