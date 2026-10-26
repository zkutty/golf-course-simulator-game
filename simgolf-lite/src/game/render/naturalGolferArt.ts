/** Pure metadata boundary. Caller supplies parsed JSON after an explicit family
 * choice; no atlas/JSON import, IO, texture loader, activity policy or clock. */
export const NATURAL_GOLFER_FAMILY = "natural-golfer-v1" as const;
export const NATURAL_GOLFER_DIRECTIONS = Object.freeze(["s", "sw", "w", "nw", "n", "ne", "e", "se"] as const);
export type NaturalGolferDirection = typeof NATURAL_GOLFER_DIRECTIONS[number];
export type NaturalGolferClip = "walk" | "idle" | "swing" | "putt" | "positive" | "negative";
type Obj = Record<string, unknown>;
export interface NaturalGolferRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface NaturalGolferLayer { readonly texture: NaturalGolferRect; readonly trim: NaturalGolferRect }
export interface NaturalGolferFrame {
  readonly id: string; readonly clip: NaturalGolferClip; readonly direction: NaturalGolferDirection;
  readonly col: number; readonly row: number; readonly directionRole: "facing" | "target";
  readonly contact: boolean; readonly contactColumn: number | null; readonly mirror: false;
  readonly layers: { readonly base: NaturalGolferLayer; readonly tint: NaturalGolferLayer };
  readonly source: { readonly width: 72; readonly height: 96; readonly feet: readonly [36, 83]; readonly rasterScale: 1 };
  /** Scale model/source units, never fit either crop or the padded 72px width to 26px. */
  readonly bodyUnitScale: number;
}
export interface NaturalGolferArtIndex {
  readonly family: typeof NATURAL_GOLFER_FAMILY; readonly identity: "primary-teal-cream-01";
  readonly version: 1; readonly modelVersion: "natural-golfer-v1.0.0-candidate";
  readonly frameCount: 224; readonly layerCount: 448;
  readonly texture: { readonly file: "atlas.png"; readonly width: number; readonly height: number; readonly sha256: string };
  readonly body: { readonly referenceWidth: 48; readonly referenceHeight: 72; readonly referenceFeet: readonly [24, 69]; readonly sourceHeight: 64.1; readonly bodyUnitScale: number; readonly displayHeightAt100: number; readonly paddedDisplaySizeAt100: readonly [39, 52] };
  readonly coverage: { readonly hand: "right"; readonly genericMotion: true; readonly specificEquipmentClasses: readonly []; readonly classAccuracyCertified: false; readonly description: string };
  readonly shadow: { readonly file: "shadow.png"; readonly width: 40; readonly height: 20; readonly separate: true; readonly worldOffset: readonly [1.5, .8]; readonly worldRadii: readonly [8, 3.4]; readonly alpha: .18 };
  readonly cost: { readonly runtimePNGPlusManifestBytes: number; readonly decodedRGBABytes: number };
}
export type NaturalGolferArtParseResult = { readonly ok: true; readonly index: NaturalGolferArtIndex } | { readonly ok: false; readonly reason: string };
export interface GolferArtFamilySelection { readonly family: string; readonly identity: string }
export interface NaturalGolferArtRequest {
  readonly selection: GolferArtFamilySelection; readonly clip: string; readonly direction: string;
  readonly col: number; readonly handedness: "right" | "left" | null;
}
export type NaturalGolferArtFallbackReason = "family-not-selected" | "identity-not-covered" | "index-unavailable" | "unsupported-handedness" | "unsupported-clip" | "unsupported-direction" | "invalid-column" | "missing-frame";
export type NaturalGolferArtResolution = { readonly kind: "frame"; readonly selection: Readonly<GolferArtFamilySelection>; readonly frame: NaturalGolferFrame; readonly coverage: NaturalGolferArtIndex["coverage"] } | { readonly kind: "fallback"; readonly neutral: "non-gripping"; readonly reason: NaturalGolferArtFallbackReason; readonly selection: Readonly<GolferArtFamilySelection> };
const CLIPS = Object.freeze({ walk: [6, null, "facing"], idle: [2, null, "facing"], swing: [8, 5, "target"], putt: [4, 2, "target"], positive: [4, null, "facing"], negative: [4, null, "facing"] } as const);
const SCALE = 26 / 48;
const SOURCE = Object.freeze({ width: 72 as const, height: 96 as const, feet: Object.freeze([36, 83] as const), rasterScale: 1 as const });
// Frames are inaccessible to callers except through exact lookup. Freezing a Map
// alone would not prevent set/delete; a private WeakMap and frozen values do.
const validated = new WeakMap<NaturalGolferArtIndex, Readonly<Record<string, NaturalGolferFrame>>>();
const fail = (message: string): never => { throw new Error(message); };
const check = (condition: unknown, message: string): void => { if (!condition) fail(message); };
function record(value: unknown, label: string): Obj { check(typeof value === "object" && value !== null && !Array.isArray(value), label); return value as Obj; }
function keys(obj: Obj, expected: readonly string[], label: string): void { check(Object.keys(obj).length === expected.length && expected.every(key => Object.hasOwn(obj, key)), `${label}: fields`); }
function num(value: unknown, min: number, max: number, label: string, integer = false): number { check(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isSafeInteger(value)), label); return value as number; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}
function equal(value: unknown, expected: unknown, label: string): void { check(JSON.stringify(canonical(value)) === JSON.stringify(canonical(expected)), label); }
function near(value: unknown, expected: number, label: string): void { check(typeof value === "number" && Number.isFinite(value) && Math.abs(value - expected) < 1e-8, label); }
function jsonData(root: unknown): void {
  let visits = 0;
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): void {
    check(++visits <= 30000 && depth <= 16, "JSON bounds");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") { check(value.length <= 2048, "JSON string bounds"); return; }
    if (typeof value === "number") { check(Number.isFinite(value), "JSON finite numbers"); return; }
    check(typeof value === "object" && value !== null, "JSON data only");
    const object = value as object;
    check(!seen.has(object), "JSON repeated/cyclic object"); seen.add(object);
    check(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "JSON plain objects");
    check(Object.getOwnPropertySymbols(object).length === 0, "JSON symbols");
    if (Array.isArray(value)) check(value.length <= 448 && Object.keys(value).length === value.length, "JSON array bounds/sparse array");
    for (const key of Object.getOwnPropertyNames(object)) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      check(descriptor.enumerable && "value" in descriptor, "JSON accessors/hidden fields");
      visit(descriptor.value, depth + 1);
    }
  }
  visit(root, 0);
}
function rectangle(value: unknown, width: number, height: number, margin: number, label: string): NaturalGolferRect {
  const r = record(value, label); keys(r, ["x", "y", "w", "h"], label);
  const x = num(r.x, margin, width, `${label}.x`, true), y = num(r.y, margin, height, `${label}.y`, true);
  const w = num(r.w, 1, width, `${label}.w`, true), h = num(r.h, 1, height, `${label}.h`, true);
  check(x + w + margin <= width && y + h + margin <= height, `${label}: rectangle bounds`);
  return Object.freeze({ x, y, w, h });
}
function vector(value: unknown, label: string): readonly number[] { check(Array.isArray(value) && value.length === 3, label); return (value as unknown[]).map(v => num(v, -128, 128, label)); }
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((n, i) => n - b[i]));
function rig(value: unknown, strike: boolean, contact: boolean): void {
  if (!strike) { check(value === null, "non-strike rig must be null"); return; }
  const r = record(value, "rig"); keys(r, ["hand", "handL", "handR", "tip", "headEnd"], "rig"); check(r.hand === "right", "right-hand rig only");
  const l = vector(r.handL, "lead hand"), right = vector(r.handR, "trailing hand"), tip = vector(r.tip, "club tip"), end = vector(r.headEnd, "head end");
  near(distance(l, right), 1.85, "grip spacing"); near(distance(right, tip), Math.hypot(3.9, 4, 29.5), "rigid shaft"); near(distance(tip, end), 2.2, "rigid clubhead");
  for (let i = 0; i < 3; i++) near((l[i] - right[i]) / 1.85, (right[i] - tip[i]) / Math.hypot(3.9, 4, 29.5), "ordered collinear grip");
  if (contact) tip.forEach((n, i) => near(n, [7.6, 12, 1][i], "contact tip"));
}
/** Validate metadata and its cost receipt once. This checks declarations, not
 * PNG hashes/alpha or GPU upload; those stay with separate asset/loader gates. */
export function parseNaturalGolferArt(manifest: unknown, costReceipt: unknown): NaturalGolferArtParseResult {
  try {
    jsonData(manifest); jsonData(costReceipt);
    const m = record(manifest, "manifest");
    keys(m, ["schema", "version", "modelVersion", "status", "runtimeIntegrated", "identity", "variantCount", "legacyPreserved", "native", "body", "texture", "layers", "shadow", "directions", "coverage", "clips", "frames", "validation", "provenance"], "manifest");
    check(m.schema === "coursecraft.natural-golfer-atlas" && m.version === 1 && m.modelVersion === "natural-golfer-v1.0.0-candidate", "manifest version");
    check(m.status === "production-candidate-human-review-pending" && m.runtimeIntegrated === false && m.identity === "primary-teal-cream-01" && m.variantCount === 1 && m.legacyPreserved === true, "family/identity boundary");
    equal(m.native, { logicalWidth: 72, logicalHeight: 96, feet: [36, 83], sourceOrigin: [-12, -14], rasterScale: 1, referenceWidth: 48, referenceHeight: 72, referenceFeet: [24, 69], referenceDisplayWidth: 26, nativeDisplaySizeAt100: [39, 52] }, "native source/feet/reference scale");
    const body = record(m.body, "body"); keys(body, ["headRatio", "height", "displayHeightAt100"], "body"); near(body.headRatio, 6.41, "adult proportions"); near(body.height, 64.1, "body height"); near(body.displayHeightAt100, 64.1 * SCALE, "body world size");
    const texture = record(m.texture, "texture"); keys(texture, ["file", "width", "height", "format", "padding", "sha256"], "texture");
    check(texture.file === "atlas.png" && texture.format === "rgba8" && texture.padding === 2 && typeof texture.sha256 === "string" && /^[a-f0-9]{64}$/.test(texture.sha256), "texture role/hash");
    const width = num(texture.width, 1, 2048, "atlas width", true), height = num(texture.height, 1, 2048, "atlas height", true);
    const layers = record(m.layers, "layers"); keys(layers, ["order", "tint", "base", "occlusion"], "layers"); equal(layers.order, ["base", "tint"], "layer roles/order");
    equal(layers.tint, { scope: "polo fabric only", neutral: "grayscale", defaultColor: "#397e82" }, "tint role");
    equal(layers.base, { scope: "skin, trousers, cream cap, hair, shoes, bag, equipment, collar/buttons" }, "base role");
    check(layers.occlusion === "visible-surface partition; base alpha corrected for tint-over-base reconstruction", "layer occlusion contract");
    const shadow = record(m.shadow, "shadow"); keys(shadow, ["file", "width", "height", "rasterScale", "logicalAnchor", "worldOffset", "worldRadii", "alpha", "separate", "sha256"], "shadow");
    equal({ ...shadow, sha256: undefined }, { file: "shadow.png", width: 40, height: 20, rasterScale: 2, logicalAnchor: [10, 5], worldOffset: [1.5, .8], worldRadii: [8, 3.4], alpha: .18, separate: true }, "separate shadow");
    check(typeof shadow.sha256 === "string" && /^[a-f0-9]{64}$/.test(shadow.sha256), "shadow hash");
    equal(m.directions, { rows: [...NATURAL_GOLFER_DIRECTIONS], authored: 8, mirrored: 0, walkIdleReaction: "facing", swingPutt: "target" }, "authored direction roles");
    const coverage = record(m.coverage, "coverage"); keys(coverage, ["handedness", "unknownHand", "leftHand", "equipment", "optionalClips", "reactionPolicy"], "coverage");
    equal(coverage.handedness, ["right"], "hand coverage");
    check(coverage.unknownHand === "neutral non-gripping idle fallback; no strike coverage claimed" && coverage.leftHand === coverage.unknownHand, "unsupported-hand fallback");
    check(coverage.equipment === "generic legacy club silhouette; no driver/iron/putter class certification", "generic motion / class accuracy boundary");
    equal(coverage.optionalClips, { settle: "idle", watch: "idle" }, "optional clips");
    check(coverage.reactionPolicy === "candidate frames only; runtime may use one static evidenced cue inside shared rest, no added dwell or automatic loop", "reaction metadata");
    const clips = record(m.clips, "clips"); keys(clips, Object.keys(CLIPS), "clip roles");
    const samples: Record<string, readonly number[]> = Object.create(null) as Record<string, readonly number[]>;
    for (const [name, [columns, contact, semantics]] of Object.entries(CLIPS)) {
      const clip = record(clips[name], name); keys(clip, ["columns", "rows", "contact", "semantics", "modelSamples"], name);
      check(clip.columns === columns && clip.rows === 8 && clip.contact === contact && clip.semantics === semantics, `${name}: grid/contact/direction`);
      check(Array.isArray(clip.modelSamples) && clip.modelSamples.length === columns, `${name}: model sample count`);
      samples[name] = (clip.modelSamples as unknown[]).map(n => num(n, 0, 1, `${name}: finite sample`));
      check(samples[name].every((n, i, a) => i === 0 || n >= a[i - 1]), `${name}: ordered samples`);
    }
    near(samples.swing[5], .63, "swing contact sample"); near(samples.putt[2], .5, "putt contact sample");
    check(Array.isArray(m.frames) && m.frames.length === 224, "224 complete logical frames / maximum224");
    const table: Record<string, NaturalGolferFrame> = Object.create(null) as Record<string, NaturalGolferFrame>, ids = new Set<string>(), rectangles = new Map<string, NaturalGolferRect>();
    for (const value of m.frames as unknown[]) {
      const f = record(value, "frame"); keys(f, ["id", "clip", "direction", "col", "modelProgress", "contact", "sourceSize", "feetRaster", "layers", "rig"], "frame");
      check(typeof f.clip === "string" && Object.hasOwn(CLIPS, f.clip), "frame clip"); const clip = f.clip as NaturalGolferClip, def = CLIPS[clip];
      check(typeof f.direction === "string" && (NATURAL_GOLFER_DIRECTIONS as readonly string[]).includes(f.direction), "frame direction"); const direction = f.direction as NaturalGolferDirection;
      const col = num(f.col, 0, def[0] - 1, "frame column", true), id = `primary.${clip}.${direction}.${col}`, key = `${clip}/${direction}/${col}`;
      check(f.id === id && !ids.has(id) && !Object.hasOwn(table, key), "exact unique frame ID"); ids.add(id);
      near(f.modelProgress, samples[clip][col], "frame model sample"); check(f.contact === (def[1] === col), "frame contact ID"); equal(f.sourceSize, { w: 72, h: 96 }, "frame source size"); equal(f.feetRaster, [36, 83], "frame feet");
      rig(f.rig, clip === "swing" || clip === "putt", f.contact === true);
      const pair = record(f.layers, "frame layers"); keys(pair, ["base", "tint"], "atomic base/tint pair");
      const parsed = {} as { base: NaturalGolferLayer; tint: NaturalGolferLayer };
      for (const role of ["base", "tint"] as const) {
        const layer = record(pair[role], role); keys(layer, ["texture", "trim", "empty"], role); check(layer.empty === false, "missing/empty layer");
        const rect = rectangle(layer.texture, width, height, 2, "packed texture"), trim = rectangle(layer.trim, 72, 96, 1, "native trim");
        check(rect.w === trim.w && rect.h === trim.h, "texture / trim dimensions"); rectangles.set(JSON.stringify(rect), rect); parsed[role] = Object.freeze({ texture: rect, trim });
      }
      table[key] = Object.freeze({ id, clip, direction, col, row: NATURAL_GOLFER_DIRECTIONS.indexOf(direction), directionRole: def[2], contact: f.contact as boolean, contactColumn: def[1], mirror: false, layers: Object.freeze(parsed), source: SOURCE, bodyUnitScale: SCALE });
    }
    for (const [clip, def] of Object.entries(CLIPS)) for (const direction of NATURAL_GOLFER_DIRECTIONS) for (let col = 0; col < def[0]; col++) check(Object.hasOwn(table, `${clip}/${direction}/${col}`), "incomplete grid");
    const unique = [...rectangles.values()];
    for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i], b = unique[j]; check(a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y, "overlapping textures / padding");
    }
    const validation = record(m.validation, "validation"); keys(validation, ["alphaClippedFrames", "maxCompositeAlphaError", "maxCompositePremultipliedRGBError", "perPoseScale", "worldScale", "rasterToWorldScale"], "validation");
    check(validation.alphaClippedFrames === 0 && validation.perPoseScale === false, "source clipping / scale declarations"); num(validation.maxCompositeAlphaError, 0, 1, "alpha error bound"); num(validation.maxCompositePremultipliedRGBError, 0, 3, "RGB error bound"); near(validation.worldScale, SCALE, "body scale"); near(validation.rasterToWorldScale, SCALE, "raster scale");
    const provenance = record(m.provenance, "provenance");
    keys(provenance, ["approvedAnatomyCommit", "approvedModel", "approvedModelSha256", "paletteConceptCommit", "modelSha256", "generatorSha256", "sourceType", "rasterizer", "pngEncoder", "reproducibility", "licensing", "reviewer", "approval"], "provenance");
    for (const name of ["approvedModelSha256", "modelSha256", "generatorSha256"]) check(typeof provenance[name] === "string" && /^[a-f0-9]{64}$/.test(provenance[name] as string), "source hash declaration");
    for (const name of ["approvedAnatomyCommit", "paletteConceptCommit"]) check(typeof provenance[name] === "string" && /^[a-f0-9]{40}$/.test(provenance[name] as string), "source commit declaration");
    for (const name of ["approvedModel", "sourceType", "rasterizer", "pngEncoder", "reproducibility", "licensing"]) check(typeof provenance[name] === "string" && (provenance[name] as string).length > 0, "provenance declaration");
    check(provenance.reviewer === null && provenance.approval === "pending PNG/alpha/anchor/occlusion/normal-scale human review", "metadata cannot certify review");
    const c = record(costReceipt, "cost"); keys(c, ["manifestBytes", "runtimePNGPlusManifestBytes", "allPNGPlusManifestBytes", "baseline", "runtimeTextures", "reviewOnly", "allPNGs", "withinBaseline", "frames", "layerFrames", "uniqueLayerTextures"], "cost");
    equal(c.baseline, { compressedPNGBytes: 501591, decodedRGBABytes: 12700960 }, "unchanged budget ceilings");
    const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`).length; check(c.manifestBytes === manifestBytes, "manifest byte receipt");
    const runtime = record(c.runtimeTextures, "runtime texture cost"); keys(runtime, ["compressedPNGBytes", "decodedRGBABytes", "files"], "runtime texture cost");
    check(Array.isArray(runtime.files) && runtime.files.length === 2, "runtime texture files"); let pngBytes = 0;
    for (const [i, name] of ["atlas.png", "shadow.png"].entries()) { const file = record((runtime.files as unknown[])[i], "texture cost"); keys(file, ["file", "bytes", "width", "height"], "texture cost"); check(file.file === name && file.width === (i ? 40 : width) && file.height === (i ? 20 : height), "texture dimensions / byte receipt"); pngBytes += num(file.bytes, 1, 501591, "texture bytes", true); }
    const decoded = (width * height + 40 * 20) * 4;
    check(runtime.compressedPNGBytes === pngBytes && runtime.decodedRGBABytes === decoded && c.runtimePNGPlusManifestBytes === pngBytes + manifestBytes && pngBytes + manifestBytes <= 501591 && decoded <= 12700960, "full runtime budget");
    const review = record(c.reviewOnly, "review bytes"); keys(review, ["compressedPNGBytes", "decodedRGBABytes"], "review bytes"); const reviewBytes = num(review.compressedPNGBytes, 1, 501591, "review bytes", true), reviewDecoded = num(review.decodedRGBABytes, 1, 12700960, "review decoded", true);
    equal(c.allPNGs, { compressedPNGBytes: pngBytes + reviewBytes, decodedRGBABytes: decoded + reviewDecoded }, "all PNG receipt"); check(pngBytes + reviewBytes <= 501591 && decoded + reviewDecoded <= 12700960 && c.allPNGPlusManifestBytes === pngBytes + reviewBytes + manifestBytes, "review / runtime cost distinction");
    equal(c.withinBaseline, { runtime: true, includingReview: true }, "budget flags"); check(c.frames === 224 && c.layerFrames === 448 && c.uniqueLayerTextures === unique.length, "frame / layer budget counts");
    const index: NaturalGolferArtIndex = Object.freeze({ family: NATURAL_GOLFER_FAMILY, identity: "primary-teal-cream-01", version: 1, modelVersion: "natural-golfer-v1.0.0-candidate", frameCount: 224, layerCount: 448,
      texture: Object.freeze({ file: "atlas.png", width, height, sha256: texture.sha256 as string }),
      body: Object.freeze({ referenceWidth: 48, referenceHeight: 72, referenceFeet: Object.freeze([24, 69] as const), sourceHeight: 64.1, bodyUnitScale: SCALE, displayHeightAt100: 64.1 * SCALE, paddedDisplaySizeAt100: Object.freeze([39, 52] as const) }),
      coverage: Object.freeze({ hand: "right", genericMotion: true, specificEquipmentClasses: Object.freeze([] as const), classAccuracyCertified: false, description: coverage.equipment as string }),
      shadow: Object.freeze({ file: "shadow.png", width: 40, height: 20, separate: true, worldOffset: Object.freeze([1.5, .8] as const), worldRadii: Object.freeze([8, 3.4] as const), alpha: .18 }),
      cost: Object.freeze({ runtimePNGPlusManifestBytes: pngBytes + manifestBytes, decodedRGBABytes: decoded }) });
    validated.set(index, Object.freeze(table)); return Object.freeze({ ok: true, index });
  } catch (error) { return Object.freeze({ ok: false, reason: error instanceof Error ? error.message : "invalid manifest" }); }
}

/** Exact family/identity selection stays with the caller. No fallback imports a
 * legacy variant or fabricates a strike/ActivityClipPair policy certification. */
export function resolveNaturalGolferArt(index: NaturalGolferArtIndex | null, request: NaturalGolferArtRequest): NaturalGolferArtResolution {
  const selection = Object.freeze({ family: request.selection.family, identity: request.selection.identity });
  const fallback = (reason: NaturalGolferArtFallbackReason): NaturalGolferArtResolution => Object.freeze({ kind: "fallback", neutral: "non-gripping", reason, selection });
  if (selection.family !== NATURAL_GOLFER_FAMILY) return fallback("family-not-selected");
  if (!index || !validated.has(index)) return fallback("index-unavailable");
  if (selection.identity !== index.identity) return fallback("identity-not-covered");
  if (request.handedness !== "right") return fallback("unsupported-handedness");
  if (!Object.hasOwn(CLIPS, request.clip)) return fallback("unsupported-clip");
  if (!(NATURAL_GOLFER_DIRECTIONS as readonly string[]).includes(request.direction)) return fallback("unsupported-direction");
  const def = CLIPS[request.clip as NaturalGolferClip];
  if (!Number.isSafeInteger(request.col) || request.col < 0 || request.col >= def[0]) return fallback("invalid-column");
  const frame = validated.get(index)![`${request.clip}/${request.direction}/${request.col}`];
  return frame ? Object.freeze({ kind: "frame", selection, frame, coverage: index.coverage }) : fallback("missing-frame");
}
