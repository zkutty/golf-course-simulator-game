/**
 * Course grid dimensions
 * These constants define the default course size and can be easily changed.
 * 
 * Current size: 110x70 tiles
 * At 10 yards/tile, this gives:
 * - Total area: ~1,100 x 700 yards = ~770,000 sq yards = ~159 acres
 * - Suitable for a realistic 9-hole layout with:
 *   - 2 par 3s (short holes)
 *   - Mostly par 4s (medium holes)
 *   - 1 par 5 (long hole)
 */
export const COURSE_WIDTH = 110;
export const COURSE_HEIGHT = 70;

/**
 * Course boundary configuration
 * Defines a soft boundary within the grid where playable land should be located.
 * This creates a more realistic property parcel shape and improves wild land generation.
 * 
 * The boundary is defined as an oval/rounded rectangle centered in the grid.
 * Values are in tiles, relative to grid center.
 */
export const COURSE_BOUNDARY = {
  // Boundary ellipse radii (in tiles)
  // These define how much of the grid is "playable" vs "out of bounds"
  radiusX: COURSE_WIDTH * 0.42, // ~46 tiles from center
  radiusY: COURSE_HEIGHT * 0.42, // ~29 tiles from center
  // Padding from edges (in tiles) - ensures boundary doesn't touch grid edges
  paddingX: COURSE_WIDTH * 0.08, // ~9 tiles
  paddingY: COURSE_HEIGHT * 0.08, // ~6 tiles
} as const;

/**
 * Check if a point is within the course boundary
 * Returns true if the point is within the playable area
 */
export function isWithinCourseBoundary(x: number, y: number): boolean {
  const centerX = COURSE_WIDTH / 2;
  const centerY = COURSE_HEIGHT / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  // Ellipse equation: (dx/radiusX)^2 + (dy/radiusY)^2 <= 1
  const normalizedX = dx / COURSE_BOUNDARY.radiusX;
  const normalizedY = dy / COURSE_BOUNDARY.radiusY;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

