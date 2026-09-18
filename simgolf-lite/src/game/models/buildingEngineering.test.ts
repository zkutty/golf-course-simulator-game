import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { emptyEditorEditHistory, recordEditorEdit, redoEditorEdit, undoEditorEdit } from "../editor/editorHistory";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./defaults";
import { createNewGame } from "../gen/newGame";
import { isOwnedTile } from "../estate/estate";
import { planBuildingSiteGrade } from "./buildingSiteGrade";
import type { Building, Course, Terrain } from "./types";
import {
  BUILDING_SPECS,
  buildingSiteNeedsRepair,
  buildingTiles,
  quoteBuildingPlacement,
  quoteBuildingSiteRepair,
} from "./buildings";

function course(width = 12, height = 12, elevation = 2): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: new Array<Terrain>(width * height).fill("fairway"),
    elevations: new Array(width * height).fill(elevation),
    holes: [],
    obstacles: [],
    buildings: [],
    decorations: [],
    estate: undefined,
    property: undefined,
  };
}

function setFootprint(input: Course, building: Building, values: readonly number[]) {
  buildingTiles(building).forEach((tile, index) => {
    input.elevations[tile.y * input.width + tile.x] = values[index];
  });
}

function state(input = course(), cash = 100_000): GameState {
  return {
    course: input,
    world: { ...DEFAULT_WORLD, cash, economicPressure: "balanced" },
    selectedTerrain: "fairway",
    terrainVersion: 0,
    obstaclesVersion: 0,
    markersVersion: 0,
    economyVersion: 0,
  };
}

const capital = { spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} };

describe("ZK-774 engineered building sites", () => {
  it.each([
    ["flat", [2, 2, 2, 2], 0, 0],
    ["gentle cross-slope", [1, 2, 2, 3], 1, 1],
    ["uphill cut", [1, 2, 3, 4], 1, 3],
    ["downhill fill", [0, 1, 2, 2], 0, 3],
  ] as const)("quotes %s sites with an inspectable shell/earthwork/foundation split", (_name, elevations, minimumCut, minimumFill) => {
    const input = course();
    setFootprint(input, { type: "pro_shop", x: 4, y: 4 }, elevations);
    const quote = quoteBuildingPlacement(input, "pro_shop", 4, 4);
    expect(quote.ok).toBe(true);
    expect(quote.grade?.costBaseline.cutSteps).toBeGreaterThanOrEqual(minimumCut);
    expect(quote.grade?.costBaseline.fillSteps).toBeGreaterThanOrEqual(minimumFill);
    expect(quote.totalCost).toBe(quote.buildingCost + quote.earthworkCost + quote.foundationCost);
    expect(quote.buildingCost).toBe(BUILDING_SPECS.pro_shop.buildCost);
  });

  it("returns stable, specific blockers for steep, shoreline, ownership, and entrance failures", () => {
    const steep = course();
    setFootprint(steep, { type: "pro_shop", x: 4, y: 4 }, [0, 0, 0, 9]);
    expect(quoteBuildingPlacement(steep, "pro_shop", 4, 4)).toMatchObject({ ok: false, reasonCode: "excessive_slope" });

    const shoreline = course();
    shoreline.tiles[3 * shoreline.width + 4] = "water"; // transition ring, not footprint
    expect(quoteBuildingPlacement(shoreline, "pro_shop", 4, 4)).toMatchObject({ ok: false, reasonCode: "water_or_wetland" });
    const wetland = course();
    wetland.tiles[4 * wetland.width + 4] = "wetland";
    expect(quoteBuildingPlacement(wetland, "pro_shop", 4, 4)).toMatchObject({ ok: false, reasonCode: "water_or_wetland" });

    const boundary = course();
    boundary.property = {
      assets: [], units: [], easements: [{ id: "edge", x: 3, y: 3, width: 1, height: 1, protected: true }],
    } as unknown as Course["property"];
    expect(quoteBuildingPlacement(boundary, "pro_shop", 4, 4)).toMatchObject({ ok: false, reasonCode: "ownership_boundary" });

    const entrance = course();
    entrance.obstacles = [
      { x: 5, y: 6, type: "rock" }, { x: 6, y: 5, type: "rock" },
      { x: 3, y: 5, type: "rock" }, { x: 5, y: 3, type: "rock" },
    ];
    expect(quoteBuildingPlacement(entrance, "pro_shop", 4, 4)).toMatchObject({ ok: false, reasonCode: "unusable_entrance" });
  });

  it("commits grade, structure, provenance, cash, and revisions atomically and rejects a stale quote", () => {
    const input = course();
    setFootprint(input, { type: "snack_bar", x: 4, y: 4 }, [0, 1, 2, 2]);
    const before = state(input);
    const quote = quoteBuildingPlacement(before.course, "snack_bar", 4, 4);
    const stale = applyAction(before, { type: "PLACE_BUILDING", buildingType: "snack_bar", x: 4, y: 4, quotedTotal: quote.totalCost + 1 });
    expect(stale).toStrictEqual(before);

    const placed = applyAction(before, { type: "PLACE_BUILDING", buildingType: "snack_bar", x: 4, y: 4, quotedTotal: quote.totalCost });
    expect(placed.world.cash).toBe(before.world.cash - quote.totalCost);
    expect(placed.course.buildings).toHaveLength(1);
    expect(placed.course.buildings[0].siteGrade).toMatchObject({ version: 1, supportElevation: quote.grade?.supportElevation });
    expect(buildingTiles(placed.course.buildings[0]).map(({ x, y }) => placed.course.elevations[y * placed.course.width + x]))
      .toEqual(new Array(4).fill(quote.grade?.supportElevation));
    expect([placed.terrainVersion, placed.economyVersion]).toEqual([1, 1]);
  });

  it("keeps placement undo/redo exact and teardown refunds the shell/foundation without refunding earthwork", () => {
    const before = state(course());
    before.course.elevations[4 * before.course.width + 4] = 1;
    const quote = quoteBuildingPlacement(before.course, "cart_rental", 4, 4);
    const placed = applyAction(before, { type: "PLACE_BUILDING", buildingType: "cart_rental", x: 4, y: 4, quotedTotal: quote.totalCost });
    const history = recordEditorEdit(emptyEditorEditHistory(), before, placed, capital, { type: "PLACE_BUILDING", buildingType: "cart_rental", x: 4, y: 4, quotedTotal: quote.totalCost });
    const undone = undoEditorEdit(history, placed, capital)!;
    expect(undone.snapshot.course).toBe(before.course);
    expect(undone.snapshot.world).toBe(before.world);
    const redone = redoEditorEdit(undone.history, undone.snapshot, undone.snapshot.capital)!;
    expect(redone.snapshot.course).toBe(placed.course);
    expect(redone.snapshot.world).toBe(placed.world);

    const removed = applyAction(placed, { type: "REMOVE_BUILDING", x: 4, y: 4 });
    const expectedSalvage = Math.round((BUILDING_SPECS.cart_rental.buildCost + quote.foundationCost) * 0.35);
    expect(removed.world.cash).toBe(placed.world.cash + expectedSalvage);
    expect(removed.course.elevations).toEqual(placed.course.elevations);
  });

  it("protects occupied pads and rebuilds a touched transition shoulder in one sculpt transaction", () => {
    const initial = state(course());
    const quote = quoteBuildingPlacement(initial.course, "pro_shop", 4, 4);
    const placed = applyAction(initial, { type: "PLACE_BUILDING", buildingType: "pro_shop", x: 4, y: 4, quotedTotal: quote.totalCost });
    const support = placed.course.buildings[0].siteGrade!.supportElevation;
    const footprintIndex = 4 * placed.course.width + 4;
    const ringIndex = 3 * placed.course.width + 4;
    const sculpted = applyAction(placed, { type: "SCULPT_TILES", deltas: [
      { x: 4, y: 4, delta: 4 },
      { x: 4, y: 3, delta: 4 },
    ] });
    expect(sculpted.course.elevations[footprintIndex]).toBe(support);
    expect(Math.abs(sculpted.course.elevations[ringIndex] - support)).toBeLessThanOrEqual(1);
    expect(sculpted.terrainVersion).toBe(placed.terrainVersion + 1);
    expect(sculpted.world.cash).toBeLessThan(placed.world.cash);
  });

  it("preserves a legacy invalid site until an explicit repair transaction", () => {
    const legacy = course();
    const building: Building = { id: "legacy-shop", type: "pro_shop", x: 4, y: 4, tier: 1, price: 20 };
    legacy.buildings = [building];
    setFootprint(legacy, building, [1, 2, 3, 4]);
    const before = state(legacy);
    const beforeElevations = [...before.course.elevations];
    expect(buildingSiteNeedsRepair(before.course, building)).toBe(true);
    const quote = quoteBuildingSiteRepair(before.course, building);
    expect(quote.ok).toBe(true);
    expect(before.course.elevations).toEqual(beforeElevations);

    const repaired = applyAction(before, { type: "REPAIR_BUILDING_SITE", x: 4, y: 4, quotedTotal: quote.totalCost });
    expect(repaired.course.buildings[0].siteGrade?.version).toBe(1);
    expect(buildingSiteNeedsRepair(repaired.course, repaired.course.buildings[0])).toBe(false);
    expect(repaired.world.cash).toBe(before.world.cash - quote.totalCost);
  });

  it.each([
    ["parkland", 1], ["parkland", 424242], ["links", 7], ["desert", 42],
  ] as const)("sites the %s starter clubhouse deterministically on a complete owned, stable site for seed %i", (theme, seed) => {
    const first = createNewGame({ mode: "challenge", courseName: "Starter", theme, seed, difficulty: "normal" });
    const second = createNewGame({ mode: "challenge", courseName: "Starter", theme, seed, difficulty: "normal" });
    const building = first.course.buildings.find((candidate) => candidate.type === "clubhouse")!;
    expect(building).toEqual(second.course.buildings.find((candidate) => candidate.type === "clubhouse"));
    const plan = planBuildingSiteGrade(first.course, building);
    expect(plan.mutations).toEqual([]);
    expect([...plan.footprint, ...plan.transitionRing].every((cell) => isOwnedTile(first.course, cell.x, cell.y))).toBe(true);
    expect(building.siteGrade).toMatchObject({ version: 1, supportElevation: plan.supportElevation });
  });
});
