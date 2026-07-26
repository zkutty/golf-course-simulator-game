import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { ISO_ROTATIONS, worldToIso } from "./iso";
import {
  PRESENTATION_SCALE,
  SILHOUETTE_QUANTUM,
  TERRAIN_CORNER_RADIUS,
  buildTerrainComponents,
  componentContains,
  createSilhouetteCache,
  rasterizePresentationMask,
  vertexCornerRadius,
} from "./terrainSilhouettes";

/**
 * Builds a grid from ASCII rows. `.` is rough; other letters map through
 * `legend`. Fixtures read as pictures of the component being asserted.
 */
function grid(
  rows: readonly string[],
  legend: Record<string, Terrain> = {},
): { tiles: Terrain[]; width: number; height: number } {
  const width = rows[0].length;
  const tiles: Terrain[] = [];
  for (const row of rows) {
    expect(row.length).toBe(width);
    for (const char of row) {
      tiles.push(char === "." ? "rough" : (legend[char] ?? "fairway"));
    }
  }
  return { tiles, width, height: rows.length };
}

const componentAt = (
  rows: readonly string[],
  terrain: Terrain,
  legend?: Record<string, Terrain>,
) => {
  const { tiles, width, height } = grid(rows, legend);
  const found = buildTerrainComponents(tiles, width, height)
    .filter((component) => component.terrain === terrain);
  return { found, tiles, width, height };
};

describe("component extraction", () => {
  it("splits 4-connected same-terrain cells into one component each", () => {
    const { found } = componentAt([
      "..........",
      ".FF....FF.",
      ".FF....FF.",
      "..........",
    ], "fairway");
    expect(found).toHaveLength(2);
    expect(found[0].cells).toEqual([11, 12, 21, 22]);
    expect(found[1].cells).toEqual([17, 18, 27, 28]);
  });

  it("treats diagonal-only contact as separate components", () => {
    const { found } = componentAt([
      ".....",
      ".F...",
      "..F..",
      ".....",
    ], "fairway");
    expect(found).toHaveLength(2);
    expect(found.every((component) => component.cells.length === 1)).toBe(true);
  });

  it("orders components and cells deterministically", () => {
    const rows = ["..F..", ".FF..", "..F.F", "....."];
    const first = componentAt(rows, "fairway").found;
    const second = componentAt(rows, "fairway").found;
    expect(second.map((c) => c.topologyKey)).toEqual(first.map((c) => c.topologyKey));
    for (const component of first) {
      expect(component.cells).toEqual([...component.cells].sort((a, b) => a - b));
    }
  });
});

describe("boundary tracing", () => {
  it("emits a single outer ring for a compact block", () => {
    const { found } = componentAt([
      "......",
      ".FFFF.",
      ".FFFF.",
      ".FFFF.",
      "......",
    ], "fairway");
    expect(found).toHaveLength(1);
    expect(found[0].rings).toHaveLength(1);
    expect(found[0].rings[0].kind).toBe("outer");
    expect(found[0].rings[0].signedArea).toBeGreaterThan(0);
  });

  it("emits an inner hole ring with opposite winding", () => {
    const { found } = componentAt([
      ".......",
      ".FFFFF.",
      ".F...F.",
      ".F...F.",
      ".FFFFF.",
      ".......",
    ], "fairway");
    const [component] = found;
    expect(component.rings).toHaveLength(2);
    expect(component.rings[0].kind).toBe("outer");
    expect(component.rings[1].kind).toBe("hole");
    expect(component.rings[0].signedArea).toBeGreaterThan(0);
    expect(component.rings[1].signedArea).toBeLessThan(0);
    // The hole is not part of the component.
    expect(componentContains(component, 3.5, 2.5)).toBe(false);
    expect(componentContains(component, 1.5, 2.5)).toBe(true);
  });

  it("keeps the rough island inside the hole as its own component", () => {
    const { found } = componentAt([
      ".......",
      ".FFFFF.",
      ".F.F.F.",
      ".FFFFF.",
      ".......",
    ], "rough");
    // Two isolated single-cell rough components inside the fairway, plus the
    // surrounding rough frame.
    expect(found.filter((component) => component.cells.length === 1)).toHaveLength(2);
  });

  it("separates a diagonal pinch into two rings rather than one figure-eight", () => {
    const { found } = componentAt([
      "......",
      ".FF...",
      ".FF...",
      "...FF.",
      "...FF.",
      "......",
    ], "fairway");
    expect(found).toHaveLength(2);
    expect(found.every((component) => component.rings.length === 1)).toBe(true);
  });
});

describe("corner rounding", () => {
  const rounded = (rows: readonly string[], terrain: Terrain = "fairway") =>
    componentAt(rows, terrain).found[0];

  it("replaces every interior right angle with an arc", () => {
    const component = rounded([
      "......",
      ".FFFF.",
      ".FFFF.",
      "......",
    ]);
    const ring = component.rings[0].points;
    // Four unrounded corners would leave exactly four vertices.
    expect(ring.length).toBeGreaterThan(4);
    // No point sits exactly on a grid corner of the block any more.
    for (const corner of [[1, 1], [5, 1], [5, 3], [1, 3]]) {
      expect(ring.some((point) => point.x === corner[0] && point.y === corner[1])).toBe(false);
    }
  });

  it("keeps the course perimeter square", () => {
    const { tiles, width, height } = grid(["FFF", "FFF"]);
    expect(vertexCornerRadius(tiles, width, height, 0, 0)).toBe(0);
    expect(vertexCornerRadius(tiles, width, height, 3, 2)).toBe(0);
    const [component] = buildTerrainComponents(tiles, width, height);
    expect(component.rings[0].points).toHaveLength(4);
  });

  it("keeps vertices sharp where more than two terrains meet", () => {
    const { tiles, width, height } = grid([
      ".....",
      ".FW..",
      ".S...",
      ".....",
    ], { F: "fairway", W: "water", S: "sand" });
    // Fairway, water, sand and rough all meet at (2, 2).
    expect(vertexCornerRadius(tiles, width, height, 2, 2)).toBe(0);
    // Only fairway and rough meet at (1, 1).
    expect(vertexCornerRadius(tiles, width, height, 1, 1)).toBe(TERRAIN_CORNER_RADIUS.fairway);
  });

  it("uses the boundary owner's radius, not the traced component's", () => {
    const { tiles, width, height } = grid([
      ".....",
      ".SS..",
      ".SS..",
      ".....",
    ], { S: "sand" });
    // Sand outranks rough, so both sides round by the bunker radius.
    expect(vertexCornerRadius(tiles, width, height, 1, 1)).toBe(TERRAIN_CORNER_RADIUS.sand);
    expect(TERRAIN_CORNER_RADIUS.sand).not.toBe(TERRAIN_CORNER_RADIUS.rough);
  });

  it("clamps every configured radius into the 0.25–0.5 tile band", () => {
    for (const radius of Object.values(TERRAIN_CORNER_RADIUS)) {
      expect(radius).toBeGreaterThanOrEqual(0.25);
      expect(radius).toBeLessThanOrEqual(0.5);
    }
  });

  it("leaves a one-tile neck at full width", () => {
    const component = rounded([
      ".......",
      ".FFF...",
      "...F...",
      "...FFF.",
      ".......",
    ]);
    // The neck's two flanks are straight runs, so no arc encroaches on them.
    expect(componentContains(component, 3.5, 2.5)).toBe(true);
    expect(componentContains(component, 3.06, 2.5)).toBe(true);
    expect(componentContains(component, 3.94, 2.5)).toBe(true);
  });

  it("keeps a one-tile island connected and non-degenerate", () => {
    const component = rounded([
      ".....",
      "..F..",
      ".....",
    ]);
    expect(componentContains(component, 2.5, 1.5)).toBe(true);
    expect(component.rings[0].signedArea).toBeGreaterThan(0.7);
  });
});

describe("topology preservation", () => {
  const shapes: Array<[string, string[]]> = [
    ["compact", ["......", ".FFFF.", ".FFFF.", ".FFFF.", "......"]],
    ["diagonal", ["......", ".F....", "..F...", "...F..", "......"]],
    ["concave", ["......", ".FFFF.", ".F..F.", ".F..F.", "......"]],
    ["holed", [".......", ".FFFFF.", ".F...F.", ".FFFFF.", "......."]],
    ["island", [".....", ".....", "..F..", ".....", "....."]],
    ["narrow-neck", [".......", ".FFF...", "...F...", "...FFF.", "......."]],
    ["comb", ["........", ".F.F.F..", ".FFFFF..", "........"]],
  ];

  it.each(shapes)("preserves owned cell centers for the %s component", (_name, rows) => {
    const { tiles, width, height } = grid(rows);
    for (const component of buildTerrainComponents(tiles, width, height)) {
      const owned = new Set(component.cells);
      for (let index = 0; index < tiles.length; index++) {
        const x = (index % width) + 0.5;
        const y = Math.floor(index / width) + 0.5;
        expect(componentContains(component, x, y)).toBe(owned.has(index));
      }
    }
  });

  it.each(shapes)("covers exactly the owned cells in the 4x mask for %s", (_name, rows) => {
    const { tiles, width, height } = grid(rows);
    for (const component of buildTerrainComponents(tiles, width, height)) {
      const mask = rasterizePresentationMask(component, width, height);
      const owned = new Set(component.cells);
      // A cell is "covered" when its centre sub-cell is set at 4x resolution.
      for (let index = 0; index < tiles.length; index++) {
        const cx = (index % width) * PRESENTATION_SCALE + PRESENTATION_SCALE / 2;
        const cy = Math.floor(index / width) * PRESENTATION_SCALE + PRESENTATION_SCALE / 2;
        const covered = mask[cy * width * PRESENTATION_SCALE + cx] === 1;
        expect(covered).toBe(owned.has(index));
      }
    }
  });

  it("never swallows a neighbouring component's cells", () => {
    const { tiles, width, height } = grid([
      "........",
      ".FFWW...",
      ".FFWW...",
      "..SS....",
      "........",
    ], { F: "fairway", W: "water", S: "sand" });
    const components = buildTerrainComponents(tiles, width, height);
    for (const component of components) {
      for (const other of components) {
        if (other === component) continue;
        for (const cell of other.cells) {
          const x = (cell % width) + 0.5;
          const y = Math.floor(cell / width) + 0.5;
          expect(componentContains(component, x, y)).toBe(false);
        }
      }
    }
  });
});

describe("shared boundaries", () => {
  /** Points of `component`'s runs that face `other`, as comparable keys. */
  const facing = (
    components: ReturnType<typeof buildTerrainComponents>,
    terrain: Terrain,
    other: Terrain,
  ) => {
    const keys = new Set<string>();
    for (const component of components) {
      if (component.terrain !== terrain) continue;
      for (const segment of component.boundarySegments) {
        if (segment.other !== other) continue;
        for (const point of segment.points) keys.add(`${point.x},${point.y}`);
      }
    }
    return keys;
  };

  it("gives both sides of a pair the identical contour", () => {
    const { tiles, width, height } = grid([
      ".........",
      ".WWWW....",
      ".WWWWW...",
      "..WWW....",
      ".........",
    ], { W: "water" });
    const components = buildTerrainComponents(tiles, width, height);
    const waterSide = facing(components, "water", "rough");
    const roughSide = facing(components, "rough", "water");
    expect(waterSide.size).toBeGreaterThan(8);
    expect([...waterSide].sort()).toEqual([...roughSide].sort());
  });

  it("assigns exactly one boundary owner per adjacency", () => {
    const { tiles, width, height } = grid([
      "......",
      ".FFS..",
      ".FFS..",
      "......",
    ], { F: "fairway", S: "sand" });
    const components = buildTerrainComponents(tiles, width, height);
    const pairs = new Set<string>();
    for (const component of components) {
      for (const segment of component.boundarySegments) {
        if (!segment.other) continue;
        pairs.add([segment.terrain, segment.other].sort().join("|"));
      }
    }
    // Every adjacency present in the grid is described from both sides, but
    // ZK-469 resolves a single owner from the shared pair key.
    expect([...pairs].sort()).toEqual(["fairway|rough", "fairway|sand", "rough|sand"]);
  });

  it("splits runs where the opposing material changes", () => {
    const { tiles, width, height } = grid([
      "......",
      ".FFF..",
      ".WWS..",
      "......",
    ], { F: "fairway", W: "water", S: "sand" });
    const fairway = buildTerrainComponents(tiles, width, height)
      .find((component) => component.terrain === "fairway")!;
    const others = new Set(fairway.boundarySegments.map((segment) => segment.other));
    expect(others).toEqual(new Set(["rough", "water", "sand"]));
    for (const segment of fairway.boundarySegments) {
      expect(segment.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("snaps all emitted points to the presentation quantum", () => {
    const { tiles, width, height } = grid([
      "........",
      "..FFFF..",
      ".FFFFFF.",
      "..FFF...",
      "........",
    ]);
    for (const component of buildTerrainComponents(tiles, width, height)) {
      for (const ring of component.rings) {
        for (const point of ring.points) {
          expect(Math.abs(point.x / SILHOUETTE_QUANTUM - Math.round(point.x / SILHOUETTE_QUANTUM)))
            .toBeLessThan(1e-9);
          expect(Math.abs(point.y / SILHOUETTE_QUANTUM - Math.round(point.y / SILHOUETTE_QUANTUM)))
            .toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe("determinism", () => {
  const rows = [
    ".........",
    "..FFWW...",
    ".FFFWWW..",
    ".FFSS.W..",
    "..FSS....",
    ".........",
  ];
  const legend = { F: "fairway", W: "water", S: "sand" } as const;

  it("is byte-stable across repeated derivations", () => {
    const { tiles, width, height } = grid(rows, legend);
    const first = buildTerrainComponents(tiles, width, height);
    const second = buildTerrainComponents(tiles.slice(), width, height);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("is unchanged by undo/redo round-trips through an edit", () => {
    const { tiles, width, height } = grid(rows, legend);
    const before = JSON.stringify(buildTerrainComponents(tiles, width, height));
    const edited = tiles.slice();
    edited[20] = "water";
    buildTerrainComponents(edited, width, height);
    const after = JSON.stringify(buildTerrainComponents(tiles.slice(), width, height));
    expect(after).toBe(before);
  });

  it("projects identically under all four rotations", () => {
    const { tiles, width, height } = grid(rows, legend);
    const components = buildTerrainComponents(tiles, width, height);
    // Geometry is derived in world space, so rotation only changes the
    // projection — never the silhouette itself.
    for (const rotation of ISO_ROTATIONS) {
      const projected = components.map((component) => component.rings.map((ring) =>
        ring.points.map((point) => worldToIso(point.x, point.y, 0, rotation))));
      expect(projected).toHaveLength(components.length);
      const reprojected = buildTerrainComponents(tiles, width, height)
        .map((component) => component.rings.map((ring) =>
          ring.points.map((point) => worldToIso(point.x, point.y, 0, rotation))));
      expect(JSON.stringify(reprojected)).toBe(JSON.stringify(projected));
    }
  });

  it("survives a randomized grid sweep with topology intact", () => {
    const terrains: Terrain[] = ["fairway", "rough", "sand", "water", "green", "path"];
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let trial = 0; trial < 12; trial++) {
      const width = 9;
      const height = 9;
      const tiles = Array.from(
        { length: width * height },
        () => terrains[Math.floor(random() * terrains.length)],
      );
      for (const component of buildTerrainComponents(tiles, width, height)) {
        const owned = new Set(component.cells);
        for (let index = 0; index < tiles.length; index++) {
          const x = (index % width) + 0.5;
          const y = Math.floor(index / width) + 0.5;
          expect(componentContains(component, x, y)).toBe(owned.has(index));
        }
      }
    }
  });
});

describe("silhouette cache", () => {
  it("reuses geometry for components whose topology did not change", () => {
    const { tiles, width, height } = grid([
      "........",
      ".FFF..W.",
      ".FFF..W.",
      "........",
    ], { F: "fairway", W: "water" });
    const cache = createSilhouetteCache();
    const first = cache.update(tiles, width, height);
    expect(first.stats.hits).toBe(0);
    expect(first.stats.misses).toBe(first.stats.components);

    const second = cache.update(tiles.slice(), width, height);
    expect(second.stats.misses).toBe(0);
    expect(second.stats.hits).toBe(second.stats.components);
    // Identity, not just equality: the cached rings are handed straight back.
    const firstFairway = first.components.find((c) => c.terrain === "fairway")!;
    const secondFairway = second.components.find((c) => c.terrain === "fairway")!;
    expect(secondFairway.rings[0]).toBe(firstFairway.rings[0]);
  });

  it("reports only the components a paint actually touched", () => {
    const { tiles, width, height } = grid([
      "........",
      ".FFF..W.",
      ".FFF..W.",
      "........",
    ], { F: "fairway", W: "water" });
    const cache = createSilhouetteCache();
    cache.update(tiles, width, height);

    const painted = tiles.slice();
    painted[9] = "sand"; // carve a bunker out of the fairway block
    const next = cache.update(painted, width, height);
    const changedTerrains = next.changed.map((component) => component.terrain).sort();
    // The fairway lost a cell and a new sand component appeared; the detached
    // water column and the surrounding rough keep their cached geometry.
    expect(changedTerrains).toEqual(["fairway", "rough", "sand"]);
    expect(next.changed.some((component) => component.terrain === "water")).toBe(false);
  });

  it("marks dirty bounds that enclose the changed cells", () => {
    const { tiles, width, height } = grid([
      "........",
      ".FFF....",
      ".FFF....",
      "........",
    ]);
    const cache = createSilhouetteCache();
    cache.update(tiles, width, height);
    const painted = tiles.slice();
    painted[18] = "sand";
    const sand = cache.update(painted, width, height).changed
      .find((component) => component.terrain === "sand")!;
    expect(sand.bounds).toEqual({ minX: 2, minY: 2, maxX: 3, maxY: 3 });
  });

  it("invalidates a component when only a diagonal neighbour is repainted", () => {
    const { tiles, width, height } = grid([
      ".....",
      ".F...",
      ".....",
      ".....",
    ]);
    const cache = createSilhouetteCache();
    const before = cache.update(tiles, width, height).components
      .find((component) => component.terrain === "fairway")!;
    const painted = tiles.slice();
    painted[12] = "sand"; // (2, 2) — diagonal to the fairway cell at (1, 1)
    const after = cache.update(painted, width, height);
    const fairway = after.components.find((component) => component.terrain === "fairway")!;
    // A third terrain now meets the fairway's south-east vertex, so that
    // corner must go sharp; reusing the cached ring would leave it rounded.
    expect(after.changed).toContain(fairway);
    expect(fairway.rings[0].points.length).toBeLessThan(before.rings[0].points.length);
    expect(vertexCornerRadius(painted, width, height, 2, 2)).toBe(0);
  });

  it("rebuilds everything after clear()", () => {
    const { tiles, width, height } = grid(["FF..", "FF.."]);
    const cache = createSilhouetteCache();
    cache.update(tiles, width, height);
    cache.clear();
    const after = cache.update(tiles, width, height);
    expect(after.stats.hits).toBe(0);
  });
});
