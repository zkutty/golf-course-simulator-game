import type { Course, Point, Terrain } from "../game/models/types";
import type { GolferRenderData } from "../game/live/types";

export type LiveAudioEvent =
  | { kind: "shot"; golferId: number; shot: "swing" | "putt"; from: Point; to: Point }
  | { kind: "landing"; golferId: number; surface: Terrain; at: Point }
  | { kind: "hole-out"; golferId: number; scoreDelta: number; at: Point };

export function deriveLiveAudioEvents(previous: readonly GolferRenderData[], next: readonly GolferRenderData[], course: Course): LiveAudioEvent[] {
  const before = new Map(previous.map((golfer) => [golfer.id, golfer]));
  const events: LiveAudioEvent[] = [];
  for (const golfer of next) {
    const old = before.get(golfer.id);
    if (!old) continue;
    if (golfer.segKind === "flight" && old.segKind !== "flight" && golfer.shot) {
      events.push({
        kind: "shot",
        golferId: golfer.id,
        shot: golfer.shot,
        from: { x: golfer.x, y: golfer.y },
        to: { x: golfer.ballToX ?? golfer.x, y: golfer.ballToY ?? golfer.y },
      });
    }
    if (old.segKind === "flight" && golfer.segKind !== "flight") {
      const at = { x: old.ballToX ?? golfer.x, y: old.ballToY ?? golfer.y };
      events.push({ kind: "landing", golferId: golfer.id, surface: terrainAt(course, at), at });
    }
    if (golfer.scoredHoles > old.scoredHoles) {
      events.push({ kind: "hole-out", golferId: golfer.id, scoreDelta: golfer.lastHoleDelta, at: { x: golfer.x, y: golfer.y } });
    }
  }
  return events;
}

function terrainAt(course: Course, point: Point): Terrain {
  const x = Math.max(0, Math.min(course.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(course.height - 1, Math.round(point.y)));
  return course.tiles[y * course.width + x] ?? "rough";
}
