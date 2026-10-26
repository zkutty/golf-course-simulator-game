import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NATURAL_GOLFER_DIRECTIONS, NATURAL_GOLFER_FAMILY, parseNaturalGolferArt, resolveNaturalGolferArt } from "./naturalGolferArt";
import type { NaturalGolferArtIndex, NaturalGolferArtRequest } from "./naturalGolferArt";
const manifest: unknown = JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/manifest.json", import.meta.url), "utf8"));
const costs: unknown = JSON.parse(readFileSync(new URL("../../../art/natural-golfer-v1/cost.json", import.meta.url), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const object = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;
const at = (root: unknown, path: readonly (string | number)[]): unknown => path.reduce<unknown>((v, key) => object(v)[key], root);
const set = (root: unknown, path: readonly (string | number)[], value: unknown): void => { object(at(root, path.slice(0, -1)))[path[path.length - 1]] = value; };
const parse = () => parseNaturalGolferArt(clone(manifest), clone(costs));
const accepted = parse();
if (!accepted.ok) throw new Error(accepted.reason);
const index = accepted.index;
const request = (overrides: Partial<NaturalGolferArtRequest> = {}): NaturalGolferArtRequest => ({ selection: { family: NATURAL_GOLFER_FAMILY, identity: "primary-teal-cream-01" }, clip: "swing", direction: "se", col: 5, handedness: "right", ...overrides });
function reject(path: readonly (string | number)[], value: unknown, expected: RegExp, target: "manifest" | "cost" = "manifest") {
  const m = clone(manifest), c = clone(costs); set(target === "manifest" ? m : c, path, value); const result = parseNaturalGolferArt(m, c); expect(result.ok).toBe(false); if (!result.ok) expect(result.reason).toMatch(expected);
}
function frozen(value: unknown): void { if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); for (const child of Object.values(value)) frozen(child); } }

describe("validated versioned natural golfer art index", () => {
  it("accepts actual manifest/cost without importing JSON, loader, activity or node APIs in production", () => {
    expect(accepted.ok).toBe(true); expect(index.frameCount).toBe(224); expect(index.layerCount).toBe(448);
    const source = readFileSync(new URL("./naturalGolferArt.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:import|require)\s*(?:\(|.*from\s)/); expect(source).not.toMatch(/fetch\(|PIXI|ActivityClipPair[<:]/);
    expect(index.cost.runtimePNGPlusManifestBytes).toBe(442249); expect(index.cost.decodedRGBABytes).toBe(2591872);
  });
  it("resolves all224 exact clip/direction/columns into atomic base/tint and stable source geometry", () => {
    for (const value of at(manifest, ["frames"]) as unknown[]) {
      const f = object(value), result = resolveNaturalGolferArt(index, request({ clip: f.clip as string, direction: f.direction as string, col: f.col as number }));
      expect(result.kind).toBe("frame"); if (result.kind !== "frame") throw new Error("missing actual fixture frame");
      expect(result.frame.id).toBe(f.id); expect(result.frame.layers).toEqual({ base: { texture: at(f, ["layers", "base", "texture"]), trim: at(f, ["layers", "base", "trim"]) }, tint: { texture: at(f, ["layers", "tint", "texture"]), trim: at(f, ["layers", "tint", "trim"]) } });
      expect(result.frame.source).toEqual({ width: 72, height: 96, feet: [36,83], rasterScale: 1 }); expect(result.frame.bodyUnitScale).toBe(26 / 48);
      expect(result.frame.row).toBe(NATURAL_GOLFER_DIRECTIONS.indexOf(f.direction as typeof NATURAL_GOLFER_DIRECTIONS[number])); expect(result.frame.mirror).toBe(false); expect(result.frame.contact).toBe(f.contact);
      expect(result.frame.directionRole).toBe(["swing", "putt"].includes(f.clip as string) ? "target" : "facing");
    }
  });
  it("keeps13/26/52 reference widths and adult body height; never fits padded/cropped width into26", () => {
    for (const zoom of [.5,1,2]) { expect(index.body.referenceWidth * index.body.bodyUnitScale * zoom).toBe(26 * zoom); expect(72 * index.body.bodyUnitScale * zoom).toBe(39 * zoom); expect(index.body.sourceHeight * index.body.bodyUnitScale * zoom).toBeCloseTo(34.7208333333 * zoom); }
    expect(index.body.referenceFeet).toEqual([24,69]); expect(index.body.paddedDisplaySizeAt100).toEqual([39,52]); expect(index.shadow.separate).toBe(true);
  });
  it("deeply freezes normalized data and does not retain incoming mutable objects", () => {
    const m = clone(manifest), parsed = parseNaturalGolferArt(m, clone(costs)); if (!parsed.ok) throw new Error(parsed.reason);
    const first = resolveNaturalGolferArt(parsed.index, request()); frozen(parsed); frozen(first);
    set(m, ["texture", "width"], 9); set(m, ["frames", 0, "layers", "base", "texture", "x"], 999);
    expect(parsed.index.texture.width).toBe(1024); expect(resolveNaturalGolferArt(parsed.index, request())).toEqual(first); expect(Reflect.set(parsed.index.texture, "width", 9)).toBe(false);
    expect(resolveNaturalGolferArt({ ...index } as NaturalGolferArtIndex, request())).toMatchObject({ kind: "fallback", reason: "index-unavailable", neutral: "non-gripping" });
  });
  it("rejects accessors without execution, cycles, sparse arrays, nonplain objects and nonfinite data", () => {
    const evil = clone(manifest); let read = false; Object.defineProperty(object(evil), "version", { enumerable: true, get() { read = true; return 1; } }); expect(parseNaturalGolferArt(evil, costs).ok).toBe(false); expect(read).toBe(false);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(parseNaturalGolferArt(cycle, costs).ok).toBe(false); expect(parseNaturalGolferArt(new Date(), costs).ok).toBe(false);
    reject(["frames"], new Array(224), /array/); reject(["body", "height"], Infinity, /finite/); reject(["version"], undefined, /JSON data/);
    const symbol = clone(manifest); Object.defineProperty(object(symbol), Symbol("hidden"), { value: 1 }); expect(parseNaturalGolferArt(symbol, costs).ok).toBe(false);
  });
  it("rejects schema/family drift, wrong native source/feet/size and wrong layer roles", () => {
    reject(["version"], 2, /version/); reject(["modelVersion"], "other", /version/); reject(["identity"], "all-variants", /identity/); reject(["variantCount"], 3, /identity/);
    reject(["native", "feet"], [24,69], /native/); reject(["native", "logicalWidth"], 48, /native/); reject(["native", "referenceDisplayWidth"], 72, /native/); reject(["texture", "width"], 4096, /width/);
    reject(["layers", "order"], ["tint", "base"], /roles/); reject(["layers", "tint", "scope"], "all clothes", /tint role/); reject(["frames", 0, "sourceSize"], { w: 48, h: 72 }, /source size/); reject(["frames", 0, "feetRaster"], [24,69], /feet/);
  });
  it("rejects incomplete/duplicate IDs, unknown directions and invalid contact grids", () => {
    reject(["frames"], (at(manifest, ["frames"]) as unknown[]).slice(1), /224/); reject(["frames", 1], clone(at(manifest, ["frames", 0])), /unique/);
    reject(["frames", 0, "id"], "wrong", /unique/); reject(["frames", 0, "col"], 6, /column/); reject(["frames", 0, "direction"], "south", /direction/);
    reject(["directions", "mirrored"], 3, /direction/); reject(["directions", "rows"], ["s","sw","w","nw","n"], /direction/); reject(["clips", "swing", "contact"], 4, /contact/); reject(["clips", "putt", "columns"], 5, /grid/); reject(["clips", "swing", "semantics"], "facing", /direction/);
    reject(["frames", 0, "contact"], true, /contact ID/); reject(["frames", 100, "rig", "hand"], "left", /right-hand/); reject(["frames", 100, "rig", "tip"], [0,0,0], /shaft/);
  });
  it("rejects partial pairs, wrong trim, out-of-bounds and partial overlap while allowing exact dedup", () => {
    expect(at(costs, ["uniqueLayerTextures"])).toBeLessThan(448); expect(parse().ok).toBe(true);
    const partial = clone(at(manifest, ["frames", 0, "layers"])); delete object(partial).tint; reject(["frames", 0, "layers"], partial, /atomic/);
    reject(["frames", 0, "layers", "base", "empty"], true, /empty/); reject(["frames", 0, "layers", "base", "texture", "x"], 1024, /rectangle bounds/);
    reject(["frames", 0, "layers", "base", "trim", "x"], 70, /rectangle bounds/); reject(["frames", 0, "layers", "base", "trim", "w"], 27, /dimensions/); reject(["frames", 0, "layers", "tint", "texture", "x"], 3, /overlapping/);
  });
  it("rejects handedness/equipment claim inflation; generic-motion metadata grants no class certification", () => {
    reject(["coverage", "handedness"], ["right", "left"], /hand coverage/); reject(["coverage", "leftHand"], "mirror", /fallback/); reject(["coverage", "equipment"], "certified driver", /generic/);
    expect(index.coverage).toMatchObject({ hand: "right", genericMotion: true, classAccuracyCertified: false, specificEquipmentClasses: [] }); expect(index.coverage).not.toHaveProperty("validated");
  });
  it("bounds finite sample grids and layer counts and cannot invent pixel/hash or review certification", () => {
    reject(["clips", "walk", "modelSamples", 0], -1, /finite sample/); reject(["clips", "swing", "modelSamples", 5], .64, /contact sample/);
    reject(["frames"], Array.from({ length: 449 }, () => clone(at(manifest, ["frames", 0]))), /array bounds/);
    reject(["texture", "sha256"], "not-a-hash", /hash/); reject(["provenance", "approval"], "shipping-certified", /certify/);
    reject(["provenance", "modelSha256"], "unknown", /hash/); reject(["validation", "alphaClippedFrames"], 1, /clipping/);
    reject(["layerFrames"], 449, /counts/, "cost");
  });
  it("rejects changed ceilings, dishonest byte schemas/sums, dimensions and manifest receipt", () => {
    reject(["baseline", "compressedPNGBytes"], 9999999, /ceilings/, "cost"); reject(["runtimePNGPlusManifestBytes"], 1, /budget/, "cost"); reject(["runtimeTextures", "files", 0, "width"], 100, /dimensions/, "cost"); reject(["manifestBytes"], 1, /manifest byte/, "cost"); reject(["uniqueLayerTextures"], 448, /counts/, "cost"); reject(["withinBaseline", "runtime"], false, /flags/, "cost");
    const partial = clone(costs); delete object(partial).allPNGs; expect(parseNaturalGolferArt(manifest, partial)).toMatchObject({ ok: false });
  });
  it("preserves caller's explicit legacy identity and never replaces another natural identity", () => {
    expect(resolveNaturalGolferArt(index, request({ selection: { family: "legacy", identity: "golfer2" } }))).toMatchObject({ kind: "fallback", neutral: "non-gripping", reason: "family-not-selected", selection: { family: "legacy", identity: "golfer2" } });
    expect(resolveNaturalGolferArt(index, request({ selection: { family: NATURAL_GOLFER_FAMILY, identity: "another-actor-body" } }))).toMatchObject({ kind: "fallback", reason: "identity-not-covered" });
  });
  it("returns neutral missing reasons for absent index, unsupported hand and invalid exact lookups", () => {
    for (const handedness of [null,"left"] as const) expect(resolveNaturalGolferArt(index, request({ handedness }))).toMatchObject({ kind: "fallback", reason: "unsupported-handedness", neutral: "non-gripping" });
    expect(resolveNaturalGolferArt(null, request())).toMatchObject({ kind: "fallback", reason: "index-unavailable" }); expect(resolveNaturalGolferArt(index, request({ clip: "watch" }))).toMatchObject({ kind: "fallback", reason: "unsupported-clip" }); expect(resolveNaturalGolferArt(index, request({ direction: "?" }))).toMatchObject({ kind: "fallback", reason: "unsupported-direction" });
    for (const col of [-1,8,NaN,Infinity,.5]) expect(resolveNaturalGolferArt(index, request({ col }))).toMatchObject({ kind: "fallback", reason: "invalid-column" });
  });
});
