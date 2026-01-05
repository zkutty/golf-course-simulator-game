import type { Point } from "../models/types";

/**
 * View mode for rendering the course
 */
export type ViewMode = "topdown" | "isometric";

/**
 * Isometric projection configuration
 * Using dimetric projection (2:1 ratio) for a classic SimGolf/RollerCoaster Tycoon look
 */
export interface IsometricConfig {
  // Angle of rotation (typically 45 degrees for isometric)
  angle: number;
  // Vertical scale factor (0.5 for classic dimetric 2:1)
  verticalScale: number;
  // Height scale factor (how much vertical units affect screen Y)
  heightScale: number;
}

/**
 * Default isometric configuration (dimetric 2:1)
 */
export const DEFAULT_ISOMETRIC_CONFIG: IsometricConfig = {
  angle: 45, // 45 degree rotation
  verticalScale: 0.5, // 2:1 dimetric ratio
  heightScale: 0.5, // height contributes to screen Y
};

/**
 * Convert world coordinates (tile space) to isometric screen coordinates
 * @param worldX - X coordinate in tile space
 * @param worldY - Y coordinate in tile space
 * @param height - Height/elevation at this point (in tile units)
 * @param config - Isometric configuration
 * @returns Screen coordinates in isometric projection
 */
export function worldToIsometric(
  worldX: number,
  worldY: number,
  height: number = 0,
  config: IsometricConfig = DEFAULT_ISOMETRIC_CONFIG
): Point {
  // Dimetric 2:1 projection formula:
  // screenX = (worldX - worldY) * cos(angle)
  // screenY = (worldX + worldY) * sin(angle) * verticalScale - height * heightScale

  const angleRad = (config.angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const screenX = (worldX - worldY) * cos;
  const screenY = (worldX + worldY) * sin * config.verticalScale - height * config.heightScale;

  return { x: screenX, y: screenY };
}

/**
 * Convert isometric screen coordinates back to world coordinates (tile space)
 * Note: This doesn't account for height, as we can't determine height from screen position alone
 * @param screenX - X coordinate on screen
 * @param screenY - Y coordinate on screen
 * @param height - Known height at this point (default 0)
 * @param config - Isometric configuration
 * @returns World coordinates in tile space
 */
export function isometricToWorld(
  screenX: number,
  screenY: number,
  height: number = 0,
  config: IsometricConfig = DEFAULT_ISOMETRIC_CONFIG
): Point {
  // Adjust screenY for height
  const adjustedScreenY = screenY + height * config.heightScale;

  // Inverse dimetric 2:1 projection:
  const angleRad = (config.angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const vs = config.verticalScale;

  // Solve the system of equations:
  // screenX = (worldX - worldY) * cos
  // adjustedScreenY = (worldX + worldY) * sin * vs

  // From first equation: worldX = screenX/cos + worldY
  // Substitute into second: adjustedScreenY = (screenX/cos + 2*worldY) * sin * vs
  // Solve for worldY: worldY = (adjustedScreenY/(sin*vs) - screenX/cos) / 2

  const worldY = (adjustedScreenY / (sin * vs) - screenX / cos) / 2;
  const worldX = screenX / cos + worldY;

  return { x: worldX, y: worldY };
}

/**
 * Calculate tile drawing order for isometric rendering (back-to-front)
 * Returns an array of tile indices sorted for proper depth ordering
 * @param width - Course width in tiles
 * @param height - Course height in tiles
 * @returns Array of tile indices in drawing order (back to front)
 */
export function getIsometricDrawOrder(width: number, height: number): number[] {
  const indices: number[] = [];

  // Isometric drawing order: diagonal sweeps from back-left to front-right
  // We iterate along diagonals where x + y = constant
  for (let diagonal = 0; diagonal < width + height - 1; diagonal++) {
    // For each diagonal, iterate from top-left to bottom-right
    const startY = Math.max(0, diagonal - width + 1);
    const endY = Math.min(height - 1, diagonal);

    for (let y = startY; y <= endY; y++) {
      const x = diagonal - y;
      if (x >= 0 && x < width) {
        indices.push(y * width + x);
      }
    }
  }

  return indices;
}

/**
 * Get tile corners in isometric projection
 * Returns the four corners of a tile diamond in screen space
 * @param tileX - Tile X coordinate
 * @param tileY - Tile Y coordinate
 * @param tileSize - Size of tile in screen pixels (for top-down view)
 * @param height - Height/elevation at this tile
 * @param config - Isometric configuration
 * @returns Array of 4 corner points [top, right, bottom, left] in screen space
 */
export function getIsometricTileCorners(
  tileX: number,
  tileY: number,
  tileSize: number,
  height: number = 0,
  config: IsometricConfig = DEFAULT_ISOMETRIC_CONFIG
): Point[] {
  // Calculate the four corners of the tile in world space
  const corners = [
    { x: tileX + 0.5, y: tileY },     // top
    { x: tileX + 1, y: tileY + 0.5 }, // right
    { x: tileX + 0.5, y: tileY + 1 }, // bottom
    { x: tileX, y: tileY + 0.5 },     // left
  ];

  // Convert each corner to isometric screen space
  return corners.map(c => {
    const iso = worldToIsometric(c.x, c.y, height, config);
    return {
      x: iso.x * tileSize,
      y: iso.y * tileSize,
    };
  });
}

/**
 * Interpolate height from heightmap at sub-tile precision
 * @param heightMap - Height map array
 * @param width - Course width
 * @param height - Course height
 * @param x - X coordinate (can be fractional)
 * @param y - Y coordinate (can be fractional)
 * @returns Interpolated height value
 */
export function getHeightAt(
  heightMap: number[] | undefined,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  if (!heightMap) return 0;

  // Clamp to bounds
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));

  // Get integer tile coordinates
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  // Get fractional parts
  const fx = x - x0;
  const fy = y - y0;

  // Get heights at the four corners
  const h00 = heightMap[y0 * width + x0] ?? 0;
  const h10 = heightMap[y0 * width + x1] ?? 0;
  const h01 = heightMap[y1 * width + x0] ?? 0;
  const h11 = heightMap[y1 * width + x1] ?? 0;

  // Bilinear interpolation
  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;
  const h = h0 * (1 - fy) + h1 * fy;

  return h;
}
