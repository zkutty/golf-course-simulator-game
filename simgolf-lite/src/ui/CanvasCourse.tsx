import React, { useEffect, useMemo, useRef } from "react";
import type { Course, Hole, Terrain } from "../game/models/types";

const TILE = 20;

const COLORS: Record<Terrain, string> = {
  fairway: "#4caf50",
  rough: "#2e7d32",
  sand: "#d8c37a",
  water: "#2196f3",
  green: "#66bb6a",
  tee: "#8d6e63",
  path: "#9e9e9e",
};

export function CanvasCourse(props: {
  course: Course;
  selected: Terrain;
  holes: Hole[];
  mode: "paint" | "tee" | "green";
  activeHoleIndex: number;
  onPaint: (idx: number, t: Terrain) => void;
  onPlaceTee: (holeIndex: number, x: number, y: number) => void;
  onPlaceGreen: (holeIndex: number, x: number, y: number) => void;
}) {
  const { course, selected, holes, mode, activeHoleIndex, onPaint, onPlaceTee, onPlaceGreen } =
    props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

    // hole overlays
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2;
    ctx.font = "12px system-ui, sans-serif";
    holes.forEach((h, i) => {
      if (!h.tee || !h.green) return;
      const isActive = i === activeHoleIndex;
      // line tee -> green
      ctx.strokeStyle = isActive ? "#111" : "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.moveTo(h.tee.x * TILE + TILE / 2, h.tee.y * TILE + TILE / 2);
      ctx.lineTo(h.green.x * TILE + TILE / 2, h.green.y * TILE + TILE / 2);
      ctx.stroke();

      // tee marker
      ctx.fillStyle = isActive ? "#000" : "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(h.tee.x * TILE + TILE / 2, h.tee.y * TILE + TILE / 2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(i + 1), h.tee.x * TILE + TILE / 2 - 3, h.tee.y * TILE + TILE / 2 + 4);

      // green marker
      ctx.fillStyle = isActive ? "#1b5e20" : "rgba(27,94,32,0.6)";
      ctx.beginPath();
      ctx.arc(h.green.x * TILE + TILE / 2, h.green.y * TILE + TILE / 2, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

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
  }, [course.width, course.height, wPx, hPx, imageData, holes, activeHoleIndex]);

  function handlePointer(e: React.PointerEvent) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / TILE);
    const y = Math.floor((e.clientY - rect.top) / TILE);
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return;
    if (mode === "paint") onPaint(y * course.width + x, selected);
    if (mode === "tee") onPlaceTee(activeHoleIndex, x, y);
    if (mode === "green") onPlaceGreen(activeHoleIndex, x, y);
  }

  return (
    <div style={{ border: "1px solid #ddd", display: "inline-block" }}>
      <canvas
        ref={canvasRef}
        width={wPx}
        height={hPx}
        onPointerDown={(e) => handlePointer(e)}
        onPointerMove={(e) => (e.buttons === 1 ? handlePointer(e) : undefined)}
        style={{ touchAction: "none", cursor: "crosshair" }}
      />
    </div>
  );
}


