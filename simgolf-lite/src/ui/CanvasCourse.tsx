import React, { useEffect, useMemo, useRef } from "react";
import type { Course, Terrain } from "../game/models/types";

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
  onPaint: (idx: number, t: Terrain) => void;
}) {
  const { course, selected, onPaint } = props;
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
  }, [course.width, course.height, wPx, hPx, imageData]);

  function handlePointer(e: React.PointerEvent) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / TILE);
    const y = Math.floor((e.clientY - rect.top) / TILE);
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return;
    onPaint(y * course.width + x, selected);
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


