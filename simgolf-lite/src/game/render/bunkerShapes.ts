import type { SurfacePoint, Terrain } from "../models/types";

export type BunkerVisualType = "pot" | "greenside" | "fairway";

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function random01(seed: number, index: number): number {
  return mix32(seed ^ Math.imul(index + 1, 0x9e3779b1)) / 0xffffffff;
}

function angularDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(raw, Math.PI * 2 - raw);
}

interface RingSample extends SurfacePoint {
  distance: number;
}

/**
 * Samples by world distance instead of by source vertex. That keeps bunker
 * lobes smooth across long tile edges and prevents the visible rhythm from
 * changing when rounded-corner tessellation changes with graphics quality.
 */
function sampleClosedRing(
  ring: readonly SurfacePoint[],
  targetSpacing: number,
): RingSample[] {
  const segments: Array<{
    start: SurfacePoint;
    end: SurfacePoint;
    startDistance: number;
    length: number;
  }> = [];
  let perimeter = 0;
  for (let index = 0; index < ring.length; index++) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= 1e-7) continue;
    segments.push({ start, end, startDistance: perimeter, length });
    perimeter += length;
  }
  if (segments.length < 3 || perimeter <= 1e-6) {
    return ring.map((point, index) => ({ ...point, distance: index }));
  }

  const sampleCount = Math.max(
    12,
    Math.min(4096, Math.ceil(perimeter / Math.max(0.12, targetSpacing))),
  );
  const samples: RingSample[] = [];
  let segmentIndex = 0;
  for (let index = 0; index < sampleCount; index++) {
    const distance = perimeter * index / sampleCount;
    while (
      segmentIndex + 1 < segments.length &&
      distance >= segments[segmentIndex + 1].startDistance
    ) segmentIndex++;
    const segment = segments[segmentIndex];
    const t = Math.max(
      0,
      Math.min(1, (distance - segment.startDistance) / segment.length),
    );
    samples.push({
      x: segment.start.x + (segment.end.x - segment.start.x) * t,
      y: segment.start.y + (segment.end.y - segment.start.y) * t,
      distance,
    });
  }
  return samples;
}

/**
 * A one-cell bunker should read as a deliberately shaped pot/greenside
 * bunker, not a rounded square. The kidney indentation and lobes are stable
 * for a given topology and remain inside the authoritative tile.
 */
function singleTileBunker(
  ring: readonly SurfacePoint[],
  topologyKey: string,
): SurfacePoint[] {
  const minX = Math.min(...ring.map((point) => point.x));
  const maxX = Math.max(...ring.map((point) => point.x));
  const minY = Math.min(...ring.map((point) => point.y));
  const maxY = Math.max(...ring.map((point) => point.y));
  const seed = hashString(topologyKey);
  const centerX = (minX + maxX) / 2 + (random01(seed, 0) - 0.5) * 0.055;
  const centerY = (minY + maxY) / 2 + (random01(seed, 1) - 0.5) * 0.045;
  const radiusX = (maxX - minX) * (0.39 + random01(seed, 2) * 0.025);
  const radiusY = (maxY - minY) * (0.355 + random01(seed, 3) * 0.035);
  const phase = random01(seed, 4) * Math.PI * 2;
  const notchAngle = phase + Math.PI * (0.12 + random01(seed, 5) * 0.28);
  const points: SurfacePoint[] = [];
  const samples = 28;

  for (let index = 0; index < samples; index++) {
    const angle = index / samples * Math.PI * 2;
    const notchDistance = angularDistance(angle, notchAngle);
    const notch = Math.exp(-(notchDistance * notchDistance) / 0.13) * 0.19;
    const lobes =
      Math.sin(angle * 2 + phase) * 0.075 +
      Math.sin(angle * 3 - phase * 0.6) * 0.035;
    const radius = 1 + lobes - notch;
    points.push({
      x: centerX + Math.cos(angle) * radiusX * radius,
      y: centerY + Math.sin(angle) * radiusY * radius,
    });
  }
  return points;
}

/**
 * Insets a connected tile union and gives its boundary slow, deterministic
 * scallops. Because traced component edges keep filled terrain on their
 * right, the right-hand normal moves both outer rings and hole rings toward
 * the sand and preserves islands.
 */
function connectedBunkerRing(
  ring: readonly SurfacePoint[],
  topologyKey: string,
  ringIndex: number,
  cellCount: number,
  visualType: BunkerVisualType,
): SurfacePoint[] {
  if (ring.length < 3) return ring.map((point) => ({ ...point }));
  const seed = hashString(`${topologyKey}:${ringIndex}`);
  const phaseA = random01(seed, 0) * Math.PI * 2;
  const phaseB = random01(seed, 1) * Math.PI * 2;
  const baseInset = visualType === "pot"
    ? 0.18
    : visualType === "greenside"
      ? cellCount <= 4 ? 0.145 : 0.125
      : cellCount <= 4 ? 0.095 : 0.075;
  const waveStrength = visualType === "fairway" ? 0.82 : 1;
  const samples = sampleClosedRing(
    ring,
    visualType === "fairway" ? 0.28 : 0.22,
  );
  const lobeLength = 1.35 + random01(seed, 2) * 0.7;
  const secondaryLength = 0.68 + random01(seed, 3) * 0.28;

  return samples.map((point, index) => {
    const previous = samples[(index - 1 + samples.length) % samples.length];
    const next = samples[(index + 1) % samples.length];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.max(1e-6, Math.hypot(tangentX, tangentY));
    const normalX = -tangentY / length;
    const normalY = tangentX / length;
    const slowWave = Math.sin(
      point.distance / lobeLength * Math.PI * 2 + phaseA,
    ) * 0.05 * waveStrength;
    const secondaryWave = Math.sin(
      point.distance / secondaryLength * Math.PI * 2 + phaseB,
    ) * 0.018 * waveStrength;
    const grain = (random01(seed, index + 11) - 0.5) * 0.006 * waveStrength;
    const inset = Math.max(0.07, Math.min(0.205, (
      baseInset + slowWave + secondaryWave + grain
    )));
    return {
      x: point.x + normalX * inset,
      y: point.y + normalY * inset,
    };
  });
}

/**
 * Infers a presentation-only bunker family from authoritative cells and
 * context. The result is deterministic and save-neutral: one-cell hazards
 * become pot bunkers, hazards close to a green receive a steeper greenside
 * treatment, and elongated/distant hazards use the shallower fairway profile.
 */
export function classifyBunkerVisualType(
  cells: readonly number[],
  tiles: readonly Terrain[],
  width: number,
  height: number,
): BunkerVisualType {
  if (cells.length <= 1) return "pot";
  let nearGreen = false;
  for (const index of cells) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -2; dy <= 2 && !nearGreen; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (tiles[ny * width + nx] === "green") {
          nearGreen = true;
          break;
        }
      }
    }
    if (nearGreen) break;
  }
  return nearGreen ? "greenside" : "fairway";
}

/**
 * Produces presentation-only sand contours. Gameplay remains tied to the
 * authoritative cells, while the connected renderer paints rough beneath
 * those cells and reveals sand only through this organic mask.
 */
export function buildBunkerVisualRings(
  rings: readonly (readonly SurfacePoint[])[],
  topologyKey: string,
  cellCount: number,
  visualType: BunkerVisualType = cellCount === 1 ? "pot" : "greenside",
): SurfacePoint[][] {
  const valid = rings.filter((ring) => ring.length >= 3);
  if (valid.length === 0) return [];
  if (cellCount === 1) {
    return [singleTileBunker(valid[0], topologyKey)];
  }
  return valid.map((ring, index) => (
    connectedBunkerRing(ring, topologyKey, index, cellCount, visualType)
  ));
}
