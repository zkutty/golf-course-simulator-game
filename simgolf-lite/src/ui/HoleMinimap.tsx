import React, { useRef, useEffect } from "react";
import type { Course, Hole, Point } from "../game/models/types";
import type { CameraState } from "../game/render/camera";

const COLORS: Record<string, string> = {
  fairway: "#4fa64f",
  rough: "#2f7a36",
  deep_rough: "#1f5f2c",
  sand: "#d7c48a",
  water: "#2b7bbb",
  green: "#5dbb6a",
  tee: "#8b6b4f",
  path: "#8f8f8f",
};

interface HoleMinimapProps {
  course: Course;
  hole: Hole;
  cameraState: CameraState | null;
  tileSize: number;
  onCenter: (center: Point) => void;
}

const MINIMAP_SIZE = 200; // Fixed minimap size in pixels

export function HoleMinimap({
  course,
  hole,
  cameraState,
  tileSize,
  onCenter,
}: HoleMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hole.tee || !hole.green) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Compute hole bounding box
    const points: Point[] = [hole.tee, hole.green];
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        const idx = y * course.width + x;
        const terrain = course.tiles[idx];
        if (terrain === "green" || terrain === "tee") {
          points.push({ x, y });
        }
      }
    }

    if (points.length === 0) return;

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;
    const scale = Math.min(MINIMAP_SIZE / (bboxWidth + 2), MINIMAP_SIZE / (bboxHeight + 2));

    // Clear
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Draw terrain (simplified: just show green/tee and path)
    const offsetX = (MINIMAP_SIZE - bboxWidth * scale) / 2;
    const offsetY = (MINIMAP_SIZE - bboxHeight * scale) / 2;

    // Draw centerline
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    const teeScreenX = (hole.tee.x - minX) * scale + offsetX;
    const teeScreenY = (hole.tee.y - minY) * scale + offsetY;
    const greenScreenX = (hole.green.x - minX) * scale + offsetX;
    const greenScreenY = (hole.green.y - minY) * scale + offsetY;
    ctx.moveTo(teeScreenX, teeScreenY);
    ctx.lineTo(greenScreenX, greenScreenY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw tee
    ctx.fillStyle = COLORS.tee;
    ctx.beginPath();
    ctx.arc(teeScreenX, teeScreenY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw green
    ctx.fillStyle = COLORS.green;
    ctx.beginPath();
    ctx.arc(greenScreenX, greenScreenY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw viewport rectangle if in hole edit mode
    if (cameraState && cameraState.mode === "hole" && cameraState.bounds) {
      const bounds = cameraState.bounds;
      const viewMinX = (bounds.minX - minX) * scale + offsetX;
      const viewMinY = (bounds.minY - minY) * scale + offsetY;
      const viewWidth = (bounds.maxX - bounds.minX) * scale;
      const viewHeight = (bounds.maxY - bounds.minY) * scale;

      ctx.strokeStyle = "#2b7bbb";
      ctx.lineWidth = 2;
      ctx.strokeRect(viewMinX, viewMinY, viewWidth, viewHeight);
    }

    // Store transform for click handling
    (canvas as any).__minimapTransform = { minX, minY, scale, offsetX, offsetY };
  }, [course, hole, cameraState, tileSize]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !hole.tee || !hole.green) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const transform = (canvas as any).__minimapTransform;
    if (!transform) return;

    // Convert screen coords to world coords
    const worldX = (x - transform.offsetX) / transform.scale + transform.minX;
    const worldY = (y - transform.offsetY) / transform.scale + transform.minY;

    onCenter({ x: worldX, y: worldY });
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        width: MINIMAP_SIZE,
        height: MINIMAP_SIZE,
        border: "2px solid #ddd",
        borderRadius: 4,
        backgroundColor: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        cursor: "pointer",
      }}
      title="Click to center view"
    >
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        onClick={handleClick}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
