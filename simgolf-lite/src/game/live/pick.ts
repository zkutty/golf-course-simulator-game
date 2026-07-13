// Pure hit-test: given golfer positions (tile-space, where a golfer at (x,y) is
// drawn centered on tile-center x+0.5 / y+0.5) and a click in fractional tile
// coordinates, return the id of the nearest golfer within `radius` tiles, or
// null. Kept pure so it can be unit-tested and reused by the canvas.
export function pickGolferAt(
  golfers: ReadonlyArray<{ id: number; x: number; y: number }>,
  wx: number,
  wy: number,
  radius = 0.9
): number | null {
  let bestId: number | null = null;
  let bestD = radius;
  for (const g of golfers) {
    const d = Math.hypot(wx - (g.x + 0.5), wy - (g.y + 0.5));
    if (d < bestD) {
      bestD = d;
      bestId = g.id;
    }
  }
  return bestId;
}
