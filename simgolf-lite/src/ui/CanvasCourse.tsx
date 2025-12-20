import React, { useEffect, useMemo, useRef } from "react";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";

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

export function CanvasCourse(props: {
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  activePath?: Point[];
  tileSize: number;
  showGridOverlays: boolean;
  animationsEnabled: boolean;
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
  wizardStep: "TEE" | "GREEN" | "CONFIRM";
  draftTee: Point | null;
  draftGreen: Point | null;
  onClickTile: (x: number, y: number) => void;
  onHoverTile?: (h: { idx: number; x: number; y: number; clientX: number; clientY: number }) => void;
  onLeave?: () => void;
  cursor?: string;
}) {
  const {
    course,
    holes,
    obstacles,
    activeHoleIndex,
    activePath,
    tileSize,
    showGridOverlays,
    animationsEnabled,
    editorMode,
    wizardStep,
    draftTee,
    draftGreen,
    onClickTile,
    onHoverTile,
    onLeave,
    cursor,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastHoverIdxRef = useRef<number | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const isVisibleRef = useRef(true);
  const TILE = tileSize;
  const wPx = course.width * TILE;
  const hPx = course.height * TILE;

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

  useEffect(() => {
    const onVis = () => {
      isVisibleRef.current = document.visibilityState === "visible";
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const ctx2: CanvasRenderingContext2D = ctx;

    // Build static terrain buffer (expensive work done only when course/size changes)
    const base = document.createElement("canvas");
    base.width = wPx;
    base.height = hPx;
    const bctx = base.getContext("2d");
    if (!bctx) return;

    // Pass 1: textured tiles + per-tile micro-lighting
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

    // Pass 2: soft edge blending
    for (let ty = 0; ty < course.height; ty++) {
      for (let tx = 0; tx < course.width; tx++) {
        const i = ty * course.width + tx;
        const terrain = course.tiles[i];
        drawSoftEdges(bctx, course, tx * TILE, ty * TILE, TILE, terrain);
      }
    }

    // Pass 3: global light + tiny “glaze” noise to reduce checkerboard feel
    drawDirectionalLight(bctx, wPx, hPx);
    if (noisePattern) {
      bctx.globalAlpha = 0.04;
      bctx.fillStyle = noisePattern;
      bctx.fillRect(0, 0, wPx, hPx);
      bctx.globalAlpha = 1;
    }

    baseCanvasRef.current = base;

    function drawObstacle(o: Obstacle, timeMs: number) {
      const cx0 = o.x * TILE + TILE / 2;
      const cy0 = o.y * TILE + TILE / 2;
      const phase = obstaclePhases.get(`${o.x},${o.y}`) ?? 0;
      const t = timeMs * 0.001;
      const amp = Math.max(0.3, TILE * 0.06);
      const sway = animationsEnabled ? Math.sin(t * 0.6 + phase) * amp : 0;
      const cx = cx0 + sway;
      const cy = cy0;

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
      } else {
        // bush
        ctx2.globalAlpha = 0.9;
        ctx2.fillStyle = "#166534";
        ctx2.strokeStyle = "rgba(0,0,0,0.35)";
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.arc(cx, cy, Math.max(3, TILE * 0.24), 0, Math.PI * 2);
        ctx2.fill();
        ctx2.stroke();
      }
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

    function drawWizard() {
      if (editorMode !== "HOLE_WIZARD") return;
      ctx2.lineWidth = 3;
      if (draftTee && draftGreen) {
        ctx2.globalAlpha = 0.9;
        ctx2.strokeStyle = "#ff6f00";
        ctx2.beginPath();
        ctx2.moveTo(draftTee.x * TILE + TILE / 2, draftTee.y * TILE + TILE / 2);
        ctx2.lineTo(draftGreen.x * TILE + TILE / 2, draftGreen.y * TILE + TILE / 2);
        ctx2.stroke();
        ctx2.globalAlpha = 1;
      }

      if (draftTee) {
        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = "#ff6f00";
        ctx2.beginPath();
        ctx2.arc(draftTee.x * TILE + TILE / 2, draftTee.y * TILE + TILE / 2, 8, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.fillStyle = "#fff";
        ctx2.fillText("T", draftTee.x * TILE + TILE / 2 - 4, draftTee.y * TILE + TILE / 2 + 4);
        ctx2.globalAlpha = 1;
      }

      if (draftGreen) {
        ctx2.globalAlpha = 0.95;
        ctx2.fillStyle = "#ff6f00";
        ctx2.beginPath();
        ctx2.arc(
          draftGreen.x * TILE + TILE / 2,
          draftGreen.y * TILE + TILE / 2,
          8,
          0,
          Math.PI * 2
        );
        ctx2.fill();
        ctx2.fillStyle = "#fff";
        ctx2.fillText(
          "G",
          draftGreen.x * TILE + TILE / 2 - 4,
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

    const render = (timeMs: number) => {
      if (!canvasRef.current) return;
      if (!isVisibleRef.current) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      const baseNow = baseCanvasRef.current;
      if (!baseNow) return;
      ctx2.clearRect(0, 0, wPx, hPx);
      ctx2.drawImage(baseNow, 0, 0);

      drawShimmer(timeMs);

      // obstacles always visible; sway only when animations enabled
      for (const o of obstacles) drawObstacle(o, timeMs);

      drawAnalytics();
      drawWizard();

      rafRef.current = requestAnimationFrame(render);
    };

    // Cancel any previous loop and render once or start loop
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (animationsEnabled) rafRef.current = requestAnimationFrame(render);
    else render(0);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
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
  ]);

  function getTileFromEvent(e: React.PointerEvent) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / TILE);
    const y = Math.floor((e.clientY - rect.top) / TILE);
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return;
    const idx = y * course.width + x;
    return { x, y, idx };
  }

  function handlePointerDown(e: React.PointerEvent) {
    const t = getTileFromEvent(e);
    if (!t) return;
    onClickTile(t.x, t.y);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const t = getTileFromEvent(e);
    if (!t) return;

    // Hover events only when tile changes
    if (onHoverTile && lastHoverIdxRef.current !== t.idx) {
      lastHoverIdxRef.current = t.idx;
      onHoverTile({ idx: t.idx, x: t.x, y: t.y, clientX: e.clientX, clientY: e.clientY });
    } else if (onHoverTile) {
      // Same tile; update tooltip position cheaply
      onHoverTile({ idx: t.idx, x: t.x, y: t.y, clientX: e.clientX, clientY: e.clientY });
    }

    // Drag painting only in PAINT mode
    if (editorMode === "PAINT" && e.buttons === 1) onClickTile(t.x, t.y);
  }

  return (
    <div style={{ display: "inline-block" }}>
      <canvas
        ref={canvasRef}
        width={wPx}
        height={hPx}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          lastHoverIdxRef.current = null;
          onLeave?.();
        }}
        style={{ touchAction: "none", cursor: cursor ?? "crosshair", display: "block" }}
      />
    </div>
  );
}


