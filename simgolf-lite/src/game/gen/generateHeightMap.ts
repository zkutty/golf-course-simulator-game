/**
 * Generate a heightmap for a golf course using Perlin-like noise
 * This creates natural-looking elevation changes
 */

import { mulberry32 } from "../../utils/rng";

/**
 * Simple noise function for height generation
 */
function noise2D(x: number, y: number, seed: number): number {
  // Simple hash-based noise
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Smoothstep interpolation
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Interpolated noise at arbitrary position
 */
function smoothNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx = x - x0;
  const fy = y - y0;

  const sx = smoothstep(fx);
  const sy = smoothstep(fy);

  const n00 = noise2D(x0, y0, seed);
  const n10 = noise2D(x1, y0, seed);
  const n01 = noise2D(x0, y1, seed);
  const n11 = noise2D(x1, y1, seed);

  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;

  return nx0 * (1 - sy) + nx1 * sy;
}

/**
 * Fractional Brownian Motion (FBM) for natural terrain
 */
function fbm(x: number, y: number, octaves: number, seed: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5; // Each octave has half the amplitude
    frequency *= 2; // Each octave has double the frequency
  }

  return value / maxValue; // Normalize to [0, 1]
}

/**
 * Generate a heightmap for a course
 * @param width - Course width in tiles
 * @param height - Course height in tiles
 * @param seed - Random seed for generation
 * @param options - Generation options
 * @returns Array of height values (length = width * height)
 */
export function generateHeightMap(
  width: number,
  height: number,
  seed: number,
  options?: {
    octaves?: number; // Number of noise octaves (default: 4)
    scale?: number; // Scale of terrain features (default: 0.1)
    amplitude?: number; // Maximum height variation (default: 2.0)
    baseHeight?: number; // Base elevation (default: 0.0)
  }
): number[] {
  const {
    octaves = 4,
    scale = 0.1,
    amplitude = 2.0,
    baseHeight = 0.0,
  } = options || {};

  const heightMap: number[] = new Array(width * height);
  const rng = mulberry32(seed);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;

      // Generate multi-octave noise
      const noiseValue = fbm(x * scale, y * scale, octaves, seed);

      // Map from [0, 1] to height range
      const h = baseHeight + (noiseValue - 0.5) * amplitude;

      heightMap[i] = h;
    }
  }

  return heightMap;
}

/**
 * Generate a subtle heightmap suitable for golf courses
 * Golf courses typically have gentle rolling hills
 */
export function generateGolfCourseHeightMap(
  width: number,
  height: number,
  seed: number
): number[] {
  return generateHeightMap(width, height, seed, {
    octaves: 3,
    scale: 0.08, // Larger features
    amplitude: 1.5, // Gentle hills (1.5 tile units max deviation)
    baseHeight: 0.0,
  });
}
