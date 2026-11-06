import type { Course, CultivatedTerrain, Terrain } from "../models/types";
import type { SurfaceCareTopology } from "./surfaceCare";

// Optional acceleration only; no runtime import of the cold builder.
function isCultivatedTerrain(terrain: Terrain): terrain is CultivatedTerrain {
  return terrain === "green" || terrain === "tee" || terrain === "fairway"
    || terrain === "rough" || terrain === "deep_rough";
}

// One strong entry only. Limits bound logical payload/structure, not V8 bytes.
const MAX_TOPOLOGY_REUSE_TILES = 32_768;
const MAX_TOPOLOGY_REUSE_FEATURES = 512;
const MAX_TOPOLOGY_REUSE_COVERAGE = 65_536;
const MAX_TOPOLOGY_REUSE_TEXT_BYTES = 262_144;
const TOPOLOGY_TERRAIN_CODES: Record<Terrain, string> = {
  fairway: "a", rough: "b", deep_rough: "c", sand: "d", waste_area: "e",
  water: "f", wetland: "g", green: "h", tee: "i", path: "j",
};
let lastTopology: { key: string; topology: SurfaceCareTopology } | null = null;
const unreadableTopologyData = Symbol("unreadable topology data");

function topologyData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor ? ("value" in descriptor ? descriptor.value : unreadableTopologyData)
    : key in value ? unreadableTopologyData : undefined;
}

function topologyObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function topologyArray(value: unknown, maximum: number): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length <= maximum
    && [Symbol.iterator, "toJSON", "map", "slice", "sort"].every((key) => !Object.hasOwn(value, key));
}

function topologyTerrain(value: unknown): value is Terrain {
  return typeof value === "string" && Object.hasOwn(TOPOLOGY_TERRAIN_CODES, value);
}

/** Unsupported inputs take the existing cold path, including its errors.
 * No general Proxy detection is claimed. Only ordinary own data is reusable.
 */
function topologyContentKey(course: Course): string | null {
  try {
    if (!topologyObject(course)) return null;
    const width = topologyData(course, "width"), height = topologyData(course, "height");
    const tiles = topologyData(course, "tiles");
    if (typeof width !== "number" || typeof height !== "number"
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || !topologyArray(tiles, MAX_TOPOLOGY_REUSE_TILES) || tiles.length !== width * height) return null;
    for (let index = 0; index < tiles.length; index++) {
      if (!topologyTerrain(topologyData(tiles, index))) return null;
    }
    const estate = topologyData(course, "estate");
    let natural: string | null = null;
    if (estate != null) {
      if (!topologyObject(estate)) return null;
      const baseline = topologyData(estate, "naturalBaseline");
      if (!topologyObject(baseline)) return null;
      const encoded = topologyData(baseline, "terrainRle");
      if (typeof encoded !== "string") return null;
      natural = encoded;
    }
    const intent = topologyData(course, "surfaceIntent");
    let features: unknown[] = [];
    if (intent != null) {
      if (!topologyObject(intent)) return null;
      const input = topologyData(intent, "features");
      if (!topologyArray(input, MAX_TOPOLOGY_REUSE_FEATURES)) return null;
      features = input;
    }
    // At most six UTF16 units per escaped input unit; numbers are counted
    // before any projection/encoding allocation. Tile codes need no escaping.
    let units = 128 + tiles.length + (natural == null ? 4 : 2 + natural.length * 6);
    let coverageCount = 0;
    for (let index = 0; index < features.length; index++) {
      const feature = topologyData(features, index);
      if (!topologyObject(feature)) return null;
      const id = topologyData(feature, "id"), terrain = topologyData(feature, "terrain");
      const order = topologyData(feature, "order");
      if (typeof id !== "string" || id.length > 256 || !topologyTerrain(terrain)
        || typeof order !== "number" || !Number.isFinite(order)) return null;
      units += 32 + id.length * 6 + terrain.length * 6 + String(order).length;
      if (isCultivatedTerrain(terrain)) {
        const coverage = topologyData(feature, "coverage");
        if (!topologyArray(coverage, MAX_TOPOLOGY_REUSE_COVERAGE)) return null;
        coverageCount += coverage.length;
        if (coverageCount > MAX_TOPOLOGY_REUSE_COVERAGE) return null;
        for (let cell = 0; cell < coverage.length; cell++) {
          const value = topologyData(coverage, cell);
          if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
          units += String(value).length + 1;
        }
      }
      if (units * 2 > MAX_TOPOLOGY_REUSE_TEXT_BYTES) return null;
    }
    if (units * 2 > MAX_TOPOLOGY_REUSE_TEXT_BYTES) return null;
    let terrainCodes = "";
    for (let index = 0; index < tiles.length; index++) {
      terrainCodes += TOPOLOGY_TERRAIN_CODES[topologyData(tiles, index) as Terrain];
    }
    // Original feature sequence includes ALL sort participants, including ties.
    const projection = features.map((value) => {
      const feature = value as Record<string, unknown>;
      const terrain = topologyData(feature, "terrain") as Terrain;
      return [topologyData(feature, "id"), terrain, topologyData(feature, "order"),
        isCultivatedTerrain(terrain) ? topologyData(feature, "coverage") : null];
    });
    const key = JSON.stringify([width, height, terrainCodes, natural, projection]);
    return key.length * 2 <= MAX_TOPOLOGY_REUSE_TEXT_BYTES ? key : null;
  } catch {
    return null;
  }
}

function reusableTopology(topology: SurfaceCareTopology): boolean {
  if (topology.zoneByTile.length > MAX_TOPOLOGY_REUSE_TILES
    || topology.zones.length > 4_096) return false;
  let cells = 0, textBytes = 0;
  const strings = new Set<string>();
  for (const zone of topology.zones) {
    cells += zone.cells.length;
    if (cells > MAX_TOPOLOGY_REUSE_TILES) return false;
    for (const text of [zone.key, zone.surfaceId]) {
      if (!strings.has(text)) {
        strings.add(text);
        textBytes += text.length * 2;
        if (textBytes > MAX_TOPOLOGY_REUSE_TEXT_BYTES) return false;
      }
    }
  }
  // zoneByTile contains only published zone.key references (or null).
  return true;
}

/** A miss retires the old single entry, including unsupported inputs. */
export function lookupTopology(course: Course): { key: string; topology: SurfaceCareTopology | null } | null {
  const key = topologyContentKey(course);
  if (key !== null && lastTopology?.key === key) return { key, topology: lastTopology.topology };
  lastTopology = null;
  return key === null ? null : { key, topology: null };
}

export function publishTopology(key: string, topology: SurfaceCareTopology): void {
  lastTopology = key.length * 2 <= MAX_TOPOLOGY_REUSE_TEXT_BYTES && reusableTopology(topology)
    ? { key, topology } : null;
}
