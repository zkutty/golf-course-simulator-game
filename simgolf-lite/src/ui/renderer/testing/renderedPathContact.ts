/** Test-only oracle: the GPU triangle is affine between its FINAL Float32 vertices.
 * No terrain sampler, projection function or scene's expected diagnostic enters
 * this calculation. World coordinates locate the same indexed triangle only. */
export interface ContactPoint { readonly x: number; readonly y: number; }
export interface RenderedPathSurface {
  readonly worldPositions: readonly number[];
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}
export interface RenderedPathContact {
  readonly triangle: readonly [number, number, number];
  readonly weights: readonly [number, number, number];
  readonly worldVertices: readonly ContactPoint[];
  readonly renderedVertices: readonly ContactPoint[];
  readonly expected: ContactPoint;
  readonly tolerancePx: number;
}
function float32Ulp(value: number): number {
  const magnitude = Math.abs(value);
  return magnitude < 2 ** -126 ? 2 ** -149 : 2 ** (Math.floor(Math.log2(magnitude)) - 23);
}
export function findRenderedPathContact(surface: RenderedPathSurface, point: ContactPoint): RenderedPathContact | null {
  const { worldPositions: world, positions, indices } = surface;
  if (world.length !== positions.length || indices.length % 3 || world.some(value => !Number.isFinite(value))
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Malformed rendered triangle buffers/query");
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = [indices[offset], indices[offset + 1], indices[offset + 2]] as const;
    if (ids.some(id => id * 2 + 1 >= world.length)) throw new Error("Rendered triangle index out of range");
    const vertices = ids.map(id => ({ x: world[id * 2], y: world[id * 2 + 1] }));
    const [a, b, c] = vertices;
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-12) continue;
    const u = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
    const v = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
    const weights = [u, v, 1 - u - v] as const;
    // Boundary/vertex checks are insufficient for this acceptance proof.
    if (weights.some(weight => weight <= 1e-4 || weight >= 1 - 1e-4)) continue;
    const rendered = ids.map(id => ({ x: positions[id * 2], y: positions[id * 2 + 1] }));
    if (rendered.some(vertex => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) throw new Error("Nonfinite rendered vertex");
    const tolerancePx = Math.max(.01, 8 * Math.max(...rendered.flatMap(vertex => [float32Ulp(vertex.x), float32Ulp(vertex.y)])));
    if (tolerancePx > .05) throw new Error("Float32 quantization exceeds the qualified .05px coordinate bound");
    return { triangle: ids, weights, worldVertices: vertices, renderedVertices: rendered,
      expected: { x: rendered.reduce((sum, vertex, i) => sum + weights[i] * vertex.x, 0),
        y: rendered.reduce((sum, vertex, i) => sum + weights[i] * vertex.y, 0) }, tolerancePx };
  }
  return null;
}
export function renderedContactResidual(contact: RenderedPathContact, actual: ContactPoint | null | undefined, holderOffsetY = 0): number {
  if (!actual || !Number.isFinite(actual.x) || !Number.isFinite(actual.y)) return Infinity;
  return Math.hypot(actual.x - contact.expected.x, actual.y - holderOffsetY - contact.expected.y);
}
export function renderedContactMatches(contact: RenderedPathContact, actual: ContactPoint | null | undefined, holderOffsetY = 0): boolean {
  return renderedContactResidual(contact, actual, holderOffsetY) <= contact.tolerancePx;
}
