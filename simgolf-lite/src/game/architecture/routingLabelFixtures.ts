import type { Course, Hole } from "../models/types";
import { createM26MultiCourseReferenceCourse } from "../testing/referenceCourse";

export type RoutingFixtureKind = "four" | "compact" | "overlapping" | "crossing" | "spread" | "incomplete" | "nine" | "eighteen" | "multi";
/** Shared deterministic geometry used by focused units and the native Pixi browser. */
export function routingLabelFixture(kind: RoutingFixtureKind = "four", theme: Course["theme"] = "parkland"): Course {
  const base = createM26MultiCourseReferenceCourse();
  const count = kind === "eighteen" || kind === "multi" ? 18 : kind === "nine" ? 9 : 4;
  const width = 64, height = 48;
  const holes: Hole[] = Array.from({ length: count }, (_, index) => {
    const col = index % 3, row = Math.floor(index / 3);
    let tee = { x: 6 + col * 18, y: 7 + row * 7 };
    let pin = { x: 17 + col * 18, y: 7 + row * 7 };
    if (kind === "four" || kind === "spread") { tee = { x: 8 + (index % 2) * 30, y: 10 + Math.floor(index / 2) * 25 }; pin = { x: tee.x + 17, y: tee.y + 3 }; }
    if (kind === "compact") { tee = { x: 22, y: 19 + index * 2 }; pin = { x: 38, y: tee.y }; }
    if (kind === "overlapping") { tee = { x: 14 + index, y: 18 }; pin = { x: 48 - index, y: 30 }; }
    if (kind === "crossing") { tee = { x: 12 + index * 10, y: 12 }; pin = { x: 48 - index * 10, y: 35 }; }
    const absentTee = kind === "incomplete" && (index === 1 || index === 3);
    const absentPin = kind === "incomplete" && index >= 2;
    return {
      id: `routing-${index + 1}`, name: `Routing ${index + 1}`, tee: absentTee ? null : tee, green: absentPin ? null : pin,
      teeBoxes: absentTee ? {} : { member: tee, forward: { x: tee.x + 2, y: tee.y }, championship: { x: tee.x - 2, y: tee.y } },
      pinPositions: absentPin ? {} : { A: pin, B: { x: pin.x, y: pin.y + 1 }, C: { x: pin.x, y: pin.y - 1 } },
      waypoints: [{ x: Math.round((tee.x + pin.x) / 2), y: Math.round((tee.y + pin.y) / 2) + 2 }], parMode: "MANUAL", parManual: 4,
    };
  });
  const ids = holes.map(h => h.id!);
  const groups = kind === "multi" ? [ids.slice(0, 9), ids.slice(9)] : [ids];
  return { ...base, width, height, tiles: Array.from({ length: width * height }, (_, i) => i % width < 3 ? "water" : "fairway"), elevations: new Array(width * height).fill(0), holes: [...holes].reverse(), layouts: groups.map((group, index) => ({ id: `layout-${index + 1}`, name: `Routing course ${index + 1}`, publishedHoleIds: group, draftHoleIds: [...group].reverse(), state: "open", roundLength: group.length === 18 ? 18 : 9, greenFee: 50 })), activeCourseId: "layout-1", activePinRotation: "B", theme };
}
