import type { Texture, TextureSource } from "pixi.js";
import { parseNaturalGolferArt, resolveNaturalGolferArt, NATURAL_GOLFER_DIRECTIONS, NATURAL_GOLFER_FAMILY } from "../game/render/naturalGolferArt";
import type { NaturalGolferArtIndex, NaturalGolferArtRequest, NaturalGolferArtResolution, NaturalGolferFrame, NaturalGolferRect } from "../game/render/naturalGolferArt";

/** No import-time IO or global Assets/cache participation. No family activation. */
const ROOT = `${import.meta.env.BASE_URL}atlases/natural-golfer-v1/`;
export const NATURAL_GOLFER_ATLAS_URLS = Object.freeze({ manifest: `${ROOT}manifest.json`, cost: `${ROOT}cost.json`, atlas: `${ROOT}atlas.png`, shadow: `${ROOT}shadow.png` });
type Role = "atlas" | "shadow";
export interface NaturalGolferOwnedSource<S> { readonly resource: S; readonly width: number; readonly height: number; readonly exclusive: true }
export interface NaturalGolferTextureGeometry {
  readonly role: Role; readonly frame: NaturalGolferRect; readonly orig: NaturalGolferRect;
  readonly trim: NaturalGolferRect | null; readonly anchor: Readonly<{ x: number; y: number }>; readonly label: string;
}
export interface NaturalGolferAtlasAdapters<S, T> {
  readonly fetchBytes: (url: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>;
  /** Must return a freshly owned private source. Shared/legacy resources are forbidden. */
  readonly createSource: (bytes: Uint8Array, expected: Readonly<{ role: Role; width: number; height: number; resolution: 1 | 2 }>) => Promise<NaturalGolferOwnedSource<S>>;
  readonly createTexture: (source: S, geometry: NaturalGolferTextureGeometry) => T;
  readonly destroyTexture: (texture: T) => void;
  readonly destroySource: (source: NaturalGolferOwnedSource<S>) => void;
}
export interface NaturalGolferAtlasSnapshot {
  readonly status: "idle" | "loading" | "ready" | "failed" | "disposed";
  readonly generation: number; readonly reason: string | null; readonly atlasTextureCount: number;
  readonly pairCount: number; readonly ownedSourceCount: number; readonly cleanupErrors: number;
  readonly totalRuntimeBytesIncludingCostReceipt: number | null;
}
export interface NaturalGolferAtlasLoadResult { readonly status: "ready" | "failed" | "superseded" | "disposed"; readonly generation: number; readonly reason: string | null }
export type NaturalGolferTextureLookup<T> = { readonly kind: "pair"; readonly generation: number; readonly base: T; readonly tint: T; readonly shadow: T; readonly shadowPlacement: { readonly unitScale: 1; readonly worldOffset: readonly [1.5, .8]; readonly alphaBaked: true }; readonly frame: NaturalGolferFrame; readonly bodyUnitScale: number; readonly coverage: NaturalGolferArtIndex["coverage"] } | Exclude<NaturalGolferArtResolution, { kind: "frame" }> | { readonly kind: "unavailable"; readonly generation: number; readonly neutral: "non-gripping"; readonly reason: "atlas-not-ready" };
export interface NaturalGolferAtlas<T> {
  readonly load: () => Promise<NaturalGolferAtlasLoadResult>;
  readonly snapshot: () => NaturalGolferAtlasSnapshot;
  /** Frozen branded metadata for the ready/current generation only. */
  readonly artIndex: () => NaturalGolferArtIndex | null;
  readonly lookup: (request: NaturalGolferArtRequest) => NaturalGolferTextureLookup<T>;
  /** Explicit reset permits one new attempt; no automatic per-frame retries. */
  readonly reset: () => number;
  /** Terminal cleanup; borrowed textures must no longer be used. */
  readonly dispose: () => void;
}
interface Attempt<S, T> {
  readonly generation: number; readonly abort: AbortController; readonly sources: Set<NaturalGolferOwnedSource<S>>;
  readonly textures: Set<T>; readonly cache: Map<string, T>; readonly pairs: Map<string, Readonly<{ base: T; tint: T }>>;
  closed: boolean; index: NaturalGolferArtIndex | null; shadow: T | null; runtimeBytes: number | null;
}
const CLIP_COLUMNS = Object.freeze({ walk: 6, idle: 2, swing: 8, putt: 4, positive: 4, negative: 4 });
const ORIG = Object.freeze({ x: 0, y: 0, w: 72, h: 96 });
const ANCHOR = Object.freeze({ x: 36 / 72, y: 83 / 96 });
const SHADOW_PLACEMENT = Object.freeze({ unitScale: 1 as const, worldOffset: Object.freeze([1.5, .8] as const), alphaBaked: true as const });
async function digest(bytes: Uint8Array): Promise<string> { const hash = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer); return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join(""); }
function pngDimensions(bytes: Uint8Array, width: number, height: number): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((n, i) => bytes[i] === n) || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("invalid PNG header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) !== width || view.getUint32(20) !== height) throw new Error("PNG source dimensions");
}
/** Explicitly created instance, bounded private resources, atomic publication. */
export function createNaturalGolferAtlas<S, T>(adapters: NaturalGolferAtlasAdapters<S, T>): NaturalGolferAtlas<T> {
  let generation = 0, status: NaturalGolferAtlasSnapshot["status"] = "idle", reason: string | null = null, cleanupErrors = 0;
  let current: Attempt<S, T> | null = null, loadPromise: Promise<NaturalGolferAtlasLoadResult> | null = null;
  const destroySource = (source: NaturalGolferOwnedSource<S>) => { try { adapters.destroySource(source); } catch { cleanupErrors++; } };
  const release = (attempt: Attempt<S, T>) => {
    if (attempt.closed) return; attempt.closed = true; attempt.abort.abort();
    for (const texture of attempt.textures) { try { adapters.destroyTexture(texture); } catch { cleanupErrors++; } }
    attempt.textures.clear(); attempt.cache.clear(); attempt.pairs.clear(); attempt.shadow = null;
    for (const source of attempt.sources) destroySource(source); attempt.sources.clear(); attempt.index = null;
  };
  const isCurrent = (attempt: Attempt<S, T>) => current === attempt && attempt.generation === generation && !attempt.closed && status !== "disposed";
  const guard = (attempt: Attempt<S, T>) => { if (!isCurrent(attempt)) throw new Error("superseded"); };
  const fetchBytes = async (attempt: Attempt<S, T>, url: string, limit: number) => {
    const bytes = await adapters.fetchBytes(url, limit, attempt.abort.signal); guard(attempt);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > limit) throw new Error("asset byte bound");
    return bytes;
  };
  const createSource = async (attempt: Attempt<S, T>, bytes: Uint8Array, role: Role, width: number, height: number, resolution: 1 | 2) => {
    const source = await adapters.createSource(bytes, Object.freeze({ role, width, height, resolution }));
    // An adapter explicitly marking a shared source is rejected without destruction.
    if (!source || source.exclusive !== true) throw new Error("source is not privately owned");
    if (!isCurrent(attempt)) { destroySource(source); throw new Error("superseded"); }
    if ([...attempt.sources].some(other => other.resource === source.resource)) throw new Error("source alias is not exclusive");
    attempt.sources.add(source);
    if (source.width !== width || source.height !== height) throw new Error("decoded source dimensions");
    return source.resource;
  };
  const texture = (attempt: Attempt<S, T>, source: S, geometry: NaturalGolferTextureGeometry): T => {
    guard(attempt); const created = adapters.createTexture(source, Object.freeze(geometry));
    if (!isCurrent(attempt)) { try { adapters.destroyTexture(created); } catch { cleanupErrors++; } throw new Error("superseded"); }
    attempt.textures.add(created); return created;
  };
  async function run(attempt: Attempt<S, T>): Promise<NaturalGolferAtlasLoadResult> {
    try {
      guard(attempt);
      const [manifestBytes, costBytes] = await Promise.all([fetchBytes(attempt, NATURAL_GOLFER_ATLAS_URLS.manifest, 131072), fetchBytes(attempt, NATURAL_GOLFER_ATLAS_URLS.cost, 4096)]);
      const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)), cost: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(costBytes));
      const parsed = parseNaturalGolferArt(manifest, cost); if (!parsed.ok) throw new Error(`metadata invalid: ${parsed.reason}`);
      // Shapes are validated by the accepted pure parser before this narrow read.
      const receipt = cost as { manifestBytes: number; runtimeTextures: { files: readonly { bytes: number }[] } };
      const shadowMetadata = (manifest as { shadow: { sha256: string } }).shadow;
      if (manifestBytes.byteLength !== receipt.manifestBytes || parsed.index.cost.runtimePNGPlusManifestBytes + costBytes.byteLength > 501591) throw new Error("complete runtime byte budget including receipt");
      attempt.runtimeBytes = parsed.index.cost.runtimePNGPlusManifestBytes + costBytes.byteLength;
      const [atlasBytes, shadowBytes] = await Promise.all([fetchBytes(attempt, NATURAL_GOLFER_ATLAS_URLS.atlas, receipt.runtimeTextures.files[0].bytes), fetchBytes(attempt, NATURAL_GOLFER_ATLAS_URLS.shadow, receipt.runtimeTextures.files[1].bytes)]);
      if (atlasBytes.length !== receipt.runtimeTextures.files[0].bytes || shadowBytes.length !== receipt.runtimeTextures.files[1].bytes) throw new Error("PNG byte receipt");
      pngDimensions(atlasBytes, parsed.index.texture.width, parsed.index.texture.height); pngDimensions(shadowBytes, 40, 20);
      const hashes = await Promise.all([digest(atlasBytes), digest(shadowBytes)]); guard(attempt);
      if (hashes[0] !== parsed.index.texture.sha256 || hashes[1] !== shadowMetadata.sha256) throw new Error("PNG hash mismatch");
      const [atlasSource, shadowSource] = await Promise.all([createSource(attempt, atlasBytes, "atlas", parsed.index.texture.width, parsed.index.texture.height, 1), createSource(attempt, shadowBytes, "shadow", 40, 20, 2)]);
      guard(attempt);
      for (const [clip, columns] of Object.entries(CLIP_COLUMNS)) for (const direction of NATURAL_GOLFER_DIRECTIONS) for (let col = 0; col < columns; col++) {
        const resolved = resolveNaturalGolferArt(parsed.index, { selection: { family: NATURAL_GOLFER_FAMILY, identity: parsed.index.identity }, clip, direction, col, handedness: "right" });
        if (resolved.kind !== "frame") throw new Error("missing atomic coverage");
        const pair = {} as { base: T; tint: T };
        for (const role of ["base", "tint"] as const) {
          const layer = resolved.frame.layers[role], key = JSON.stringify([layer.texture, layer.trim, ORIG, ANCHOR]);
          let part = attempt.cache.get(key);
          if (part === undefined) {
            if (attempt.cache.size >= 448) throw new Error("atlas texture cache bound");
            part = texture(attempt, atlasSource, { role: "atlas", frame: layer.texture, orig: ORIG, trim: layer.trim, anchor: ANCHOR, label: `${resolved.frame.id}.${role}` }); attempt.cache.set(key, part);
          }
          pair[role] = part;
        }
        attempt.pairs.set(resolved.frame.id, Object.freeze(pair));
      }
      attempt.shadow = texture(attempt, shadowSource, { role: "shadow", frame: Object.freeze({ x: 0, y: 0, w: 20, h: 10 }), orig: Object.freeze({ x: 0, y: 0, w: 20, h: 10 }), trim: null, anchor: Object.freeze({ x: .5, y: .5 }), label: "natural-golfer-v1.shadow" });
      guard(attempt); attempt.index = parsed.index; status = "ready"; reason = null;
      return Object.freeze({ status: "ready", generation: attempt.generation, reason: null });
    } catch (error) {
      if (!isCurrent(attempt)) { release(attempt); return Object.freeze({ status: "superseded", generation: attempt.generation, reason: "superseded" }); }
      const failureReason = (error instanceof Error ? error.message : "optional atlas unavailable").slice(0, 180);
      // Detach before abort/destroy callbacks: cleanup may synchronously reset,
      // dispose or start a new generation. No old completion may overwrite it.
      current = null; status = "failed"; reason = failureReason;
      release(attempt);
      if (generation !== attempt.generation || status !== "failed" || current !== null) return Object.freeze({ status: "superseded", generation: attempt.generation, reason: "superseded" });
      return Object.freeze({ status: "failed", generation: attempt.generation, reason: failureReason });
    }
  }
  return Object.freeze({
    load() {
      if (status === "disposed") return Promise.resolve(Object.freeze({ status: "disposed" as const, generation, reason: "disposed" }));
      if (loadPromise) return loadPromise;
      status = "loading"; reason = null;
      const attempt: Attempt<S, T> = { generation, abort: new AbortController(), sources: new Set(), textures: new Set(), cache: new Map(), pairs: new Map(), closed: false, index: null, shadow: null, runtimeBytes: null };
      current = attempt; loadPromise = Promise.resolve().then(() => run(attempt)); return loadPromise;
    },
    snapshot() { return Object.freeze({ status, generation, reason, atlasTextureCount: status === "ready" ? current!.cache.size : 0, pairCount: status === "ready" ? current!.pairs.size : 0, ownedSourceCount: status === "ready" ? current!.sources.size : 0, cleanupErrors, totalRuntimeBytesIncludingCostReceipt: status === "ready" ? current!.runtimeBytes : null }); },
    artIndex() { return status === "ready" && current && isCurrent(current) ? current.index : null; },
    lookup(request: NaturalGolferArtRequest): NaturalGolferTextureLookup<T> {
      if (status !== "ready" || !current?.index || current.shadow === null) return Object.freeze({ kind: "unavailable", generation, neutral: "non-gripping", reason: "atlas-not-ready" });
      const resolved = resolveNaturalGolferArt(current.index, request); if (resolved.kind !== "frame") return resolved;
      const pair = current.pairs.get(resolved.frame.id); if (!pair) return Object.freeze({ kind: "unavailable", generation, neutral: "non-gripping", reason: "atlas-not-ready" });
      return Object.freeze({ kind: "pair", generation, base: pair.base, tint: pair.tint, shadow: current.shadow, shadowPlacement: SHADOW_PLACEMENT, frame: resolved.frame, bodyUnitScale: resolved.frame.bodyUnitScale, coverage: resolved.coverage });
    },
    reset() {
      if (status === "disposed") return generation;
      const detached = current; generation++; current = null; loadPromise = null; status = "idle"; reason = null;
      if (detached) release(detached);
      return generation;
    },
    dispose() {
      if (status === "disposed") return;
      const detached = current; generation++; current = null; loadPromise = null; status = "disposed"; reason = "disposed";
      if (detached) release(detached);
    },
  });
}

/** Same-origin bounded streaming fetch. No redirect or metadata-provided URL. */
async function fetchSameOrigin(url: string, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const resolved = new URL(url, globalThis.location.href);
  if (resolved.origin !== globalThis.location.origin || !(Object.values(NATURAL_GOLFER_ATLAS_URLS) as readonly string[]).includes(url)) throw new Error("fixed same-origin assets only");
  const response = await fetch(resolved.href, { signal, credentials: "same-origin", redirect: "error", cache: "force-cache" });
  if (!response.ok || !response.body) throw new Error("optional asset response unavailable");
  const length = response.headers.get("content-length"); if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { await response.body.cancel(); throw new Error("asset content-length bound"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > limit) throw new Error("stream byte bound"); chunks.push(part.value); } }
  catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
/** Browser adapter uses only private Pixi sources; never Assets.load/from/cache. */
export function createDefaultNaturalGolferAtlas(): NaturalGolferAtlas<Texture> {
  let pixi: typeof import("pixi.js") | null = null;
  let pixiPromise: Promise<typeof import("pixi.js")> | null = null;
  const bitmaps = new WeakMap<TextureSource, ImageBitmap>();
  return createNaturalGolferAtlas<TextureSource, Texture>({
    fetchBytes: fetchSameOrigin,
    async createSource(bytes, expected) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }), { premultiplyAlpha: "none" });
      let source: TextureSource | null = null;
      try {
        if (bitmap.width !== expected.width || bitmap.height !== expected.height) throw new Error("decoded PNG dimensions");
        pixiPromise ??= import("pixi.js"); pixi ??= await pixiPromise;
        // Pixi's explicit dimensions are logical; pixelWidth = width * resolution.
        source = new pixi.ImageSource({ resource: bitmap, width: expected.width / expected.resolution, height: expected.height / expected.resolution, resolution: expected.resolution, alphaMode: "premultiply-alpha-on-upload", autoGenerateMipmaps: false, label: `natural-golfer-v1.${expected.role}` });
        source.autoGarbageCollect = false; source.scaleMode = "linear"; bitmaps.set(source, bitmap);
        return Object.freeze({ resource: source, width: bitmap.width, height: bitmap.height, exclusive: true });
      } catch (error) { source?.destroy(); bitmap.close(); throw error; }
    },
    createTexture(source, geometry) {
      if (!pixi) throw new Error("private Pixi source not initialized");
      const rectangle = (r: NaturalGolferRect) => new pixi!.Rectangle(r.x, r.y, r.w, r.h);
      return new pixi.Texture({ source, frame: rectangle(geometry.frame), orig: rectangle(geometry.orig), trim: geometry.trim ? rectangle(geometry.trim) : undefined, defaultAnchor: { ...geometry.anchor }, label: geometry.label, rotate: 0, dynamic: false });
    },
    destroyTexture(texture) { texture.destroy(false); },
    destroySource(source) { try { source.resource.destroy(); } finally { bitmaps.get(source.resource)?.close(); bitmaps.delete(source.resource); } },
  });
}
