import { getBiomeDefinition } from "../models/biomes";
import {
  buildingEntrance,
  buildingSpec,
  buildingSupportElevation,
} from "../models/buildings";
import { planBuildingSiteGrade } from "../models/buildingSiteGrade";
import type { Building, Course, LandTheme, Point } from "../models/types";
import { frontCorner, placeObject } from "./objectPlacement";
import { worldToIso, type IsoPoint, type IsoRotation } from "./iso";

export type BuildingFoundationTreatment = "flat" | "cut" | "fill" | "cut-fill" | "legacy-repair";

export interface BuildingRetainingSegment {
  readonly from: IsoPoint;
  readonly to: IsoPoint;
  readonly magnitude: number;
  readonly kind: "cut" | "fill";
}

export interface BuildingSitePresentation {
  readonly supportElevation: number;
  readonly anchor: IsoPoint;
  readonly zIndex: number;
  readonly top: readonly IsoPoint[];
  readonly lower: readonly IsoPoint[];
  readonly foundationDepthPx: number;
  readonly treatment: BuildingFoundationTreatment;
  readonly retaining: readonly BuildingRetainingSegment[];
  readonly entrance: IsoPoint;
  readonly palette: { plinth: number; edge: number; entrance: number; shadowAlpha: number };
}

function edgeWorldPoints(cell: Point, direction: "north" | "east" | "south" | "west"): [Point, Point] {
  switch (direction) {
    case "north": return [{ x: cell.x, y: cell.y }, { x: cell.x + 1, y: cell.y }];
    case "east": return [{ x: cell.x + 1, y: cell.y }, { x: cell.x + 1, y: cell.y + 1 }];
    case "south": return [{ x: cell.x + 1, y: cell.y + 1 }, { x: cell.x, y: cell.y + 1 }];
    case "west": return [{ x: cell.x, y: cell.y + 1 }, { x: cell.x, y: cell.y }];
  }
}

function treatmentFor(building: Building, legacyRepair: boolean): BuildingFoundationTreatment {
  if (legacyRepair && !building.siteGrade) return "legacy-repair";
  const cut = (building.siteGrade?.cutSteps ?? 0) > 0;
  const fill = (building.siteGrade?.fillSteps ?? 0) > 0;
  return cut && fill ? "cut-fill" : cut ? "cut" : fill ? "fill" : "flat";
}

/** Pure, inspectable renderer contract; it never normalizes a legacy course. */
export function buildingSitePresentation(
  course: Course,
  building: Building,
  rotation: IsoRotation,
  quality: "high" | "medium" | "low",
): BuildingSitePresentation {
  const supportElevation = buildingSupportElevation(course, building);
  const spec = buildingSpec(building);
  const footprint = { x: building.x, y: building.y, w: spec.w, d: spec.d };
  const front = frontCorner(footprint, rotation);
  const placement = placeObject(footprint, supportElevation, rotation);
  const corners: Point[] = [
    { x: building.x, y: building.y },
    { x: building.x + spec.w, y: building.y },
    { x: building.x + spec.w, y: building.y + spec.d },
    { x: building.x, y: building.y + spec.d },
  ];
  const top = corners.map((corner) => worldToIso(corner.x, corner.y, supportElevation, rotation));
  const plan = planBuildingSiteGrade(course, building);
  const foundationDepthPx = Math.max(3, Math.min(16, 3 + Math.max(
    building.siteGrade ? Math.max(building.siteGrade.cutSteps, building.siteGrade.fillSteps) / Math.max(1, plan.footprint.length) : 0,
    plan.maximumSupportDelta,
    plan.maximumExposedEdgeDelta,
  ) * 2));
  const lower = top.map((point) => ({ x: point.x, y: point.y + foundationDepthPx }));
  const retaining = quality === "low" ? [] : plan.exposedEdges
    .filter((edge) => edge.neighbor && edge.magnitude > 1)
    .map((edge): BuildingRetainingSegment => {
      const [from, to] = edgeWorldPoints(edge.cell, edge.direction);
      return {
        from: worldToIso(from.x, from.y, edge.neighborElevation ?? supportElevation, rotation),
        to: worldToIso(to.x, to.y, edge.neighborElevation ?? supportElevation, rotation),
        magnitude: edge.magnitude,
        kind: edge.delta >= 0 ? "fill" : "cut",
      };
    });
  const entranceTile = buildingEntrance(course, building);
  const entranceElevation = course.elevations?.[entranceTile.y * course.width + entranceTile.x] ?? supportElevation;
  const theme: LandTheme = getBiomeDefinition(course.theme).key;
  const palette = theme === "desert"
    ? { plinth: 0xb99568, edge: 0x76553b, entrance: 0xe0c28f, shadowAlpha: 0.2 }
    : theme === "links"
      ? { plinth: 0x8f9184, edge: 0x555b56, entrance: 0xb9b7a4, shadowAlpha: 0.22 }
      : { plinth: 0x9a9385, edge: 0x56534d, entrance: 0xc4b9a0, shadowAlpha: 0.2 };
  return {
    supportElevation,
    anchor: worldToIso(front.x, front.y, supportElevation, rotation),
    zIndex: placement.zIndex,
    top,
    lower,
    foundationDepthPx,
    treatment: treatmentFor(building, plan.mutations.length > 0),
    retaining,
    entrance: worldToIso(entranceTile.x + 0.5, entranceTile.y + 0.5, entranceElevation, rotation),
    palette,
  };
}
