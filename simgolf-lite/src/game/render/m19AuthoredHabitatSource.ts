import { hashCanonicalValue } from "../../utils/canonical";
import { PIN_ROTATIONS, TEE_SETS } from "../models/types";
import type { Course, Point } from "../models/types";
import type { ParklandHabitatFamily } from "./habitatFieldTopology";

/**
 * Tile-snapped presentation data for the two M19/M23 acceptance fixtures.
 *
 * It deliberately lives outside Course: it has no collision, routing, save,
 * economy, obstacle, atlas, or course-hash authority. The composition layer
 * revalidates every returned tile against the current course before rendering.
 */
export interface M19AuthoredHabitatPatchV1 {
  readonly schema: "m19-m23-authored-habitat-patch-v1";
  readonly id: string;
  readonly family: ParklandHabitatFamily;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** One inclusive x-run for every row in bounds; no camera/quality variants. */
  readonly rowRuns: readonly (readonly [number, number])[];
}

const PATCH_SCHEMA = "m19-m23-authored-habitat-patch-v1" as const;

const M19_M23_PATCHES: readonly M19AuthoredHabitatPatchV1[] = Object.freeze([
  Object.freeze({
    schema: PATCH_SCHEMA,
    id: "east-deep-rough-margin",
    family: "meadow_deep_rough_margin",
    bounds: Object.freeze({ x: 31, y: 23, width: 2, height: 2 }),
    rowRuns: Object.freeze([
      Object.freeze([31, 32] as const), Object.freeze([31, 32] as const),
    ]),
  }),
]);

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

/**
 * The signature intentionally covers only source authority consumed by this
 * art: terrain, elevation, real obstacles/structures, and every supported
 * route/marker alternative. It excludes active selection, quality, and
 * condition so A/B/C selection and render settings cannot activate new data.
 */
export function m19SourceGeometrySignature(course: Course): string {
  return hashCanonicalValue({
    width: course.width,
    height: course.height,
    theme: course.theme,
    tiles: course.tiles,
    elevations: course.elevations,
    obstacles: course.obstacles.map(({ x, y, type, plantId, origin }) => ({ x, y, type, plantId: plantId ?? null, origin: origin ?? null }))
      .sort((left, right) => left.y - right.y || left.x - right.x || left.type.localeCompare(right.type)
        || String(left.plantId).localeCompare(String(right.plantId)) || String(left.origin).localeCompare(String(right.origin))),
    buildings: (course.buildings ?? []).map(({ id, x, y, type, tier, price }) => ({ id: id ?? null, x, y, type, tier: tier ?? null, price: price ?? null }))
      .sort((left, right) => left.y - right.y || left.x - right.x || left.type.localeCompare(right.type) || String(left.id).localeCompare(String(right.id))),
    routes: course.holes.map((hole) => {
      const teeBoxes = TEE_SETS.map((teeSet) => ({ teeSet, point: hole.teeBoxes?.[teeSet] ?? null }));
      const pinPositions = PIN_ROTATIONS.map((pinRotation) => ({ pinRotation, point: hole.pinPositions?.[pinRotation] ?? null }));
      const hasTee = (point: Point | null | undefined) => point != null && teeBoxes.some((candidate) => candidate.point != null && pointKey(candidate.point) === pointKey(point));
      const hasPin = (point: Point | null | undefined) => point != null && pinPositions.some((candidate) => candidate.point != null && pointKey(candidate.point) === pointKey(point));
      const tees: { id: string; point: Point }[] = teeBoxes.flatMap(({ teeSet, point }) => point == null ? [] : [{ id: teeSet, point }]);
      const pins: { id: string; point: Point }[] = pinPositions.flatMap(({ pinRotation, point }) => point == null ? [] : [{ id: pinRotation, point }]);
      if (hole.tee && !hasTee(hole.tee)) tees.push({ id: "legacy", point: hole.tee });
      if (hole.green && !hasPin(hole.green)) pins.push({ id: "legacy", point: hole.green });
      return {
        tee: hasTee(hole.tee) ? null : hole.tee ?? null,
        green: hasPin(hole.green) ? null : hole.green ?? null,
        teeBoxes,
        pinPositions,
        waypoints: (hole.waypoints ?? []).map((point) => ({ ...point })),
        routes: tees.flatMap((tee) => pins.map((pin) => ({
          teeSet: tee.id,
          pinRotation: pin.id,
          points: [{ ...tee.point }, ...(hole.waypoints ?? []).map((point) => ({ ...point })), { ...pin.point }],
        }))),
      };
    }),
  });
}

const EXACT_FIXTURE_SIGNATURES: Readonly<Record<string, string>> = Object.freeze({
  "M19 Parkland Reference Club": "1501df6a",
  "M23 Course Standards Club": "d7d7f508",
});

function validPatch(patch: M19AuthoredHabitatPatchV1): boolean {
  const { bounds } = patch;
  return patch.schema === PATCH_SCHEMA
    && /^[a-z0-9-]+$/.test(patch.id)
    && Number.isInteger(bounds.x) && Number.isInteger(bounds.y)
    && Number.isInteger(bounds.width) && Number.isInteger(bounds.height)
    && bounds.width >= 2 && bounds.height >= 2
    && patch.rowRuns.length === bounds.height
    && patch.rowRuns.every(([start, end]) => Number.isInteger(start) && Number.isInteger(end)
      && start >= bounds.x && end < bounds.x + bounds.width && start <= end);
}

/** Returns fixture-owned immutable presentation data, or nothing. */
export function m19AuthoredHabitatSource(course: Course): readonly M19AuthoredHabitatPatchV1[] {
  const expectedSignature = EXACT_FIXTURE_SIGNATURES[course.name];
  if (course.width !== 48 || course.height !== 36 || course.theme !== "parkland" || !expectedSignature) return [];
  if (m19SourceGeometrySignature(course) !== expectedSignature) return [];
  if (!M19_M23_PATCHES.every(validPatch)) return [];
  return M19_M23_PATCHES;
}
