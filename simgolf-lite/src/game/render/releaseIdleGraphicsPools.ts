import type * as PIXI from "pixi.js";

type GraphicsPoolApi = Pick<typeof PIXI, "BigPool" | "GraphicsContextRenderData" | "BatchableGraphics">;

/** Release cross-session allocation capacity only after an application has finished teardown. */
export function releaseIdleGraphicsPools(pixi: GraphicsPoolApi): void {
  for (const pool of [pixi.BigPool.getPool(pixi.GraphicsContextRenderData), pixi.BigPool.getPool(pixi.BatchableGraphics)]) {
    // Pool.clear resets accounting, so a live peer must keep its entire pool.
    if (pool.totalUsed === 0) pool.clear();
  }
}
