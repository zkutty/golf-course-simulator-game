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

function drawTileTexture(
  ctx: CanvasRenderingContext2D,
  terrain: Terrain,
  x: number,
  y: number,
  size: number,
  noise: CanvasPattern | null,
  seed: number
) {
  // Subtle per-tile variation
  const v = (hash01(seed) - 0.5) * 0.22;
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
    for (let i = 0; i < 6; i++) {
      const sx = x + hash01(seed + i * 11) * size;
      const sy = y + hash01(seed + i * 17) * size;
      ctx.fillRect(sx, sy, 1, 1);
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

  // mowing lines for fairway/green (very subtle)
  if (terrain === "fairway" || terrain === "green") {
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    const stripe = Math.max(2, Math.floor(size / 3));
    if ((seed & 1) === 0) ctx.fillRect(x, y, size, stripe);
    else ctx.fillRect(x, y + size - stripe, size, stripe);
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
  // Blend with neighbors by painting thin translucent strips.
  const t = Math.max(1, Math.min(6, Math.floor(size * 0.18)));
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

  ctx.globalAlpha = 0.14;
  if (n && n !== terrain) {
    ctx.fillStyle = COLORS[n];
    ctx.fillRect(x, y, size, t);
  }
  if (s && s !== terrain) {
    ctx.fillStyle = COLORS[s];
    ctx.fillRect(x, y + size - t, size, t);
  }
  if (wv && wv !== terrain) {
    ctx.fillStyle = COLORS[wv];
    ctx.fillRect(x, y, t, size);
  }
  if (e && e !== terrain) {
    ctx.fillStyle = COLORS[e];
    ctx.fillRect(x + size - t, y, t, size);
  }
  ctx.globalAlpha = 1;
}

function drawLightingEdges(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  // Simple top-left light source: highlight TL edges, shade BR edges.
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + size - 0.5);
  ctx.lineTo(x + 0.5, y + 0.5);
  ctx.lineTo(x + size - 0.5, y + 0.5);
  ctx.stroke();

  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + size - 0.5);
  ctx.lineTo(x + size - 0.5, y + size - 0.5);
  ctx.lineTo(x + size - 0.5, y + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function CanvasCourse(props: {
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  activePath?: Point[];
  tileSize: number;
  showGridOverlays: boolean;
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

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, wPx, hPx);
    // Pass 1: textured tiles + lighting
    for (let ty = 0; ty < course.height; ty++) {
      for (let tx = 0; tx < course.width; tx++) {
        const i = ty * course.width + tx;
        const terrain = course.tiles[i];
        const x = tx * TILE;
        const y = ty * TILE;
        drawTileTexture(ctx, terrain, x, y, TILE, noisePattern, i + course.width * 1000);
        drawLightingEdges(ctx, x, y, TILE);
      }
    }

    // Pass 2: soft edge blending
    for (let ty = 0; ty < course.height; ty++) {
      for (let tx = 0; tx < course.width; tx++) {
        const i = ty * course.width + tx;
        const terrain = course.tiles[i];
        drawSoftEdges(ctx, course, tx * TILE, ty * TILE, TILE, terrain);
      }
    }

    // Optional grid + analytical overlays (editor-only toggle)
    if (showGridOverlays) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      for (let x = 0; x <= course.width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * TILE, 0);
        ctx.lineTo(x * TILE, hPx);
        ctx.stroke();
      }
      for (let y = 0; y <= course.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * TILE);
        ctx.lineTo(wPx, y * TILE);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // obstacle overlay (above tiles + grid, below hole markers)
    obstacles.forEach((o) => {
      const cx = o.x * TILE + TILE / 2;
      const cy = o.y * TILE + TILE / 2;
      if (o.type === "tree") {
        // canopy
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#14532d";
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy - TILE * 0.08, Math.max(3, TILE * 0.28), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // trunk
        ctx.fillStyle = "#7c4a03";
        ctx.globalAlpha = 0.95;
        const tw = Math.max(2, TILE * 0.12);
        const th = Math.max(3, TILE * 0.22);
        ctx.fillRect(cx - tw / 2, cy + TILE * 0.12, tw, th);
      } else {
        // bush
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#166534";
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, TILE * 0.24), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    // Analytical overlays: holes, lines, best path
    if (showGridOverlays) {
      ctx.lineWidth = 2;
      ctx.font = `${Math.max(10, Math.floor(TILE * 0.55))}px system-ui, sans-serif`;
      holes.forEach((h, i) => {
        if (!h.tee || !h.green) return;
        const isActive = i === activeHoleIndex;

        // active best-path polyline (dogleg-aware)
        if (isActive && activePath && activePath.length >= 2) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = "#facc15"; // amber
          ctx.lineWidth = Math.max(1, TILE * 0.12);
          ctx.beginPath();
          ctx.moveTo(activePath[0].x * TILE + TILE / 2, activePath[0].y * TILE + TILE / 2);
          for (let k = 1; k < activePath.length; k++) {
            ctx.lineTo(activePath[k].x * TILE + TILE / 2, activePath[k].y * TILE + TILE / 2);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2;
        }

        // semi-transparent "shot line" tee -> green
        ctx.globalAlpha = isActive ? 0.6 : 0.35;
        ctx.strokeStyle = "#111";
        ctx.beginPath();
        ctx.moveTo(h.tee.x * TILE + TILE / 2, h.tee.y * TILE + TILE / 2);
        ctx.lineTo(h.green.x * TILE + TILE / 2, h.green.y * TILE + TILE / 2);
        ctx.stroke();

        // tee marker (labeled)
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = isActive ? "#000" : "rgba(0,0,0,0.75)";
        ctx.beginPath();
        ctx.arc(h.tee.x * TILE + TILE / 2, h.tee.y * TILE + TILE / 2, Math.max(4, TILE * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(String(i + 1), h.tee.x * TILE + TILE / 2 - 3, h.tee.y * TILE + TILE / 2 + 4);

        // green marker (labeled)
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = isActive ? "#1b5e20" : "rgba(27,94,32,0.78)";
        ctx.beginPath();
        ctx.arc(h.green.x * TILE + TILE / 2, h.green.y * TILE + TILE / 2, Math.max(4, TILE * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(String(i + 1), h.green.x * TILE + TILE / 2 - 3, h.green.y * TILE + TILE / 2 + 4);
      });
      ctx.globalAlpha = 1;
    }

    // draft overlays (wizard) above everything else
    if (editorMode === "HOLE_WIZARD") {
      ctx.lineWidth = 3;
      if (draftTee && draftGreen) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "#ff6f00";
        ctx.beginPath();
        ctx.moveTo(draftTee.x * TILE + TILE / 2, draftTee.y * TILE + TILE / 2);
        ctx.lineTo(draftGreen.x * TILE + TILE / 2, draftGreen.y * TILE + TILE / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (draftTee) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#ff6f00";
        ctx.beginPath();
        ctx.arc(draftTee.x * TILE + TILE / 2, draftTee.y * TILE + TILE / 2, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText("T", draftTee.x * TILE + TILE / 2 - 4, draftTee.y * TILE + TILE / 2 + 4);
        ctx.globalAlpha = 1;
      }

      if (draftGreen) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#ff6f00";
        ctx.beginPath();
        ctx.arc(
          draftGreen.x * TILE + TILE / 2,
          draftGreen.y * TILE + TILE / 2,
          8,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(
          "G",
          draftGreen.x * TILE + TILE / 2 - 4,
          draftGreen.y * TILE + TILE / 2 + 4
        );
        ctx.globalAlpha = 1;
      }

      // small hint (top-left) only when overlays enabled
      if (showGridOverlays) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "rgba(0,0,0,0.9)";
        const hint =
          wizardStep === "TEE"
            ? `Hole ${activeHoleIndex + 1}: click to place tee`
            : wizardStep === "GREEN"
              ? `Hole ${activeHoleIndex + 1}: click to place green`
              : `Hole ${activeHoleIndex + 1}: confirm or redo`;
        ctx.fillText(hint, 8, 16);
        ctx.globalAlpha = 1;
      }
    }
  }, [
    course.width,
    course.height,
    wPx,
    hPx,
    imageData,
    noisePattern,
    holes,
    obstacles,
    activeHoleIndex,
    editorMode,
    wizardStep,
    draftTee,
    draftGreen,
    showGridOverlays,
    activePath,
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


