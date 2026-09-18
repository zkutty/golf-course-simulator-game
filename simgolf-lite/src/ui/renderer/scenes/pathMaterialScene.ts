import type { Point, Terrain } from "../../../game/models/types";
import type { LandscapeComponent } from "../../../game/render/landscapeGeometry";
import {
  buildPathMaterialCrossSection,
  type PathMaterialStrip,
  type PathMaterialZoneRole,
} from "../../../game/render/pathMaterialCrossSection";
import type { AtlasPathMaterialRole, AtlasQuality } from "../../../render/atlasManifest";

export interface PathMaterialMeshData {
  readonly role: AtlasPathMaterialRole;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}
export interface PathMaterialScenePlan {
  readonly mode: "legacy" | "cross-section";
  readonly componentKey: string;
  readonly roles: readonly PathMaterialZoneRole[];
  readonly textureRoles: readonly AtlasPathMaterialRole[];
  readonly shoulderWidth: number;
  readonly edgeWidth: number;
  readonly strips: readonly PathMaterialStrip[];
  readonly suppressGenericPathRibbons: boolean;
}

const LEGACY_PLAN = (componentKey: string): PathMaterialScenePlan => ({
  mode: "legacy",
  componentKey,
  roles: ["core"],
  textureRoles: [],
  shoulderWidth: 0,
  edgeWidth: 0,
  strips: [],
  suppressGenericPathRibbons: false,
});

export function buildPathMaterialScenePlan(
  component: LandscapeComponent,
  tiles: readonly Terrain[],
  width: number,
  height: number,
  quality: AtlasQuality,
): PathMaterialScenePlan {
  if (quality === "low" || component.terrain !== "path") return LEGACY_PLAN(component.topologyKey);
  const section = buildPathMaterialCrossSection(component, tiles, width, height);
  if (!section || section.strips.length === 0) return LEGACY_PLAN(component.topologyKey);
  return {
    mode: "cross-section",
    componentKey: component.topologyKey,
    roles: ["shoulder", "edge", "core"],
    textureRoles: ["shoulder", "edge"],
    shoulderWidth: section.shoulderWidth,
    edgeWidth: section.edgeWidth,
    strips: section.strips,
    suppressGenericPathRibbons: true,
  };
}

/**
 * Converts one world-space strip into a repeating-texture mesh. UVs are
 * derived before projection, so camera rotation changes screen positions but
 * never the material phase or direction.
 */
export function pathMaterialStripMesh(
  strip: PathMaterialStrip,
  project: (point: Point) => Point,
  periodTiles = 4,
): PathMaterialMeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = Math.min(strip.outer.length, strip.inner.length);
  for (let index = 0; index + 1 < count; index++) {
    const world = [
      strip.outer[index],
      strip.outer[index + 1],
      strip.inner[index + 1],
      strip.inner[index],
    ];
    const base = positions.length / 2;
    for (const point of world) {
      const projected = project(point);
      positions.push(projected.x, projected.y);
      uvs.push(point.x / periodTiles, point.y / periodTiles);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    role: strip.role,
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}
