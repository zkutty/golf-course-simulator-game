import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import highAtlasJson from "../../assets/terrain/parkland-habitat-4x/high/habitat-atlas.json";
import {
  canonicalHabitatMaskTransform,
  classifyHabitatOccupancyMask,
  HABITAT_D4_CANONICAL_MASKS,
  HABITAT_D4_TRANSFORMS,
  HABITAT_NORMALIZED_MASKS,
  HABITAT_OCCUPANCY_MASK_BITS,
  PARKLAND_HABITAT_FAMILIES,
  resolveHabitatFieldTopology,
  transformHabitatMask,
  type BoundedHabitatOccupancy,
  type HabitatCardinalDirection,
  type HabitatCorner,
  type HabitatFieldPlacement,
  type HabitatTileCoordinate,
  type ParklandHabitatAtlasCatalog,
  type ParklandHabitatAtlasFrame,
  type ParklandHabitatFamily,
} from "./habitatFieldTopology";

const HIGH_ATLAS = highAtlasJson as unknown as ParklandHabitatAtlasCatalog;
const FAMILY: ParklandHabitatFamily = "wet_shore";

const CARDINAL_OFFSET: Readonly<Record<HabitatCardinalDirection, HabitatTileCoordinate>> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

const CORNER_OFFSET: Readonly<Record<HabitatCorner, HabitatTileCoordinate>> = {
  ne: { x: 1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
  nw: { x: -1, y: -1 },
};

const CORNER_SIDES: Readonly<Record<HabitatCorner, readonly [HabitatCardinalDirection, HabitatCardinalDirection]>> = {
  ne: ["n", "e"],
  se: ["s", "e"],
  sw: ["s", "w"],
  nw: ["n", "w"],
};

function rectangularPatch(width: number, height: number, x = 0, y = 0): BoundedHabitatOccupancy {
  return {
    bounds: { x, y, width, height },
    occupied: Array.from({ length: width * height }, (_, index) => ({
      x: x + index % width,
      y: y + Math.floor(index / width),
    })),
  };
}

function withoutTile(
  occupancy: BoundedHabitatOccupancy,
  removed: HabitatTileCoordinate,
): BoundedHabitatOccupancy {
  return {
    bounds: occupancy.bounds,
    occupied: occupancy.occupied.filter((tile) => tile.x !== removed.x || tile.y !== removed.y),
  };
}

function resolve(
  occupancy: BoundedHabitatOccupancy,
  family: ParklandHabitatFamily = FAMILY,
  atlas: ParklandHabitatAtlasCatalog = HIGH_ATLAS,
  seed = 0x1202,
) {
  return resolveHabitatFieldTopology({ occupancy, family, atlas, seed });
}

function successfulPlacements(occupancy: BoundedHabitatOccupancy): readonly HabitatFieldPlacement[] {
  const result = resolve(occupancy);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.placements;
}

function placementAt(
  placements: readonly HabitatFieldPlacement[],
  x: number,
  y: number,
): HabitatFieldPlacement {
  const placement = placements.find((candidate) => candidate.tile.x === x && candidate.tile.y === y);
  if (!placement) throw new Error(`missing placement at ${x},${y}`);
  return placement;
}

function mutableCatalog(
  frames: Readonly<Record<string, ParklandHabitatAtlasFrame>> = HIGH_ATLAS.frames,
): ParklandHabitatAtlasCatalog {
  return {
    ...HIGH_ATLAS,
    frames: Object.fromEntries(Object.entries(frames).map(([id, frame]) => [id, structuredClone(frame)])),
  };
}

function invalidAtlasMessages(atlas: ParklandHabitatAtlasCatalog): readonly string[] {
  const result = resolve(rectangularPatch(3, 3), FAMILY, atlas);
  expect(result.ok).toBe(false);
  expect("placements" in result).toBe(false);
  if (result.ok) throw new Error("invalid atlas unexpectedly produced placements/world anchors");
  expect(result.diagnostics.every((diagnostic) => diagnostic.code === "invalid_atlas")).toBe(true);
  return result.diagnostics.map((diagnostic) => diagnostic.message);
}

function cellKey(tile: HabitatTileCoordinate): string {
  return `${tile.x},${tile.y}`;
}

function occupiedNeighbors(
  placement: HabitatFieldPlacement,
  occupied: ReadonlySet<string>,
): Readonly<Record<HabitatCardinalDirection, boolean>> {
  return Object.fromEntries(Object.entries(CARDINAL_OFFSET).map(([direction, offset]) => [
    direction,
    occupied.has(cellKey({ x: placement.tile.x + offset.x, y: placement.tile.y + offset.y })),
  ])) as Readonly<Record<HabitatCardinalDirection, boolean>>;
}

describe("Parkland habitat field occupancy topology", () => {
  it("resolves a solid 3x3 patch with every cell, exposed side, and corner derived from occupancy", () => {
    const occupancy = rectangularPatch(3, 3, 10, 20);
    const placements = successfulPlacements(occupancy);

    expect(placements).toHaveLength(occupancy.occupied.length);
    expect(new Set(placements.map((placement) => cellKey(placement.tile))).size).toBe(occupancy.occupied.length);
    expect(placementAt(placements, 11, 21)).toMatchObject({
      topologyRole: "interior",
      direction: null,
      corner: null,
    });

    const boundaryCases = [
      { tile: { x: 11, y: 20 }, direction: "n" },
      { tile: { x: 12, y: 21 }, direction: "e" },
      { tile: { x: 11, y: 22 }, direction: "s" },
      { tile: { x: 10, y: 21 }, direction: "w" },
    ] as const;
    for (const expected of boundaryCases) {
      expect(placementAt(placements, expected.tile.x, expected.tile.y)).toMatchObject({
        topologyRole: "boundary",
        direction: expected.direction,
        corner: null,
      });
    }

    const cornerCases = [
      { tile: { x: 10, y: 20 }, corner: "nw" },
      { tile: { x: 12, y: 20 }, corner: "ne" },
      { tile: { x: 12, y: 22 }, corner: "se" },
      { tile: { x: 10, y: 22 }, corner: "sw" },
    ] as const;
    for (const expected of cornerCases) {
      expect(placementAt(placements, expected.tile.x, expected.tile.y)).toMatchObject({
        topologyRole: "convex",
        direction: null,
        corner: expected.corner,
      });
    }
  });

  it.each([
    ["ne", { x: 2, y: 0 }],
    ["se", { x: 2, y: 2 }],
    ["sw", { x: 0, y: 2 }],
    ["nw", { x: 0, y: 0 }],
  ] as const)("resolves a single %s concave notch without changing its semantic rotation", (corner, removed) => {
    const occupancy = withoutTile(rectangularPatch(3, 3), removed);
    const placements = successfulPlacements(occupancy);
    expect(placements).toHaveLength(8);
    expect(placementAt(placements, 1, 1)).toMatchObject({
      topologyRole: "concave",
      direction: null,
      corner,
    });
  });

  it.each([
    ["n", [{ x: 1, y: 1 }, { x: 1, y: 0 }]],
    ["e", [{ x: 1, y: 1 }, { x: 2, y: 1 }]],
    ["s", [{ x: 1, y: 1 }, { x: 1, y: 2 }]],
    ["w", [{ x: 1, y: 1 }, { x: 0, y: 1 }]],
  ] as const)("orients a one-neighbor termination toward %s", (direction, occupied) => {
    const occupancy = { bounds: { x: 0, y: 0, width: 3, height: 3 }, occupied };
    const placements = successfulPlacements(occupancy);
    expect(placementAt(placements, 1, 1)).toMatchObject({
      topologyRole: "termination",
      direction,
      corner: null,
    });
  });

  it("classifies all 256 raw masks only when the emitted semantic is true of occupancy", () => {
    const directionBits = HABITAT_OCCUPANCY_MASK_BITS;
    for (let rawMask = 0; rawMask <= 0xff; rawMask += 1) {
      const { topology } = classifyHabitatOccupancyMask(rawMask);
      if (topology === null) continue;

      const cardinal = Object.fromEntries(Object.entries(CARDINAL_OFFSET).map(([direction]) => [
        direction,
        (rawMask & directionBits[direction as HabitatCardinalDirection]) !== 0,
      ])) as Record<HabitatCardinalDirection, boolean>;
      const cardinalCount = Object.values(cardinal).filter(Boolean).length;

      if (topology.role === "interior") {
        expect(cardinalCount).toBe(4);
        expect(Object.values(CORNER_OFFSET).every((_, index) => {
          const corner = Object.keys(CORNER_OFFSET)[index] as HabitatCorner;
          return (rawMask & directionBits[corner]) !== 0;
        })).toBe(true);
      } else if (topology.role === "boundary") {
        expect(cardinalCount).toBe(3);
        expect(cardinal[topology.direction as HabitatCardinalDirection]).toBe(false);
      } else if (topology.role === "convex") {
        expect(cardinalCount).toBe(2);
        for (const exposed of CORNER_SIDES[topology.corner as HabitatCorner]) expect(cardinal[exposed]).toBe(false);
      } else if (topology.role === "concave") {
        expect(cardinalCount).toBe(4);
        expect((rawMask & directionBits[topology.corner as HabitatCorner]) === 0).toBe(true);
      } else {
        expect(cardinalCount).toBe(1);
        expect(cardinal[topology.direction as HabitatCardinalDirection]).toBe(true);
      }
    }
  });

  it("proves all 47 normalized masks map bijectively through exactly 14 D4 canonical classes", () => {
    expect(HABITAT_NORMALIZED_MASKS).toHaveLength(47);
    expect(new Set(HABITAT_D4_CANONICAL_MASKS)).toEqual(new Set([
      0, 1, 5, 7, 17, 21, 23, 31, 85, 87, 95, 119, 127, 255,
    ]));
    const observed = new Set<number>();
    for (const mask of HABITAT_NORMALIZED_MASKS) {
      const canonical = canonicalHabitatMaskTransform(mask);
      observed.add(canonical.canonicalMask);
      expect(transformHabitatMask(canonical.canonicalMask, canonical.transform)).toBe(mask);
      expect(HABITAT_D4_TRANSFORMS.some((transform) => (
        transformHabitatMask(mask, transform) === canonical.canonicalMask
      ))).toBe(true);
    }
    expect(observed).toEqual(new Set(HABITAT_D4_CANONICAL_MASKS));
  });

  it.each(["woodland_floor", "understory_edge"] as const)(
    "resolves singleton, bars, junctions, and every normalized mask for %s without silent gaps",
    (family) => {
      for (const normalizedMask of HABITAT_NORMALIZED_MASKS) {
        const occupied = [{ x: 1, y: 1 }];
        const offsets = {
          n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1],
          s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
        } as const;
        for (const [direction, [dx, dy]] of Object.entries(offsets)) {
          if ((normalizedMask & HABITAT_OCCUPANCY_MASK_BITS[direction as keyof typeof HABITAT_OCCUPANCY_MASK_BITS]) !== 0) {
            occupied.push({ x: 1 + dx, y: 1 + dy });
          }
        }
        // The resolver requires a cardinally connected whole patch. Resolve a
        // 3x3 field whenever diagonal-only neighbors would be disconnected,
        // then inspect the center's exact mask placement.
        const connected = occupied.every((point) => point.x === 1 || point.y === 1)
          ? occupied
          : rectangularPatch(3, 3).occupied.filter((point) => (
            point.x === 1 && point.y === 1
              ? true
              : occupied.some((candidate) => candidate.x === point.x && candidate.y === point.y)
          ));
        const result = resolve({ bounds: { x: 0, y: 0, width: 3, height: 3 }, occupied: connected }, family);
        if (!result.ok) {
          // Some local masks cannot constitute an independently connected
          // finite patch; their D4 proof above remains exhaustive.
          expect(result.diagnostics.every((diagnostic) => diagnostic.code === "disconnected_patch")).toBe(true);
          continue;
        }
        const center = placementAt(result.placements, 1, 1);
        expect(center.canonicalMask).toBe(canonicalHabitatMaskTransform(center.normalizedMask).canonicalMask);
        expect(transformHabitatMask(center.canonicalMask as number, center.d4Transform)).toBe(center.normalizedMask);
      }
    },
  );

  it("rejects unsupported masks transactionally instead of emitting a straight bar or singleton", () => {
    const bar = resolve({
      bounds: { x: 0, y: 0, width: 3, height: 1 },
      occupied: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    expect(bar.ok).toBe(false);
    if (bar.ok) throw new Error("straight bar unexpectedly resolved");
    expect(bar.diagnostics).toEqual([expect.objectContaining({
      code: "unsupported_topology",
      tile: { x: 1, y: 0 },
    })]);
    expect("placements" in bar).toBe(false);

    const singleton = resolve({ bounds: { x: 0, y: 0, width: 1, height: 1 }, occupied: [{ x: 0, y: 0 }] });
    expect(singleton.ok).toBe(false);
    if (!singleton.ok) expect(singleton.diagnostics[0]?.code).toBe("unsupported_topology");
  });

  it("rejects disconnected occupancy before attempting per-cell resolution", () => {
    const occupancy = {
      bounds: { x: 0, y: 0, width: 3, height: 3 },
      occupied: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
    } as const;
    const result = resolve(occupancy);
    expect(result).toEqual({
      ok: false,
      diagnostics: [{
        code: "disconnected_patch",
        message: "occupancy patch is not cardinally connected (1/2 cells reachable)",
      }],
    });
    expect(resolve({ ...occupancy, occupied: occupancy.occupied.slice().reverse() })).toEqual(result);
  });

  it("uses actual checked-in high-tier records for every manifest family", () => {
    expect(Object.keys(HIGH_ATLAS.frames)).toHaveLength(89);
    for (const family of PARKLAND_HABITAT_FAMILIES) {
      const result = resolve(rectangularPatch(3, 3), family);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.placements).toHaveLength(9);
      for (const placement of result.placements) {
        const actual = HIGH_ATLAS.frames[placement.frameId];
        expect(actual).toBeDefined();
        expect(placement).toMatchObject({
          family: actual.family,
          topologyRole: actual.topologyRole,
          direction: actual.direction,
          corner: actual.corner,
          variant: actual.variant,
          atlasAnchor: actual.anchor,
        });
        if (placement.canonicalMask === null) expect(placement.edgeAnchors).toEqual(actual.edgeAnchors);
        else expect(transformHabitatMask(placement.canonicalMask, placement.d4Transform)).toBe(placement.normalizedMask);
        expect(placement.worldAnchor).toEqual({
          x: placement.tile.x + actual.anchor.x / actual.frame.width,
          y: placement.tile.y + actual.anchor.y / actual.frame.height,
        });
      }
    }
  });

  it("never invents a neighbor, exposed side, or corner", () => {
    const occupancy = withoutTile(rectangularPatch(3, 3), { x: 2, y: 0 });
    const placements = successfulPlacements(occupancy);
    const occupied = new Set(occupancy.occupied.map(cellKey));

    for (const placement of placements) {
      const neighbors = occupiedNeighbors(placement, occupied);
      if (placement.topologyRole === "boundary") {
        expect(neighbors[placement.direction as HabitatCardinalDirection]).toBe(false);
      } else if (placement.topologyRole === "convex") {
        for (const side of CORNER_SIDES[placement.corner as HabitatCorner]) expect(neighbors[side]).toBe(false);
      } else if (placement.topologyRole === "concave") {
        const offset = CORNER_OFFSET[placement.corner as HabitatCorner];
        expect(occupied.has(cellKey({ x: placement.tile.x + offset.x, y: placement.tile.y + offset.y }))).toBe(false);
        for (const side of CORNER_SIDES[placement.corner as HabitatCorner]) expect(neighbors[side]).toBe(true);
      } else if (placement.topologyRole === "termination") {
        expect(neighbors[placement.direction as HabitatCardinalDirection]).toBe(true);
        expect(Object.values(neighbors).filter(Boolean)).toHaveLength(1);
      } else {
        expect(Object.values(neighbors).every(Boolean)).toBe(true);
      }
    }
  });

  it("rejects wrong-family, missing, duplicate, and semantically false atlas records", () => {
    const wrongFamilyFrames = Object.fromEntries(
      Object.entries(HIGH_ATLAS.frames).filter(([, frame]) => frame.family !== FAMILY),
    );
    const wrongFamily = resolve(rectangularPatch(3, 3), FAMILY, mutableCatalog(wrongFamilyFrames));
    expect(wrongFamily.ok).toBe(false);
    if (!wrongFamily.ok) expect(wrongFamily.diagnostics.some((diagnostic) => diagnostic.message.includes("missing interior"))).toBe(true);

    const missingFrames = { ...HIGH_ATLAS.frames } as Record<string, ParklandHabitatAtlasFrame>;
    delete missingFrames[`${FAMILY}--boundary-n`];
    const missing = resolve(rectangularPatch(3, 3), FAMILY, mutableCatalog(missingFrames));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics.some((diagnostic) => diagnostic.message.includes("missing boundary|n|-"))).toBe(true);

    const source = HIGH_ATLAS.frames[`${FAMILY}--boundary-n`];
    const duplicateId = `${source.id}-duplicate`;
    const duplicate = resolve(rectangularPatch(3, 3), FAMILY, mutableCatalog({
      ...HIGH_ATLAS.frames,
      [duplicateId]: { ...source, id: duplicateId },
    }));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics.some((diagnostic) => diagnostic.message.includes("duplicate boundary|n|- variant 0"))).toBe(true);

    const falseAnchors = mutableCatalog({
      ...HIGH_ATLAS.frames,
      [source.id]: { ...source, edgeAnchors: ["s"] },
    });
    const invalidMetadata = resolve(rectangularPatch(3, 3), FAMILY, falseAnchors);
    expect(invalidMetadata.ok).toBe(false);
    if (!invalidMetadata.ok) expect(invalidMetadata.diagnostics.some((diagnostic) => diagnostic.message.includes("edge anchors"))).toBe(true);
  });

  it("validates semantic completeness and uniqueness for non-requested families", () => {
    const missingId = "wet_shore--boundary-n";
    const missingFrames = { ...HIGH_ATLAS.frames } as Record<string, ParklandHabitatAtlasFrame>;
    delete missingFrames[missingId];
    const missingMessages = invalidAtlasMessages({
      ...mutableCatalog(missingFrames),
      frameCount: HIGH_ATLAS.frameCount - 1,
    });
    expect(missingMessages.some((message) => message.includes("wet_shore: missing boundary|n|-"))).toBe(true);

    const duplicateSource = HIGH_ATLAS.frames["wet_shore--boundary-e"];
    const duplicateId = `${duplicateSource.id}-duplicate`;
    const duplicateFrames = {
      ...HIGH_ATLAS.frames,
      [duplicateId]: { ...duplicateSource, id: duplicateId },
    };
    const duplicateMessages = invalidAtlasMessages({
      ...mutableCatalog(duplicateFrames),
      frameCount: HIGH_ATLAS.frameCount + 1,
    });
    expect(duplicateMessages.some((message) => message.includes("wet_shore: duplicate boundary|e|- variant 0"))).toBe(true);
  });

  it("rejects malformed atlas headers and mismatched declared record counts", () => {
    const headerCases: readonly [string, ParklandHabitatAtlasCatalog][] = [
      ["frame count", { ...HIGH_ATLAS, frameCount: HIGH_ATLAS.frameCount - 1 }],
      ["zero width", { ...HIGH_ATLAS, width: 0 }],
      ["fractional height", { ...HIGH_ATLAS, height: HIGH_ATLAS.height - 0.5 }],
      ["negative gutter", { ...HIGH_ATLAS, gutterPx: -1 }],
      ["fractional gutter", { ...HIGH_ATLAS, gutterPx: 1.5 }],
    ];
    for (const [label, catalog] of headerCases) {
      expect(invalidAtlasMessages(catalog).length, label).toBeGreaterThan(0);
    }
  });

  it("rejects negative, fractional, and out-of-bounds frame geometry and fractional anchors", () => {
    const source = HIGH_ATLAS.frames[`${FAMILY}--boundary-n`];
    const geometryCases: readonly [string, ParklandHabitatAtlasFrame][] = [
      ["negative origin", { ...source, frame: { ...source.frame, x: -1 } }],
      ["fractional origin", { ...source, frame: { ...source.frame, y: source.frame.y + 0.25 } }],
      ["fractional width", { ...source, frame: { ...source.frame, width: source.frame.width - 0.5 } }],
      ["fractional height", { ...source, frame: { ...source.frame, height: source.frame.height - 0.5 } }],
      ["past atlas width", { ...source, frame: { ...source.frame, x: HIGH_ATLAS.width } }],
      ["past atlas height", { ...source, frame: { ...source.frame, y: HIGH_ATLAS.height } }],
      ["fractional anchor x", { ...source, anchor: { ...source.anchor, x: source.anchor.x + 0.5 } }],
      ["fractional anchor y", { ...source, anchor: { ...source.anchor, y: source.anchor.y + 0.5 } }],
    ];

    for (const [label, malformed] of geometryCases) {
      const messages = invalidAtlasMessages(mutableCatalog({
        ...HIGH_ATLAS.frames,
        [source.id]: malformed,
      }));
      expect(messages.some((message) => message.includes("invalid, fractional, or out-of-bounds")), label).toBe(true);
    }
  });

  it("is deterministic, varies only exact interior variants, and does not mutate inputs", () => {
    const occupancy = rectangularPatch(6, 6, -2, 4);
    const request = { occupancy, family: FAMILY, atlas: HIGH_ATLAS, seed: 981_202 } as const;
    const before = JSON.stringify(request);
    const first = resolveHabitatFieldTopology(request);
    const second = resolveHabitatFieldTopology(request);

    expect(first).toEqual(second);
    expect(JSON.stringify(request)).toBe(before);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    for (const placement of first.placements.filter((candidate) => candidate.topologyRole === "interior")) {
      const frame = HIGH_ATLAS.frames[placement.frameId];
      expect(frame.family).toBe(FAMILY);
      expect(frame.topologyRole).toBe("interior");
      expect(frame.direction).toBeNull();
      expect(frame.corner).toBeNull();
    }

    const otherSeed = resolveHabitatFieldTopology({ ...request, seed: request.seed + 1 });
    expect(otherSeed.ok).toBe(true);
    if (otherSeed.ok) {
      expect(otherSeed.placements.map(({ variant }) => variant))
        .not.toEqual(first.placements.map(({ variant }) => variant));
      expect(otherSeed.placements.map(({ topologyRole, direction, corner, tile }) => ({ topologyRole, direction, corner, tile })))
        .toEqual(first.placements.map(({ topologyRole, direction, corner, tile }) => ({ topologyRole, direction, corner, tile })));
    }
  });

  it("resolves a 36x36 patch under the 50 ms packet budget after warmup", () => {
    const occupancy = rectangularPatch(36, 36);
    expect(resolve(occupancy).ok).toBe(true);
    const started = performance.now();
    const result = resolve(occupancy);
    const elapsedMs = performance.now() - started;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.placements).toHaveLength(36 * 36);
    expect(elapsedMs).toBeLessThan(50);
  });
});
