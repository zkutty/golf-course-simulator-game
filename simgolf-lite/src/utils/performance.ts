/**
 * Performance utilities and instrumentation
 */

import { useRef, useCallback } from "react";

export const DEBUG_PERF = false; // Set to true to enable performance logging

interface PerfStats {
  reactRenders: number;
  evaluateHoleCalls: number;
  drawFrames: number;
  terrainLayerRebuilds: number;
  obstacleLayerRebuilds: number;
  reducerDispatches: number;
  canvasRenderCount: number;
  pixiRenderCount: number;
  lastResetTime: number;
}

const stats: PerfStats = {
  reactRenders: 0,
  evaluateHoleCalls: 0,
  drawFrames: 0,
  terrainLayerRebuilds: 0,
  obstacleLayerRebuilds: 0,
  reducerDispatches: 0,
  canvasRenderCount: 0,
  pixiRenderCount: 0,
  lastResetTime: performance.now(),
};

let logInterval: number | null = null;

function startLogging() {
  if (!DEBUG_PERF) return;
  if (logInterval) return;
  
  logInterval = window.setInterval(() => {
    const elapsed = (performance.now() - stats.lastResetTime) / 1000;
    if (elapsed > 0) {
      console.log("[PERF]", {
        analyzeHoleCallsPerSec: (stats.evaluateHoleCalls / elapsed).toFixed(1),
        reducerDispatchesPerSec: (stats.reducerDispatches / elapsed).toFixed(1),
        canvasRendersPerSec: (stats.canvasRenderCount / elapsed).toFixed(1),
        pixiRendersPerSec: (stats.pixiRenderCount / elapsed).toFixed(1),
        reactRendersPerSec: (stats.reactRenders / elapsed).toFixed(1),
        drawFramesPerSec: (stats.drawFrames / elapsed).toFixed(1),
        terrainRebuilds: stats.terrainLayerRebuilds,
        obstacleRebuilds: stats.obstacleLayerRebuilds,
      });
      // Reset counters
      stats.reactRenders = 0;
      stats.evaluateHoleCalls = 0;
      stats.drawFrames = 0;
      stats.reducerDispatches = 0;
      stats.canvasRenderCount = 0;
      stats.pixiRenderCount = 0;
      stats.lastResetTime = performance.now();
    }
  }, 1000);
}

if (DEBUG_PERF) {
  startLogging();
}

export function logReactRender() {
  if (DEBUG_PERF) stats.reactRenders++;
}

export function logEvaluateHole(durationMs?: number) {
  if (DEBUG_PERF) {
    stats.evaluateHoleCalls++;
    if (durationMs !== undefined) {
      console.log(`[PERF] evaluateHole took ${durationMs.toFixed(2)}ms`);
    }
  }
}

export function logDrawFrame() {
  if (DEBUG_PERF) stats.drawFrames++;
}

export function logTerrainLayerRebuild(durationMs: number) {
  if (DEBUG_PERF) {
    stats.terrainLayerRebuilds++;
    console.log(`[PERF] rebuildTerrainLayer took ${durationMs.toFixed(2)}ms`);
  }
}

export function logObstacleLayerRebuild(durationMs: number) {
  if (DEBUG_PERF) {
    stats.obstacleLayerRebuilds++;
    console.log(`[PERF] rebuildObstacleLayer took ${durationMs.toFixed(2)}ms`);
  }
}

export function logReducerDispatch() {
  if (DEBUG_PERF) stats.reducerDispatches++;
}

export function logCanvasRender() {
  if (DEBUG_PERF) stats.canvasRenderCount++;
}

export function logPixiRender() {
  if (DEBUG_PERF) stats.pixiRenderCount++;
}

/**
 * RAF invalidation helper - ensures only one RAF is pending
 */
export function useRafInvalidation() {
  const rafRef = useRef<number | null>(null);
  
  const invalidate = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
      });
    }
  }, []);
  
  return { invalidate, rafRef };
}

