import type { Course, Estate, EstateParcel, LandTheme, Point, Terrain } from "../models/types";
import { COURSE_HEIGHT, COURSE_WIDTH, STARTER_PARCEL_HEIGHT, STARTER_PARCEL_WIDTH } from "../models/constants";

export const ESTATE_GENERATION_VERSION = 1 as const;
const TERRAIN_CODES: Record<Terrain, string> = {
  fairway: "f", rough: "r", deep_rough: "d", sand: "s", waste_area: "a",
  water: "w", wetland: "l", green: "g", tee: "t", path: "p",
};
const CODE_TERRAIN = Object.fromEntries(Object.entries(TERRAIN_CODES).map(([key, value]) => [value, key])) as Record<string, Terrain>;

function hash(seed: number, a: number, b = 0): number {
  let value = Math.imul(seed ^ Math.imul(a + 1, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(b + 7, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

function encodeRuns(values: readonly (number | string)[]): string {
  if (values.length === 0) return "";
  const parts: string[] = [];
  let value = values[0];
  let count = 1;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === value) count++;
    else {
      parts.push(`${typeof value === "number" ? value.toString(36) : value}:${count.toString(36)}`);
      value = values[i];
      count = 1;
    }
  }
  return parts.join(",");
}

function decodeStringRuns(encoded: string, expected: number): string[] | null {
  const result: string[] = [];
  if (!encoded) return expected === 0 ? result : null;
  for (const run of encoded.split(",")) {
    const [value, rawCount] = run.split(":");
    const count = Number.parseInt(rawCount, 36);
    if (!value || !Number.isInteger(count) || count < 1 || result.length + count > expected) return null;
    for (let i = 0; i < count; i++) result.push(value);
  }
  return result.length === expected ? result : null;
}

function decodeNumberRuns(encoded: string, expected: number): number[] | null {
  const strings = decodeStringRuns(encoded, expected);
  if (!strings) return null;
  const values = strings.map((value) => Number.parseInt(value, 36));
  return values.every(Number.isFinite) ? values : null;
}

export function encodeTerrainBaseline(tiles: readonly Terrain[]): string {
  return encodeRuns(tiles.map((tile) => TERRAIN_CODES[tile]));
}

export function decodeTerrainBaseline(encoded: string, expected: number): Terrain[] | null {
  const codes = decodeStringRuns(encoded, expected);
  if (!codes || codes.some((code) => !CODE_TERRAIN[code])) return null;
  return codes.map((code) => CODE_TERRAIN[code]);
}

export function encodeElevationBaseline(elevations: readonly number[]): string {
  return encodeRuns(elevations.map((value) => Math.round(value)));
}

export function decodeElevationBaseline(encoded: string, expected: number): number[] | null {
  return decodeNumberRuns(encoded, expected);
}

function starterBounds(width: number, height: number) {
  const minX = Math.floor((width - STARTER_PARCEL_WIDTH) / 2);
  const minY = Math.floor((height - STARTER_PARCEL_HEIGHT) / 2);
  return { minX, minY, maxX: minX + STARTER_PARCEL_WIDTH - 1, maxY: minY + STARTER_PARCEL_HEIGHT - 1 };
}

/** One exact legacy-sized starter parcel plus eight contiguous, irregular neighbors. */
export function generateParcelMap(width: number, height: number, seed: number): number[] {
  const starter = starterBounds(width, height);
  const map = new Array<number>(width * height);
  const wobbleX = (y: number, salt: number) => ((hash(seed + salt, Math.floor(y / 7)) % 9) - 4);
  const wobbleY = (x: number, salt: number) => ((hash(seed + salt, Math.floor(x / 9)) % 7) - 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let id: number;
    if (x >= starter.minX && x <= starter.maxX && y >= starter.minY && y <= starter.maxY) id = 4;
    else if (y < starter.minY) {
      const left = starter.minX + wobbleX(y, 11);
      const right = starter.maxX + 1 + wobbleX(y, 23);
      id = x < left ? 0 : x < right ? 1 : 2;
    } else if (y > starter.maxY) {
      const left = starter.minX + wobbleX(y, 37);
      const right = starter.maxX + 1 + wobbleX(y, 41);
      id = x < left ? 6 : x < right ? 7 : 8;
    } else if (x < starter.minX) {
      const upper = starter.minY + wobbleY(x, 53);
      const lower = starter.maxY + 1 + wobbleY(x, 67);
      id = y < upper ? 0 : y < lower ? 3 : 6;
    } else {
      const upper = starter.minY + wobbleY(x, 71);
      const lower = starter.maxY + 1 + wobbleY(x, 83);
      id = y < upper ? 2 : y < lower ? 5 : 8;
    }
    map[y * width + x] = id;
  }
  return map;
}

function parcelName(index: number): string {
  return ["Northwest Meadow", "North Ridge", "Northeast Woods", "West Fields", "Starter Property", "East Bluffs", "Southwest Heath", "South Valley", "Southeast Lakes"][index];
}

function buildTraits(args: { road: boolean; water: number; elevation: number; scenery: number; developable: number }): string[] {
  const traits: string[] = [];
  if (args.road) traits.push("road");
  if (args.water >= 8) traits.push("water");
  if (args.elevation >= 5) traits.push("contours");
  else if (args.elevation <= 2) traits.push("gentle");
  if (args.scenery >= 70) traits.push("scenic");
  if (args.developable >= 75) traits.push("developable");
  return traits.length ? traits : ["mixed"];
}

export function createEstate(course: Pick<Course, "width" | "height" | "tiles" | "elevations" | "yardsPerTile" | "theme">, seed: number): Estate {
  const parcelMap = generateParcelMap(course.width, course.height, seed);
  const stats = Array.from({ length: 9 }, () => ({ count: 0, sx: 0, sy: 0, minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, water: 0, developable: 0, scenic: 0, minElev: Infinity, maxElev: -Infinity, road: false, adjacent: new Set<number>() }));
  for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
    const index = y * course.width + x;
    const id = parcelMap[index];
    const s = stats[id];
    const terrain = course.tiles[index];
    const elevation = course.elevations[index] ?? 0;
    s.count++; s.sx += x; s.sy += y; s.minX = Math.min(s.minX, x); s.minY = Math.min(s.minY, y); s.maxX = Math.max(s.maxX, x); s.maxY = Math.max(s.maxY, y);
    if (terrain === "water" || terrain === "wetland") s.water++;
    if (terrain !== "water" && terrain !== "wetland" && terrain !== "sand") s.developable++;
    if (terrain === "water" || terrain === "wetland" || terrain === "deep_rough") s.scenic++;
    s.minElev = Math.min(s.minElev, elevation); s.maxElev = Math.max(s.maxElev, elevation);
    if (x === 0 || y === 0 || x === course.width - 1 || y === course.height - 1) s.road = true;
    if (x + 1 < course.width && parcelMap[index + 1] !== id) s.adjacent.add(parcelMap[index + 1]);
    if (y + 1 < course.height && parcelMap[index + course.width] !== id) s.adjacent.add(parcelMap[index + course.width]);
  }
  stats.forEach((s, id) => s.adjacent.forEach((other) => stats[other].adjacent.add(id)));
  const pressureBase: Record<LandTheme, number> = { parkland: 18_000, links: 15_000, desert: 12_000 };
  const parcels: EstateParcel[] = stats.map((s, index) => {
    const acreage = Number((s.count * course.yardsPerTile * course.yardsPerTile / 4840).toFixed(1));
    const developablePercent = Math.round(s.developable / s.count * 100);
    const waterPercent = Math.round(s.water / s.count * 100);
    const elevationRange = s.maxElev - s.minElev;
    const sceneryScore = Math.min(100, Math.round(35 + s.scenic / s.count * 180 + elevationRange * 4));
    const landValue = Math.round(acreage * 430);
    const developableValue = Math.round(acreage * developablePercent * 2.1);
    const roadAccessValue = s.road ? 12_000 : -6_000;
    const sceneryValue = Math.round(sceneryScore * 145);
    const waterValue = Math.round(waterPercent * 310);
    const elevationValue = Math.round(elevationRange * 1_400);
    const pressureValue = pressureBase[course.theme ?? "parkland"] + (hash(seed, index, 97) % 8_001);
    const total = Math.max(25_000, Math.round((landValue + developableValue + roadAccessValue + sceneryValue + waterValue + elevationValue + pressureValue) / 1000) * 1000);
    return {
      id: `parcel-${index + 1}`, name: parcelName(index), tileCount: s.count, acreage,
      center: { x: Math.round(s.sx / s.count), y: Math.round(s.sy / s.count) },
      bounds: { minX: s.minX, minY: s.minY, maxX: s.maxX, maxY: s.maxY },
      adjacentParcelIds: [...s.adjacent].sort((a, b) => a - b).map((id) => `parcel-${id + 1}`),
      publicRoadAccess: s.road, developablePercent, waterPercent, elevationRange, sceneryScore,
      traits: buildTraits({ road: s.road, water: waterPercent, elevation: elevationRange, scenery: sceneryScore, developable: developablePercent }),
      appraisal: { acreage, landValue, developableValue, roadAccessValue, sceneryValue, waterValue, elevationValue, pressureValue, total },
    };
  });
  return {
    generationVersion: ESTATE_GENERATION_VERSION, seed, starterParcelId: "parcel-5", ownedParcelIds: ["parcel-5"],
    parcelMapRle: encodeRuns(parcelMap), parcels,
    naturalBaseline: { terrainRle: encodeTerrainBaseline(course.tiles), elevationRle: encodeElevationBaseline(course.elevations) },
  };
}

const parcelMapCache = new WeakMap<Estate, number[]>();
export function decodeParcelMap(estate: Estate, expected: number): number[] | null {
  const cached = parcelMapCache.get(estate);
  if (cached?.length === expected) return cached;
  const decoded = decodeNumberRuns(estate.parcelMapRle, expected);
  if (decoded) parcelMapCache.set(estate, decoded);
  return decoded;
}

export function parcelAt(course: Course, point: Point): EstateParcel | null {
  const estate = course.estate;
  if (!estate || point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) return null;
  const map = decodeParcelMap(estate, course.width * course.height);
  return map ? estate.parcels[map[point.y * course.width + point.x]] ?? null : null;
}

export function isOwnedTile(course: Course, x: number, y: number): boolean {
  if (!course.estate) return x >= 0 && y >= 0 && x < course.width && y < course.height;
  const parcel = parcelAt(course, { x, y });
  return !!parcel && course.estate.ownedParcelIds.includes(parcel.id);
}

export function canPurchaseParcel(course: Course, cash: number, parcelId: string): { ok: true; parcel: EstateParcel } | { ok: false; reason: "missing" | "owned" | "non-adjacent" | "unaffordable" } {
  const estate = course.estate;
  const parcel = estate?.parcels.find((entry) => entry.id === parcelId);
  if (!estate || !parcel) return { ok: false, reason: "missing" };
  if (estate.ownedParcelIds.includes(parcelId)) return { ok: false, reason: "owned" };
  if (!parcel.adjacentParcelIds.some((id) => estate.ownedParcelIds.includes(id))) return { ok: false, reason: "non-adjacent" };
  if (cash < parcel.appraisal.total) return { ok: false, reason: "unaffordable" };
  return { ok: true, parcel };
}

export function starterParcelOffset(width = COURSE_WIDTH, height = COURSE_HEIGHT): Point {
  const bounds = starterBounds(width, height);
  return { x: bounds.minX, y: bounds.minY };
}

export function validateEstate(estate: Estate | undefined, width: number, height: number): boolean {
  const expected = width * height;
  if (!estate || estate.generationVersion !== 1 || !Number.isFinite(estate.seed) || estate.parcels.length !== 9) return false;
  if (!estate.parcels.some((p) => p.id === estate.starterParcelId) || !estate.ownedParcelIds.includes(estate.starterParcelId)) return false;
  if (new Set(estate.parcels.map((p) => p.id)).size !== 9 || estate.ownedParcelIds.some((id) => !estate.parcels.some((p) => p.id === id))) return false;
  const map = decodeParcelMap(estate, expected);
  if (!map || map.some((id) => id < 0 || id >= estate.parcels.length)) return false;
  if (!decodeTerrainBaseline(estate.naturalBaseline?.terrainRle ?? "", expected)) return false;
  if (!decodeElevationBaseline(estate.naturalBaseline?.elevationRle ?? "", expected)) return false;
  return estate.parcels.every((parcel) => parcel.tileCount > 0 && parcel.appraisal.total >= 0 && parcel.adjacentParcelIds.every((id) => estate.parcels.some((candidate) => candidate.id === id)));
}
