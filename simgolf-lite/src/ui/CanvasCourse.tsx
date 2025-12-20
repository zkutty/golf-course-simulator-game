import React, { useEffect, useMemo, useRef } from "react";
import type { Course, Hole, Obstacle, Point, Terrain } from "../game/models/types";

const COLORS: Record<Terrain, string> = {
  fairway: "#4caf50",
  rough: "#2e7d32",
  deep_rough: "#14532d",
  sand: "#d8c37a",
  water: "#2196f3",
  green: "#66bb6a",
  tee: "#8d6e63",
  path: "#9e9e9e",
};

export function CanvasCourse(props: {
  course: Course;
  holes: Hole[];
  obstacles: Obstacle[];
  activeHoleIndex: number;
  activePath?: Point[];
  tileSize: number;
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

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, wPx, hPx);
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const idx = y * course.width + x;
        ctx.fillStyle = imageData[idx];
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    // grid lines
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#000";
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

    // hole overlays (above tiles + grid)
    ctx.lineWidth = 2;
    ctx.font = "12px system-ui, sans-serif";
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
      ctx.arc(h.tee.x * TILE + TILE / 2, h.tee.y * TILE + TILE / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(
        String(i + 1),
        h.tee.x * TILE + TILE / 2 - 3,
        h.tee.y * TILE + TILE / 2 + 4
      );

      // green marker (labeled)
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = isActive ? "#1b5e20" : "rgba(27,94,32,0.78)";
      ctx.beginPath();
      ctx.arc(h.green.x * TILE + TILE / 2, h.green.y * TILE + TILE / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(
        String(i + 1),
        h.green.x * TILE + TILE / 2 - 3,
        h.green.y * TILE + TILE / 2 + 4
      );
    });
    ctx.globalAlpha = 1;

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

      // small hint (top-left)
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#000";
      const hint =
        wizardStep === "TEE"
          ? `Hole ${activeHoleIndex + 1}: click to place tee`
          : wizardStep === "GREEN"
            ? `Hole ${activeHoleIndex + 1}: click to place green`
            : `Hole ${activeHoleIndex + 1}: confirm or redo`;
      ctx.fillText(hint, 8, 16);
      ctx.globalAlpha = 1;
    }
  }, [
    course.width,
    course.height,
    wPx,
    hPx,
    imageData,
    holes,
    obstacles,
    activeHoleIndex,
    editorMode,
    wizardStep,
    draftTee,
    draftGreen,
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


