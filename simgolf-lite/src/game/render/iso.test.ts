import { describe, expect, it } from "vitest";
import {
  ELEVATION_STEP_PX,
  ISO_ROTATIONS,
  TILE_H,
  TILE_W,
  isoDepth,
  isoToTile,
  isoToWorld,
  nextRotation,
  rotateWorld,
  tileCenterIso,
  tileDiamondCorners,
  unrotateWorld,
  worldToIso,
} from "./iso";
import { mulberry32 } from "../../utils/rng";

const EPS = 1e-9;

describe("iso projection", () => {
  it("projects the origin to (0,0) at every rotation", () => {
    for (const rot of ISO_ROTATIONS) {
      const p = worldToIso(0, 0, 0, rot);
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    }
  });

  it("uses 2:1 dimetric axes at rotation 0", () => {
    // +x in world goes right-and-down half a tile.
    expect(worldToIso(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    // +y in world goes left-and-down half a tile.
    expect(worldToIso(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it("round-trips world → iso → world within 1e-9 for all rotations", () => {
    const rng = mulberry32(1234);
    for (const rot of ISO_ROTATIONS) {
      for (let i = 0; i < 200; i++) {
        const x = (rng() - 0.5) * 200;
        const y = (rng() - 0.5) * 200;
        const p = worldToIso(x, y, 0, rot);
        const back = isoToWorld(p.x, p.y, rot);
        expect(Math.abs(back.x - x)).toBeLessThan(EPS);
        expect(Math.abs(back.y - y)).toBeLessThan(EPS);
      }
    }
  });

  it("rotateWorld/unrotateWorld are exact inverses", () => {
    const rng = mulberry32(99);
    for (const rot of ISO_ROTATIONS) {
      for (let i = 0; i < 50; i++) {
        const x = (rng() - 0.5) * 100;
        const y = (rng() - 0.5) * 100;
        const r = rotateWorld(x, y, rot);
        const back = unrotateWorld(r.x, r.y, rot);
        expect(Math.abs(back.x - x)).toBeLessThan(EPS);
        expect(Math.abs(back.y - y)).toBeLessThan(EPS);
      }
    }
  });

  it("four 90° rotations compose to identity", () => {
    let p = { x: 3.25, y: -7.5 };
    for (let i = 0; i < 4; i++) p = rotateWorld(p.x, p.y, 90);
    expect(p.x).toBeCloseTo(3.25, 12);
    expect(p.y).toBeCloseTo(-7.5, 12);
  });

  it("elevation raises the screen point straight up", () => {
    const flat = worldToIso(4, 7, 0);
    const raised = worldToIso(4, 7, 3);
    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 3 * ELEVATION_STEP_PX);
  });

  it("neighboring tiles share diamond corners exactly", () => {
    for (const rot of ISO_ROTATIONS) {
      const a = tileDiamondCorners(2, 5, 0, rot); // corners: (2,5)(3,5)(3,6)(2,6)
      const b = tileDiamondCorners(3, 5, 0, rot); // corners: (3,5)(4,5)(4,6)(3,6)
      expect(a[1]).toEqual(b[0]); // shared vertex (3,5)
      expect(a[2]).toEqual(b[3]); // shared vertex (3,6)
      const below = tileDiamondCorners(2, 6, 0, rot); // shares (2,6)(3,6) with a
      expect(a[3]).toEqual(below[0]);
      expect(a[2]).toEqual(below[1]);
    }
  });

  it("isoToTile picks the tile whose center was projected", () => {
    const rng = mulberry32(555);
    for (const rot of ISO_ROTATIONS) {
      for (let i = 0; i < 100; i++) {
        const tx = Math.floor(rng() * 40);
        const ty = Math.floor(rng() * 40);
        const center = tileCenterIso(tx, ty, 0, rot);
        const picked = isoToTile(center.x, center.y, rot);
        expect(picked).toEqual({ x: tx, y: ty });
      }
    }
  });

  it("depth increases toward the camera (larger projected screen y = larger depth)", () => {
    const rng = mulberry32(42);
    for (const rot of ISO_ROTATIONS) {
      for (let i = 0; i < 100; i++) {
        const ax = rng() * 30;
        const ay = rng() * 30;
        const bx = rng() * 30;
        const by = rng() * 30;
        const screenA = worldToIso(ax, ay, 0, rot).y;
        const screenB = worldToIso(bx, by, 0, rot).y;
        const depthA = isoDepth(ax, ay, 0, rot);
        const depthB = isoDepth(bx, by, 0, rot);
        if (screenA < screenB) expect(depthA).toBeLessThan(depthB);
        if (screenA > screenB) expect(depthA).toBeGreaterThan(depthB);
      }
    }
  });

  it("elevation breaks depth ties in favor of the raised point", () => {
    expect(isoDepth(5, 5, 1)).toBeGreaterThan(isoDepth(5, 5, 0));
    // ...but never reorders distinct ground positions (bias < 1 tile).
    expect(isoDepth(5, 5, 15)).toBeLessThan(isoDepth(5, 6, 0));
  });

  it("nextRotation cycles through the four cardinals both ways", () => {
    expect(nextRotation(0, 1)).toBe(90);
    expect(nextRotation(270, 1)).toBe(0);
    expect(nextRotation(0, -1)).toBe(270);
    expect(nextRotation(90, -1)).toBe(0);
  });
});
