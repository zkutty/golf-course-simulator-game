import { Culler, Graphics, Mesh, MeshGeometry, Rectangle, WebGLRenderer, type Application, type Buffer, type Container } from "pixi.js";
import { captureOwnedStencilViewport, knownOwnedStencilRootViewport, scanFullGeometryExtent,
  stockComponentCullingControls, stockOwnedCullingAccessor, type FullGeometryExtent, type OwnedStencilViewportProof } from "./rootStageViewport";

// Accounting reservation, not a claim about engine-specific JS object size.
// No per-cell storage, original-index copies or fan metadata is allocated.
export const COMPONENT_ENTRY_BYTES = 4096;
const MAX_COMPONENTS = 64;
const stockCull = Culler.prototype.cull;
const stockRecursive = Reflect.get(Culler.prototype, "_cullRecursive");
const bits = new DataView(new ArrayBuffer(8));
function up(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return Number.MIN_VALUE;
  bits.setFloat64(0, value); bits.setBigUint64(0, bits.getBigUint64(0) + (value > 0 ? 1n : -1n));
  return bits.getFloat64(0);
}
const down = (value: number) => -up(-value);
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
/** Verify the actual x+width operation too. Extra view ULPs retain touching bounds. */
export function enclosingComponentRectangle(bounds: Bounds, view = false): Rectangle | null {
  const x = view ? down(bounds.minX) : bounds.minX, y = view ? down(bounds.minY) : bounds.minY;
  const maxX = view ? up(bounds.maxX) : bounds.maxX, maxY = view ? up(bounds.maxY) : bounds.maxY;
  const width = up(maxX - x), height = up(maxY - y);
  if (![x, y, maxX, maxY, width, height, x + width, y + height].every(Number.isFinite)
    || width <= 0 || height <= 0 || x + width < maxX || y + height < maxY
    || view && !(x < bounds.minX && y < bounds.minY && x + width > bounds.maxX && y + height > bounds.maxY)) return null;
  return new Rectangle(x, y, width, height);
}
function dataControl(mesh: Mesh, key: string): boolean {
  let node: object | null = mesh;
  while (node) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (descriptor) return Object.hasOwn(descriptor, "value") && descriptor.writable === true;
    node = Object.getPrototypeOf(node);
  }
  return false;
}
function version(buffer: Buffer): number { return Reflect.get(buffer, "_updateID") ?? NaN; }
type Entry = {
  mesh: Mesh<MeshGeometry>; proof: OwnedStencilViewportProof; extent: FullGeometryExtent;
  positions: Float32Array; uvs: Float32Array; indices: Uint32Array;
  positionBuffer: Buffer; uvBuffer: Buffer; indexBuffer: Buffer; versions: number[];
  area: Rectangle; baselineArea: Rectangle | null | undefined; view: Rectangle | null; installed: boolean; lastCulled: boolean; onDestroy: () => void;
};

/** Exclusive private producer/controller only. Equal-valued foreign boolean
 * writes are unobservable; this does not coexist with a second culler. */
export class OwnedComponentCulling {
  private readonly culler = new Culler();
  private readonly entries = new Map<Mesh<MeshGeometry>, Entry>();
  private canvas: HTMLCanvasElement | null = null;
  private context: object | null = null;
  private disposed = false;
  private readonly invalidate = () => { this.clear(); };
  get size(): number { return this.entries.size; }
  get reservedBytes(): number { return this.size * COMPONENT_ENTRY_BYTES; }
  private apiControls(mesh: Mesh): boolean {
    return this.culler.cull === stockCull && Reflect.get(this.culler, "_cullRecursive") === stockRecursive
      && stockOwnedCullingAccessor(mesh) && dataControl(mesh, "cullable");
  }
  private controls(mesh: Mesh): boolean { return this.apiControls(mesh) && dataControl(mesh, "cullArea")
    && dataControl(mesh, "cullableChildren") && stockComponentCullingControls(mesh); }
  register(mesh: Mesh<MeshGeometry>, mask: Graphics): boolean {
    if (this.disposed || this.entries.size >= MAX_COMPONENTS || this.entries.has(mesh)
      || !(mesh.geometry instanceof MeshGeometry) || mesh.batched || !this.controls(mesh) || mesh.culled
      || mesh.cullable || mesh.cullArea != null || mesh.cullableChildren !== true) return false;
    for (const entry of this.entries.values()) if (entry.proof.mask === mask) return false;
    const proof = captureOwnedStencilViewport(mesh, mask), extent = scanFullGeometryExtent(mesh);
    if (!proof || !extent) return false;
    const g = mesh.geometry, positionBuffer = g.attributes.aPosition?.buffer, uvBuffer = g.attributes.aUV?.buffer, indexBuffer = g.indexBuffer;
    if (!positionBuffer || !uvBuffer || !indexBuffer || !(g.positions instanceof Float32Array)
      || !(g.uvs instanceof Float32Array) || g.uvs.length < g.positions.length || !(g.indices instanceof Uint32Array) || !g.indices.length) return false;
    for (const index of g.indices) if (index >= g.positions.length / 2) return false;
    const versions = [positionBuffer, uvBuffer, indexBuffer].map(version);
    const area = enclosingComponentRectangle(extent);
    if (!area || !versions.every(Number.isSafeInteger)) return false;
    const entry: Entry = { mesh, proof, extent, positions: g.positions, uvs: g.uvs, indices: g.indices,
      positionBuffer, uvBuffer, indexBuffer, versions, area, baselineArea: mesh.cullArea, view: null, installed: false, lastCulled: false,
      onDestroy: () => { this.restore(entry); this.remove(entry); } };
    this.entries.set(mesh, entry); mesh.once("destroyed", entry.onDestroy); mask.once("destroyed", entry.onDestroy);
    return true;
  }
  private live(entry: Entry): boolean {
    const { mesh, extent, positionBuffer, uvBuffer, indexBuffer } = entry;
    const g = mesh.geometry;
    return !mesh.destroyed && g === extent.geometry && !positionBuffer.destroyed && !uvBuffer.destroyed && !indexBuffer.destroyed
      && g.attributes?.aPosition?.buffer === positionBuffer && g.attributes?.aUV?.buffer === uvBuffer && g.indexBuffer === indexBuffer
      && g.positions === entry.positions && g.uvs === entry.uvs && g.indices === entry.indices
      && [positionBuffer, uvBuffer, indexBuffer].every((buffer, i) => version(buffer) === entry.versions[i]);
  }
  private restore(entry: Entry): void {
    const { mesh } = entry;
    if (!entry.installed || mesh.destroyed) return;
    const areaOwned = dataControl(mesh, "cullArea") && mesh.cullArea === entry.area;
    const childrenOwned = dataControl(mesh, "cullableChildren") && mesh.cullableChildren === false;
    const configOwned = dataControl(mesh, "cullable") && mesh.cullable === true && areaOwned && childrenOwned;
    // Observable configuration loss ends exclusive ownership. Do not call
    // Culler: foreign child-culling settings could recurse into new children.
    // Preserve every configuration field and flag, without promising fallback.
    if (!configOwned) { entry.installed = false; entry.lastCulled = false; return; }
    // Only intact owned configuration permits documented disable+cull. The
    // owned cullableChildren=false bounds it to this receiver, even if a
    // foreign descendant was added. Divergent foreign bits remain untouched.
    if (this.apiControls(mesh) && entry.lastCulled && mesh.culled === true && entry.view) {
      mesh.cullable = false; this.culler.cull(mesh, entry.view, false);
    }
    mesh.cullable = false;
    // Pixi's documented null reset and runtime null default are wider than its
    // Rectangle|undefined declaration. Widen only this public-property write,
    // preserving the exact captured null/undefined baseline; no global types.
    (mesh as unknown as { cullArea: Rectangle | null | undefined }).cullArea = entry.baselineArea;
    mesh.cullableChildren = true;
    entry.installed = false; entry.lastCulled = false;
  }
  private remove(entry: Entry): void {
    entry.mesh.off("destroyed", entry.onDestroy); entry.proof.mask.off("destroyed", entry.onDestroy);
    this.entries.delete(entry.mesh);
  }
  private clear(): void {
    for (const entry of this.entries.values()) { this.restore(entry); this.remove(entry); }
  }
  reconcile(app: Application, world: Container): void {
    if (this.disposed || !this.entries.size) return;
    const renderer = app.renderer;
    if (!(renderer instanceof WebGLRenderer)) { this.clear(); return; }
    if (!this.canvas) {
      this.canvas = app.canvas as HTMLCanvasElement;
      if (typeof this.canvas.addEventListener !== "function" || typeof this.canvas.removeEventListener !== "function") { this.canvas = null; this.clear(); return; }
      this.context = renderer.gl as object;
      this.canvas.addEventListener("webglcontextlost", this.invalidate);
      this.canvas.addEventListener("webglcontextrestored", this.invalidate);
    }
    if (this.canvas !== app.canvas || this.context !== renderer.gl) { this.clear(); return; }
    for (const [mesh, entry] of this.entries) {
      const controls = this.controls(mesh);
      const conflict = controls && entry.installed && (mesh.cullable !== true || mesh.cullArea !== entry.area
        || mesh.cullableChildren !== false || mesh.culled !== entry.lastCulled);
      if (!this.live(entry) || !controls || conflict) {
        this.restore(entry); this.remove(entry); continue;
      }
      let view: Rectangle | null = null;
      try {
        const viewport = knownOwnedStencilRootViewport(app, world, entry.extent, entry.proof);
        if (viewport) view = enclosingComponentRectangle(viewport.local, true);
      } catch { /* Unsupported or destroyed SDK state restores original rendering. */ }
      if (!view) { this.restore(entry); continue; }
      mesh.cullable = true; mesh.cullableChildren = false; mesh.cullArea = entry.area;
      entry.installed = true; entry.view = view;
      this.culler.cull(mesh, view, false); entry.lastCulled = mesh.culled;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear(); this.disposed = true;
    this.canvas?.removeEventListener("webglcontextlost", this.invalidate);
    this.canvas?.removeEventListener("webglcontextrestored", this.invalidate);
    this.canvas = null; this.context = null;
  }
  diagnostics(): Readonly<{ meshes: number; culled: number; reservedBytes: number }> {
    let culled = 0; for (const entry of this.entries.values()) if (entry.lastCulled) culled++;
    return { meshes: this.size, culled, reservedBytes: this.reservedBytes };
  }
}
