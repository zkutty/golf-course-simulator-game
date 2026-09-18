import { describe, expect, it } from "vitest";
import type { Terrain } from "../../../game/models/types";
import { buildLandscapeComponents } from "../../../game/render/landscapeGeometry";
import { buildPathMaterialScenePlan, pathMaterialStripMesh } from "./pathMaterialScene";

function fixture() {
  const width = 5;
  const height = 4;
  const tiles = Array<Terrain>(width * height).fill("rough");
  for (const [x, y] of [[1, 1], [2, 1], [3, 1], [3, 2]]) tiles[y * width + x] = "path";
  const component = buildLandscapeComponents(tiles, width, height, {
    cornerRadius: 0.32,
    cornerSegments: 3,
  }).find((candidate) => candidate.terrain === "path")!;
  return { width, height, tiles, component };
}

describe("path material scene", () => {
  it.each(["medium", "high"] as const)("requests all three %s material roles and one compositor owner", (quality) => {
    const { width, height, tiles, component } = fixture();
    const plan = buildPathMaterialScenePlan(component, tiles, width, height, quality);
    expect(plan.mode).toBe("cross-section");
    expect(plan.roles).toEqual(["shoulder", "edge", "core"]);
    expect(plan.textureRoles).toEqual(["shoulder", "edge"]);
    expect(plan.suppressGenericPathRibbons).toBe(true);
    expect(new Set(plan.strips.map((strip) => strip.role))).toEqual(new Set(["shoulder", "edge"]));
  });

  it("keeps Low on the exact legacy path and generic ribbon behavior", () => {
    const { width, height, tiles, component } = fixture();
    const plan = buildPathMaterialScenePlan(component, tiles, width, height, "low");
    expect(plan).toMatchObject({
      mode: "legacy",
      roles: ["core"],
      textureRoles: [],
      strips: [],
      suppressGenericPathRibbons: false,
    });
  });

  it("keeps UVs world-anchored while projection rotates positions", () => {
    const { width, height, tiles, component } = fixture();
    const strip = buildPathMaterialScenePlan(component, tiles, width, height, "high").strips[0];
    const identity = pathMaterialStripMesh(strip, (point) => point);
    const quarterTurn = pathMaterialStripMesh(strip, (point) => ({ x: -point.y, y: point.x }));
    expect([...quarterTurn.uvs]).toEqual([...identity.uvs]);
    expect([...quarterTurn.positions]).not.toEqual([...identity.positions]);
    expect([...quarterTurn.indices]).toEqual([...identity.indices]);
    expect(identity.positions.length).toBe(identity.uvs.length);
    expect(identity.indices.length % 6).toBe(0);
  });
});
