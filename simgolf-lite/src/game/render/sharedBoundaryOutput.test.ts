import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terrain } from "../models/types";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { buildLandscapeComponents } from "./landscapeGeometry";
import * as shared from "./sharedBoundaryContours";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_, item: unknown) => {
    if (typeof item !== "number") return item;
    if (Number.isNaN(item)) return ["nonfinite", "NaN"];
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(item);
    return ["f64", bytes.toString("hex")];
  })).digest("hex");
}
const consumed = (result: shared.SharedBoundaryResult) => ({ rings: [...result.ringsByComponent], edges: result.edges });
afterEach(() => vi.restoreAllMocks());

describe("shared boundary requested output", () => {
  it("preserves original default full IEEE outputs and consumed rings/edges across fixtures", () => {
    const fullHashes: string[] = [];
    for (const fixture of ["m19", "m27"] as const) {
      for (const theme of fixture === "m19" ? ["parkland"] as const : ["parkland", "links", "desert"] as const) {
        const course = fixture === "m19" ? createParklandVisualReferenceCourse() : createM27ReleaseReferenceCourse(theme);
        for (const quality of ["high", "medium", "low"] as const) {
          const options = { cornerRadius: quality === "high" ? 0.4 : 0.32, cornerSegments: quality === "high" ? 4 : 2 };
          const components = buildLandscapeComponents(course.tiles, course.width, course.height, options)
            .map((component, id) => ({ id, terrain: component.terrain, cells: component.cells }));
          const full = shared.buildSharedBoundaryContours(course.tiles, course.width, course.height, components, options);
          fullHashes.push(digest({ ...consumed(full), seams: full.seams }));
          const rings = shared.buildSharedBoundaryContours(course.tiles, course.width, course.height, components, options, "rings-only");
          expect(digest(consumed(rings))).toBe(digest(consumed(full)));
          expect(full.seams.length).toBeGreaterThan(0);
          expect(rings.seams).toHaveLength(0);
        }
      }
    }
    expect(fullHashes).toHaveLength(12);
    // Unmodified 08e default API output, captured before this packet's source edit.
    expect(createHash("sha256").update(JSON.stringify(fullHashes)).digest("hex")).toBe("322b40e4642f42039062952cd06c7df00f5aabd51af73eb14f94c599a3e34deb");
  });

  it("omits canonical seam work rather than computing and discarding its output", () => {
    const tiles: Terrain[] = ["rough", "rough", "rough", "rough", "fairway", "rough", "rough", "rough", "rough"];
    const components = [{ id: 0, terrain: "rough" as const, cells: [0, 1, 2, 3, 5, 6, 7, 8] }, { id: 1, terrain: "fairway" as const, cells: [4] }];
    const counts = (mode: "full" | "rings-only") => {
      const reads = { radius: 0, segments: 0 };
      const result = shared.buildSharedBoundaryContours(tiles, 3, 3, components, {
        get cornerRadius() { reads.radius++; return 0.4; },
        get cornerSegments() { reads.segments++; return 4; },
      }, mode);
      return { reads, result };
    };
    const full = counts("full"), rings = counts("rings-only");
    // Original ring reconstruction reads 2/4; original canonical seams add 1/2.
    expect(full.reads).toEqual({ radius: 3, segments: 6 });
    expect(rings.reads).toEqual({ radius: 2, segments: 4 });
    expect(digest(consumed(rings.result))).toBe(digest(consumed(full.result)));
  });

  it("requests rings only for captured finite primitives and keeps malformed coercion on the full path", () => {
    const build = vi.spyOn(shared, "buildSharedBoundaryContours");
    const tiles: Terrain[] = ["rough", "fairway", "rough"];
    buildLandscapeComponents(tiles, 3, 1, { cornerRadius: 0.4, cornerSegments: 4 });
    expect(build.mock.calls.at(-1)?.[5]).toBe("rings-only");
    for (const radius of [NaN, Infinity, "0.4", { valueOf: () => 0.4 }]) {
      buildLandscapeComponents(tiles, 3, 1, { cornerRadius: radius as number, cornerSegments: 4 });
      expect(build.mock.calls.at(-1)?.[5]).toBe("full");
    }
  });

  it.each([
    ["rough", "fairway", "rough", "rough", "fairway", "rough", "rough", "rough", "rough"],
    ["fairway", "rough", "fairway", "rough", "sand", "rough", "fairway", "rough", "fairway"],
    ["sand", "sand", "sand", "sand", "rough", "sand", "sand", "sand", "sand"],
  ] as Terrain[][])("keeps junction, disconnected and hole ring ordering: %j", (...tiles) => {
    const options = { cornerRadius: 0.4, cornerSegments: 4 };
    const components = buildLandscapeComponents(tiles, 3, 3, options).map((component, id) => ({ id, terrain: component.terrain, cells: component.cells }));
    for (const ordered of [components, [...components].reverse()]) {
      const full = shared.buildSharedBoundaryContours(tiles, 3, 3, ordered, options);
      const rings = shared.buildSharedBoundaryContours(tiles, 3, 3, ordered, options, "rings-only");
      expect(digest(consumed(rings))).toBe(digest(consumed(full)));
    }
  });

  it("preserves early-return behavior and tile proxy reads before output dispatch", () => {
    const options = { cornerRadius: 0.4, cornerSegments: 4 };
    for (const [width, height, tiles] of [[0, 0, []], [-1, 1, []], [Infinity, 1, []], [NaN, 1, []], [2, 2, ["rough"]]] as Array<[number, number, Terrain[]]>) {
      const fullTrace: string[] = [], ringsTrace: string[] = [];
      const proxy = (trace: string[]) => new Proxy(tiles, { get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver); } });
      const full = shared.buildSharedBoundaryContours(proxy(fullTrace), width, height, [], options);
      const rings = shared.buildSharedBoundaryContours(proxy(ringsTrace), width, height, [], options, "rings-only");
      expect(digest(rings)).toBe(digest(full));
      expect(ringsTrace).toEqual(fullTrace);
    }
    const tiles: Terrain[] = ["rough", "fairway", "rough"];
    const components = [{ id: 0, terrain: "rough" as const, cells: [0] }, { id: 1, terrain: "fairway" as const, cells: [1] }, { id: 2, terrain: "rough" as const, cells: [2] }];
    const traces: string[][] = [];
    for (const mode of ["full", "rings-only"] as const) {
      const trace: string[] = []; traces.push(trace);
      shared.buildSharedBoundaryContours(new Proxy(tiles, { get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver); } }), 3, 1, components, options, mode);
    }
    expect(traces[1]).toEqual(traces[0]);
  });

  it("does not add shape probes for sparse or proxied landscape inputs", () => {
    const sparse = new Array<Terrain>(3); sparse[1] = "fairway";
    const trace: string[] = [];
    const tiles = new Proxy(sparse, {
      get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver); },
      ownKeys() { throw new Error("unexpected shape enumeration"); },
      getOwnPropertyDescriptor() { throw new Error("unexpected descriptor probe"); },
    });
    const result = buildLandscapeComponents(tiles, 3, 1, { cornerRadius: 0.4, cornerSegments: 4 });
    expect(result.map((component) => component.cells)).toEqual([[0], [1], [2]]);
    expect(trace).toContain("length");
  });
});
