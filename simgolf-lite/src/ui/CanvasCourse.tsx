import React, { useEffect, useMemo, useRef } from "react";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";
import type { ShotPlanStep } from "../game/sim/shots/solveShotsToGreen";
import type { CameraState } from "../game/render/camera";
import { screenToWorld as cameraScreenToWorld, applyCameraTransform } from "../game/render/camera";
import { getObstacleSprite, preloadObstacleSprites } from "../render/iconSprites";
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";
import { perfProfiler } from "../utils/performanceProfiler";

// Feature flag: Enable/disable hover-based distance preview (performance optimization)
// When disabled, no hover tracking or preview rendering occurs for marker placement
const ENABLE_HOVER_DISTANCE_PREVIEW = false;

const COLORS: Record<Terrain, string> = {
  fairway: "#4fa64f",
  rough: "#2f7a36",
  deep_rough: "#1f5f2c",
  sand: "#d7c48a",
  water: "#2b7bbb",
  green: "#5dbb6a",
  tee: "#8b6b4f",
  path: "#8f8f8f",
};

function hash01(n: number) {
  // Deterministic hash → [0,1)
  let x = n | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 1_000_000) / 1_000_000;
}

function shadeHex(hex: string, amt: number) {
  // amt: -1..+1
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const k = amt >= 0 ? 1 + amt * 0.22 : 1 + amt * 0.35;
  return `rgb(${f(r * k)},${f(g * k)},${f(b * k)})`;
}

function rgbaHex(hex: string, alpha: number, shadeAmt = 0) {
  // shadeAmt: -1..+1, alpha: 0..1
  const c = hex.replace("#", "");
  const r0 = parseInt(c.slice(0, 2), 16);
  const g0 = parseInt(c.slice(2, 4), 16);
  const b0 = parseInt(c.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const k = shadeAmt >= 0 ? 1 + shadeAmt * 0.22 : 1 + shadeAmt * 0.35;
  return `rgba(${f(r0 * k)},${f(g0 * k)},${f(b0 * k)},${Math.max(0, Math.min(1, alpha))})`;
}

function drawTileTexture(
  ctx: CanvasRenderingContext2D,
  terrain: Terrain,
  x: number,
  y: number,
  size: number,
  noise: CanvasPattern | null,
  mow: CanvasPattern | null,
  seed: number
) {
  // Subtle per-tile variation
  const v = (hash01(seed) - 0.5) * 0.12;
  ctx.fillStyle = shadeHex(COLORS[terrain], v);
  ctx.fillRect(x, y, size, size);

  // Terrain-specific texture pass
  if (terrain === "water") {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    // simple wave highlights
    for (let i = 0; i < 2; i++) {
      const yy = y + (i + 1) * (size / 3) + (hash01(seed + i * 31) - 0.5) * 2;
      ctx.fillRect(x + 2, yy, size - 4, 1);
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (terrain === "sand") {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(120,80,20,0.25)";
    // speckles
    for (let i = 0; i < 8; i++) {
      const sx = x + hash01(seed + i * 11) * size;
      const sy = y + hash01(seed + i * 17) * size;
      ctx.fillRect(sx, sy, 1, 1);
    }
    // grain glaze (continuous pattern)
    if (noise) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = noise;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (terrain === "path") {
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + size - 2);
    ctx.lineTo(x + size - 2, y + 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  // grass-like noise overlay
  if (noise) {
    const alpha =
      terrain === "green"
        ? 0.08
        : terrain === "fairway"
          ? 0.12
          : terrain === "rough"
            ? 0.16
            : terrain === "deep_rough"
              ? 0.2
              : terrain === "tee"
                ? 0.12
                : 0.12;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = noise;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 1;
  }

  // mowing banding for fairway (continuous diagonal pattern, very subtle)
  if (mow && terrain === "fairway") {
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = mow;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 1;
  }
  // greens: even more subtle
  if (mow && terrain === "green") {
    ctx.globalAlpha = 0.028;
    ctx.fillStyle = mow;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 1;
  }
}

function drawSoftEdges(
  ctx: CanvasRenderingContext2D,
  course: Course,
  x: number,
  y: number,
  size: number,
  terrain: Terrain
) {
  // Blend with neighbors by painting thin alpha gradients along shared borders.
  // Keep it cheap: no autotiling, just border gradients for prioritized pairs.
  const t = Math.max(1, Math.min(8, Math.floor(size * 0.24)));
  const w = course.width;
  const h = course.height;
  const ix = x / size;
  const iy = y / size;
  const at = (dx: number, dy: number): Terrain | null => {
    const nx = ix + dx;
    const ny = iy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return null;
    return course.tiles[ny * w + nx];
  };

  const n = at(0, -1);
  const s = at(0, 1);
  const e = at(1, 0);
  const wv = at(-1, 0);

  const isGrass = (t: Terrain) => t === "fairway" || t === "rough" || t === "deep_rough" || t === "green";
  const basePairAlpha = (a: Terrain, b: Terrain) => {
    // Prioritize: fairway↔rough, green↔fairway/rough, sand↔grass, water↔grass.
    if (a === b) return 0;
    if (isGrass(a) && isGrass(b)) {
      const aGrass = a;
      const bGrass = b;
      if (
        (aGrass === "fairway" && (bGrass === "rough" || bGrass === "deep_rough")) ||
        (bGrass === "fairway" && (aGrass === "rough" || aGrass === "deep_rough"))
      )
        return 0.10;
      if (
        (aGrass === "green" && (bGrass === "fairway" || bGrass === "rough" || bGrass === "deep_rough")) ||
        (bGrass === "green" && (aGrass === "fairway" || aGrass === "rough" || aGrass === "deep_rough"))
      )
        return 0.12;
      // other grass transitions: very subtle
      return 0.06;
    }
    if ((a === "sand" && isGrass(b)) || (b === "sand" && isGrass(a))) return 0.12;
    if ((a === "water" && isGrass(b)) || (b === "water" && isGrass(a))) return 0.12;
    // other transitions: skip (avoid smearing tees/paths)
    return 0;
  };

  const drawBorderGradient = (
    neighbor: Terrain,
    side: "N" | "S" | "E" | "W"
  ) => {
    const a = basePairAlpha(terrain, neighbor);
    if (a <= 0) return;
    ctx.save();
    let g: CanvasGradient;
    const c0 = rgbaHex(COLORS[neighbor], a, -0.03);
    const c1 = rgbaHex(COLORS[neighbor], 0, -0.03);
    if (side === "N") {
      g = ctx.createLinearGradient(0, y, 0, y + t);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, t);
    } else if (side === "S") {
      g = ctx.createLinearGradient(0, y + size - t, 0, y + size);
      g.addColorStop(0, c1);
      g.addColorStop(1, c0);
      ctx.fillStyle = g;
      ctx.fillRect(x, y + size - t, size, t);
    } else if (side === "W") {
      g = ctx.createLinearGradient(x, 0, x + t, 0);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, t, size);
    } else {
      g = ctx.createLinearGradient(x + size - t, 0, x + size, 0);
      g.addColorStop(0, c1);
      g.addColorStop(1, c0);
      ctx.fillStyle = g;
      ctx.fillRect(x + size - t, y, t, size);
    }
    ctx.restore();
  };

  const drawWaterShore = (neighbor: Terrain, side: "N" | "S" | "E" | "W") => {
    if (terrain !== "water") return;
    if (neighbor === "water") return;
    // Only shore against land-ish tiles (avoid weird shore against path/tee).
    if (!(isGrass(neighbor) || neighbor === "sand")) return;
    ctx.save();
    const a = 0.16; // shoreline darkening intensity
    let g: CanvasGradient;
    if (side === "N") {
      g = ctx.createLinearGradient(0, y, 0, y + t);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, t);
    } else if (side === "S") {
      g = ctx.createLinearGradient(0, y + size - t, 0, y + size);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y + size - t, size, t);
    } else if (side === "W") {
      g = ctx.createLinearGradient(x, 0, x + t, 0);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, t, size);
    } else {
      g = ctx.createLinearGradient(x + size - t, 0, x + size, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(x + size - t, y, t, size);
    }
    ctx.restore();
  };

  if (n && n !== terrain) {
    drawBorderGradient(n, "N");
    drawWaterShore(n, "N");
  }
  if (s && s !== terrain) {
    drawBorderGradient(s, "S");
    drawWaterShore(s, "S");
  }
  if (wv && wv !== terrain) {
    drawBorderGradient(wv, "W");
    drawWaterShore(wv, "W");
  }
  if (e && e !== terrain) {
    drawBorderGradient(e, "E");
    drawWaterShore(e, "E");
  }
}

// Helper for infinite canvas: draw soft edges for a single tile
function drawSoftEdgesForTile(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  size: number,
  terrain: Terrain,
  getTerrainAt: (x: number, y: number) => Terrain
) {
  const t = Math.max(1, Math.min(8, Math.floor(size * 0.24)));
  const x = tx * size;
  const y = ty * size;

  const n = getTerrainAt(tx, ty - 1);
  const s = getTerrainAt(tx, ty + 1);
  const e = getTerrainAt(tx + 1, ty);
  const wv = getTerrainAt(tx - 1, ty);

  const isGrass = (t: Terrain) => t === "fairway" || t === "rough" || t === "deep_rough" || t === "green";
  const basePairAlpha = (a: Terrain, b: Terrain) => {
    if (a === b) return 0;
    if (isGrass(a) && isGrass(b)) {
      const aGrass = a;
      const bGrass = b;
      if (
        (aGrass === "fairway" && (bGrass === "rough" || bGrass === "deep_rough")) ||
        (bGrass === "fairway" && (aGrass === "rough" || aGrass === "deep_rough"))
      )
        return 0.10;
      if (
        (aGrass === "green" && (bGrass === "fairway" || bGrass === "rough" || bGrass === "deep_rough")) ||
        (bGrass === "green" && (aGrass === "fairway" || aGrass === "rough" || aGrass === "deep_rough"))
      )
        return 0.12;
      return 0.06;
    }
    if ((a === "sand" && isGrass(b)) || (b === "sand" && isGrass(a))) return 0.12;
    if ((a === "water" && isGrass(b)) || (b === "water" && isGrass(a))) return 0.12;
    return 0;
  };

  const drawBorderGradient = (neighbor: Terrain, side: "N" | "S" | "E" | "W") => {
    const a = basePairAlpha(terrain, neighbor);
    if (a <= 0) return;
    ctx.save();
    let g: CanvasGradient;
    const c0 = rgbaHex(COLORS[neighbor], a, -0.03);
    const c1 = rgbaHex(COLORS[neighbor], 0, -0.03);
    if (side === "N") {
      g = ctx.createLinearGradient(0, y, 0, y + t);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, t);
    } else if (side === "S") {
      g = ctx.createLinearGradient(0, y + size - t, 0, y + size);
      g.addColorStop(0, c1);
      g.addColorStop(1, c0);
      ctx.fillStyle = g;
      ctx.fillRect(x, y + size - t, size, t);
    } else if (side === "W") {
      g = ctx.createLinearGradient(x, 0, x + t, 0);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, t, size);
    } else {
      g = ctx.createLinearGradient(x + size - t, 0, x + size, 0);
      g.addColorStop(0, c1);
      g.addColorStop(1, c0);
      ctx.fillStyle = g;
      ctx.fillRect(x + size - t, y, t, size);
    }
    ctx.restore();
  };

  if (n && n !== terrain) drawBorderGradient(n, "N");
  if (s && s !== terrain) drawBorderGradient(s, "S");
  if (wv && wv !== terrain) drawBorderGradient(wv, "W");
  if (e && e !== terrain) drawBorderGradient(e, "E");
}

// Helper for infinite canvas: draw green treatment for a single tile
function drawGreenForTile(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  size: number,
  getTerrainAt: (x: number, y: number) => Terrain
) {
  const x = tx * size;
  const y = ty * size;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const T = size;
  const collarColor = "rgba(140, 255, 160, 0.10)";
  const ringW = Math.max(1, Math.min(6, Math.floor(T * 0.18)));

  const isGrassNoGreen = (t: Terrain) =>
    t === "fairway" || t === "rough" || t === "deep_rough";

  // Radial gradient
  ctx.save();
  const rg = ctx.createRadialGradient(cx, cy, Math.max(1, T * 0.12), cx, cy, T * 0.62);
  rg.addColorStop(0, "rgba(255,255,255,0.18)");
  rg.addColorStop(0.55, "rgba(255,255,255,0.04)");
  rg.addColorStop(1, "rgba(0,0,0,0.06)");
  ctx.fillStyle = rg;
  ctx.fillRect(x, y, T, T);
  ctx.restore();

  // Inner ring
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = ringW;
  ctx.strokeRect(x + ringW / 2, y + ringW / 2, T - ringW, T - ringW);
  ctx.restore();

  // Collar/fringe on adjacent grass tiles
  const drawCollar = (nx: number, ny: number, side: "N" | "S" | "E" | "W") => {
    const nt = getTerrainAt(nx, ny);
    if (!nt || !isGrassNoGreen(nt)) return;
    const npx = nx * T;
    const npy = ny * T;
    const t = Math.max(1, Math.min(8, Math.floor(T * 0.22)));
    ctx.save();
    let g: CanvasGradient;
    if (side === "N") {
      g = ctx.createLinearGradient(0, npy, 0, npy + t);
      g.addColorStop(0, collarColor);
      g.addColorStop(1, "rgba(140, 255, 160, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(npx, npy, T, t);
    } else if (side === "S") {
      g = ctx.createLinearGradient(0, npy + T - t, 0, npy + T);
      g.addColorStop(0, "rgba(140, 255, 160, 0)");
      g.addColorStop(1, collarColor);
      ctx.fillStyle = g;
      ctx.fillRect(npx, npy + T - t, T, t);
    } else if (side === "W") {
      g = ctx.createLinearGradient(npx, 0, npx + t, 0);
      g.addColorStop(0, collarColor);
      g.addColorStop(1, "rgba(140, 255, 160, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(npx, npy, t, T);
    } else {
      g = ctx.createLinearGradient(npx + T - t, 0, npx + T, 0);
      g.addColorStop(0, "rgba(140, 255, 160, 0)");
      g.addColorStop(1, collarColor);
      ctx.fillStyle = g;
      ctx.fillRect(npx + T - t, npy, t, T);
    }
    ctx.restore();
  };

  if (getTerrainAt(tx, ty - 1) !== "green") drawCollar(tx, ty - 1, "S");
  if (getTerrainAt(tx, ty + 1) !== "green") drawCollar(tx, ty + 1, "N");
  if (getTerrainAt(tx - 1, ty) !== "green") drawCollar(tx - 1, ty, "E");
  if (getTerrainAt(tx + 1, ty) !== "green") drawCollar(tx + 1, ty, "W");
}

function drawLightingEdges(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  // Simple top-left light source: highlight TL edges, shade BR edges.
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + size - 0.5);
  ctx.lineTo(x + 0.5, y + 0.5);
  ctx.lineTo(x + size - 0.5, y + 0.5);
  ctx.stroke();

  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + size - 0.5);
  ctx.lineTo(x + size - 0.5, y + size - 0.5);
  ctx.lineTo(x + size - 0.5, y + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawDirectionalLight(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Very subtle whole-canvas light gradient (top-left bright, bottom-right darker).
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "rgba(255,255,255,0.06)");
  g.addColorStop(0.55, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.08)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawGreenTargetTreatment(
  ctx: CanvasRenderingContext2D,
  course: Course,
  tileSize: number
) {
  // Adds: subtle radial gradient on greens + 1-tile collar/fringe around greens.
  const w = course.width;
  const h = course.height;
  const T = tileSize;
  const collarColor = "rgba(140, 255, 160, 0.10)";
  const collarDark = "rgba(0,0,0,0.06)";
  const ringAlpha = 0.08;
  const ringW = Math.max(1, Math.min(6, Math.floor(T * 0.18)));

  const isGrassNoGreen = (t: Terrain) =>
    t === "fairway" || t === "rough" || t === "deep_rough";

  const at = (x: number, y: number): Terrain | null => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return course.tiles[y * w + x];
  };

  const drawCollarOnNeighbor = (nx: number, ny: number, side: "N" | "S" | "E" | "W") => {
    const nt = at(nx, ny);
    if (!nt || !isGrassNoGreen(nt)) return;
    const px = nx * T;
    const py = ny * T;
    const t = Math.max(1, Math.min(8, Math.floor(T * 0.22)));
    ctx.save();
    let g: CanvasGradient;
    if (side === "N") {
      g = ctx.createLinearGradient(0, py, 0, py + t);
      g.addColorStop(0, collarColor);
      g.addColorStop(1, "rgba(140, 255, 160, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(px, py, T, t);
    } else if (side === "S") {
      g = ctx.createLinearGradient(0, py + T - t, 0, py + T);
      g.addColorStop(0, "rgba(140, 255, 160, 0)");
      g.addColorStop(1, collarColor);
      ctx.fillStyle = g;
      ctx.fillRect(px, py + T - t, T, t);
    } else if (side === "W") {
      g = ctx.createLinearGradient(px, 0, px + t, 0);
      g.addColorStop(0, collarColor);
      g.addColorStop(1, "rgba(140, 255, 160, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(px, py, t, T);
    } else {
      g = ctx.createLinearGradient(px + T - t, 0, px + T, 0);
      g.addColorStop(0, "rgba(140, 255, 160, 0)");
      g.addColorStop(1, collarColor);
      ctx.fillStyle = g;
      ctx.fillRect(px + T - t, py, t, T);
    }
    // tiny dark rim for separation
    ctx.globalAlpha = 1;
    ctx.fillStyle = collarDark;
    if (side === "N") ctx.fillRect(px, py, T, 1);
    if (side === "S") ctx.fillRect(px, py + T - 1, T, 1);
    if (side === "W") ctx.fillRect(px, py, 1, T);
    if (side === "E") ctx.fillRect(px + T - 1, py, 1, T);
    ctx.restore();
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (course.tiles[i] !== "green") continue;
      const px = x * T;
      const py = y * T;
      const cx = px + T / 2;
      const cy = py + T / 2;

      // Radial gradient "target" look
      ctx.save();
      const rg = ctx.createRadialGradient(cx, cy, Math.max(1, T * 0.12), cx, cy, T * 0.62);
      rg.addColorStop(0, "rgba(255,255,255,0.18)");
      rg.addColorStop(0.55, "rgba(255,255,255,0.04)");
      rg.addColorStop(1, "rgba(0,0,0,0.06)");
      ctx.fillStyle = rg;
      ctx.fillRect(px, py, T, T);
      ctx.restore();

      // Inner ring near edges (helps greens read as a “target”)
      ctx.save();
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = ringW;
      ctx.strokeRect(px + ringW / 2, py + ringW / 2, T - ringW, T - ringW);
      ctx.restore();

      // Collar/fringe on adjacent grass tiles
      const n = at(x, y - 1);
      const s = at(x, y + 1);
      const wv = at(x - 1, y);
      const e = at(x + 1, y);
      if (n && n !== "green") drawCollarOnNeighbor(x, y - 1, "S");
      if (s && s !== "green") drawCollarOnNeighbor(x, y + 1, "N");
      if (wv && wv !== "green") drawCollarOnNeighbor(x - 1, y, "E");
      if (e && e !== "green") drawCollarOnNeighbor(x + 1, y, "W");
    }
  }
}

export function CanvasCourse(props: {
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  activePath?: Point[];
  activeShotPlan?: ShotPlanStep[];
  tileSize: number;
  showGridOverlays: boolean;
  animationsEnabled: boolean;
  flyoverNonce: number;
  showShotPlan: boolean;
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
  wizardStep: "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
  draftTee: Point | null;
  draftGreen: Point | null;
  onClickTile: (x: number, y: number) => void;
  selectedTerrain?: Terrain; // For cursor calculation
  worldCash?: number; // For cursor calculation
  flagColor?: string;
  cameraState?: CameraState | null; // Optional hole edit mode camera
  showFixOverlay?: boolean; // Show corridor/layup zone overlays
  failingCorridorSegments?: Point[]; // Failing corridor segments for overlay
  onCameraUpdate?: (camera: CameraState) => void; // Callback to update hole edit camera
  showObstacles?: boolean; // Show/hide obstacles layer (default true)
}) {
  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    activePath,
    activeShotPlan,
    tileSize,
    showGridOverlays,
    animationsEnabled,
    flyoverNonce,
    showShotPlan,
    editorMode,
    wizardStep,
    draftTee,
    draftGreen,
    onClickTile,
    selectedTerrain,
    worldCash,
    flagColor,
    cameraState,
    showFixOverlay: _showFixOverlay = false,
    failingCorridorSegments = [],
    onCameraUpdate,
    showObstacles = true,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastHoverIdxRef = useRef<number | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverTileRef = useRef<{ idx: number; x: number; y: number; clientX: number; clientY: number } | null>(null);
  
  // Hover state refs (no React state to avoid high-frequency renders)
  const hoverWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  const isHoveringRef = useRef(false);
  const previewDistanceRef = useRef<number | null>(null);
  
  // Dirty flags for rendering optimization
  const overlayDirtyRef = useRef(false);
  const courseDirtyRef = useRef(false);
  const terrainDirtyRef = useRef(false);
  
  // Single animation loop refs
  const rafRef = useRef<number | null>(null);
  const renderRef = useRef<null | ((t: number) => void)>(null);
  const isVisibleRef = useRef(true);
  const camRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const camAnimRef = useRef<null | { from: { panX: number; panY: number; zoom: number }; to: { panX: number; panY: number; zoom: number }; t0: number; dur: number }>(null);
  const flyoverRef = useRef<null | { from: { panX: number; panY: number; zoom: number }; to: { panX: number; panY: number; zoom: number }; t0: number; dur: number }>(null);
  const panStateRef = useRef<null | { startX: number; startY: number; startPanX: number; startPanY: number; active: boolean; panIntent: boolean; moved: boolean; downTile: { x: number; y: number } | null }>(null);
  const lastFocusKeyRef = useRef<string>("");
  
  // Instrumentation refs
  const renderCountRef = useRef(0);
  const pointerMoveCountRef = useRef(0);
  const lastInstrumentationTimeRef = useRef(performance.now());
  const ambientRef = useRef<{
    nextBirdAt: number;
    birdSeq: number;
    birds: Array<{
      id: number;
      t0: number;
      dur: number;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      scale: number;
      phase: number;
    }>;
    cart: null | {
      t0: number;
      dur: number;
      pathPx: Array<{ x: number; y: number }>;
    };
  }>({ nextBirdAt: 0, birdSeq: 1, birds: [], cart: null });

  // Cache for loaded obstacle sprites (by type and size)
  const obstacleSpriteCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const TILE = tileSize;
  const wPx = course.width * TILE;
  const hPx = course.height * TILE;
  
  // Helper function to get terrain at any coordinate (infinite canvas support)
  const getTerrainAt = (x: number, y: number): Terrain => {
    if (x >= 0 && y >= 0 && x < course.width && y < course.height) {
      return course.tiles[y * course.width + x];
    }
    // Outside bounds = rough terrain
    return "rough";
  };

  // Preload obstacle sprites when tileSize changes
  // DISABLED: SVG sprite loading causes severe performance issues
  // useEffect(() => {
  //   const spriteSize = Math.round(TILE * 1.1);
  //   // Preload common sizes around current tileSize (for zoom scenarios)
  //   const sizesToPreload = [spriteSize, Math.round(spriteSize * 0.8), Math.round(spriteSize * 1.2)];
  //   preloadObstacleSprites(sizesToPreload).catch((err) => {
  //     console.warn("Failed to preload obstacle sprites:", err);
  //   });
  // }, [TILE]);

  const imageData = useMemo(() => {
    return course.tiles.map((t) => COLORS[t]);
  }, [course.tiles]);

  const noisePattern = useMemo(() => {
    const c = document.createElement("canvas");
    const s = 48;
    c.width = s;
    c.height = s;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(110 + 60 * hash01(i * 13));
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return ctx.createPattern(c, "repeat");
  }, []);

  const mowPattern = useMemo(() => {
    const c = document.createElement("canvas");
    const s = 64;
    c.width = s;
    c.height = s;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, s, s);
    // diagonal banding
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    for (let i = -s; i < s * 2; i += 10) {
      ctx.beginPath();
      ctx.moveTo(i, s);
      ctx.lineTo(i + s, 0);
      ctx.stroke();
    }
    return ctx.createPattern(c, "repeat");
  }, []);

  const waterTiles = useMemo(() => {
    const pts: Array<{ x: number; y: number; seed: number }> = [];
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const i = y * course.width + x;
        if (course.tiles[i] === "water") pts.push({ x, y, seed: i * 17 + 3 });
      }
    }
    return pts;
  }, [course.tiles, course.width, course.height]);

  const obstaclePhases = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of obstacles) {
      const k = `${o.x},${o.y}`;
      m.set(k, hash01(o.x * 1337 + o.y * 733 + (o.type === "tree" ? 7 : 11)) * Math.PI * 2);
    }
    return m;
  }, [obstacles]);

  const flagPhases = useMemo(() => {
    // deterministic per-hole phase so flags don't all flutter in sync
    return holes.map((_, i) => hash01(991 + i * 101) * Math.PI * 2);
  }, [holes]);

  useEffect(() => {
    const onVis = () => {
      isVisibleRef.current = document.visibilityState === "visible";
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function randRange(seed: number, a: number, b: number) {
    return a + (b - a) * hash01(seed);
  }

  function clampCamera(cam: { panX: number; panY: number; zoom: number }) {
    const z = cam.zoom;
    const sw = wPx;
    const sh = hPx;
    const worldW = wPx;
    const worldH = hPx;
    const scaledW = worldW * z;
    const scaledH = worldH * z;

    // If scaled world is smaller than viewport, center it.
    let minX: number;
    let maxX: number;
    if (scaledW <= sw) {
      minX = maxX = (sw - scaledW) / 2;
    } else {
      minX = sw - scaledW;
      maxX = 0;
    }

    let minY: number;
    let maxY: number;
    if (scaledH <= sh) {
      minY = maxY = (sh - scaledH) / 2;
    } else {
      minY = sh - scaledH;
      maxY = 0;
    }

    cam.panX = Math.max(minX, Math.min(maxX, cam.panX));
    cam.panY = Math.max(minY, Math.min(maxY, cam.panY));
    return cam;
  }

  function cameraSetTransform(ctx: CanvasRenderingContext2D) {
    if (cameraState && cameraState.mode === "hole") {
      // Use hole edit mode camera with rotation
      applyCameraTransform(ctx, cameraState, tileSize, wPx, hPx);
    } else {
      // Use default pan/zoom camera
      const cam = camRef.current;
      ctx.setTransform(cam.zoom, 0, 0, cam.zoom, cam.panX, cam.panY);
    }
  }

  function screenToWorldPx(clientX: number, clientY: number) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    if (cameraState && cameraState.mode === "hole") {
      // Use hole edit mode camera transform (includes rotation)
      // cameraScreenToWorld returns tile coordinates, convert to pixel coordinates
      const screenPoint = { x: sx, y: sy };
      const worldPoint = cameraScreenToWorld(screenPoint, cameraState, tileSize, wPx, hPx);
      return { x: worldPoint.x * tileSize, y: worldPoint.y * tileSize };
    } else {
      // Use default pan/zoom camera
      const cam = camRef.current;
      return { x: (sx - cam.panX) / cam.zoom, y: (sy - cam.panY) / cam.zoom };
    }
  }

  function startCameraAnim(to: { panX: number; panY: number; zoom: number }, dur = 650) {
    const from = { ...camRef.current };
    camAnimRef.current = { from, to: clampCamera({ ...to }), t0: performance.now(), dur };
  }

  function focusOnPoints(points: Array<{ x: number; y: number }>) {
    if (points.length === 0) return;
    const sw = wPx;
    const sh = hPx;
    const minZoom = 0.6;
    const maxZoom = 3.0;

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const pad = Math.max(TILE * 3, 28);
    const z = Math.max(minZoom, Math.min(maxZoom, Math.min(sw / (bboxW + pad * 2), sh / (bboxH + pad * 2))));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const panX = sw / 2 - cx * z;
    const panY = sh / 2 - cy * z;
    startCameraAnim({ panX, panY, zoom: z }, 700);
  }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const ctx2: CanvasRenderingContext2D = ctx;

    perfProfiler.measure('CanvasCourse.buildBaseCanvas', () => {

      // Build static terrain buffer (expensive work done only when course/size changes)
      const base = document.createElement("canvas");
      base.width = wPx;
      base.height = hPx;
      const bctx = base.getContext("2d");
      if (!bctx) return;

      // Pass 1: textured tiles + per-tile micro-lighting
      perfProfiler.measure('buildBaseCanvas.pass1_tiles', () => {
        for (let ty = 0; ty < course.height; ty++) {
          for (let tx = 0; tx < course.width; tx++) {
            const i = ty * course.width + tx;
            const terrain = course.tiles[i];
            const x = tx * TILE;
            const y = ty * TILE;
            drawTileTexture(
              bctx,
              terrain,
              x,
              y,
              TILE,
              noisePattern,
              mowPattern,
              i + course.width * 1000
            );
            drawLightingEdges(bctx, x, y, TILE);
          }
        }
      });

      // Pass 2: soft edge blending
      perfProfiler.measure('buildBaseCanvas.pass2_edges', () => {
        for (let ty = 0; ty < course.height; ty++) {
          for (let tx = 0; tx < course.width; tx++) {
            const i = ty * course.width + tx;
            const terrain = course.tiles[i];
            drawSoftEdges(bctx, course, tx * TILE, ty * TILE, TILE, terrain);
          }
        }
      });

      // Pass 2.5: greens read as intentional targets (fringe/collar + subtle radial gradient)
      perfProfiler.measure('buildBaseCanvas.pass2.5_greens', () => {
        drawGreenTargetTreatment(bctx, course, TILE);
      });

      // Pass 3: global light + tiny "glaze" noise to reduce checkerboard feel
      perfProfiler.measure('buildBaseCanvas.pass3_lighting', () => {
        drawDirectionalLight(bctx, wPx, hPx);
        if (noisePattern) {
          bctx.globalAlpha = 0.04;
          bctx.fillStyle = noisePattern;
          bctx.fillRect(0, 0, wPx, hPx);
          bctx.globalAlpha = 1;
        }
      });

      baseCanvasRef.current = base;
      // Mark terrain as clean after base canvas is built
      terrainDirtyRef.current = false;
      courseDirtyRef.current = false;
    });

    function drawObstacle(o: Obstacle, timeMs: number) {
      const cx0 = o.x * TILE + TILE / 2;
      const cy0 = o.y * TILE + TILE / 2;
      const phase = obstaclePhases.get(`${o.x},${o.y}`) ?? 0;
      const t = timeMs * 0.001;
      const amp = Math.max(0.3, TILE * 0.06);
      const sway = animationsEnabled && o.type !== "rock" ? Math.sin(t * 0.6 + phase) * amp : 0;
      
      // Add deterministic jitter for organic look (based on position + type)
      const jitterSeed = o.x * 1337 + o.y * 733 + (o.type === "tree" ? 7 : o.type === "bush" ? 11 : 13);
      const jitterScale = 0.92 + (hash01(jitterSeed) * 0.14); // 0.92 to 1.06
      const jitterRotation = (hash01(jitterSeed + 1000) - 0.5) * 12; // -6° to +6°
      
      const cx = cx0 + sway;
      const cy = cy0;

      // Try to use SVG sprite icon
      const spriteSize = Math.round(TILE * 1.1); // 10% padding
      const spriteKey = `${o.type}-${spriteSize}`;
      let sprite = obstacleSpriteCacheRef.current.get(spriteKey);
      
      // Check if sprite is available (already loaded)
      if (sprite) {
        // Draw sprite with subtle shadow, jitter, and 10% padding
        ctx2.save();
        ctx2.globalAlpha = 0.95;
        
        // Apply jitter: translate to center, rotate, scale, then translate back
        ctx2.translate(cx, cy);
        ctx2.rotate((jitterRotation * Math.PI) / 180);
        ctx2.scale(jitterScale, jitterScale);
        ctx2.translate(-cx, -cy);
        
        // Subtle shadow
        ctx2.shadowColor = "rgba(0, 0, 0, 0.25)";
        ctx2.shadowBlur = 2;
        ctx2.shadowOffsetX = 1;
        ctx2.shadowOffsetY = 1;
        
        const drawWidth = TILE * 1.1;
        const drawHeight = TILE * 1.1;
        const drawX = cx - drawWidth / 2;
        const drawY = cy - drawHeight / 2;
        
        ctx2.drawImage(sprite, drawX, drawY, drawWidth, drawHeight);
        
        ctx2.restore();
        return;
      }

      // Fallback: try to get sprite (may be loading)
      const spriteOrPromise = getObstacleSprite(o.type, spriteSize);
      if (spriteOrPromise instanceof HTMLImageElement) {
        // Just loaded, cache it
        obstacleSpriteCacheRef.current.set(spriteKey, spriteOrPromise);
        sprite = spriteOrPromise;
        
        ctx2.save();
        ctx2.globalAlpha = 0.95;
        
        // Apply jitter: translate to center, rotate, scale, then translate back
        ctx2.translate(cx, cy);
        ctx2.rotate((jitterRotation * Math.PI) / 180);
        ctx2.scale(jitterScale, jitterScale);
        ctx2.translate(-cx, -cy);
        
        ctx2.shadowColor = "rgba(0, 0, 0, 0.25)";
        ctx2.shadowBlur = 2;
        ctx2.shadowOffsetX = 1;
        ctx2.shadowOffsetY = 1;
        
        const drawWidth = TILE * 1.1;
        const drawHeight = TILE * 1.1;
        const drawX = cx - drawWidth / 2;
        const drawY = cy - drawHeight / 2;
        
        ctx2.drawImage(sprite, drawX, drawY, drawWidth, drawHeight);
        ctx2.restore();
        return;
      }

      if (spriteOrPromise instanceof Promise) {
        // Sprite is loading, cache the promise and draw fallback for now
        spriteOrPromise
          .then((loadedSprite) => {
            obstacleSpriteCacheRef.current.set(spriteKey, loadedSprite);
            // Trigger re-render by calling render function
            if (renderRef.current) {
              renderRef.current(performance.now());
            }
            // Also ensure animation loop continues
            if (rafRef.current === null && animationsEnabled && renderRef.current) {
              rafRef.current = requestAnimationFrame(renderRef.current);
            }
          })
          .catch((err) => {
            console.warn(`Failed to load obstacle sprite for ${o.type}:`, err);
          });
      }

      // Fallback: draw primitive placeholder while sprite loads (with jitter)
      ctx2.save();
      // Apply jitter: translate to center, rotate, scale, then translate back
      ctx2.translate(cx, cy);
      ctx2.rotate((jitterRotation * Math.PI) / 180);
      ctx2.scale(jitterScale, jitterScale);
      ctx2.translate(-cx, -cy);
      
      if (o.type === "tree") {
        // canopy
        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = "#14532d";
        ctx2.strokeStyle = "rgba(0,0,0,0.45)";
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.arc(cx, cy - TILE * 0.08, Math.max(3, TILE * 0.28), 0, Math.PI * 2);
        ctx2.fill();
        ctx2.stroke();
        // trunk
        ctx2.fillStyle = "#7c4a03";
        ctx2.globalAlpha = 0.95;
        const tw = Math.max(2, TILE * 0.12);
        const th = Math.max(3, TILE * 0.22);
        ctx2.fillRect(cx - tw / 2, cy + TILE * 0.12, tw, th);
      } else if (o.type === "bush") {
        // bush
        ctx2.globalAlpha = 0.9;
        ctx2.fillStyle = "#166534";
        ctx2.strokeStyle = "rgba(0,0,0,0.35)";
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.arc(cx, cy, Math.max(3, TILE * 0.24), 0, Math.PI * 2);
        ctx2.fill();
        ctx2.stroke();
      } else {
        // rock
        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = "#a09f93";
        ctx2.strokeStyle = "rgba(0,0,0,0.35)";
        ctx2.lineWidth = 2;
        const rw = Math.max(6, TILE * 0.46);
        const rh = Math.max(5, TILE * 0.34);
        ctx2.beginPath();
        ctx2.ellipse(cx, cy + TILE * 0.05, rw, rh, 0, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.stroke();
        // highlight
        ctx2.globalAlpha = 0.35;
        ctx2.fillStyle = "#d9d8cc";
        ctx2.beginPath();
        ctx2.ellipse(cx - rw * 0.25, cy - rh * 0.25, rw * 0.35, rh * 0.28, 0, 0, Math.PI * 2);
        ctx2.fill();
      }
      ctx2.restore(); // Restore jitter transform
      ctx2.globalAlpha = 1;
    }

    function drawShimmer(timeMs: number) {
      if (!animationsEnabled || waterTiles.length === 0) return;
      const t = timeMs * 0.00012; // slow drift
      ctx2.save();
      for (const w of waterTiles) {
        const x = w.x * TILE;
        const y = w.y * TILE;
        const p = (hash01(w.seed) - 0.5) * 2;
        const s = 0.5 + 0.5 * Math.sin(t + w.x * 0.35 + w.y * 0.22 + p);
        const alpha = 0.05 + 0.06 * s;
        ctx2.globalAlpha = alpha;
        // simple moving highlight band within the tile
        const bandY = y + ((t * 14 + w.x * 2 + w.y) % TILE);
        ctx2.fillStyle = "rgba(255,255,255,0.9)";
        ctx2.fillRect(x + 2, bandY, TILE - 4, 1);
        // faint full-tile glaze
        ctx2.globalAlpha = alpha * 0.6;
        ctx2.fillRect(x, y, TILE, TILE);
      }
      ctx2.restore();
      ctx2.globalAlpha = 1;
    }

    function drawAnalytics() {
      if (!showGridOverlays) return;
      // grid
      ctx2.globalAlpha = 0.18;
      ctx2.strokeStyle = "rgba(0,0,0,0.65)";
      for (let x = 0; x <= course.width; x++) {
        ctx2.beginPath();
        ctx2.moveTo(x * TILE, 0);
        ctx2.lineTo(x * TILE, hPx);
        ctx2.stroke();
      }
      for (let y = 0; y <= course.height; y++) {
        ctx2.beginPath();
        ctx2.moveTo(0, y * TILE);
        ctx2.lineTo(wPx, y * TILE);
        ctx2.stroke();
      }
      ctx2.globalAlpha = 1;

      // holes + path
      ctx2.lineWidth = 2;
      ctx2.font = `${Math.max(10, Math.floor(TILE * 0.55))}px system-ui, sans-serif`;
      holes.forEach((h, i) => {
        if (!h.tee || !h.green) return;
        const isActive = i === activeHoleIndex;

        if (isActive && activePath && activePath.length >= 2) {
          ctx2.globalAlpha = 0.85;
          ctx2.strokeStyle = "#facc15";
          ctx2.lineWidth = Math.max(1, TILE * 0.12);
          ctx2.beginPath();
          ctx2.moveTo(activePath[0].x * TILE + TILE / 2, activePath[0].y * TILE + TILE / 2);
          for (let k = 1; k < activePath.length; k++) {
            ctx2.lineTo(activePath[k].x * TILE + TILE / 2, activePath[k].y * TILE + TILE / 2);
          }
          ctx2.stroke();
          ctx2.globalAlpha = 1;
          ctx2.lineWidth = 2;
        }

        ctx2.globalAlpha = isActive ? 0.6 : 0.35;
        ctx2.strokeStyle = "#111";
        ctx2.beginPath();
        ctx2.moveTo(h.tee.x * TILE + TILE / 2, h.tee.y * TILE + TILE / 2);
        ctx2.lineTo(h.green.x * TILE + TILE / 2, h.green.y * TILE + TILE / 2);
        ctx2.stroke();

        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = isActive ? "#000" : "rgba(0,0,0,0.75)";
        ctx2.beginPath();
        ctx2.arc(
          h.tee.x * TILE + TILE / 2,
          h.tee.y * TILE + TILE / 2,
          Math.max(4, TILE * 0.35),
          0,
          Math.PI * 2
        );
        ctx2.fill();
        ctx2.fillStyle = "#fff";
        ctx2.fillText(
          String(i + 1),
          h.tee.x * TILE + TILE / 2 - 3,
          h.tee.y * TILE + TILE / 2 + 4
        );

        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = isActive ? "#1b5e20" : "rgba(27,94,32,0.78)";
        ctx2.beginPath();
        ctx2.arc(
          h.green.x * TILE + TILE / 2,
          h.green.y * TILE + TILE / 2,
          Math.max(4, TILE * 0.35),
          0,
          Math.PI * 2
        );
        ctx2.fill();
        ctx2.fillStyle = "#fff";
        ctx2.fillText(
          String(i + 1),
          h.green.x * TILE + TILE / 2 - 3,
          h.green.y * TILE + TILE / 2 + 4
        );
      });
      ctx2.globalAlpha = 1;
    }

    function drawShotPlanOverlay() {
      if (!showGridOverlays || !showShotPlan) return;
      if (!activeShotPlan || activeShotPlan.length === 0) return;

      ctx2.save();
      ctx2.globalAlpha = 0.9;
      ctx2.strokeStyle = "rgba(250,204,21,0.85)"; // amber
      ctx2.lineWidth = Math.max(1, TILE * 0.10);
      ctx2.fillStyle = "rgba(250,204,21,0.95)";
      ctx2.font = `${Math.max(10, Math.floor(TILE * 0.48))}px system-ui, sans-serif`;

      for (let i = 0; i < activeShotPlan.length; i++) {
        const s = activeShotPlan[i];
        const x0 = s.from.x * TILE + TILE / 2;
        const y0 = s.from.y * TILE + TILE / 2;
        const x1 = s.to.x * TILE + TILE / 2;
        const y1 = s.to.y * TILE + TILE / 2;
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const vx = x1 - x0;
        const vy = y1 - y0;
        const len = Math.max(1, Math.hypot(vx, vy));
        const nx = -vy / len;
        const ny = vx / len;
        const bend = Math.min(TILE * 1.0, len * 0.12);
        const cx = mx + nx * bend;
        const cy = my + ny * bend;

        ctx2.beginPath();
        ctx2.moveTo(x0, y0);
        ctx2.quadraticCurveTo(cx, cy, x1, y1);
        ctx2.stroke();

        // landing marker + step number
        ctx2.beginPath();
        ctx2.arc(x1, y1, Math.max(2, TILE * 0.16), 0, Math.PI * 2);
        ctx2.fill();
        ctx2.fillStyle = "#111";
        ctx2.fillText(String(i + 1), x1 + 3, y1 - 3);
        ctx2.fillStyle = "rgba(250,204,21,0.95)";
      }

      ctx2.restore();
    }

    /**
     * Calculate suggested par from distance in yards
     * Based on typical golf hole distances:
     * - Par 3: < 250 yards
     * - Par 4: 250-450 yards
     * - Par 5: > 450 yards
     */
    function getSuggestedPar(distanceYards: number): 3 | 4 | 5 {
      if (distanceYards < 250) return 3;
      if (distanceYards < 450) return 4;
      return 5;
    }

    /**
     * Calculate distance between two points in tiles and yards
     */
    function calculateDistance(from: Point, to: Point): { tiles: number; yards: number } {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const tiles = Math.sqrt(dx * dx + dy * dy);
      const yards = tiles * course.yardsPerTile;
      return { tiles, yards };
    }

    function drawDistancePreview() {
      // Feature flag: Disabled for performance
      if (!ENABLE_HOVER_DISTANCE_PREVIEW) return;
      
      // Only show in green or tee placement mode
      const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
      const isTeePlacement = wizardStep === "TEE" || wizardStep === "MOVE_TEE";
      
      if (!isGreenPlacement && !isTeePlacement) return;
      
      const hover = hoverTileRef.current;
      if (!hover) return;

      // For green placement: line from tee to hover
      // For tee placement: line from green to hover (if green exists)
      let fromPoint: Point | null = null;
      let previewMode: "green" | "tee" = "green";
      
      const hole = holes[activeHoleIndex];
      if (isGreenPlacement) {
        // Use tee from hole or draftTee
        fromPoint = hole?.tee || draftTee;
        previewMode = "green";
      } else if (isTeePlacement) {
        // Use green from hole or draftGreen
        fromPoint = hole?.green || draftGreen;
        previewMode = "tee";
      }
      
      if (!fromPoint) {
        // No reference point, can't show preview
        return;
      }

      // Check if hover is valid (within reasonable bounds for rendering)
      const hoverInBounds = hover.x >= -1 && hover.y >= -1 && hover.x <= course.width && hover.y <= course.height;
      
      // Check if hover is on water (invalid for green placement)
      const isWater = hoverInBounds && hover.x >= 0 && hover.y >= 0 && hover.x < course.width && hover.y < course.height && getTerrainAt(hover.x, hover.y) === "water";
      const isValid = !(isWater && previewMode === "green");

      // Convert world coordinates to screen (context already has transform applied)
      // We need to draw before transform reset, so use world coords
      const fromScreen = { x: fromPoint.x * TILE + TILE / 2, y: fromPoint.y * TILE + TILE / 2 };
      const toScreen = { x: hover.x * TILE + TILE / 2, y: hover.y * TILE + TILE / 2 };

      // Draw line (rubber-band style) - context already has camera transform
      ctx2.save();
      ctx2.strokeStyle = isValid ? "rgba(100, 150, 255, 0.6)" : "rgba(255, 100, 100, 0.6)";
      ctx2.lineWidth = 2;
      ctx2.setLineDash([4, 4]);
      ctx2.beginPath();
      ctx2.moveTo(fromScreen.x, fromScreen.y);
      ctx2.lineTo(toScreen.x, toScreen.y);
      ctx2.stroke();
      ctx2.setLineDash([]);
      
      // Draw circle at hover point
      ctx2.fillStyle = isValid ? "rgba(100, 150, 255, 0.8)" : "rgba(255, 100, 100, 0.8)";
      ctx2.strokeStyle = isValid ? "rgba(100, 150, 255, 1)" : "rgba(255, 100, 100, 1)";
      ctx2.lineWidth = 2;
      ctx2.beginPath();
      ctx2.arc(toScreen.x, toScreen.y, Math.max(4, TILE * 0.15), 0, Math.PI * 2);
      ctx2.fill();
      ctx2.stroke();
      
      ctx2.restore();
    }

    function drawDistancePreviewTooltip() {
      // Feature flag: Disabled for performance
      if (!ENABLE_HOVER_DISTANCE_PREVIEW) return;
      
      // Only show in green or tee placement mode
      const isGreenPlacement = wizardStep === "GREEN" || wizardStep === "MOVE_GREEN";
      const isTeePlacement = wizardStep === "TEE" || wizardStep === "MOVE_TEE";
      
      if (!isGreenPlacement && !isTeePlacement) return;
      
      const hover = hoverTileRef.current;
      if (!hover) return;

      // For green placement: line from tee to hover
      // For tee placement: line from green to hover (if green exists)
      let fromPoint: Point | null = null;
      let previewMode: "green" | "tee" = "green";
      
      const hole = holes[activeHoleIndex];
      if (isGreenPlacement) {
        fromPoint = hole?.tee || draftTee;
        previewMode = "green";
      } else if (isTeePlacement) {
        fromPoint = hole?.green || draftGreen;
        previewMode = "tee";
      }
      
      if (!fromPoint) {
        // No reference point, show hint
        const hintX = Math.max(12, Math.min(wPx - 200, hover.clientX));
        const hintY = Math.max(12, Math.min(hPx - 30, hover.clientY + 20));
        ctx2.save();
        ctx2.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx2.fillText("Place tee first to see distance", hintX, hintY);
        ctx2.restore();
        return;
      }

      // Check if hover is valid
      const hoverInBounds = hover.x >= -1 && hover.y >= -1 && hover.x <= course.width && hover.y <= course.height;
      if (!hoverInBounds) return;
      
      // Calculate distance
      const dist = calculateDistance(fromPoint, { x: hover.x, y: hover.y });
      const roundedYards = Math.round(dist.yards / 5) * 5; // Round to nearest 5 yards
      
      // Check if hover is on water (invalid for green placement)
      const isWater = hover.x >= 0 && hover.y >= 0 && hover.x < course.width && hover.y < course.height && getTerrainAt(hover.x, hover.y) === "water";
      const isValid = !(isWater && previewMode === "green");
      
      // Handle edge case: tee == hover
      if (dist.tiles < 0.1) {
        // Show 0 yards tooltip
        const tooltipText = "0 yds (0.0 tiles)";
        const tooltipX = Math.max(12, Math.min(wPx - 150, hover.clientX));
        const tooltipY = Math.max(12, Math.min(hPx - 30, hover.clientY + 20));
        
        ctx2.save();
        ctx2.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx2.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx2.lineWidth = 1;
        ctx2.font = "12px system-ui, sans-serif";
        ctx2.textAlign = "left";
        ctx2.textBaseline = "top";
        
        const padding = 6;
        const textWidth = ctx2.measureText(tooltipText).width;
        const tooltipWidth = textWidth + padding * 2;
        const tooltipHeight = 16 + padding * 2;
        
        ctx2.fillRect(tooltipX - padding, tooltipY - padding, tooltipWidth, tooltipHeight);
        ctx2.strokeRect(tooltipX - padding, tooltipY - padding, tooltipWidth, tooltipHeight);
        ctx2.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx2.fillText(tooltipText, tooltipX, tooltipY);
        ctx2.restore();
        return;
      }

      const suggestedPar = getSuggestedPar(roundedYards);
      const tooltipText = isValid 
        ? `${roundedYards} yds (${dist.tiles.toFixed(1)} tiles)\nPar ${suggestedPar}`
        : `${roundedYards} yds (${dist.tiles.toFixed(1)} tiles)\nInvalid (water)`;
      
      // Position tooltip near cursor, clamped to viewport
      // Use clientX/clientY from hover (already in screen coords)
      const tooltipPadding = 12;
      const tooltipX = Math.max(tooltipPadding, Math.min(wPx - 150, hover.clientX));
      const tooltipY = Math.max(tooltipPadding, Math.min(hPx - 60, hover.clientY + 20));
      
      ctx2.save();
      ctx2.fillStyle = "rgba(0, 0, 0, 0.85)";
      ctx2.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx2.lineWidth = 1;
      ctx2.font = "12px system-ui, sans-serif";
      ctx2.textAlign = "left";
      ctx2.textBaseline = "top";
      
      // Measure text
      const lines = tooltipText.split("\n");
      const lineHeight = 16;
      const padding = 6;
      const maxWidth = Math.max(...lines.map(l => ctx2.measureText(l).width));
      const tooltipWidth = maxWidth + padding * 2;
      const tooltipHeight = lines.length * lineHeight + padding * 2;
      
      // Draw background
      ctx2.fillRect(tooltipX - padding, tooltipY - padding, tooltipWidth, tooltipHeight);
      ctx2.strokeRect(tooltipX - padding, tooltipY - padding, tooltipWidth, tooltipHeight);
      
      // Draw text
      ctx2.fillStyle = isValid ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 200, 200, 0.95)";
      lines.forEach((line, i) => {
        ctx2.fillText(line, tooltipX, tooltipY + i * lineHeight);
      });
      
      ctx2.restore();
    }

    function drawPaintHoverTooltip() {
      // Show hover tooltip for paint mode
      if (editorMode !== "PAINT" || !selectedTerrain || worldCash === undefined) return;
      
      const hover = hoverTileRef.current;
      if (!hover || hover.idx < 0) return;
      
      const prev = course.tiles[hover.idx];
      const cost = computeTerrainChangeCost(prev, selectedTerrain);
      const canAfford = cost.net <= 0 || worldCash >= cost.net;
      
      // Build tooltip text
      const lines: string[] = [];
      if (cost.net > 0) {
        lines.push(`Cost: $${Math.ceil(cost.net).toLocaleString()}`);
        if (!canAfford) {
          lines.push("Insufficient funds");
        }
      } else if (cost.net < 0) {
        lines.push(`Refund: $${Math.ceil(-cost.net).toLocaleString()}`);
      }
      
      if (lines.length === 0) return;
      
      const tooltipText = lines.join("\n");
      const tooltipX = Math.max(12, Math.min(wPx - 150, hover.clientX));
      const tooltipY = Math.max(12, Math.min(hPx - 60, hover.clientY + 20));
      
      ctx2.save();
      ctx2.fillStyle = "rgba(0, 0, 0, 0.85)";
      ctx2.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx2.lineWidth = 1;
      ctx2.font = "12px system-ui, sans-serif";
      ctx2.textAlign = "left";
      ctx2.textBaseline = "top";
      
      const lineHeight = 16;
      const padding = 6;
      const textLines = tooltipText.split("\n");
      const maxWidth = Math.max(...textLines.map(l => ctx2.measureText(l).width));
      const tooltipWidth = maxWidth + padding * 2;
      const tooltipHeight = textLines.length * lineHeight + padding * 2;
      
      // Draw background
      ctx2.fillRect(tooltipX - padding, tooltipY - padding, tooltipWidth, tooltipHeight);
      ctx2.strokeRect(tooltipX - padding, tooltipY - padding, tooltipWidth, tooltipHeight);
      
      // Draw text
      ctx2.fillStyle = canAfford ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 200, 200, 0.95)";
      textLines.forEach((line, i) => {
        ctx2.fillText(line, tooltipX, tooltipY + i * lineHeight);
      });
      
      ctx2.restore();
    }

    function drawFixOverlay() {
      if (!_showFixOverlay || failingCorridorSegments.length === 0) return;

      ctx2.save();
      ctx2.globalAlpha = 0.4;
      ctx2.fillStyle = "rgba(255, 165, 0, 0.6)"; // Orange overlay for failing segments

      for (const p of failingCorridorSegments) {
        const x = p.x * TILE;
        const y = p.y * TILE;
        ctx2.fillRect(x, y, TILE, TILE);
      }

      ctx2.restore();
    }

    function drawWizard() {
      if (editorMode !== "HOLE_WIZARD") return;
      ctx2.font = `${Math.max(10, Math.floor(TILE * 0.55))}px system-ui, sans-serif`;
      ctx2.lineWidth = 3;
      
      // Draw black line connecting tee and green (through waypoints if any)
      if (draftTee && draftGreen) {
        const hole = holes[activeHoleIndex];
        const waypoints = hole?.waypoints || [];
        
        ctx2.globalAlpha = 0.9;
        ctx2.strokeStyle = "#000";
        ctx2.beginPath();
        ctx2.moveTo(draftTee.x * TILE + TILE / 2, draftTee.y * TILE + TILE / 2);
        
        // Draw through waypoints
        for (const wp of waypoints) {
          ctx2.lineTo(wp.x * TILE + TILE / 2, wp.y * TILE + TILE / 2);
        }
        
        // Draw to green
        ctx2.lineTo(draftGreen.x * TILE + TILE / 2, draftGreen.y * TILE + TILE / 2);
        ctx2.stroke();
        ctx2.globalAlpha = 1;
        
        // Draw waypoint markers
        for (const wp of waypoints) {
          ctx2.globalAlpha = 0.95;
          ctx2.fillStyle = "#666";
          ctx2.beginPath();
          ctx2.arc(wp.x * TILE + TILE / 2, wp.y * TILE + TILE / 2, Math.max(3, TILE * 0.25), 0, Math.PI * 2);
          ctx2.fill();
          ctx2.globalAlpha = 1;
        }
      }

      const holeNumber = String(activeHoleIndex + 1);
      const numberWidth = ctx2.measureText(holeNumber).width;

      if (draftTee) {
        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = "#000";
        ctx2.beginPath();
        ctx2.arc(draftTee.x * TILE + TILE / 2, draftTee.y * TILE + TILE / 2, Math.max(4, TILE * 0.35), 0, Math.PI * 2);
        ctx2.fill();
        ctx2.fillStyle = "#fff";
        ctx2.fillText(holeNumber, draftTee.x * TILE + TILE / 2 - numberWidth / 2, draftTee.y * TILE + TILE / 2 + 4);
        ctx2.globalAlpha = 1;
      }

      if (draftGreen) {
        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = "#1b5e20";
        ctx2.beginPath();
        ctx2.arc(
          draftGreen.x * TILE + TILE / 2,
          draftGreen.y * TILE + TILE / 2,
          Math.max(4, TILE * 0.35),
          0,
          Math.PI * 2
        );
        ctx2.fill();
        ctx2.fillStyle = "#fff";
        ctx2.fillText(
          holeNumber,
          draftGreen.x * TILE + TILE / 2 - numberWidth / 2,
          draftGreen.y * TILE + TILE / 2 + 4
        );
        ctx2.globalAlpha = 1;
      }

      if (showGridOverlays) {
        ctx2.globalAlpha = 0.85;
        ctx2.fillStyle = "rgba(0,0,0,0.9)";
        const hint =
          wizardStep === "TEE"
            ? `Hole ${activeHoleIndex + 1}: click to place tee`
            : wizardStep === "GREEN"
              ? `Hole ${activeHoleIndex + 1}: click to place green`
              : `Hole ${activeHoleIndex + 1}: confirm or redo`;
        ctx2.fillText(hint, 8, 16);
        ctx2.globalAlpha = 1;
      }
    }

    function drawFlags(timeMs: number) {
      // Flags should add charm in COZY mode; keep them readable at different tile sizes.
      const flutter = animationsEnabled && !showGridOverlays;
      const t = timeMs * 0.001;
      const poleH = Math.max(6, TILE * 0.75);
      const poleW = Math.max(1, Math.min(2.5, TILE * 0.08));
      const flagW = Math.max(6, Math.min(16, TILE * 0.55));
      const flagH = Math.max(4, Math.min(12, TILE * 0.35));
      const baseYOff = TILE * 0.18;

      for (let i = 0; i < holes.length; i++) {
        const g = holes[i]?.green;
        if (!g) continue;
        const cx = g.x * TILE + TILE / 2;
        const cy = g.y * TILE + TILE / 2;
        const phase = flagPhases[i] ?? 0;
        const flutterAmt = flutter ? Math.sin(t * 2.2 + phase) * (Math.max(0.6, TILE * 0.05)) : 0;
        const tipLift = flutter ? Math.cos(t * 2.0 + phase) * (Math.max(0.4, TILE * 0.03)) : 0;

        const poleTopX = cx;
        const poleTopY = cy - poleH / 2 - baseYOff;
        const poleBotY = cy + poleH / 2 - baseYOff;

        // little shadow for readability
        ctx2.save();
        ctx2.globalAlpha = 0.22;
        ctx2.fillStyle = "rgba(0,0,0,0.9)";
        ctx2.beginPath();
        ctx2.ellipse(cx + 1, poleBotY + 3, Math.max(2, TILE * 0.22), Math.max(1.5, TILE * 0.12), 0, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.restore();

        // pole
        ctx2.save();
        ctx2.lineWidth = poleW;
        ctx2.strokeStyle = "rgba(20,20,20,0.9)";
        ctx2.beginPath();
        ctx2.moveTo(poleTopX, poleTopY);
        ctx2.lineTo(poleTopX, poleBotY);
        ctx2.stroke();
        ctx2.restore();

        // flag cloth (small triangle with tiny flutter)
        const fx0 = poleTopX;
        const fy0 = poleTopY + poleW; // attach point
        const fx1 = fx0 + flagW + flutterAmt;
        const fy1 = fy0 + flagH / 2 + tipLift;
        const fx2 = fx0;
        const fy2 = fy0 + flagH;

        ctx2.save();
        ctx2.fillStyle = flagColor ?? "rgba(220,38,38,0.92)";
        ctx2.strokeStyle = "rgba(0,0,0,0.35)";
        ctx2.lineWidth = Math.max(1, TILE * 0.06);
        ctx2.beginPath();
        ctx2.moveTo(fx0, fy0);
        ctx2.quadraticCurveTo((fx0 + fx1) / 2, (fy0 + fy1) / 2 + tipLift, fx1, fy1);
        ctx2.lineTo(fx2, fy2);
        ctx2.closePath();
        ctx2.fill();
        ctx2.stroke();
        ctx2.restore();

        // tiny pin/marker dot at green center
        ctx2.save();
        ctx2.globalAlpha = 0.9;
        ctx2.fillStyle = "rgba(255,255,255,0.9)";
        ctx2.strokeStyle = "rgba(0,0,0,0.35)";
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.arc(cx, cy, Math.max(1.5, TILE * 0.12), 0, Math.PI * 2);
        ctx2.fill();
        ctx2.stroke();
        ctx2.restore();
      }
    }

    function drawAmbientLife(timeMs: number) {
      // COZY-only ambient layer; keep frequency low and visuals subtle.
      if (showGridOverlays) return;
      if (!animationsEnabled) return;

      const now = timeMs;
      const amb = ambientRef.current;
      if (amb.nextBirdAt === 0) {
        amb.nextBirdAt = now + randRange(123, 20_000, 40_000);
      }

      // Spawn bird occasionally (max 2 concurrent)
      if (now >= amb.nextBirdAt && amb.birds.length < 2) {
        const id = amb.birdSeq++;
        const seed = 9000 + id * 101;
        const dir = hash01(seed) < 0.5 ? -1 : 1;
        const margin = TILE * 2.5;
        const y = randRange(seed + 1, hPx * 0.12, hPx * 0.72);
        const y2 = y + randRange(seed + 2, -TILE * 0.8, TILE * 0.8);
        const x0 = dir > 0 ? -margin : wPx + margin;
        const x1 = dir > 0 ? wPx + margin : -margin;
        const dur = randRange(seed + 3, 9_000, 14_000);
        const scale = randRange(seed + 4, 0.65, 1.1);
        const phase = randRange(seed + 5, 0, Math.PI * 2);

        amb.birds.push({ id, t0: now, dur, x0, y0: y, x1, y1: y2, scale, phase });
        amb.nextBirdAt = now + randRange(seed + 6, 20_000, 40_000);

        // Rare cart spawn if a playable path exists (very rare)
        if (!amb.cart && activePath && activePath.length > 10 && hash01(seed + 7) < 0.10) {
          const pathPx = activePath.map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));
          amb.cart = { t0: now, dur: randRange(seed + 8, 8_000, 12_000), pathPx };
        }
      }

      // Draw birds
      const still: typeof amb.birds = [];
      for (const b of amb.birds) {
        const t = (now - b.t0) / b.dur;
        if (t >= 1) continue;
        const e = easeInOutCubic(Math.max(0, Math.min(1, t)));
        const x = b.x0 + (b.x1 - b.x0) * e;
        const y = b.y0 + (b.y1 - b.y0) * e + Math.sin(now * 0.002 + b.phase) * (TILE * 0.15);
        const fade = t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1;
        const a = 0.22 * fade;

        ctx2.save();
        ctx2.globalAlpha = a;
        ctx2.translate(x, y);
        ctx2.scale(b.scale, b.scale);
        ctx2.strokeStyle = "rgba(10,10,10,0.95)";
        ctx2.lineWidth = Math.max(1, TILE * 0.06);
        // Simple bird silhouette: two arcs (like a tiny "m")
        const wing = Math.max(4, TILE * 0.6);
        const flap = Math.sin(now * 0.008 + b.phase) * (TILE * 0.18);
        ctx2.beginPath();
        ctx2.arc(-wing * 0.35, 0, wing * 0.55, Math.PI * 0.1, Math.PI * 0.9);
        ctx2.arc(wing * 0.35, 0, wing * 0.55, Math.PI * 0.1, Math.PI * 0.9);
        ctx2.stroke();
        // tiny flap hint
        ctx2.globalAlpha = a * 0.7;
        ctx2.beginPath();
        ctx2.moveTo(-wing * 0.35, 0);
        ctx2.lineTo(-wing * 0.35, -flap);
        ctx2.moveTo(wing * 0.35, 0);
        ctx2.lineTo(wing * 0.35, -flap);
        ctx2.stroke();
        ctx2.restore();

        still.push(b);
      }
      amb.birds = still;

      // Draw cart (very rare, subtle)
      if (amb.cart) {
        const c = amb.cart;
        const t = (now - c.t0) / c.dur;
        if (t >= 1) {
          amb.cart = null;
        } else if (c.pathPx.length >= 2) {
          const e = easeInOutCubic(Math.max(0, Math.min(1, t)));
          const idx = e * (c.pathPx.length - 1);
          const i0 = Math.floor(idx);
          const i1 = Math.min(c.pathPx.length - 1, i0 + 1);
          const f = idx - i0;
          const p0 = c.pathPx[i0];
          const p1 = c.pathPx[i1];
          const x = p0.x + (p1.x - p0.x) * f;
          const y = p0.y + (p1.y - p0.y) * f;
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);

          ctx2.save();
          ctx2.globalAlpha = 0.24;
          ctx2.translate(x, y);
          ctx2.rotate(ang);
          const bw = Math.max(6, TILE * 0.55);
          const bh = Math.max(3, TILE * 0.28);
          ctx2.fillStyle = "rgba(20,20,20,0.9)";
          ctx2.fillRect(-bw * 0.5, -bh * 0.5, bw, bh);
          ctx2.fillStyle = "rgba(255,255,255,0.75)";
          ctx2.fillRect(-bw * 0.1, -bh * 0.45, bw * 0.3, bh * 0.3);
          // wheels
          ctx2.fillStyle = "rgba(0,0,0,0.9)";
          const r = Math.max(1.2, TILE * 0.10);
          ctx2.beginPath();
          ctx2.arc(-bw * 0.3, -bh * 0.55, r, 0, Math.PI * 2);
          ctx2.arc(bw * 0.3, -bh * 0.55, r, 0, Math.PI * 2);
          ctx2.arc(-bw * 0.3, bh * 0.55, r, 0, Math.PI * 2);
          ctx2.arc(bw * 0.3, bh * 0.55, r, 0, Math.PI * 2);
          ctx2.fill();
          ctx2.restore();
        }
      }
    }

    const render = (timeMs: number) => {
      return perfProfiler.measure('CanvasCourse.render', () => {
        if (!canvasRef.current) return;
        if (!isVisibleRef.current) {
          rafRef.current = requestAnimationFrame(render);
          return;
        }
        const baseNow = baseCanvasRef.current;
        if (!baseNow) return;
        
        // Instrumentation: count renders
        renderCountRef.current++;
        const now = performance.now();
        const timeSinceLastLog = now - lastInstrumentationTimeRef.current;
        if (timeSinceLastLog >= 5000) { // Log every 5 seconds
          const renderFps = renderCountRef.current / (timeSinceLastLog / 1000);
          const pointerMoveFps = pointerMoveCountRef.current / (timeSinceLastLog / 1000);
          if (renderFps > 30) {
            console.warn(`[Performance] High render rate: ${renderFps.toFixed(1)} fps (${renderCountRef.current} renders), ${pointerMoveFps.toFixed(1)} pointer moves/sec`);
          }
          renderCountRef.current = 0;
          pointerMoveCountRef.current = 0;
          lastInstrumentationTimeRef.current = now;
        }
      
      // Update camera animations (focus / flyover)
      const cam = camRef.current;
      const stepAnim = (a: typeof camAnimRef.current) => {
        if (!a) return false;
        const t = Math.max(0, Math.min(1, (timeMs - a.t0) / a.dur));
        const e = easeInOutCubic(t);
        cam.zoom = a.from.zoom + (a.to.zoom - a.from.zoom) * e;
        cam.panX = a.from.panX + (a.to.panX - a.from.panX) * e;
        cam.panY = a.from.panY + (a.to.panY - a.from.panY) * e;
        clampCamera(cam);
        return t < 1;
      };
      const stillFocusing = stepAnim(camAnimRef.current);
      if (!stillFocusing) camAnimRef.current = null;
      const stillFly = stepAnim(flyoverRef.current);
      if (!stillFly) flyoverRef.current = null;
      
      // Check if camera animation changed (requires full redraw)
      const cameraChanged = stillFocusing || stillFly;

      // Only clear and redraw if needed (dirty flags or camera animation)
      const needsFullRedraw = courseDirtyRef.current || terrainDirtyRef.current || cameraChanged;
      const needsOverlayRedraw = overlayDirtyRef.current || cameraChanged;

      if (needsFullRedraw) {
        ctx2.setTransform(1, 0, 0, 1, 0, 0);
        ctx2.clearRect(0, 0, wPx, hPx);
        cameraSetTransform(ctx2);
      } else if (needsOverlayRedraw) {
        // Only clear overlay area (save previous frame, then redraw overlay)
        // For simplicity, we'll still clear full canvas but skip terrain redraw
        ctx2.setTransform(1, 0, 0, 1, 0, 0);
        ctx2.clearRect(0, 0, wPx, hPx);
        cameraSetTransform(ctx2);
        // Redraw base terrain (cached)
        ctx2.drawImage(baseNow, 0, 0);
      } else {
        // Nothing to update, skip render
        const shouldContinue =
          animationsEnabled ||
          camAnimRef.current != null ||
          flyoverRef.current != null ||
          (panStateRef.current?.active ?? false) ||
          overlayDirtyRef.current;
        if (shouldContinue) rafRef.current = requestAnimationFrame(render);
        else rafRef.current = null;
        return;
      }
      
      // Draw terrain (only if needed)
      if (needsFullRedraw || terrainDirtyRef.current) {
        // In hole edit mode, render infinite canvas dynamically
        if (cameraState && cameraState.mode === "hole") {
          perfProfiler.measure('render.infiniteCanvas', () => {
            // Calculate visible tile range based on camera transform
            // Get world coordinates of screen corners
            const invZoom = 1 / (cameraState.zoom || 1);
            const visibleWidthTiles = (wPx * invZoom) / TILE + 2; // +2 for padding
            const visibleHeightTiles = (hPx * invZoom) / TILE + 2;
            const centerX = cameraState.center.x;
            const centerY = cameraState.center.y;
            const minTileX = Math.floor(centerX - visibleWidthTiles / 2);
            const maxTileX = Math.ceil(centerX + visibleWidthTiles / 2);
            const minTileY = Math.floor(centerY - visibleHeightTiles / 2);
            const maxTileY = Math.ceil(centerY + visibleHeightTiles / 2);
            
            const tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
            if (tileCount > 1000) {
              console.warn(`[PerfProfiler] Rendering ${tileCount} tiles in infinite canvas mode - this may be slow!`);
            }
            
            // Render visible tiles dynamically
            for (let ty = minTileY; ty <= maxTileY; ty++) {
              for (let tx = minTileX; tx <= maxTileX; tx++) {
                const terrain = getTerrainAt(tx, ty);
                const x = tx * TILE;
                const y = ty * TILE;
                
                // Draw tile texture
                drawTileTexture(
                  ctx2,
                  terrain,
                  x,
                  y,
                  TILE,
                  noisePattern,
                  mowPattern,
                  tx * 1000 + ty
                );
                
                // Draw lighting edges
                drawLightingEdges(ctx2, x, y, TILE);
                
                // Draw soft edges for all tiles
                drawSoftEdgesForTile(ctx2, tx, ty, TILE, terrain, getTerrainAt);
              }
            }
            
            // Draw greens treatment for visible greens
            for (let ty = minTileY; ty <= maxTileY; ty++) {
              for (let tx = minTileX; tx <= maxTileX; tx++) {
                if (getTerrainAt(tx, ty) === "green") {
                  drawGreenForTile(ctx2, tx, ty, TILE, getTerrainAt);
                }
              }
            }
          });
        } else {
          // Normal mode: use pre-rendered base canvas (cached)
          ctx2.drawImage(baseNow, 0, 0);
        }
        terrainDirtyRef.current = false;
      }

      // Draw overlays (only if overlay is dirty or full redraw needed)
      if (needsOverlayRedraw || needsFullRedraw) {
        perfProfiler.measure('render.overlays', () => {
          perfProfiler.measure('render.overlays.shimmer', () => drawShimmer(timeMs));

          // obstacles (only if showObstacles is true)
          // DISABLED: SVG sprite loading causes severe performance issues
          // if (showObstacles) {
          //   perfProfiler.measure('render.overlays.obstacles', () => {
          //     // In infinite mode, only draw obstacles in visible range
          //     if (cameraState && cameraState.mode === "hole") {
          //       const invZoom = 1 / (cameraState.zoom || 1);
          //       const visibleWidthTiles = (wPx * invZoom) / TILE + 2;
          //       const visibleHeightTiles = (hPx * invZoom) / TILE + 2;
          //       const centerX = cameraState.center.x;
          //       const centerY = cameraState.center.y;
          //       const minTileX = Math.floor(centerX - visibleWidthTiles / 2);
          //       const maxTileX = Math.ceil(centerX + visibleWidthTiles / 2);
          //       const minTileY = Math.floor(centerY - visibleHeightTiles / 2);
          //       const maxTileY = Math.ceil(centerY + visibleHeightTiles / 2);
          //
          //       for (const o of obstacles) {
          //         if (o.x >= minTileX && o.x <= maxTileX && o.y >= minTileY && o.y <= maxTileY) {
          //           drawObstacle(o, timeMs);
          //         }
          //       }
          //     } else {
          //       for (const o of obstacles) drawObstacle(o, timeMs);
          //     }
          //   });
          // }

          // greens as targets: small flags (flutter in COZY)
          perfProfiler.measure('render.overlays.flags', () => drawFlags(timeMs));

          // ambient life layer (COZY)
          perfProfiler.measure('render.overlays.ambient', () => drawAmbientLife(timeMs));

          // shot plan visualization (Architect)
          perfProfiler.measure('render.overlays.shotPlan', () => drawShotPlanOverlay());

          // fix overlay (failing corridor segments)
          perfProfiler.measure('render.overlays.fixOverlay', () => drawFixOverlay());

          // distance preview (placement mode) - draw before resetting transform
          perfProfiler.measure('render.overlays.distancePreview', () => drawDistancePreview());

          perfProfiler.measure('render.overlays.analytics', () => drawAnalytics());
          perfProfiler.measure('render.overlays.wizard', () => drawWizard());
          
          // Reset transform before drawing tooltip (needs screen coords)
          ctx2.setTransform(1, 0, 0, 1, 0, 0);
          
          // Draw tooltips (after transform reset, using screen coordinates)
          perfProfiler.measure('render.overlays.tooltips', () => {
            drawDistancePreviewTooltip();
            drawPaintHoverTooltip();
          });
        });
        
        // Reset overlay dirty flag
        overlayDirtyRef.current = false;
      }

        const shouldContinue =
          animationsEnabled ||
          camAnimRef.current != null ||
          flyoverRef.current != null ||
          (panStateRef.current?.active ?? false) ||
          overlayDirtyRef.current;
        if (shouldContinue) rafRef.current = requestAnimationFrame(render);
        else rafRef.current = null;
      });
    };
    renderRef.current = render;

    // Cancel any previous loop and render once or start loop
    // Ensure only one RAF loop exists
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    // Mark terrain dirty when course changes
    terrainDirtyRef.current = true;
    courseDirtyRef.current = true;
    if (animationsEnabled) rafRef.current = requestAnimationFrame(render);
    else render(performance.now());

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      renderRef.current = null;
    };
  }, [
    course.width,
    course.height,
    wPx,
    hPx,
    imageData,
    noisePattern,
    mowPattern,
    holes,
    obstacles,
    activeHoleIndex,
    editorMode,
    wizardStep,
    draftTee,
    draftGreen,
    showGridOverlays,
    activePath,
    obstaclePhases,
    animationsEnabled,
    waterTiles,
    flyoverNonce,
    showShotPlan,
    activeShotPlan,
    _showFixOverlay,
    failingCorridorSegments,
    cameraState,
    showObstacles,
  ]);

  // Focus camera when active hole changes or gets tee/green set (cinematic selection)
  // Skip zoom when placing tee (when we have draftTee but the hole doesn't have a tee yet)
  useEffect(() => {
    if (panStateRef.current?.active) return;
    const h = holes[activeHoleIndex];
    // Don't zoom when placing tee in wizard mode (we have draftTee but the hole doesn't have a tee yet)
    if (editorMode === "HOLE_WIZARD" && draftTee && !h?.tee) return;
    const pts: Array<{ x: number; y: number }> = [];
    const toWorldCenter = (p: Point) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });
    if (h?.tee) pts.push(toWorldCenter(h.tee));
    if (h?.green) pts.push(toWorldCenter(h.green));
    if (!h?.tee && draftTee) pts.push(toWorldCenter(draftTee));
    if (!h?.green && draftGreen) pts.push(toWorldCenter(draftGreen));
    if (pts.length === 0) return;

    const key = `${activeHoleIndex}:${pts.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`).join("|")}`;
    if (key === lastFocusKeyRef.current) return;
    lastFocusKeyRef.current = key;
    focusOnPoints(pts);
    if (rafRef.current == null && renderRef.current) {
      rafRef.current = requestAnimationFrame(renderRef.current);
    }
  }, [activeHoleIndex, holes, TILE, draftTee, draftGreen, editorMode, wizardStep]);

  // Start flyover when nonce changes (COZY button)
  useEffect(() => {
    if (flyoverNonce === 0) return;
    // Cancel any ongoing focus; flyover takes over.
    camAnimRef.current = null;
    const sw = wPx;
    const sh = hPx;
    const minZoom = 0.7;
    const maxZoom = 1.6;
    const z = Math.max(minZoom, Math.min(maxZoom, Math.min(1.2, Math.max(0.95, camRef.current.zoom))));

    const from = { ...camRef.current };
    // Sweep from current view towards the opposite side of the course (deterministic, feels "guided").
    const currentCenterWorldX = (sw / 2 - from.panX) / from.zoom;
    const currentCenterWorldY = (sh / 2 - from.panY) / from.zoom;
    const targetWorldX = currentCenterWorldX < wPx / 2 ? wPx * 0.82 : wPx * 0.18;
    const targetWorldY = currentCenterWorldY < hPx / 2 ? hPx * 0.78 : hPx * 0.22;
    const endPanX = sw / 2 - targetWorldX * z;
    const endPanY = sh / 2 - targetWorldY * z;
    flyoverRef.current = {
      from,
      to: clampCamera({ panX: endPanX, panY: endPanY, zoom: z }),
      t0: performance.now(),
      dur: 10_000,
    };

    if (rafRef.current == null && renderRef.current) {
      rafRef.current = requestAnimationFrame(renderRef.current);
    }
  }, [flyoverNonce, wPx, hPx]);

  function getTileFromEvent(e: React.PointerEvent) {
    const wp = screenToWorldPx(e.clientX, e.clientY);
    const x = Math.floor(wp.x / TILE);
    const y = Math.floor(wp.y / TILE);
    
    // In hole edit mode with infinite canvas, allow coordinates outside bounds
    if (cameraState && cameraState.mode === "hole") {
      // Always return coordinates (infinite canvas)
      const idx = x >= 0 && y >= 0 && x < course.width && y < course.height
        ? y * course.width + x
        : -1; // Use -1 for out-of-bounds tiles
      return { x, y, idx };
    }
    
    // Normal mode: check bounds
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return;
    const idx = y * course.width + x;
    return { x, y, idx };
  }

  function handlePointerDown(e: React.PointerEvent) {
    // Cancel cinematic motions on user input.
    camAnimRef.current = null;
    flyoverRef.current = null;

    const t = getTileFromEvent(e);
    const canvas = e.currentTarget;
    canvas.setPointerCapture?.(e.pointerId);

    // In hole edit mode, allow pan with left-click (unless in paint mode with overlay shown)
    // Otherwise, use middle/right mouse buttons for pan
    const isHoleEditMode = cameraState && cameraState.mode === "hole";
    const panIntent = (isHoleEditMode && editorMode !== "PAINT" && e.button === 0) ||
                      (!showGridOverlays && e.button === 0) || 
                      e.button === 1 || 
                      e.button === 2;
    
    // Store initial camera state for hole edit mode pan
    const startCameraState = isHoleEditMode && cameraState ? { ...cameraState } : null;
    
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: camRef.current.panX,
      startPanY: camRef.current.panY,
      active: false,
      panIntent,
      moved: false,
      downTile: t ? { x: t.x, y: t.y } : null,
    };
    
    // Store hole edit camera state for panning
    (panStateRef.current as any).startCameraState = startCameraState;

    // Preserve editor feel: in ARCHITECT/PAINT, immediate click + drag paint.
    // But in hole edit mode, only paint if grid overlays are shown (ARCHITECT mode)
    if (showGridOverlays && editorMode === "PAINT" && e.button === 0 && t) {
      onClickTile(t.x, t.y);
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Instrumentation: count pointer move events
    pointerMoveCountRef.current++;
    perfProfiler.logEvent('pointermove');
    
    const t = getTileFromEvent(e);
    const ps = panStateRef.current;

    // Pan when dragging
    if (ps && ps.panIntent && (e.buttons & 1 || e.buttons & 2 || e.buttons & 4)) {
      const dx = e.clientX - ps.startX;
      const dy = e.clientY - ps.startY;
      if (!ps.moved && Math.hypot(dx, dy) > 3) ps.moved = true;
      if (ps.moved) {
        ps.active = true;
        
        // Handle hole edit mode camera panning
        if (cameraState && cameraState.mode === "hole" && onCameraUpdate) {
          const startState = (ps as any).startCameraState;
          if (startState) {
            // Convert screen delta to world delta
            const invZoom = 1 / startState.zoom;
            const worldDx = (-dx * invZoom) / tileSize;
            const worldDy = (-dy * invZoom) / tileSize;
            
            const newCamera: CameraState = {
              ...startState,
              center: {
                x: startState.center.x + worldDx,
                y: startState.center.y + worldDy,
              },
            };
            onCameraUpdate(newCamera);
            // Mark overlay as dirty instead of triggering immediate render
            overlayDirtyRef.current = true;
            if (rafRef.current == null && renderRef.current) {
              rafRef.current = requestAnimationFrame(renderRef.current);
            }
          }
        } else {
          // Normal mode panning
          camRef.current.panX = ps.startPanX + dx;
          camRef.current.panY = ps.startPanY + dy;
          clampCamera(camRef.current);
          // Mark overlay as dirty instead of triggering immediate render
          overlayDirtyRef.current = true;
          if (rafRef.current == null && renderRef.current) {
            rafRef.current = requestAnimationFrame(renderRef.current);
          }
        }
      }
    }

    // Track hover state in refs (no React state updates - performance critical)
    const needsHoverTracking = ENABLE_HOVER_DISTANCE_PREVIEW || (editorMode === "PAINT" && selectedTerrain);
    if (needsHoverTracking) {
      const prevHover = hoverTileRef.current;
      const wasHovering = isHoveringRef.current;
      
      if (t) {
        hoverTileRef.current = { idx: t.idx, x: t.x, y: t.y, clientX: e.clientX, clientY: e.clientY };
        hoverWorldPosRef.current = { x: t.x, y: t.y };
        isHoveringRef.current = true;
        
        // Calculate preview distance if needed
        if (ENABLE_HOVER_DISTANCE_PREVIEW) {
          const hole = holes[activeHoleIndex];
          const fromPoint = (wizardStep === "GREEN" || wizardStep === "MOVE_GREEN") 
            ? (hole?.tee || draftTee)
            : (wizardStep === "TEE" || wizardStep === "MOVE_TEE")
            ? (hole?.green || draftGreen)
            : null;
          
          if (fromPoint) {
            const dx = t.x - fromPoint.x;
            const dy = t.y - fromPoint.y;
            previewDistanceRef.current = Math.sqrt(dx * dx + dy * dy) * course.yardsPerTile;
          } else {
            previewDistanceRef.current = null;
          }
        }
        
        // Mark overlay dirty if hover changed (only update overlay, not full render)
        if (prevHover?.x !== t.x || prevHover?.y !== t.y || !wasHovering) {
          overlayDirtyRef.current = true;
          // Ensure render loop is running
          if (rafRef.current == null && renderRef.current) {
            rafRef.current = requestAnimationFrame(renderRef.current);
          }
        }
      } else {
        hoverTileRef.current = null;
        hoverWorldPosRef.current = null;
        isHoveringRef.current = false;
        previewDistanceRef.current = null;
        // Mark overlay dirty to clear hover visuals
        if (wasHovering) {
          overlayDirtyRef.current = true;
          if (rafRef.current == null && renderRef.current) {
            rafRef.current = requestAnimationFrame(renderRef.current);
          }
        }
      }
    } else {
      // Clear hover tracking when not needed
      hoverTileRef.current = null;
      hoverWorldPosRef.current = null;
      isHoveringRef.current = false;
      previewDistanceRef.current = null;
    }
    
    if (!t) return;

    // Drag painting in PAINT mode (works in both modes)
    if (editorMode === "PAINT" && e.buttons === 1 && t) {
      onClickTile(t.x, t.y);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const ps = panStateRef.current;
    panStateRef.current = null;
    if (!ps) return;
    // If we weren't panning and this was a simple click, treat as a click interaction.
    if (!ps.moved && e.button === 0) {
      const t = getTileFromEvent(e);
      if (t) onClickTile(t.x, t.y);
    }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    // User input cancels cinematic motions.
    camAnimRef.current = null;
    flyoverRef.current = null;

    // Handle hole edit mode zoom
    if (cameraState && cameraState.mode === "hole" && onCameraUpdate) {
      const delta = -e.deltaY * 0.001;
      const zoomFactor = 1 + delta;
      const newZoom = Math.max(0.5, Math.min(10.0, cameraState.zoom * zoomFactor));
      
      // Zoom towards mouse position
      const rect = canvasRef.current!.getBoundingClientRect();
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPoint = cameraScreenToWorld(screenPoint, cameraState, tileSize, wPx, hPx);
      
      // Calculate new center so the world point under mouse stays fixed
      const zoomRatio = newZoom / cameraState.zoom;
      const newCenterX = cameraState.center.x - (worldPoint.x - cameraState.center.x) * (zoomRatio - 1);
      const newCenterY = cameraState.center.y - (worldPoint.y - cameraState.center.y) * (zoomRatio - 1);
      
      const newCamera: CameraState = {
        ...cameraState,
        zoom: newZoom,
        center: {
          x: newCenterX,
          y: newCenterY,
        },
      };
      
      onCameraUpdate(newCamera);
      if (rafRef.current == null && renderRef.current) rafRef.current = requestAnimationFrame(renderRef.current);
      return;
    }

    const cam = camRef.current;
    const wp = screenToWorldPx(e.clientX, e.clientY);
    const minZoom = 0.6;
    const maxZoom = 3.0;
    const factor = Math.exp(-e.deltaY * 0.001);
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, cam.zoom * factor));
    if (Math.abs(nextZoom - cam.zoom) < 0.0001) return;

    // Zoom around cursor
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    cam.zoom = nextZoom;
    cam.panX = sx - wp.x * cam.zoom;
    cam.panY = sy - wp.y * cam.zoom;
    clampCamera(cam);

    if (renderRef.current) {
      // For responsiveness, render immediately; loop continues only if needed.
      renderRef.current(performance.now());
      if (rafRef.current == null && (animationsEnabled || camAnimRef.current || flyoverRef.current)) {
        rafRef.current = requestAnimationFrame(renderRef.current);
      }
    }
  }

  return (
    <div style={{ display: "inline-block" }}>
      <canvas
        ref={canvasRef}
        width={wPx}
        height={hPx}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => {
          lastHoverIdxRef.current = null;
          if (ENABLE_HOVER_DISTANCE_PREVIEW || editorMode === "PAINT") {
            hoverTileRef.current = null;
            hoverWorldPosRef.current = null;
            isHoveringRef.current = false;
            previewDistanceRef.current = null;
            // Mark overlay dirty to clear hover visuals
            overlayDirtyRef.current = true;
            // Ensure render loop is running
            if (renderRef.current && rafRef.current == null) {
              rafRef.current = requestAnimationFrame(renderRef.current);
            }
          }
        }}
        style={{
          touchAction: "none",
          cursor: (() => {
            // Calculate cursor style based on hover tile (no React state)
            if (editorMode === "PAINT" && selectedTerrain && worldCash !== undefined) {
              const hover = hoverTileRef.current;
              if (hover && hover.idx >= 0) {
                const prev = course.tiles[hover.idx];
                const cost = computeTerrainChangeCost(prev, selectedTerrain);
                return cost.net > 0 && worldCash < cost.net ? "not-allowed" : "crosshair";
              }
            }
            return "crosshair";
          })(),
          display: "block",
        }}
      />
    </div>
  );
}


