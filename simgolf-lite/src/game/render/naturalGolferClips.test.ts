import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseNaturalGolferArt } from "./naturalGolferArt";
import { naturalGolferActivityClips } from "./naturalGolferClips";
const manifest: unknown = JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/manifest.json", import.meta.url), "utf8"));
const cost: unknown = JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/cost.json", import.meta.url), "utf8"));
const parsed = parseNaturalGolferArt(manifest, cost);
if (!parsed.ok) throw new Error(parsed.reason);
const index = parsed.index;
const selection = Object.freeze({ family: "natural-golfer-v1", identity: "primary-teal-cream-01" });

describe("explicit natural body-motion binding", () => {
  it("validates all16 role/view pairs and preserves anatomical native rows", () => {
    const clips = naturalGolferActivityClips(index, selection);
    expect(clips).toHaveLength(16); expect(Object.isFrozen(clips)).toBe(true);
    expect(new Set(clips.map(c => c.id)).size).toBe(16);
    for (const clip of clips) {
      expect(clip).toMatchObject({ handedness: "right", equipmentClass: null, row: (clip.targetOctant + 6) % 8, mirror: false, validated: true });
      expect(clip.frames).toBe(clip.role === "swing" ? 8 : 4); expect(clip.contactFrame).toBe(clip.role === "swing" ? 5 : 2);
      if (clip.equipmentClass !== null) throw new Error("generic art cannot certify equipment");
      expect(clip.compatibleEquipmentClasses).toEqual(clip.role === "swing" ? ["driver", "iron", "wedge"] : ["putter"]);
      expect(Object.isFrozen(clip)).toBe(true); expect(Object.isFrozen(clip.compatibleEquipmentClasses)).toBe(true);
    }
  });
  it("rejects unavailable, copied and forged indexes without trusting coverage metadata", () => {
    for (const candidate of [null, { ...index }, structuredClone(index), {} as typeof index]) expect(naturalGolferActivityClips(candidate, selection)).toEqual([]);
  });
  it("requires exact explicit family and identity and performs no IO or clock work", () => {
    for (const choice of [{ ...selection, family: "legacy" }, { ...selection, identity: "other-player" }]) expect(naturalGolferActivityClips(index, choice)).toEqual([]);
    const code = readFileSync(new URL("./naturalGolferClips.ts", import.meta.url), "utf8");
    expect(code).not.toMatch(/fetch\(|\.json["']|Date\.|performance\.|setTimeout|from ["']pixi/);
  });
});
