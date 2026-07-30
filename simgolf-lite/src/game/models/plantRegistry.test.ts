import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "./biomes";
import {
  PLANT_REGISTRY,
  auditPlantRegistry,
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
  plantFitForBiome,
  plantFitMultipliers,
} from "./plantRegistry";
import { PLANT_IDS } from "./plantTypes";
import { pickNaturalProp } from "../render/naturalProps";

describe("semantic plant registry", () => {
  it("defines every stable id with exhaustive biome fit and safe semantics", () => {
    expect(Object.keys(PLANT_REGISTRY)).toEqual(PLANT_IDS);
    expect(auditPlantRegistry()).toEqual([]);
    for (const id of PLANT_IDS) {
      expect(PLANT_REGISTRY[id].id).toBe(id);
      expect(Object.keys(PLANT_REGISTRY[id].ecologicalFit)).toEqual(BIOME_KEYS);
      expect(PLANT_REGISTRY[id].safeVisualFallback.kind)
        .toBe(PLANT_REGISTRY[id].semantics.kind);
    }
    expect(PLANT_REGISTRY["links-hawthorn"].seasonalProfile)
      .toBe("coastal-deciduous");
  });

  it("applies exact fit multipliers and makes imported plants costlier to own", () => {
    expect(plantFitForBiome("parkland", "parkland-oak")).toBe("native");
    expect(plantFitForBiome("desert", "parkland-oak")).toBe("imported");
    expect(plantFitMultipliers("parkland", "parkland-oak")).toEqual({
      installationMultiplier: .75,
      careMultiplier: .70,
      waterMultiplier: .70,
    });
    expect(plantFitMultipliers("desert", "parkland-oak")).toEqual({
      installationMultiplier: 1.60,
      careMultiplier: 1.75,
      waterMultiplier: 1.60,
    });
    const native = naturalFeatureInstallationQuote({
      theme: "parkland",
      obstacleType: "tree",
      plantId: "parkland-oak",
    });
    const imported = naturalFeatureInstallationQuote({
      theme: "desert",
      obstacleType: "tree",
      plantId: "parkland-oak",
    });
    expect(imported.charged).toBeGreaterThan(native.charged);
  });

  it("charges natural clearing while capping authored-feature salvage at 50%", () => {
    const natural = naturalFeatureRemovalQuote({
      theme: "links",
      obstacle: { type: "bush" },
    });
    expect(natural).toMatchObject({
      net: 40,
      charged: 40,
      refunded: 0,
      salvage: 0,
    });

    const player = naturalFeatureRemovalQuote({
      theme: "links",
      obstacle: {
        type: "bush",
        plantId: "links-gorse",
        origin: "player",
      },
    });
    const installed = naturalFeatureInstallationQuote({
      theme: "links",
      obstacleType: "bush",
      plantId: "links-gorse",
    }).gross;
    expect(player.net).toBe(-player.salvage);
    expect(player.salvage).toBeLessThanOrEqual(installed * .5);
  });

  it("retains semantic identity but always falls back inside the active biome", () => {
    const context = {
      runSeed: 17,
      obstacle: {
        x: 3,
        y: 4,
        type: "tree" as const,
        plantId: "parkland-oak" as const,
        origin: "player" as const,
      },
      terrain: "rough" as const,
      elevation: 0,
      nearWater: false,
      cultivated: true,
    };
    expect(pickNaturalProp({ ...context, theme: "parkland" }).variant.frame)
      .toBe("parkland_tree_oak");
    expect(pickNaturalProp({ ...context, theme: "desert" }).variant.frame)
      .toMatch(/^desert_tree_/);
  });
});
