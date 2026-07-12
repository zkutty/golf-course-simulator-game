import { describe, expect, it } from "vitest";
import { entityDepth, frontCorner, placeObject } from "./objectPlacement";
import { ISO_ROTATIONS, worldToIso } from "./iso";

describe("object placement & depth sorting", () => {
  it("front corner of a 1×1 footprint is the bottom-projected corner at every rotation", () => {
    for (const rot of ISO_ROTATIONS) {
      const c = frontCorner({ x: 4, y: 7, w: 1, d: 1 }, rot);
      // The chosen corner must project lower on screen than the others.
      const cScreen = worldToIso(c.x, c.y, 0, rot);
      for (const other of [
        { x: 4, y: 7 },
        { x: 5, y: 7 },
        { x: 5, y: 8 },
        { x: 4, y: 8 },
      ]) {
        const oScreen = worldToIso(other.x, other.y, 0, rot);
        expect(cScreen.y).toBeGreaterThanOrEqual(oScreen.y - 1e-9);
      }
    }
  });

  // Painters'-algorithm invariant: for ground-level objects, depth ordering
  // must agree with ground-anchor screen-y ordering (ties in y are ties in
  // depth — objects on the same screen row can draw in either order).
  it("depth ordering matches screen-y ordering for props at every rotation", () => {
    const spots = [
      { x: 5, y: 5 }, { x: 6, y: 6 }, { x: 8, y: 6 }, { x: 3, y: 9 },
      { x: 10, y: 2 }, { x: 7, y: 7 }, { x: 12, y: 4 },
    ];
    for (const rot of ISO_ROTATIONS) {
      const placed = spots.map((sp) => placeObject({ ...sp, w: 1, d: 1 }, 0, rot));
      for (let i = 0; i < placed.length; i++) {
        for (let j = 0; j < placed.length; j++) {
          const dy = placed[i].position.y - placed[j].position.y;
          if (Math.abs(dy) < 1e-6) continue; // same screen row: order free
          if (dy > 0) expect(placed[i].zIndex).toBeGreaterThan(placed[j].zIndex);
          else expect(placed[i].zIndex).toBeLessThan(placed[j].zIndex);
        }
      }
    }
  });

  it("a golfer circling a tree is behind it above and in front below, at every rotation", () => {
    for (const rot of ISO_ROTATIONS) {
      const tree = placeObject({ x: 10, y: 10, w: 1, d: 1 }, 0, rot);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const gx = 10 + dx;
          const gy = 10 + dy;
          const depth = entityDepth(gx, gy, 0, rot);
          const screenY = worldToIso(gx + 0.5, gy + 0.5, 0, rot).y;
          const treeScreenY = worldToIso(10.5, 10.5, 0, rot).y;
          if (Math.abs(screenY - treeScreenY) < 1e-6) continue;
          if (screenY > treeScreenY) expect(depth).toBeGreaterThan(tree.zIndex);
          else expect(depth).toBeLessThan(tree.zIndex);
        }
      }
    }
  });

  it("a 2×2 building occludes props behind its front row and yields to props in front", () => {
    for (const rot of ISO_ROTATIONS) {
      const building = placeObject({ x: 10, y: 10, w: 2, d: 2 }, 0, rot);
      // Sample a ring of 1×1 props around the building; compare against the
      // building's front-row screen y with a half-tile margin so only
      // clearly-in-front / clearly-behind cases are asserted.
      for (let dy = -2; dy <= 3; dy++) {
        for (let dx = -2; dx <= 3; dx++) {
          const inside = dx >= 0 && dx < 2 && dy >= 0 && dy < 2;
          if (inside) continue;
          const prop = placeObject({ x: 10 + dx, y: 10 + dy, w: 1, d: 1 }, 0, rot);
          const margin = 8; // half TILE_H: skip ambiguous same-row cases
          if (prop.position.y > building.position.y + margin) {
            expect(prop.zIndex).toBeGreaterThan(building.zIndex);
          } else if (prop.position.y < building.position.y - margin) {
            expect(prop.zIndex).toBeLessThan(building.zIndex);
          }
        }
      }
    }
  });

  it("elevation raises the depth key without reordering distinct rows", () => {
    const flat = placeObject({ x: 5, y: 5, w: 1, d: 1 }, 0, 0);
    const raised = placeObject({ x: 5, y: 5, w: 1, d: 1 }, 3, 0);
    expect(raised.zIndex).toBeGreaterThan(flat.zIndex);
    const nextRow = placeObject({ x: 5, y: 6, w: 1, d: 1 }, 0, 0);
    expect(raised.zIndex).toBeLessThan(nextRow.zIndex);
  });
});
