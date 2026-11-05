// One fixed High 5x5-lattice,16triangle fan. No renderer or scene owners are cached.
const registration = new WeakSet<object>();
const boundary = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5] as const;
const ROUND = 2 ** -40; // >128times gamma32(double), including magnitude/division evaluation.
const MAX_COORDINATE = 2 ** 20;
const stepBits = new DataView(new ArrayBuffer(8));
function up(value: number): number {
  if (!Number.isFinite(value)) return Infinity;
  if (value === 0) return Number.MIN_VALUE;
  stepBits.setFloat64(0, value);
  stepBits.setBigUint64(0, stepBits.getBigUint64(0) + 1n);
  return stepBits.getFloat64(0);
}

/** Only the owned factory's synchronous original callback can admit fan metadata. */
export function withOwnedHighTurfFan(mesh: object, callback: () => void): void {
  registration.add(mesh);
  try { callback(); } finally { registration.delete(mesh); }
}
export function hasOwnedHighTurfFanRegistration(mesh: object): boolean {
  return registration.has(mesh);
}

function sourceOffset(grid: number): number {
  const x = grid % 5, y = Math.floor(grid / 5);
  if (y === 4) return (12 + Math.min(x, 3)) * 6 + (x === 4 ? 2 : 5);
  return (y * 4 + Math.min(x, 3)) * 6 + (x === 4 ? 1 : 0);
}
const fanOffsets = new Uint8Array(48);
for (let i = 0; i < 16; i++) {
  fanOffsets[i * 3] = sourceOffset(12);
  fanOffsets[i * 3 + 1] = sourceOffset(boundary[i]);
  fanOffsets[i * 3 + 2] = sourceOffset(boundary[(i + 1) % 16]);
}

// All overlay vertices are on the1/6grid: original vertical/horizontal/diagonal
// edges meet a center-to-boundary spoke at denominators1,2,3 (corner simplifies4).
// Include every such intersection, plus the25originalvertices. Extra points are safe.
function overlayKernel(): Int16Array {
  const points = new Set<number>();
  const add = (x: number, y: number) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 24 || y > 24) throw new Error("fan overlay is not exact");
    points.add(y * 25 + x);
  };
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) add(x * 6, y * 6);
  for (const b of boundary) {
    const dx = b % 5 - 2, dy = Math.floor(b / 5) - 2;
    for (const [nx, ny, low, high] of [[1, 0, 0, 4], [0, 1, 0, 4], [1, -1, -4, 4]]) {
      const denominator = nx * dx + ny * dy;
      if (denominator === 0) continue;
      for (let k = low; k <= high; k++) {
        const numerator = k - 2 * nx - 2 * ny;
        const t = numerator / denominator;
        if (t < 0 || t > 1) continue;
        add(12 + 6 * dx * numerator / denominator, 12 + 6 * dy * numerator / denominator);
      }
    }
  }
  const packed: number[] = [];
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  for (const point of points) {
    const qx = point % 25, qy = Math.floor(point / 25);
    const x = Math.min(3, Math.floor(qx / 6)), y = Math.min(3, Math.floor(qy / 6));
    const fx = qx - x * 6, fy = qy - y * 6, tl = y * 5 + x;
    const coefficients = new Map<number, number>();
    const addWeight = (grid: number, value: number) => coefficients.set(grid, (coefficients.get(grid) ?? 0) + value);
    if (fy <= fx) {
      addWeight(tl, (6 - fx) * 12); addWeight(tl + 1, (fx - fy) * 12); addWeight(tl + 6, fy * 12);
    } else {
      addWeight(tl, (6 - fy) * 12); addWeight(tl + 6, fx * 12); addWeight(tl + 5, (fy - fx) * 12);
    }
    let found = false;
    for (let i = 0; i < 16; i++) {
      const a = boundary[i], b = boundary[(i + 1) % 16];
      const ax = (a % 5) * 6, ay = Math.floor(a / 5) * 6;
      const bx = (b % 5) * 6, by = Math.floor(b / 5) * 6;
      const area = cross(ax - 12, ay - 12, bx - 12, by - 12);
      const wc = cross(ax - qx, ay - qy, bx - qx, by - qy);
      const wa = cross(bx - qx, by - qy, 12 - qx, 12 - qy);
      const wb = area - wc - wa;
      if (wc < 0 || wa < 0 || wb < 0) continue;
      if (area !== 72) throw new Error("unexpected fan area");
      addWeight(12, -wc); addWeight(a, -wa); addWeight(b, -wb); found = true; break;
    }
    if (!found) throw new Error("uncovered fan overlay");
    const row = [...coefficients].filter(([, value]) => value !== 0);
    if (row.length > 6 || row.reduce((sum, [, value]) => sum + value, 0) !== 0) throw new Error("invalid fan coefficients");
    for (let i = 0; i < 6; i++) packed.push(row[i]?.[0] ?? 0, row[i]?.[1] ?? 0);
  }
  return new Int16Array(packed);
}
const kernel = overlayKernel();

function determinant(positions: Float32Array, a: number, b: number, c: number): number {
  const ax = positions[a * 2], ay = positions[a * 2 + 1];
  const left = (positions[b * 2] - ax) * (positions[c * 2 + 1] - ay);
  const right = (positions[b * 2 + 1] - ay) * (positions[c * 2] - ax);
  const value = left - right;
  const uncertainty = (Math.abs(left) + Math.abs(right) + 1) * ROUND;
  return Math.abs(value) <= uncertainty ? 0 : value;
}
function simpleBoundary(positions: Float32Array, grid: Uint32Array): boolean {
  for (let i = 0; i < 16; i++) for (let j = i + 2; j < 16; j++) {
    if (i === 0 && j === 15) continue;
    const a = grid[boundary[i]], b = grid[boundary[(i + 1) % 16]];
    const c = grid[boundary[j]], d = grid[boundary[(j + 1) % 16]];
    const ax = positions[a * 2], ay = positions[a * 2 + 1], bx = positions[b * 2], by = positions[b * 2 + 1];
    const cx = positions[c * 2], cy = positions[c * 2 + 1], dx = positions[d * 2], dy = positions[d * 2 + 1];
    if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)
      || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
    const ac = determinant(positions, a, b, c), ad = determinant(positions, a, b, d);
    const ca = determinant(positions, c, d, a), cb = determinant(positions, c, d, b);
    if (ac * ad > 0 || ca * cb > 0) continue;
    return false; // Intersection, touching nonadjacent edges, or uncertain arithmetic.
  }
  return true;
}

/**16bytes/unit; invalid topology/UV rejects the entire source; folds retain96indices. */
export function prepareGuardedTurfFan(positions: Float32Array, uvs: Float32Array,
  indices: Uint32Array, units: number): Float64Array | null {
  if (!Number.isSafeInteger(units) || units < 1 || units > 62_500 || indices.length !== units * 96
    || positions.length % 2 !== 0 || uvs.length !== positions.length) return null;
  const errors = new Float64Array(units * 2); errors.fill(Infinity);
  const grid = new Uint32Array(25);
  for (let unit = 0; unit < units; unit++) {
    const start = unit * 96;
    for (let g = 0; g < 25; g++) grid[g] = indices[start + sourceOffset(g)];
    const u0 = uvs[grid[0] * 2], v0 = uvs[grid[0] * 2 + 1];
    if (!Number.isInteger(u0 * 8) || !Number.isInteger(v0 * 8) || u0 < 0 || v0 < 0 || u0 >= 128 || v0 >= 128) return null;
    for (let g = 0; g < 25; g++) {
      const at = grid[g] * 2;
      if (at + 1 >= positions.length || !Number.isFinite(positions[at]) || !Number.isFinite(positions[at + 1])
        || Math.abs(positions[at]) > MAX_COORDINATE || Math.abs(positions[at + 1]) > MAX_COORDINATE
        || uvs[at] !== u0 + (g % 5) / 32 || uvs[at + 1] !== v0 + Math.floor(g / 5) / 32) return null;
    }
    let valid = true;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const g = y * 5 + x, at = start + (y * 4 + x) * 6;
      const expected = [grid[g], grid[g + 1], grid[g + 6], grid[g], grid[g + 6], grid[g + 5]];
      for (let k = 0; k < 6; k++) if (indices[at + k] !== expected[k]) return null;
      if (determinant(positions, expected[0], expected[1], expected[2]) <= 0
        || determinant(positions, expected[3], expected[4], expected[5]) <= 0) valid = false;
    }
    for (let i = 0; i < 16; i++) if (determinant(positions, grid[12], grid[boundary[i]], grid[boundary[(i + 1) % 16]]) <= 0) valid = false;
    if (!valid || !simpleBoundary(positions, grid)) continue;
    let maxX = 0, maxY = 0;
    for (let row = 0; row < kernel.length; row += 12) {
      let dx = 0, dy = 0, mx = 0, my = 0;
      for (let term = 0; term < 12; term += 2) {
        const coefficient = kernel[row + term + 1];
        if (coefficient === 0) continue;
        const at = grid[kernel[row + term]] * 2;
        const x = coefficient * positions[at], y = coefficient * positions[at + 1];
        dx += x; dy += y; mx += Math.abs(x); my += Math.abs(y);
      }
      maxX = Math.max(maxX, Math.abs(dx / 72) + (mx + 1) * ROUND);
      maxY = Math.max(maxY, Math.abs(dy / 72) + (my + 1) * ROUND);
    }
    errors[unit * 2] = up(maxX); errors[unit * 2 + 1] = up(maxY);
  }
  return errors;
}

/** Euclidean physical-pixel bound; default-root guard already proves resolution1. */
export function guardedTurfFanEligible(errors: Float64Array, unit: number, scale: number, screenError: number): boolean {
  if (!Number.isSafeInteger(unit) || unit < 0 || unit * 2 + 1 >= errors.length
    || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(screenError) || screenError < 0) return false;
  const x = up(up(scale * errors[unit * 2]) + up(2 * screenError));
  const y = up(up(scale * errors[unit * 2 + 1]) + up(2 * screenError));
  // Euclidean displacement is at most this outward L1 bound; no hypot accuracy assumption.
  return up(x + y) <= 0.25;
}
export function copyGuardedTurfFan(indices: Uint32Array, unit: number, target: Uint32Array, cursor: number): number {
  const start = unit * 96;
  for (let i = 0; i < 48; i++) target[cursor++] = indices[start + fanOffsets[i]];
  return cursor;
}
/** Static kernel accounting only; no owners are exposed. */
export function guardedTurfFanKernelBytes(): number { return kernel.byteLength + fanOffsets.byteLength; }
