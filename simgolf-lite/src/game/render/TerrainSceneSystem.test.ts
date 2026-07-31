import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type GameState } from "../gameState";
import { createRenderSnapshot } from "./renderSnapshot";
import { TerrainSceneSystem } from "./TerrainSceneSystem";

function snapshot(state: GameState) {
  return createRenderSnapshot({ state });
}

describe("TerrainSceneSystem", () => {
  it("ignores cash, selection, and overlay-only changes but updates terrain", () => {
    const calls: string[] = [];
    const system = new TerrainSceneSystem<void>({
      create: () => calls.push("create"), update: () => calls.push("update"), destroy: () => calls.push("destroy"),
    });
    const first = snapshot(DEFAULT_STATE);
    expect(system.sync(undefined, first)).toBe("created");
    expect(system.sync(undefined, snapshot({ ...DEFAULT_STATE, world: { ...DEFAULT_STATE.world, cash: 1 } }))).toBe("unchanged");
    expect(system.sync(undefined, snapshot({ ...DEFAULT_STATE, selectedTerrain: "rough" }))).toBe("unchanged");
    expect(system.sync(undefined, snapshot({ ...DEFAULT_STATE, terrainVersion: 1 }))).toBe("updated");
    expect(calls).toEqual(["create", "update"]);
  });

  it("recreates on course replacement and tears down exactly once", () => {
    const calls: string[] = [];
    const system = new TerrainSceneSystem<void>({
      create: () => calls.push("create"), update: () => calls.push("update"), destroy: () => calls.push("destroy"),
    });
    system.sync(undefined, snapshot(DEFAULT_STATE));
    system.sync(undefined, snapshot({ ...DEFAULT_STATE, course: { ...DEFAULT_STATE.course } }));
    system.destroy(undefined);
    system.destroy(undefined);
    expect(calls).toEqual(["create", "destroy", "create", "destroy"]);
  });
});
