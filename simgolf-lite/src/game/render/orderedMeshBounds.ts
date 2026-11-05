import { COMPONENT_ENTRY_BYTES, OwnedComponentCulling } from "./ownedComponentCulling";
import { copyGuardedTurfFan, guardedTurfFanEligible, guardedTurfFanKernelBytes,
  hasOwnedHighTurfFanRegistration, prepareGuardedTurfFan } from "./guardedTurfFan";
import * as PIXI from "pixi.js";
import {
  knownRootStageViewport,
  scanFullGeometryExtent,
  type FullGeometryExtent,
} from "./rootStageViewport";

// Frozen ZK-1259 limits. Registration reserves the worst-case selected-index
// storage even though that storage is allocated only on the first partial view.
const MESH_BYTES = 16 * 1024 * 1024;
const COHORT_BYTES = 64 * 1024 * 1024;
const MESH_INDICES = 6_000_000;
const COHORT_INDICES = 8_000_000;
const MESH_VISITS = 8_192;
const COHORT_VISITS = 32_768;
const EMPTY_INDICES = new Uint32Array(0);

type Mesh = PIXI.Mesh<PIXI.MeshGeometry>;
type Rect = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
type TurfShape = Readonly<{ kind: "turf"; units: number; stride: number; leafBase: number }>;
type MacroShape = Readonly<{ kind: "macro"; units: number; stride: 6; columns: number; rows: number }>;
type Shape = TurfShape | MacroShape;
type QueryResult = Readonly<{ visited: number; complete: boolean }>;
type Entry = {
  mesh: Mesh;
  geometry: PIXI.MeshGeometry;
  indexBuffer: PIXI.Buffer;
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  extent: FullGeometryExtent;
  positionVersion: number;
  uvVersion: number;
  indexVersion: number;
  expectedIndexData: Uint32Array;
  shape: Shape;
  bounds: Float64Array;
  currentBits: Uint32Array;
  nextBits: Uint32Array;
  selectedStorage: Uint32Array | null;
  mode: "original" | "selected";
  lastRect: Rect | null;
  reservedBytes: number;
  fanErrors: Float64Array | null;
  currentFanBits: Uint32Array | null;
  nextFanBits: Uint32Array | null;
  lastFanScale: number;
  lastFanError: number;
};

function version(buffer: PIXI.Buffer): number {
  return (buffer as PIXI.Buffer & { _updateID?: number })._updateID ?? NaN;
}

function finitePositions(positions: Float32Array): boolean {
  if (positions.length === 0 || positions.length % 2 !== 0) return false;
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) return false;
  return true;
}

function validIndices(indices: Uint32Array, vertexCount: number): boolean {
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertexCount) return false;
  return true;
}

function estimate(shape: Shape, indexCount: number): number {
  const nodes = shape.kind === "turf" ? shape.leafBase * 2 : shape.units * 2 - 1;
  return nodes * 4 * 8 + 2 * Math.ceil(shape.units / 32) * 4 + indexCount * 4;
}

function setLeaf(bounds: Float64Array, node: number, positions: Float32Array,
  indices: Uint32Array, start: number, end: number): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = start; i < end; i++) {
    const offset = indices[i] * 2;
    const x = positions[offset];
    const y = positions[offset + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const at = node * 4;
  bounds[at] = minX;
  bounds[at + 1] = minY;
  bounds[at + 2] = maxX;
  bounds[at + 3] = maxY;
}

function union(bounds: Float64Array, node: number, left: number, right: number): void {
  const at = node * 4;
  const l = left * 4;
  const r = right * 4;
  bounds[at] = Math.min(bounds[l], bounds[r]);
  bounds[at + 1] = Math.min(bounds[l + 1], bounds[r + 1]);
  bounds[at + 2] = Math.max(bounds[l + 2], bounds[r + 2]);
  bounds[at + 3] = Math.max(bounds[l + 3], bounds[r + 3]);
}

function buildTurf(shape: TurfShape, positions: Float32Array, indices: Uint32Array): Float64Array {
  const bounds = new Float64Array(shape.leafBase * 2 * 4);
  for (let node = 0; node < shape.leafBase * 2; node++) {
    const at = node * 4;
    bounds[at] = bounds[at + 1] = Infinity;
    bounds[at + 2] = bounds[at + 3] = -Infinity;
  }
  for (let unit = 0; unit < shape.units; unit++) {
    setLeaf(bounds, shape.leafBase + unit, positions, indices,
      unit * shape.stride, (unit + 1) * shape.stride);
  }
  for (let node = shape.leafBase - 1; node > 0; node--) {
    union(bounds, node, node * 2, node * 2 + 1);
  }
  return bounds;
}

function validGrid(shape: MacroShape, positions: Float32Array, indices: Uint32Array): boolean {
  const { columns, rows } = shape;
  if (positions.length !== (columns + 1) * (rows + 1) * 2 || indices.length !== columns * rows * 6) return false;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const unit = y * columns + x;
    const first = y * (columns + 1) + x;
    const bottom = first + columns + 1;
    const offset = unit * 6;
    if (indices[offset] !== first || indices[offset + 1] !== first + 1
      || indices[offset + 2] !== bottom + 1 || indices[offset + 3] !== first
      || indices[offset + 4] !== bottom + 1 || indices[offset + 5] !== bottom) return false;
  }
  return true;
}

function buildMacro(shape: MacroShape, positions: Float32Array, indices: Uint32Array): Float64Array {
  const bounds = new Float64Array((shape.units * 2 - 1) * 4);
  const fill = (node: number, x: number, y: number, width: number, height: number): void => {
    if (width * height === 1) {
      const unit = y * shape.columns + x;
      setLeaf(bounds, node, positions, indices, unit * 6, unit * 6 + 6);
      return;
    }
    const left = node + 1;
    let right: number;
    if (width >= height && width > 1) {
      const half = Math.floor(width / 2);
      right = node + 2 * half * height;
      fill(left, x, y, half, height);
      fill(right, x + half, y, width - half, height);
    } else {
      const half = Math.floor(height / 2);
      right = node + 2 * width * half;
      fill(left, x, y, width, half);
      fill(right, x, y + half, width, height - half);
    }
    union(bounds, node, left, right);
  };
  fill(0, 0, 0, shape.columns, shape.rows);
  return bounds;
}

function outside(bounds: Float64Array, node: number, rect: Rect): boolean {
  const at = node * 4;
  return bounds[at + 2] < rect.minX || bounds[at + 3] < rect.minY
    || bounds[at] > rect.maxX || bounds[at + 1] > rect.maxY;
}

function inside(bounds: Float64Array, node: number, rect: Rect): boolean {
  const at = node * 4;
  return bounds[at] >= rect.minX && bounds[at + 1] >= rect.minY
    && bounds[at + 2] <= rect.maxX && bounds[at + 3] <= rect.maxY;
}

function mark(bits: Uint32Array, begin: number, end: number): void {
  while (begin < end) {
    const word = begin >>> 5;
    const bit = begin & 31;
    const count = Math.min(32 - bit, end - begin);
    const mask = count === 32 ? 0xffffffff : ((2 ** count - 1) << bit) >>> 0;
    bits[word] |= mask;
    begin += count;
  }
}

function queryTurf(entry: Entry, rect: Rect, remaining: number): QueryResult {
  const shape = entry.shape as TurfShape;
  const bits = entry.nextBits;
  let visited = 0;
  const visit = (node: number, begin: number, end: number): boolean => {
    if (begin >= shape.units) return true;
    if (visited >= MESH_VISITS || visited >= remaining) return false;
    visited++;
    if (outside(entry.bounds, node, rect)) return true;
    if (inside(entry.bounds, node, rect)) {
      mark(bits, begin, Math.min(end, shape.units));
      return true;
    }
    if (node >= shape.leafBase) {
      mark(bits, begin, begin + 1);
      return true;
    }
    const middle = Math.floor((begin + end) / 2);
    return visit(node * 2, begin, middle) && visit(node * 2 + 1, middle, end);
  };
  const complete = visit(1, 0, shape.leafBase);
  return { visited, complete };
}

function queryMacro(entry: Entry, rect: Rect, remaining: number): QueryResult {
  const shape = entry.shape as MacroShape;
  const bits = entry.nextBits;
  let visited = 0;
  const visit = (node: number, x: number, y: number, width: number, height: number): boolean => {
    if (visited >= MESH_VISITS || visited >= remaining) return false;
    visited++;
    if (outside(entry.bounds, node, rect)) return true;
    if (inside(entry.bounds, node, rect)) {
      for (let row = y; row < y + height; row++) mark(bits, row * shape.columns + x, row * shape.columns + x + width);
      return true;
    }
    if (width * height === 1) {
      mark(bits, y * shape.columns + x, y * shape.columns + x + 1);
      return true;
    }
    if (width >= height && width > 1) {
      const half = Math.floor(width / 2);
      return visit(node + 1, x, y, half, height)
        && visit(node + 2 * half * height, x + half, y, width - half, height);
    }
    const half = Math.floor(height / 2);
    return visit(node + 1, x, y, width, half)
      && visit(node + 2 * width * half, x, y + half, width, height - half);
  };
  const complete = visit(0, 0, 0, shape.columns, shape.rows);
  return { visited, complete };
}

function sameBits(left: Uint32Array, right: Uint32Array): boolean {
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

function allBits(bits: Uint32Array, units: number): boolean {
  const words = Math.floor(units / 32);
  for (let word = 0; word < words; word++) if (bits[word] !== 0xffffffff) return false;
  const remainder = units & 31;
  if (remainder !== 0 && bits[words] !== 2 ** remainder - 1) return false;
  return true;
}

function currentSource(entry: Entry): boolean {
  const { mesh, geometry } = entry;
  const indexBuffer = geometry.indexBuffer;
  return indexBuffer === entry.indexBuffer && !entry.indexBuffer.destroyed
    && mesh.geometry === geometry
    && geometry.attributes.aPosition != null && geometry.attributes.aUV != null
    && geometry.positions === entry.positions && geometry.uvs === entry.uvs
    && version(geometry.attributes.aPosition.buffer) === entry.positionVersion
    && version(geometry.attributes.aUV.buffer) === entry.uvVersion
    && indexBuffer.data === entry.expectedIndexData
    && version(indexBuffer) === entry.indexVersion;
}

function restore(entry: Entry, preserveRect = false): void {
  // A foreign update() changes the version but leaves our selected view in
  // this exact captured buffer. Retirement must sever that owned view even if
  // the geometry or its current index-buffer binding was replaced meanwhile.
  const indexBuffer = entry.indexBuffer;
  if (entry.mode === "selected" && !indexBuffer.destroyed
    && indexBuffer.data === entry.expectedIndexData) {
    indexBuffer.data = entry.indices;
    entry.expectedIndexData = entry.indices;
    entry.indexVersion = version(indexBuffer);
  }
  entry.mode = "original";
  if (!preserveRect) entry.lastRect = null;
}

function sameRect(left: Rect | null, right: Rect): boolean {
  return left !== null && left.minX === right.minX && left.minY === right.minY
    && left.maxX === right.maxX && left.maxY === right.maxY;
}

/** One scene-owned cohort only. A disposed cohort has no strong mesh owners. */
export class OrderedMeshBoundsCohort {
  private readonly entries = new Map<Mesh, Entry>();
  private reservedBytes = 0;
  private originalIndexCount = 0;
  private fanKernelReserved = false;
  private disposed = false;
  private readonly components = new OwnedComponentCulling();

  /** Called after canonical turf+macro registration. No component index copies. */
  registerComponent(mesh: Mesh, mask: PIXI.Graphics): boolean {
    if (this.disposed || this.reservedBytes + this.components.reservedBytes + COMPONENT_ENTRY_BYTES > COHORT_BYTES) return false;
    return this.components.register(mesh, mask);
  }

  registerTurf(mesh: Mesh, subdivisions: number, originalUnits: number): boolean {
    if (subdivisions !== 2 && subdivisions !== 4) return false;
    if (!Number.isSafeInteger(originalUnits) || originalUnits < 1) return false;
    const stride = 6 * subdivisions * subdivisions;
    let leafBase = 1;
    while (leafBase < originalUnits) leafBase *= 2;
    return this.register(mesh, { kind: "turf", units: originalUnits, stride, leafBase });
  }

  registerMacro(mesh: Mesh, columns: number, rows: number): boolean {
    if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)
      || columns < 1 || rows < 1 || !Number.isSafeInteger(columns * rows)) return false;
    return this.register(mesh, { kind: "macro", units: columns * rows, stride: 6, columns, rows });
  }

  private register(mesh: Mesh, shape: Shape): boolean {
    if (this.disposed || this.entries.has(mesh) || !(mesh.geometry instanceof PIXI.MeshGeometry)
      || mesh.batched || mesh.shader !== null || mesh.geometry.topology !== "triangle-list") return false;
    const geometry = mesh.geometry;
    const positions = geometry.positions;
    const uvs = geometry.uvs;
    const indices = geometry.indices;
    if (!(positions instanceof Float32Array) || !(uvs instanceof Float32Array)
      || !(indices instanceof Uint32Array) || !finitePositions(positions)
      || uvs.length < positions.length || indices.length !== shape.units * shape.stride
      || indices.length > MESH_INDICES || indices.length + this.originalIndexCount > COHORT_INDICES
      || !validIndices(indices, positions.length / 2)) return false;
    let bytes = estimate(shape, indices.length);
    if (!Number.isSafeInteger(bytes) || bytes > MESH_BYTES || bytes + this.reservedBytes + this.components.reservedBytes > COHORT_BYTES
      || (shape.kind === "macro" && !validGrid(shape, positions, indices))) return false;
    const extent = scanFullGeometryExtent(mesh);
    if (!extent) return false;
    const indexBuffer = geometry.indexBuffer;
    if (indexBuffer == null || indexBuffer.destroyed) return false;
    const positionVersion = version(geometry.attributes.aPosition.buffer);
    const uvVersion = version(geometry.attributes.aUV.buffer);
    const indexVersion = version(indexBuffer);
    if (![positionVersion, uvVersion, indexVersion].every(Number.isSafeInteger)) return false;
    const words = Math.ceil(shape.units / 32);
    const fanBytes = shape.units * 16 + words * 8;
    const kernelBytes = this.fanKernelReserved ? 0 : guardedTurfFanKernelBytes();
    let fanErrors: Float64Array | null = null;
    if (shape.kind === "turf" && shape.stride === 96 && hasOwnedHighTurfFanRegistration(mesh)
      && bytes + fanBytes <= MESH_BYTES && this.reservedBytes + this.components.reservedBytes + bytes + fanBytes + kernelBytes <= COHORT_BYTES) {
      fanErrors = prepareGuardedTurfFan(positions, uvs, indices, shape.units);
      if (fanErrors) {
        bytes += fanBytes;
        this.reservedBytes += kernelBytes;
        this.fanKernelReserved = true;
      }
    }
    const bounds = shape.kind === "turf"
      ? buildTurf(shape, positions, indices)
      : buildMacro(shape, positions, indices);
    this.entries.set(mesh, {
      mesh, geometry, indexBuffer, positions, uvs, indices, extent,
      positionVersion, uvVersion, indexVersion, expectedIndexData: indices,
      shape, bounds, currentBits: new Uint32Array(words), nextBits: new Uint32Array(words),
      selectedStorage: null, mode: "original", lastRect: null, reservedBytes: bytes,
      fanErrors, currentFanBits: fanErrors ? new Uint32Array(words) : null,
      nextFanBits: fanErrors ? new Uint32Array(words) : null,
      lastFanScale: NaN, lastFanError: NaN,
    });
    this.reservedBytes += bytes;
    this.originalIndexCount += indices.length;
    return true;
  }

  reconcile(app: PIXI.Application, world: PIXI.Container): void {
    if (this.disposed) return;
    let remaining = COHORT_VISITS;
    for (const [mesh, entry] of this.entries) {
      if (!currentSource(entry)) {
        restore(entry);
        this.entries.delete(mesh);
        this.reservedBytes -= entry.reservedBytes;
        this.originalIndexCount -= entry.indices.length;
        continue;
      }
      const viewport = knownRootStageViewport(app, world, mesh, entry.extent);
      if (!viewport) {
        restore(entry);
        continue;
      }
      const fanScale = viewport.worldToScreen.a;
      const fanError = viewport.screenErrorPx;
      const sameFanView = entry.fanErrors === null
        || entry.lastFanScale === fanScale && entry.lastFanError === fanError;
      if (sameRect(entry.lastRect, viewport.local) && sameFanView) continue;
      entry.nextBits.fill(0);
      entry.nextFanBits?.fill(0);
      const query = entry.shape.kind === "turf"
        ? queryTurf(entry, viewport.local, remaining)
        : queryMacro(entry, viewport.local, remaining);
      remaining -= query.visited;
      if (!query.complete) {
        restore(entry);
        this.entries.delete(mesh);
        this.reservedBytes -= entry.reservedBytes;
        this.originalIndexCount -= entry.indices.length;
        continue;
      }
      let fanCount = 0;
      if (entry.fanErrors && entry.nextFanBits) {
        let selectedUnits = 0;
        for (const word of entry.nextBits) {
          let bits = word;
          while (bits !== 0) { bits &= bits - 1; selectedUnits++; }
        }
        // Each certificate lookup consumes one of the existing query visits.
        // If that budget is unavailable, retain every selected original96-index block.
        if (selectedUnits <= MESH_VISITS - query.visited && selectedUnits <= remaining) {
          remaining -= selectedUnits;
          for (let unit = 0; unit < entry.shape.units; unit++) {
            if ((entry.nextBits[unit >>> 5] & (1 << (unit & 31))) !== 0
              && guardedTurfFanEligible(entry.fanErrors, unit, fanScale, fanError)) {
              entry.nextFanBits[unit >>> 5] |= 1 << (unit & 31); fanCount++;
            }
          }
        }
      }
      entry.lastFanScale = fanScale;
      entry.lastFanError = fanError;
      if (fanCount === 0 && allBits(entry.nextBits, entry.shape.units)) {
        restore(entry, true);
        entry.lastRect = viewport.local;
        continue;
      }
      if (entry.mode === "selected" && sameBits(entry.currentBits, entry.nextBits)
        && (entry.fanErrors === null || sameBits(entry.currentFanBits!, entry.nextFanBits!))) {
        entry.lastRect = viewport.local;
        continue;
      }
      entry.selectedStorage ??= new Uint32Array(entry.indices.length);
      let cursor = 0;
      for (let unit = 0; unit < entry.shape.units; unit++) {
        if ((entry.nextBits[unit >>> 5] & (1 << (unit & 31))) === 0) continue;
        if (entry.nextFanBits && (entry.nextFanBits[unit >>> 5] & (1 << (unit & 31))) !== 0) {
          cursor = copyGuardedTurfFan(entry.indices, unit, entry.selectedStorage, cursor);
        } else {
          const end = (unit + 1) * entry.shape.stride;
          for (let index = unit * entry.shape.stride; index < end; index++) {
            entry.selectedStorage[cursor++] = entry.indices[index];
          }
        }
      }
      const selected = cursor === 0 ? EMPTY_INDICES : entry.selectedStorage.subarray(0, cursor);
      entry.geometry.indices = selected;
      entry.expectedIndexData = selected;
      entry.indexVersion = version(entry.geometry.indexBuffer);
      [entry.currentBits, entry.nextBits] = [entry.nextBits, entry.currentBits];
      [entry.currentFanBits, entry.nextFanBits] = [entry.nextFanBits, entry.currentFanBits];
      entry.mode = "selected";
      entry.lastRect = viewport.local;
    }
    this.components.reconcile(app, world);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.components.dispose();
    for (const entry of this.entries.values()) restore(entry);
    this.entries.clear();
    this.reservedBytes = 0;
    this.originalIndexCount = 0;
    this.fanKernelReserved = false;
  }

  /** Prototype-only bounded scalar diagnostics; no meshes or arrays escape. */
  fanDiagnostics(): Readonly<{ preparedUnits: number; selectedUnits: number; metadataBytes: number; kernelBytes: number }> {
    let preparedUnits = 0, selectedUnits = 0, metadataBytes = 0;
    for (const entry of this.entries.values()) if (entry.fanErrors) {
      preparedUnits += entry.shape.units;
      metadataBytes += entry.fanErrors.byteLength + entry.currentFanBits!.byteLength + entry.nextFanBits!.byteLength;
      if (entry.mode === "selected") for (const word of entry.currentFanBits!) {
        let bits = word;
        while (bits !== 0) { bits &= bits - 1; selectedUnits++; }
      }
    }
    return { preparedUnits, selectedUnits, metadataBytes, kernelBytes: guardedTurfFanKernelBytes() };
  }

  componentDiagnostics(): Readonly<{ meshes: number; culled: number; reservedBytes: number }> {
    return this.components.diagnostics();
  }

  /** Bounded integer diagnostics for focused tests; never returns owners. */
  diagnostics(): Readonly<{ meshes: number; originalIndices: number; reservedBytes: number }> {
    return { meshes: this.entries.size + this.components.size, originalIndices: this.originalIndexCount,
      reservedBytes: this.reservedBytes + this.components.reservedBytes };
  }
}
