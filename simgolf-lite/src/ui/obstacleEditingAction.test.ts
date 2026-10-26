import { describe, expect, it } from "vitest";
import type { ObstacleType } from "../game/models/types";
import type { PlantId } from "../game/models/plantTypes";
import { createObstacleEditingAction } from "./obstacleEditingAction";

function fixture(overrides: Partial<Parameters<typeof createObstacleEditingAction>[0]> = {}) {
  const calls: Array<[string, unknown]> = [];
  const action = createObstacleEditingAction({
    theme: "parkland",
    obstacleType: "tree",
    selectedPlantId: null,
    setObstacleType: value => calls.push(["obstacle", value]),
    setSelectedPlantId: value => calls.push(["plant", value]),
    setSelectedDesignItemId: value => calls.push(["item", value]),
    setEditorMode: value => calls.push(["mode", value]),
    setPaintError: value => calls.push(["error", value]),
    ...overrides,
  });
  return { action, calls };
}

function expected(type: ObstacleType, plant: PlantId | null, item: string) {
  return [["obstacle", type], ["plant", plant], ["item", item], ["mode", "OBSTACLE"], ["error", null]];
}

describe("obstacle editing action", () => {
  it.each([
    ["parkland", "tree", "parkland-oak"],
    ["parkland", "bush", "parkland-wild-shrub"],
    ["links", "tree", "links-hawthorn"],
    ["links", "bush", "links-gorse"],
    ["desert", "tree", "desert-mesquite"],
    ["desert", "bush", "desert-agave"],
    [undefined, "tree", "parkland-oak"],
    [undefined, "bush", "parkland-wild-shrub"],
  ] as const)("resolves the %s %s default without changing setter order", (theme, type, plant) => {
    const { action, calls } = fixture({ theme });
    action(type, null);
    expect(calls).toEqual(expected(type, plant, `plant:${plant}`));
  });

  it("creates an action without calling setters", () => {
    const { action, calls } = fixture();
    expect(calls).toEqual([]);
    action();
    expect(calls).toEqual(expected("tree", "parkland-oak", "plant:parkland-oak"));
  });

  it("uses captured obstacle and plant defaults for omitted and undefined arguments", () => {
    const { action, calls } = fixture({ obstacleType: "bush", selectedPlantId: "links-gorse" });
    action();
    action(undefined, undefined);
    expect(calls).toEqual([
      ...expected("bush", "links-gorse", "plant:links-gorse"),
      ...expected("bush", "links-gorse", "plant:links-gorse"),
    ]);
  });

  it("treats explicit null as a request for the biome default", () => {
    const { action, calls } = fixture({ obstacleType: "bush", selectedPlantId: "links-gorse" });
    action(undefined, null);
    expect(calls).toEqual(expected("bush", "parkland-wild-shrub", "plant:parkland-wild-shrub"));
  });

  it("keeps a valid imported plant that matches the requested obstacle", () => {
    const { action, calls } = fixture({ theme: "desert" });
    action("tree", "links-hawthorn");
    expect(calls).toEqual(expected("tree", "links-hawthorn", "plant:links-hawthorn"));
  });

  it.each([
    ["parkland-wild-shrub", "wrong obstacle type"],
    ["parkland-perennial-bed", "decoration plant"],
    ["missing-plant" as PlantId, "unknown runtime plant"],
  ] as const)("falls back from %s (%s) using the requested type", (plant, _reason) => {
    const { action, calls } = fixture({ theme: "links", obstacleType: "bush" });
    action("tree", plant);
    expect(calls).toEqual(expected("tree", "links-hawthorn", "plant:links-hawthorn"));
  });

  it.each(["parkland", "links", "desert", undefined] as const)("clears plant selection for rock in %s", theme => {
    const { action, calls } = fixture({ theme, selectedPlantId: "parkland-oak" });
    action("rock");
    expect(calls).toEqual(expected("rock", null, "nature:rock"));
  });

  it("preserves an explicit requested design item", () => {
    const { action, calls } = fixture();
    action("bush", null, "catalog:chosen-item");
    expect(calls).toEqual(expected("bush", "parkland-wild-shrub", "catalog:chosen-item"));
  });

  it.each(["tree", "rock"] as const)("preserves an empty requested item for %s", type => {
    const { action, calls } = fixture();
    action(type, null, "");
    expect(calls).toEqual(expected(type, type === "rock" ? null : "parkland-oak", ""));
  });

  it("keeps defaults separate for independent action lifetimes", () => {
    const first = fixture({ theme: "desert", obstacleType: "bush" });
    const second = fixture({ theme: "links", selectedPlantId: "links-hawthorn" });
    first.action();
    second.action();
    expect(first.calls).toEqual(expected("bush", "desert-agave", "plant:desert-agave"));
    expect(second.calls).toEqual(expected("tree", "links-hawthorn", "plant:links-hawthorn"));
  });
});
