import { useEffect, useRef, useState } from "react";
import type { Course, Hole, Point } from "../game/models/types";
import type { GolferRenderData } from "../game/live/types";
import { computeHoleBoundingBox, type BoundingBox, type IsoCameraSnapshot } from "../game/render/camera";
import { TILE_H, TILE_W, worldToIso } from "../game/render/iso";
import { getElevation } from "../game/models/elevation";
import { translateCurrent } from "../i18n/core";
import { MINIMAP_SIZE as SIZE, makeMinimapTransform, minimapCanvasPoint, minimapPointToWorld, type MinimapTransform } from "../game/render/minimap";
import { getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS } from "../game/models/courseSetup";
import { decodeParcelMap } from "../game/estate/estate";

const COLORS: Record<string, string> = {
  fairway: "#76ad58",
  rough: "#548342",
  deep_rough: "#355f37",
  sand: "#d5bb72",
  waste_area: "#9f8153",
  water: "#4f91b9",
  wetland: "#477b68",
  green: "#78ba61",
  tee: "#92bd6c",
  path: "#9b8d76",
};

interface HoleMinimapProps {
  course: Course;
  hole?: Hole;
  holeIndex?: number;
  view?: IsoCameraSnapshot | null;
  golfersRef?: React.RefObject<GolferRenderData[]>;
  onCenter?: (center: Point) => void;
  thumbnail?: boolean;
}

function boundsFor(course: Course, hole?: Hole, holeIndex = 0): BoundingBox {
  return hole ? computeHoleBoundingBox(course, hole, holeIndex, 2) ?? { minX: 0, minY: 0, maxX: course.width, maxY: course.height }
    : { minX: 0, minY: 0, maxX: course.width, maxY: course.height };
}

function shade(hex: string, elevation: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const factor = 0.82 + Math.min(0.24, elevation * 0.018);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function drawDiamond(ctx: CanvasRenderingContext2D, center: Point, scale: number, fill: string) {
  const hw = TILE_W * scale / 2;
  const hh = TILE_H * scale / 2;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - hh);
  ctx.lineTo(center.x + hw, center.y);
  ctx.lineTo(center.x, center.y + hh);
  ctx.lineTo(center.x - hw, center.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeDiamond(ctx: CanvasRenderingContext2D, center: Point, scale: number, stroke: string) {
  const hw = TILE_W * scale / 2;
  const hh = TILE_H * scale / 2;
  ctx.beginPath(); ctx.moveTo(center.x, center.y - hh); ctx.lineTo(center.x + hw, center.y); ctx.lineTo(center.x, center.y + hh); ctx.lineTo(center.x - hw, center.y); ctx.closePath();
  ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(.55, scale * 2); ctx.stroke();
}

/** North-up isometric course overview and reusable per-hole thumbnail. */
export function HoleMinimap({ course, hole, holeIndex = 0, view, golfersRef, onCenter, thumbnail = false }: HoleMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<MinimapTransform | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [renderState, setRenderState] = useState<"loading" | "ready" | "error">("loading");
  const [baseVersion, setBaseVersion] = useState(0);

  useEffect(() => {
    setRenderState("loading");
    baseRef.current = null;
    transformRef.current = null;
    const timer = window.setTimeout(() => {
      try {
      const bounds = boundsFor(course, hole, holeIndex);
      const transform = makeMinimapTransform(bounds);
      transformRef.current = transform;
      const base = document.createElement("canvas");
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      base.width = SIZE * pixelRatio;
      base.height = SIZE * pixelRatio;
      const ctx = base.getContext("2d");
      if (!ctx) throw new Error("Unable to create the minimap canvas context.");
      ctx.scale(pixelRatio, pixelRatio);
      ctx.fillStyle = "#26372f";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Painter order for the fixed north-up 2:1 projection.
      for (let sum = Math.floor(bounds.minX + bounds.minY); sum <= Math.ceil(bounds.maxX + bounds.maxY); sum++) {
        for (let x = Math.floor(bounds.minX); x <= Math.ceil(bounds.maxX); x++) {
          const y = sum - x;
          if (x < 0 || y < 0 || x >= course.width || y >= course.height) continue;
          if (x < bounds.minX || y < bounds.minY || x > bounds.maxX || y > bounds.maxY) continue;
          const elevation = getElevation(course, x, y);
          const iso = worldToIso(x + 0.5, y + 0.5, elevation);
          const p = minimapCanvasPoint(iso, transform);
          const terrain = course.tiles[y * course.width + x];
          drawDiamond(ctx, p, transform.scale, shade(COLORS[terrain] ?? COLORS.rough, elevation));
          if (terrain === "water" || terrain === "wetland") {
            ctx.strokeStyle = "rgba(220,245,255,.48)";
            ctx.lineWidth = Math.max(.45, transform.scale * 2);
            ctx.beginPath();
            ctx.moveTo(p.x - TILE_W * transform.scale * .2, p.y);
            ctx.lineTo(p.x + TILE_W * transform.scale * .2, p.y);
            ctx.stroke();
          }
        }
      }
      const estate = course.estate;
      const parcelMap = estate ? decodeParcelMap(estate, course.width * course.height) : null;
      if (estate && parcelMap) {
        const owned = new Set(estate.ownedParcelIds);
        for (let y = Math.max(0, Math.floor(bounds.minY)); y <= Math.min(course.height - 1, Math.ceil(bounds.maxY)); y++) for (let x = Math.max(0, Math.floor(bounds.minX)); x <= Math.min(course.width - 1, Math.ceil(bounds.maxX)); x++) {
          const index = y * course.width + x;
          const parcelIndex = parcelMap[index];
          const iso = worldToIso(x + .5, y + .5, getElevation(course, x, y));
          const point = minimapCanvasPoint(iso, transform);
          if (!owned.has(estate.parcels[parcelIndex].id)) drawDiamond(ctx, point, transform.scale, "rgba(9,15,18,.35)");
          const boundary = x === 0 || y === 0 || x === course.width - 1 || y === course.height - 1 || parcelMap[index - 1] !== parcelIndex || parcelMap[index + 1] !== parcelIndex || parcelMap[index - course.width] !== parcelIndex || parcelMap[index + course.width] !== parcelIndex;
          if (boundary) strokeDiamond(ctx, point, transform.scale, owned.has(estate.parcels[parcelIndex].id) ? "rgba(117,220,135,.75)" : "rgba(255,239,188,.52)");
        }
      }
      const markerHoles = hole ? [hole] : course.holes;
      const activePin = course.activePinRotation ?? "A";
      for (const markerHole of markerHoles) {
        for (const teeSet of TEE_SETS) {
          const marker = getTeeBox(markerHole, teeSet);
          if (!marker) continue;
          const point = minimapCanvasPoint(worldToIso(marker.x + .5, marker.y + .5, getElevation(course, marker.x, marker.y)), transform);
          ctx.globalAlpha = teeSet === "member" ? 1 : .45;
          ctx.fillStyle = teeSet === "forward" ? "#efcf6a" : teeSet === "championship" ? "#202722" : "#f7f4e8";
          ctx.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
        }
        for (const rotation of PIN_ROTATIONS) {
          const marker = getPinPosition(markerHole, rotation);
          if (!marker) continue;
          const point = minimapCanvasPoint(worldToIso(marker.x + .5, marker.y + .5, getElevation(course, marker.x, marker.y)), transform);
          ctx.globalAlpha = rotation === activePin ? 1 : .35;
          ctx.fillStyle = "#e44842";
          ctx.beginPath(); ctx.arc(point.x, point.y, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      baseRef.current = base;
      setBaseVersion((version) => version + 1);
      setRenderState("ready");
      } catch (error) {
        // The shell must communicate a failed map rather than leaving an
        // indistinguishable blank panel. Rendering can recover on the next
        // course or hole update.
        console.error("Unable to render course minimap", error);
        setRenderState("error");
      }
    }, 0); // Yield once, then paint the first usable course frame immediately.
    return () => window.clearTimeout(timer);
  }, [course, hole, holeIndex]);

  useEffect(() => {
    if (collapsed) return;
    const render = () => {
      const canvas = canvasRef.current;
      const base = baseRef.current;
      const transform = transformRef.current;
      if (!canvas || !base || !transform) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(base, 0, 0, SIZE, SIZE);

      if (!thumbnail) {
        for (const golfer of golfersRef?.current ?? []) {
          const iso = worldToIso(golfer.x, golfer.y, getElevation(course, Math.round(golfer.x), Math.round(golfer.y)));
          const p = minimapCanvasPoint(iso, transform);
          ctx.fillStyle = golfer.mood < .35 ? "#d94b42" : golfer.mood > .75 ? "#7adb68" : "#f1d36c";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (view) {
          const corners = [
            { x: view.bounds.minX, y: view.bounds.minY }, { x: view.bounds.maxX, y: view.bounds.minY },
            { x: view.bounds.maxX, y: view.bounds.maxY }, { x: view.bounds.minX, y: view.bounds.maxY },
          ].map((p) => minimapCanvasPoint(worldToIso(p.x, p.y), transform));
          ctx.strokeStyle = "#fff1a6";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          corners.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
          ctx.closePath();
          ctx.stroke();
        }
      }
    };
    render();
    const interval = window.setInterval(render, 333); // live dots + viewport at 3 Hz
    return () => window.clearInterval(interval);
  }, [baseVersion, collapsed, course, golfersRef, thumbnail, view]);

  if (collapsed && !thumbnail) {
    return <button className="cc-minimap-toggle" onClick={() => setCollapsed(false)} aria-label={translateCurrent("minimap.open")}>◇</button>;
  }

  return (
    <div
      className={thumbnail ? "cc-hole-thumbnail" : "cc-minimap"}
      data-render-state={renderState}
      aria-busy={renderState === "loading" || undefined}
    >
      {!thumbnail && <button className="cc-minimap-collapse" onClick={() => setCollapsed(true)} aria-label={translateCurrent("minimap.collapse")}>−</button>}
      {!thumbnail && <div className="cc-minimap-compass" aria-label={translateCurrent("minimap.bearing", { degrees: view?.rotation ?? 0 })}>{translateCurrent("minimap.north")}<span style={{ transform: `rotate(${-(view?.rotation ?? 0)}deg)` }}>▲</span></div>}
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        aria-label={thumbnail ? `Isometric preview of hole ${holeIndex + 1}` : "Isometric course minimap"}
        title={onCenter ? translateCurrent("auto.ui.holeminimap.click.to.center.view") : undefined}
        onClick={(event) => {
          if (!onCenter || !transformRef.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const point = { x: (event.clientX - rect.left) * SIZE / rect.width, y: (event.clientY - rect.top) * SIZE / rect.height };
          const world = minimapPointToWorld(point, transformRef.current);
          onCenter({ x: Math.max(0, Math.min(course.width - 1, world.x)), y: Math.max(0, Math.min(course.height - 1, world.y)) });
        }}
      />
      {!thumbnail && renderState !== "ready" && (
        <div className="cc-minimap-status" role={renderState === "error" ? "alert" : "status"}>
          {renderState === "error" ? "Course map unavailable" : "Drawing course map…"}
        </div>
      )}
    </div>
  );
}
