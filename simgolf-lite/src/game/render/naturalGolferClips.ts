import type { ActivityClipPair } from "./golferActivity";
import { NATURAL_GOLFER_DIRECTIONS, resolveNaturalGolferArt, type GolferArtFamilySelection, type NaturalGolferArtIndex } from "./naturalGolferArt";

/** Explicit body-motion compatibility, never a claim about the pictured club.
 * All authored frames must resolve through the branded art boundary first.
 * Octants use the activity convention: E=0, SE=1, S=2, ... NE=7. */
export function naturalGolferActivityClips(index: NaturalGolferArtIndex | null, selection: GolferArtFamilySelection): readonly ActivityClipPair[] {
  const clips: ActivityClipPair[] = [];
  for (const role of ["swing", "putt"] as const) {
    const frames = role === "swing" ? 8 : 4, contactFrame = role === "swing" ? 5 : 2;
    for (let targetOctant = 0; targetOctant < 8; targetOctant++) {
      const row = (targetOctant + 6) % 8, direction = NATURAL_GOLFER_DIRECTIONS[row];
      for (let col = 0; col < frames; col++) {
        const result = resolveNaturalGolferArt(index, { selection, clip: role, direction, col, handedness: "right" });
        if (result.kind !== "frame" || !result.coverage.genericMotion || result.coverage.classAccuracyCertified || result.frame.contactColumn !== contactFrame
          || result.frame.row !== row || result.frame.directionRole !== "target" || result.frame.contact !== (col === contactFrame)) return Object.freeze([]);
      }
      clips.push(Object.freeze({ id: `natural-golfer-v1/${role}/${direction}`, role, targetOctant, handedness: "right", equipmentClass: null,
        compatibleEquipmentClasses: Object.freeze(role === "swing" ? ["driver", "iron", "wedge"] as const : ["putter"] as const),
        row, frames, contactFrame, mirror: false, validated: true }));
    }
  }
  return Object.freeze(clips);
}
