import { describe, expect, it } from "vitest";
import type { SurfacePoint, Terrain } from "../models/types";
import {
  buildSharedBoundaryContours,
  type SharedBoundaryComponentInput,
} from "./sharedBoundaryContours";

function fixture(rows: readonly string[]) {
  const legend: Record<string, Terrain> = {
    F: "fairway",
    R: "rough",
    S: "sand",
    W: "water",
    P: "path",
  };
  const width = rows[0].length;
  const height = rows.length;
  const tiles = rows.flatMap((row) => [...row].map((char) => legend[char]));
  const visited = new Uint8Array(tiles.length);
  const components: SharedBoundaryComponentInput[] = [];
  for (let seed = 0; seed < tiles.length; seed++) {
    if (visited[seed]) continue;
    const terrain = tiles[seed];
    const cells: number[] = [];
    const queue = [seed];
    visited[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      cells.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor] || tiles[neighbor] !== terrain) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ id: components.length, terrain, cells: cells.sort((a, b) => a - b) });
  }
  return { tiles, width, height, components };
}

function contains(rings: readonly (readonly SurfacePoint[])[], point: SurfacePoint): boolean {
  let inside = false;
  for (const ring of rings) {
    let inRing = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const a = ring[index];
      const b = ring[previous];
      if (
        (a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
      ) inRing = !inRing;
    }
    if (inRing) inside = !inside;
  }
  return inside;
}

function cyclicReverseEquals(a: readonly SurfacePoint[], b: readonly SurfacePoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let offset = 0; offset < b.length; offset++) {
    let matches = true;
    for (let index = 0; index < a.length; index++) {
      const other = b[(offset - index + b.length) % b.length];
      if (a[index].x !== other.x || a[index].y !== other.y) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function orientation(a: SurfacePoint, b: SurfacePoint, c: SurfacePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properIntersection(a: SurfacePoint, b: SurfacePoint, c: SurfacePoint, d: SurfacePoint) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-12 && cdA * cdB < -1e-12;
}

describe("shared presentation boundary graph", () => {
  it("traces every physical grid seam once and assigns reverse reuse", () => {
    const input = fixture([
      "RRRRR",
      "RFFRR",
      "RFSRR",
      "RRRRR",
    ]);
    const result = buildSharedBoundaryContours(
      input.tiles,
      input.width,
      input.height,
      input.components,
      { cornerRadius: 0.32, cornerSegments: 2 },
    );
    expect(new Set(result.edges.map((edge) => edge.key)).size).toBe(result.edges.length);
    for (const edge of result.edges) {
      expect(edge.forwardComponentId ?? edge.reverseComponentId).not.toBeNull();
      if (edge.forwardComponentId != null && edge.reverseComponentId != null) {
        expect(edge.forwardComponentId).not.toBe(edge.reverseComponentId);
      }
    }
  });

  it("reuses an enclosed seam as an exact cyclic reverse", () => {
    const input = fixture([
      "RRRRR",
      "RFFFR",
      "RFFFR",
      "RRRRR",
    ]);
    const result = buildSharedBoundaryContours(
      input.tiles,
      input.width,
      input.height,
      input.components,
      { cornerRadius: 0.32, cornerSegments: 2 },
    );
    const fairway = input.components.find((component) => component.terrain === "fairway")!;
    const rough = input.components.find((component) => component.terrain === "rough")!;
    const fairwayRing = result.ringsByComponent.get(fairway.id)![0];
    const roughHole = result.ringsByComponent.get(rough.id)!
      .find((ring) => ring.length === fairwayRing.length)!;
    expect(cyclicReverseEquals(fairwayRing, roughHole)).toBe(true);
  });

  it("preserves owned centers, diagonal separation, and a one-cell neck", () => {
    for (const rows of [
      ["RRRRRRR", "RFFFRRR", "RRRFRRR", "RRRFFFR", "RRRRRRR"],
      ["RRRRR", "RFRRR", "RRFRR", "RRRRR"],
    ]) {
      const input = fixture(rows);
      const result = buildSharedBoundaryContours(
        input.tiles,
        input.width,
        input.height,
        input.components,
        { cornerRadius: 0.4, cornerSegments: 4 },
      );
      for (const component of input.components) {
        const owned = new Set(component.cells);
        const rings = result.ringsByComponent.get(component.id)!;
        for (let index = 0; index < input.tiles.length; index++) {
          expect(contains(rings, {
            x: index % input.width + 0.5,
            y: Math.floor(index / input.width) + 0.5,
          })).toBe(owned.has(index));
        }
      }
      const fairways = input.components.filter((component) => component.terrain === "fairway");
      if (fairways.length === 2) expect(fairways.every((component) => component.cells.length === 1)).toBe(true);
    }
  });

  it("emits no proper self-intersections across adversarial component rings", () => {
    const input = fixture([
      "RRRRRRRR",
      "RFRFRFRR",
      "RFFFFFRR",
      "RFFRRFRR",
      "RFFFFFRR",
      "RRRRRRRR",
    ]);
    const result = buildSharedBoundaryContours(
      input.tiles,
      input.width,
      input.height,
      input.components,
      { cornerRadius: 0.4, cornerSegments: 4 },
    );
    for (const rings of result.ringsByComponent.values()) for (const ring of rings) {
      for (let a = 0; a < ring.length; a++) for (let b = a + 2; b < ring.length; b++) {
        if (a === 0 && b === ring.length - 1) continue;
        expect(properIntersection(
          ring[a],
          ring[(a + 1) % ring.length],
          ring[b],
          ring[(b + 1) % ring.length],
        )).toBe(false);
      }
    }
  });

  it("is byte-deterministic", () => {
    const input = fixture(["RRRR", "RFSR", "RWWR", "RRRR"]);
    const build = () => buildSharedBoundaryContours(
      input.tiles,
      input.width,
      input.height,
      input.components,
      { cornerRadius: 0.32, cornerSegments: 2 },
    );
    const serialize = (result: ReturnType<typeof build>) => JSON.stringify({
      edges: result.edges,
      rings: [...result.ringsByComponent],
    });
    expect(serialize(build())).toBe(serialize(build()));
  });
});
