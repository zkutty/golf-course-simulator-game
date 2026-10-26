import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNaturalGolferAtlas, createDefaultNaturalGolferAtlas, NATURAL_GOLFER_ATLAS_URLS } from "./naturalGolferAtlas";
import type { NaturalGolferAtlasAdapters, NaturalGolferOwnedSource, NaturalGolferTextureGeometry } from "./naturalGolferAtlas";
import type { NaturalGolferArtRequest } from "../game/render/naturalGolferArt";
import { resolveNaturalGolferArt } from "../game/render/naturalGolferArt";
const pixiMock = vi.hoisted(() => ({ sources: [] as Record<string, unknown>[], textures: [] as Record<string, unknown>[], actual: null as typeof import("pixi.js") | null }));
vi.mock("pixi.js", () => ({
  Rectangle: class { x: number; y: number; width: number; height: number; constructor(x: number, y: number, width: number, height: number) { this.x = x; this.y = y; this.width = width; this.height = height; if (pixiMock.actual) return new pixiMock.actual.Rectangle(x, y, width, height); } },
  ImageSource: class { destroy = vi.fn(); autoGarbageCollect = true; scaleMode = "nearest"; constructor(options: Record<string, unknown>) { if (pixiMock.actual) { const source = new pixiMock.actual.ImageSource(options); pixiMock.sources.push(source as unknown as Record<string, unknown>); return source as unknown as typeof this; } Object.assign(this, options); pixiMock.sources.push(this as unknown as Record<string, unknown>); } },
  Texture: class { destroy = vi.fn(); constructor(options: Record<string, unknown>) { if (pixiMock.actual) { const texture = new pixiMock.actual.Texture(options); pixiMock.textures.push(texture as unknown as Record<string, unknown>); return texture as unknown as typeof this; } Object.assign(this, options); pixiMock.textures.push(this as unknown as Record<string, unknown>); } },
}));
const files = Object.fromEntries(["manifest.json", "cost.json", "atlas.png", "shadow.png"].map(name => [name, new Uint8Array(readFileSync(new URL(`../../art/natural-golfer-v1/${name}`, import.meta.url)))]));
interface Source { id: number; role: "atlas" | "shadow"; destroyed: boolean }
interface Part { id: number; source: Source; geometry: NaturalGolferTextureGeometry; destroyed: boolean }
type Expected = Parameters<NaturalGolferAtlasAdapters<Source, Part>["createSource"]>[1];
function mock() {
  const sources: NaturalGolferOwnedSource<Source>[] = [], textures: Part[] = [];
  const owned = (expected: Expected) => { const result = Object.freeze({ resource: { id: sources.length, role: expected.role, destroyed: false }, width: expected.width, height: expected.height, exclusive: true as const }); sources.push(result); return result; };
  const adapters = {
    fetchBytes: vi.fn(async (url: string, _max: number, _signal: AbortSignal): Promise<Uint8Array> => new Uint8Array(files[url.slice(url.lastIndexOf("/") + 1)])),
    createSource: vi.fn(async (_bytes: Uint8Array, expected: Expected) => owned(expected)),
    createTexture: vi.fn((source: Source, geometry: NaturalGolferTextureGeometry) => { const part = { id: textures.length, source, geometry, destroyed: false }; textures.push(part); return part; }),
    destroyTexture: vi.fn((part: Part) => { expect(part.destroyed).toBe(false); part.destroyed = true; }),
    destroySource: vi.fn((source: NaturalGolferOwnedSource<Source>) => { expect(source.resource.destroyed).toBe(false); source.resource.destroyed = true; }),
  } satisfies NaturalGolferAtlasAdapters<Source, Part>;
  return { sources, textures, adapters, owned, loader: createNaturalGolferAtlas(adapters) };
}
const request = (overrides: Partial<NaturalGolferArtRequest> = {}): NaturalGolferArtRequest => ({ selection: { family: "natural-golfer-v1", identity: "primary-teal-cream-01" }, clip: "swing", direction: "se", col: 5, handedness: "right", ...overrides });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function onFirstDestroy(m: ReturnType<typeof mock>, phase: "texture" | "source", callback: () => void): void {
  let called = false;
  const trigger = () => { if (!called) { called = true; callback(); } };
  if (phase === "texture") { const original = m.adapters.destroyTexture.getMockImplementation()!; m.adapters.destroyTexture.mockImplementation(part => { original(part); trigger(); }); }
  else { const original = m.adapters.destroySource.getMockImplementation()!; m.adapters.destroySource.mockImplementation(source => { original(source); trigger(); }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); pixiMock.sources.length = 0; pixiMock.textures.length = 0; pixiMock.actual = null; });

describe("explicit optional natural golfer atlas", () => {
  it("is lazy, coalesces exact promises, fetches only four fixed files once and latches readiness", async () => {
    const { loader, adapters } = mock(); expect(loader.snapshot()).toMatchObject({ status: "idle", generation: 0 }); expect(adapters.fetchBytes).not.toHaveBeenCalled(); expect(loader.lookup(request()).kind).toBe("unavailable");
    const a = loader.load(); expect(loader.load()).toBe(a); expect(loader.snapshot().status).toBe("loading"); expect(loader.lookup(request()).kind).toBe("unavailable");
    expect(await a).toEqual({ status: "ready", generation: 0, reason: null }); expect(loader.load()).toBe(a); expect(adapters.fetchBytes.mock.calls.map(([url]) => url).sort()).toEqual(Object.values(NATURAL_GOLFER_ATLAS_URLS).sort()); expect(adapters.createSource).toHaveBeenCalledTimes(2);
    expect(loader.snapshot()).toMatchObject({ status: "ready", pairCount: 224, ownedSourceCount: 2, totalRuntimeBytesIncludingCostReceipt: 443107, cleanupErrors: 0 }); loader.dispose();
  });
  it("maps all224 atomic pairs with exact orig/trim/anchor/scale and bounded full-geometry dedup", async () => {
    const { loader, textures, adapters } = mock(); await loader.load(); const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as { frames: { clip: string; direction: string; col: number; layers: Record<"base" | "tint", { texture: object; trim: object }> }[] };
    for (const frame of manifest.frames) { const result = loader.lookup(request(frame)); if (result.kind !== "pair") throw new Error("missing atomic pair"); for (const role of ["base", "tint"] as const) expect(result[role].geometry).toMatchObject({ frame: frame.layers[role].texture, trim: frame.layers[role].trim, orig: { x: 0, y: 0, w: 72, h: 96 }, anchor: { x: .5, y: 83 / 96 } }); expect(result.bodyUnitScale).toBe(26 / 48); expect(result.frame.source.feet).toEqual([36,83]); expect(result.shadow.geometry).toMatchObject({ role: "shadow", orig: { w: 20, h: 10 }, frame: { w: 20, h: 10 }, trim: null }); }
    const size = textures.length; expect(size).toBeLessThanOrEqual(449); expect(loader.snapshot().atlasTextureCount).toBeLessThan(448); const a = loader.lookup(request({ clip: "idle", col: 0 })), b = loader.lookup(request({ clip: "idle", col: 1 })); if (a.kind !== "pair" || b.kind !== "pair") throw new Error("idle missing"); expect(a.base).toBe(b.base); expect(a.tint).toBe(b.tint);
    for (let i = 0; i < 100; i++) loader.lookup(request()); expect(textures.length).toBe(size); expect(adapters.fetchBytes).toHaveBeenCalledTimes(4); loader.dispose();
  });
  it("leaves explicit legacy/identity selections and unsupported hand/clip coverage neutral", async () => {
    const { loader } = mock(); await loader.load(); expect(loader.lookup(request({ selection: { family: "legacy", identity: "golfer2" } }))).toMatchObject({ kind: "fallback", reason: "family-not-selected", selection: { identity: "golfer2" } }); expect(loader.lookup(request({ handedness: "left" }))).toMatchObject({ kind: "fallback", reason: "unsupported-handedness" }); expect(loader.lookup(request({ clip: "watch" }))).toMatchObject({ kind: "fallback", reason: "unsupported-clip" }); const result = loader.lookup(request()); if (result.kind !== "pair") throw new Error("missing pair"); expect(result.coverage.classAccuracyCertified).toBe(false); expect(result.coverage.specificEquipmentClasses).toEqual([]); loader.dispose();
  });
  it("latches fetch failure until explicit reset, without per-frame/repeated-load retries", async () => {
    const { loader, adapters } = mock(); adapters.fetchBytes.mockRejectedValueOnce(new Error("offline")); const a = loader.load(); expect(await a).toMatchObject({ status: "failed", reason: "offline" }); const calls = adapters.fetchBytes.mock.calls.length; for (let i = 0; i < 20; i++) { expect(loader.load()).toBe(a); expect(loader.lookup(request()).kind).toBe("unavailable"); } expect(adapters.fetchBytes).toHaveBeenCalledTimes(calls); expect(loader.reset()).toBe(1); expect(await loader.load()).toMatchObject({ status: "ready", generation: 1 }); loader.dispose();
  });
  it("rejects partial/oversized metadata and metadata URLs before source creation or PNG fetch", async () => {
    for (const mode of ["partial", "oversized", "url"] as const) { const { loader, adapters } = mock(), original = adapters.fetchBytes.getMockImplementation()!; adapters.fetchBytes.mockImplementation(async (url, max, signal) => { if (url === NATURAL_GOLFER_ATLAS_URLS.manifest) { if (mode === "oversized") return new Uint8Array(131073); const m = JSON.parse(new TextDecoder().decode(files["manifest.json"])); if (mode === "partial") delete m.frames[0].layers.tint; else m.texture.file = "https://other.invalid/atlas.png"; return new TextEncoder().encode(JSON.stringify(m)); } return original(url, max, signal); }); expect(await loader.load()).toMatchObject({ status: "failed" }); expect(adapters.createSource).not.toHaveBeenCalled(); expect(adapters.fetchBytes.mock.calls.every(([url]) => ([NATURAL_GOLFER_ATLAS_URLS.manifest, NATURAL_GOLFER_ATLAS_URLS.cost] as readonly string[]).includes(url))).toBe(true); loader.dispose(); }
  });
  it("includes actual cost-receipt bytes in the runtime budget before image decode", async () => {
    const { loader, adapters } = mock(), original = adapters.fetchBytes.getMockImplementation()!; adapters.fetchBytes.mockImplementation(async (url, max, signal) => { if (url === NATURAL_GOLFER_ATLAS_URLS.cost) { const c = JSON.parse(new TextDecoder().decode(files["cost.json"])); c.runtimeTextures.files[0].bytes = 501000 - c.manifestBytes - c.runtimeTextures.files[1].bytes; c.runtimeTextures.compressedPNGBytes = c.runtimeTextures.files[0].bytes + c.runtimeTextures.files[1].bytes; c.runtimePNGPlusManifestBytes = 501000; c.reviewOnly.compressedPNGBytes = 1; c.allPNGs.compressedPNGBytes = c.runtimeTextures.compressedPNGBytes + 1; c.allPNGPlusManifestBytes = 501001; return new TextEncoder().encode(JSON.stringify(c)); } return original(url, max, signal); }); expect(await loader.load()).toMatchObject({ status: "failed", reason: expect.stringMatching(/including receipt/) }); expect(adapters.createSource).not.toHaveBeenCalled(); loader.dispose();
  });
  it("rejects wrong PNG hashes or decoded dimensions and destroys private partial sources", async () => {
    const corrupt = mock(), fetch = corrupt.adapters.fetchBytes.getMockImplementation()!; corrupt.adapters.fetchBytes.mockImplementation(async (url, max, signal) => { const bytes = await fetch(url, max, signal); if (url === NATURAL_GOLFER_ATLAS_URLS.atlas) bytes[bytes.length - 1] ^= 1; return bytes; }); expect(await corrupt.loader.load()).toMatchObject({ status: "failed", reason: "PNG hash mismatch" }); expect(corrupt.adapters.createSource).not.toHaveBeenCalled(); corrupt.loader.dispose();
    const bad = mock(); bad.adapters.createSource.mockImplementation(async (_bytes, expected) => bad.owned({ ...expected, height: expected.height + 1 })); expect(await bad.loader.load()).toMatchObject({ status: "failed", reason: "decoded source dimensions" }); expect(bad.sources.every(s => s.resource.destroyed)).toBe(true); expect(bad.loader.lookup(request()).kind).toBe("unavailable"); bad.loader.dispose();
  });
  it("cleans up partial texture failure without exposing one layer or touching shared legacy sources", async () => {
    const { loader, adapters, sources, textures } = mock(), original = adapters.createTexture.getMockImplementation()!; adapters.createTexture.mockImplementation((source, geometry) => { if (textures.length === 8) throw new Error("partial texture creation"); return original(source, geometry); }); expect(await loader.load()).toMatchObject({ status: "failed" }); expect(textures.length).toBe(8); expect(textures.every(t => t.destroyed)).toBe(true); expect(sources.every(s => s.resource.destroyed)).toBe(true); expect(loader.lookup(request()).kind).toBe("unavailable"); loader.dispose(); expect(adapters.destroyTexture).toHaveBeenCalledTimes(8);
    const shared = mock(), legacy: Source = { id: 999, role: "atlas", destroyed: false }; shared.adapters.createSource.mockResolvedValue({ resource: legacy, width: 1024, height: 632, exclusive: false } as unknown as NaturalGolferOwnedSource<Source>); expect(await shared.loader.load()).toMatchObject({ status: "failed", reason: "source is not privately owned" }); expect(shared.adapters.destroySource).not.toHaveBeenCalled(); expect(legacy.destroyed).toBe(false); shared.loader.dispose();
  });
  it("reset rejects stale metadata publication and keeps the independently loaded new generation ready", async () => {
    const { loader, adapters } = mock(), gate = deferred<Uint8Array>(), original = adapters.fetchBytes.getMockImplementation()!; let delayed = false; adapters.fetchBytes.mockImplementation((url, max, signal) => { if (url === NATURAL_GOLFER_ATLAS_URLS.manifest && !delayed) { delayed = true; return gate.promise; } return original(url, max, signal); }); const old = loader.load(); await vi.waitFor(() => expect(delayed).toBe(true)); expect(loader.reset()).toBe(1); expect(await loader.load()).toMatchObject({ status: "ready", generation: 1 }); gate.resolve(files["manifest.json"]); expect(await old).toMatchObject({ status: "superseded", generation: 0 }); expect(loader.snapshot()).toMatchObject({ status: "ready", generation: 1 }); loader.dispose();
  });
  it("reset immediately releases collected sources and destroys late decoded sources exactly once", async () => {
    const { loader, adapters, owned, sources } = mock(), gate = deferred<NaturalGolferOwnedSource<Source>>(); adapters.createSource.mockImplementation(async (_bytes, expected) => expected.role === "shadow" ? gate.promise : owned(expected)); const pending = loader.load(); await vi.waitFor(() => expect(sources.length).toBe(1)); loader.reset(); expect(sources[0].resource.destroyed).toBe(true); const late = owned({ role: "shadow", width: 40, height: 20, resolution: 2 }); gate.resolve(late); expect(await pending).toMatchObject({ status: "superseded" }); expect(late.resource.destroyed).toBe(true); expect(adapters.destroySource).toHaveBeenCalledTimes(2); expect(loader.snapshot().status).toBe("idle"); loader.dispose();
  });
  it("dispose is terminal/idempotent and releases every cached texture and both sources", async () => {
    const { loader, adapters, textures, sources } = mock(); await loader.load(); const n = textures.length; loader.dispose(); loader.dispose(); expect(loader.snapshot()).toMatchObject({ status: "disposed", generation: 1, atlasTextureCount: 0, ownedSourceCount: 0 }); expect(adapters.destroyTexture).toHaveBeenCalledTimes(n); expect(adapters.destroySource).toHaveBeenCalledTimes(2); expect(textures.every(t => t.destroyed) && sources.every(s => s.resource.destroyed)).toBe(true); expect(await loader.load()).toMatchObject({ status: "disposed" }); expect(loader.reset()).toBe(1); expect(adapters.fetchBytes).toHaveBeenCalledTimes(4);
  });
  it("default Pixi adapter builds private sources with correct Texture orig/trim/anchor and destroy(false)", async () => {
    vi.stubGlobal("location", { href: "https://coursecraft.test/game/", origin: "https://coursecraft.test" }); const closes: ReturnType<typeof vi.fn>[] = []; vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => { const atlas = blob.size === files["atlas.png"].length, close = vi.fn(); closes.push(close); return { width: atlas ? 1024 : 40, height: atlas ? 632 : 20, close }; }));
    const fetch = vi.fn(async (url: string) => new Response(new Uint8Array(files[url.slice(url.lastIndexOf("/") + 1)]).buffer)); vi.stubGlobal("fetch", fetch);
    const loader = createDefaultNaturalGolferAtlas(); expect(fetch).not.toHaveBeenCalled(); expect(await loader.load()).toMatchObject({ status: "ready" }); expect(pixiMock.sources).toHaveLength(2); expect(pixiMock.sources.map(s => s.resolution).sort()).toEqual([1,2]); expect(pixiMock.sources.every(s => s.autoGarbageCollect === false)).toBe(true);
    const result = loader.lookup(request()); if (result.kind !== "pair") throw new Error("missing default pair"); expect(result.base.orig).toMatchObject({ width: 72, height: 96 }); expect(result.base.trim).toMatchObject({ width: result.frame.layers.base.trim.w }); expect(result.base.defaultAnchor).toEqual({ x: .5, y: 83 / 96 }); expect(result.shadow.orig).toMatchObject({ width: 20, height: 10 }); expect(result.shadowPlacement).toEqual({ unitScale: 1, worldOffset: [1.5,.8], alphaBaked: true });
    loader.dispose(); for (const texture of pixiMock.textures) expect(texture.destroy).toHaveBeenCalledWith(false); for (const source of pixiMock.sources) expect(source.destroy).toHaveBeenCalledTimes(1); closes.forEach(close => expect(close).toHaveBeenCalledTimes(1)); expect(fetch.mock.calls.every(([url]) => url.startsWith("https://coursecraft.test/atlases/natural-golfer-v1/"))).toBe(true);
  });
  it("default bounded fetch rejects oversized streamed metadata without creating GPU sources", async () => {
    vi.stubGlobal("location", { href: "https://coursecraft.test/", origin: "https://coursecraft.test" });
    const image = vi.fn(); vi.stubGlobal("createImageBitmap", image);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(131073).buffer)));
    const loader = createDefaultNaturalGolferAtlas(); expect(await loader.load()).toMatchObject({ status: "failed", reason: "stream byte bound" }); expect(image).not.toHaveBeenCalled(); expect(pixiMock.sources).toHaveLength(0); loader.dispose();
  });
  it("dispose while decoding prevents publication and closes late exclusively owned resources", async () => {
    const { loader, adapters, owned } = mock(), gate = deferred<NaturalGolferOwnedSource<Source>>();
    adapters.createSource.mockImplementation(async (_bytes, expected) => expected.role === "shadow" ? gate.promise : owned(expected));
    const pending = loader.load(); await vi.waitFor(() => expect(adapters.createSource).toHaveBeenCalledTimes(2)); loader.dispose();
    const late = owned({ role: "shadow", width: 40, height: 20, resolution: 2 }); gate.resolve(late); expect(await pending).toMatchObject({ status: "superseded" }); expect(late.resource.destroyed).toBe(true); expect(loader.snapshot().status).toBe("disposed");
  });
  it("reentrant reset during texture creation destroys the late texture without publishing or leaking it", async () => {
    const { loader, adapters, textures, sources } = mock(), original = adapters.createTexture.getMockImplementation()!;
    adapters.createTexture.mockImplementation((source, geometry) => { const part = original(source, geometry); loader.reset(); return part; });
    expect(await loader.load()).toMatchObject({ status: "superseded" }); expect(loader.snapshot()).toMatchObject({ status: "idle", generation: 1 }); expect(textures).toHaveLength(1); expect(textures[0].destroyed).toBe(true); expect(sources.every(s => s.resource.destroyed)).toBe(true); loader.dispose();
  });
  it("exposes the same frozen branded artIndex only for its ready current generation", async () => {
    const { loader, adapters } = mock(); expect(loader.artIndex()).toBeNull(); const firstLoad = loader.load(); expect(loader.artIndex()).toBeNull(); await firstLoad;
    const first = loader.artIndex(); expect(first).not.toBeNull(); expect(Object.isFrozen(first)).toBe(true); expect(first?.body).toBeDefined(); expect(Object.isFrozen(first?.body)).toBe(true); expect(loader.artIndex()).toBe(first);
    expect(resolveNaturalGolferArt(first, request()).kind).toBe("frame"); loader.reset(); expect(loader.artIndex()).toBeNull();
    adapters.fetchBytes.mockRejectedValueOnce(new Error("metadata missing")); await loader.load(); expect(loader.artIndex()).toBeNull();
    loader.reset(); const reload = loader.load(); expect(loader.artIndex()).toBeNull(); await reload; expect(loader.artIndex()).not.toBe(first); expect(resolveNaturalGolferArt(loader.artIndex(), request()).kind).toBe("frame");
    loader.dispose(); expect(loader.artIndex()).toBeNull();
  });
  for (const phase of ["texture", "source"] as const) {
    it(`reset cleanup cannot revive a reentrant terminal dispose from ${phase} destruction`, async () => {
      const m = mock(); await m.loader.load(); onFirstDestroy(m, phase, () => m.loader.dispose());
      expect(m.loader.reset()).toBe(2); expect(m.loader.snapshot()).toMatchObject({ status: "disposed", generation: 2 }); expect(m.loader.artIndex()).toBeNull();
      expect(await m.loader.load()).toMatchObject({ status: "disposed" }); expect(m.adapters.fetchBytes).toHaveBeenCalledTimes(4); expect(m.textures.every(t => t.destroyed) && m.sources.every(s => s.resource.destroyed)).toBe(true);
    });
    it(`reset cleanup cannot overwrite a reentrant reset/new generation from ${phase} destruction`, async () => {
      const m = mock(); await m.loader.load(); const oldSources = [...m.sources], oldTextures = [...m.textures]; let next: ReturnType<typeof m.loader.load> | null = null;
      onFirstDestroy(m, phase, () => { m.loader.reset(); next = m.loader.load(); }); expect(m.loader.reset()).toBe(2);
      expect(await next).toMatchObject({ status: "ready", generation: 2 }); expect(m.loader.snapshot()).toMatchObject({ status: "ready", generation: 2 }); expect(m.loader.artIndex()).not.toBeNull();
      expect(oldSources.every(s => s.resource.destroyed) && oldTextures.every(t => t.destroyed)).toBe(true); expect(m.sources.slice(2).every(s => !s.resource.destroyed)).toBe(true); m.loader.dispose();
    });
    it(`failure cleanup cannot overwrite reentrant dispose from ${phase} destruction`, async () => {
      const m = mock(), original = m.adapters.createTexture.getMockImplementation()!;
      m.adapters.createTexture.mockImplementation((source, geometry) => { if (m.textures.length === 8) throw new Error("texture failure"); return original(source, geometry); });
      onFirstDestroy(m, phase, () => m.loader.dispose()); expect(await m.loader.load()).toMatchObject({ status: "superseded", generation: 0 });
      expect(m.loader.snapshot()).toMatchObject({ status: "disposed", generation: 1, reason: "disposed" }); expect(await m.loader.load()).toMatchObject({ status: "disposed" }); expect(m.loader.artIndex()).toBeNull(); expect(m.adapters.fetchBytes).toHaveBeenCalledTimes(4);
      expect(m.textures.every(t => t.destroyed) && m.sources.every(s => s.resource.destroyed)).toBe(true);
    });
    it(`failure cleanup cannot overwrite reentrant reset/new load from ${phase} destruction`, async () => {
      const m = mock(), original = m.adapters.createTexture.getMockImplementation()!; let failed = false, next: ReturnType<typeof m.loader.load> | null = null;
      m.adapters.createTexture.mockImplementation((source, geometry) => { if (!failed && m.textures.length === 8) { failed = true; throw new Error("texture failure"); } return original(source, geometry); });
      onFirstDestroy(m, phase, () => { m.loader.reset(); next = m.loader.load(); }); expect(await m.loader.load()).toMatchObject({ status: "superseded", generation: 0 });
      expect(await next).toMatchObject({ status: "ready", generation: 1 }); expect(m.loader.snapshot()).toMatchObject({ status: "ready", generation: 1, reason: null }); expect(m.loader.artIndex()).not.toBeNull(); expect(m.sources.slice(0, 2).every(s => s.resource.destroyed)).toBe(true); expect(m.sources.slice(2).every(s => !s.resource.destroyed)).toBe(true); m.loader.dispose();
    });
  }
  it("uses actual installed Pixi logical/physical dimensions and full shadow UVs without GPU allocation", async () => {
    pixiMock.actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
    vi.stubGlobal("location", { href: "https://coursecraft.test/", origin: "https://coursecraft.test" });
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => { const atlas = blob.size === files["atlas.png"].length, close = vi.fn(); closes.push(close); return { width: atlas ? 1024 : 40, height: atlas ? 632 : 20, close }; }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(new Uint8Array(files[url.slice(url.lastIndexOf("/") + 1)]).buffer)));
    const loader = createDefaultNaturalGolferAtlas(); expect(await loader.load()).toMatchObject({ status: "ready" }); const pair = loader.lookup(request()); if (pair.kind !== "pair") throw new Error("missing real Pixi pair");
    expect(pair.shadow).toBeInstanceOf(pixiMock.actual.Texture); expect(pair.shadow.source).toBeInstanceOf(pixiMock.actual.ImageSource);
    expect(pair.shadow.source.width).toBe(20); expect(pair.shadow.source.height).toBe(10); expect(pair.shadow.source.pixelWidth).toBe(40); expect(pair.shadow.source.pixelHeight).toBe(20); expect(pair.shadow.source.resolution).toBe(2);
    expect(pair.shadow.uvs).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0, x2: 1, y2: 1, x3: 0, y3: 1 });
    expect(pair.base.source.width).toBe(1024); expect(pair.base.source.height).toBe(632); expect(pair.base.source.pixelWidth).toBe(1024); expect(pair.base.source.pixelHeight).toBe(632);
    expect((pair.base.source.pixelWidth * pair.base.source.pixelHeight + pair.shadow.source.pixelWidth * pair.shadow.source.pixelHeight) * 4).toBe(2591872);
    loader.dispose(); expect(pair.shadow.destroyed).toBe(true); expect(pair.shadow.source.destroyed).toBe(true); closes.forEach(close => expect(close).toHaveBeenCalledTimes(1));
  });
});
