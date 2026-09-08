import type { Course, Hole } from "../models/types";
import { defaultHoleIllustrationPreviewSettings, type HoleIllustrationPreviewSettings } from "../holeIllustration/preview";

export const ZK771_HOLE_KINDS = [
  "straight", "dogleg", "split", "water-carry", "elevation", "wooded", "overlap", "alternate-tee-pin", "long-title",
] as const;

export type Zk771HoleKind = typeof ZK771_HOLE_KINDS[number];

function hole(kind: Zk771HoleKind, index: number): Hole {
  const row = Math.floor(index / 3);
  const column = index % 3;
  const tee = kind === "overlap" ? { x: 57, y: 4 } : { x: 4 + column * 20, y: 4 + row * 10 };
  const green = kind === "overlap" ? { x: 44, y: 7 } : { x: tee.x + 13, y: tee.y + (kind === "dogleg" ? 7 : 3) };
  const forward = { x: tee.x + 1, y: tee.y + 1 };
  const championship = { x: Math.max(1, tee.x - 1), y: tee.y };
  const waypoints = kind === "dogleg" ? [{ x: tee.x + 5, y: tee.y + 8 }]
    : kind === "split" ? [{ x: tee.x + 5, y: tee.y + 8 }, { x: tee.x + 9, y: tee.y - 2 }]
      : kind === "overlap" ? [{ x: 50, y: 4 }, { x: 50, y: 7 }]
        : [];
  return {
    id: `cert-${kind}-${index + 1}`,
    name: kind === "long-title" ? `Certified ${kind} ${"illustration ".repeat(20)}` : `Certified ${kind}`,
    tee,
    green,
    teeBoxes: { forward, member: tee, championship },
    pinPositions: {
      A: green,
      B: { x: green.x - 1, y: green.y },
      C: { x: green.x, y: Math.max(1, green.y - 1) },
    },
    waypoints,
    parMode: "MANUAL",
    parManual: kind === "water-carry" || kind === "elevation" ? 4 : 3,
  };
}

/** Deterministic, self-contained estate used only by the ZK-771 machine certificate. */
export function zk771CertificationEstate(size: 9 | 18, layoutMode: "full" | "disjoint" = "full"): Course {
  const width = 64;
  const height = 64;
  const tiles: Course["tiles"] = new Array(width * height).fill("rough");
  const elevations = new Array(width * height).fill(0);
  const holes = Array.from({ length: size }, (_, index) => {
    const kind = ZK771_HOLE_KINDS[index % ZK771_HOLE_KINDS.length];
    const value = hole(kind, index);
    const tee = value.tee!;
    const green = value.green!;
    tiles[tee.y * width + tee.x] = "tee";
    tiles[green.y * width + green.x] = "green";
    if (kind !== "overlap") for (let x = Math.min(tee.x, green.x); x <= Math.max(tee.x, green.x); x++) tiles[tee.y * width + x] = "fairway";
    if (kind === "split") {
      for (let y = tee.y - 2; y <= tee.y + 2; y++) tiles[y * width + tee.x + 1] = "fairway";
      for (let x = tee.x + 2; x < green.x - 2; x++) { tiles[(tee.y - 2) * width + x] = "fairway"; tiles[(tee.y + 2) * width + x] = "fairway"; tiles[tee.y * width + x] = "rough"; }
      for (let x = green.x - 2; x <= green.x; x++) for (let y = tee.y - 2; y <= tee.y + 2; y++) tiles[y * width + x] = "fairway";
    }
    if (kind === "water-carry") for (let y = tee.y - 2; y <= tee.y + 3; y++) for (let x = tee.x + 6; x <= tee.x + 8; x++) tiles[y * width + x] = "water";
    if (kind === "elevation") for (let y = green.y - 3; y <= green.y + 3; y++) for (let x = green.x - 3; x <= green.x + 3; x++) elevations[y * width + x] = x < green.x - 1 ? 2 : x < green.x + 1 ? 4 : 6;
    if (kind === "wooded") for (let y = tee.y - 3; y <= tee.y + 3; y++) for (let x = tee.x + 3; x <= tee.x + 8; x++) tiles[y * width + x] = "deep_rough";
    return value;
  });
  const publishedHoleIds = holes.map((entry) => entry.id!);
  const layouts = size === 18 && layoutMode === "disjoint"
    ? [
        { id: "cert-18-north", name: "Certified North", draftHoleIds: publishedHoleIds.slice(0, 9), publishedHoleIds: publishedHoleIds.slice(0, 9), roundLength: 9 as const, state: "open" as const, greenFee: 80 },
        { id: "cert-18-south", name: "Certified South", draftHoleIds: publishedHoleIds.slice(9), publishedHoleIds: publishedHoleIds.slice(9), roundLength: 9 as const, state: "open" as const, greenFee: 80 },
      ]
    : [{ id: `cert-${size}`, name: `Certified ${size}-hole illustrated course`, draftHoleIds: publishedHoleIds, publishedHoleIds, roundLength: size, state: "open" as const, greenFee: 80 }];
  return {
    width,
    height,
    tiles,
    elevations,
    holes,
    layouts,
    activeCourseId: layouts[0].id,
    obstacles: holes.flatMap((entry) => entry.id?.includes("wooded") && entry.tee ? [
      { x: entry.tee.x + 3, y: entry.tee.y - 2, type: "tree" as const },
      { x: entry.tee.x + 5, y: entry.tee.y + 2, type: "tree" as const },
      { x: entry.tee.x + 7, y: entry.tee.y - 1, type: "bush" as const },
    ] : []),
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "ZK-771 machine certification estate",
    baseGreenFee: 80,
    condition: 1,
  };
}

export function zk771IncompleteEstate() {
  const course = zk771CertificationEstate(9);
  const incomplete = structuredClone(course);
  incomplete.holes[0].green = null;
  incomplete.holes[0].pinPositions!.A = null;
  return incomplete;
}

export function zk771Settings(course: Course, teeSet: HoleIllustrationPreviewSettings["teeSet"] = "member", pinRotation: HoleIllustrationPreviewSettings["pinRotation"] = "A"): HoleIllustrationPreviewSettings {
  const settings = defaultHoleIllustrationPreviewSettings(course);
  if (!settings) throw new Error("ZK-771 fixture must expose a complete default illustration setting.");
  return { ...settings, teeSet, pinRotation };
}

export function zk771Evidence(settings: HoleIllustrationPreviewSettings) {
  return {
    status: "ready" as const,
    layoutId: settings.layoutId,
    holeId: settings.holeId,
    teeSet: settings.teeSet,
    pinRotation: settings.pinRotation,
  };
}
