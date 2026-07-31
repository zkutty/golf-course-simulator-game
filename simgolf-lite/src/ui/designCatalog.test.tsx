import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "../game/models/biomes";
import { createNewGame } from "../game/gen/newGame";
import {
  DECORATION_KINDS,
  DECORATION_SPECS,
  decorationCost,
  decorationRemovalQuote,
} from "../game/models/decorations";
import {
  PLANT_REGISTRY,
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
} from "../game/models/plantRegistry";
import { PLANT_IDS } from "../game/models/plantTypes";
import {
  terrainConstructionUnitCost,
  terrainSalvageUnitValue,
} from "../game/models/terrainEconomics";
import { TERRAIN_KINDS } from "../game/render/terrainMaterials";
import { seasonalVisualState } from "../game/presentation/seasonalVisualState";
import type { Decoration } from "../game/models/types";
import { translate } from "../i18n/core";
import { DesignDock } from "./DesignDock";
import {
  buildDesignCatalog,
  designCatalogCoverage,
} from "./designCatalog";

describe("registry-driven Design dock catalog", () => {
  it("covers every registered terrain, plant, and decor in every biome and season", () => {
    for (const theme of BIOME_KEYS) {
      for (const season of ["spring", "summer", "autumn", "winter"] as const) {
        const catalog = buildDesignCatalog({
          theme,
          season,
          weatherKind: season === "summer" ? "heat" : "clear",
          costMult: 1.2,
          colorVision: "deuteranopia",
        });
        const coverage = designCatalogCoverage(catalog);
        expect(coverage.terrain).toBe(TERRAIN_KINDS.length);
        expect(coverage.plants).toBe(PLANT_IDS.length);
        expect(coverage.decor).toBe(DECORATION_KINDS.length);
        const items = [...catalog.terrain, ...catalog.nature, ...catalog.decor];
        expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
        for (const item of items) {
          expect(item.atlasFrame.length).toBeGreaterThan(0);
          expect(Number.isFinite(item.buildPrice)).toBe(true);
          expect(Number.isFinite(item.salvageValue)).toBe(true);
          expect(Number.isFinite(item.weeklyCare)).toBe(true);
          expect(Number.isFinite(item.waterDemand)).toBe(true);
          expect(item.degradationPath).toContain("→");
          expect(["low", "watch", "high"]).toContain(item.seasonalRisk.level);
        }
      }
    }
  });

  it("quotes the exact shared terrain, plant, and decoration authorities", () => {
    for (const theme of BIOME_KEYS) {
      const costMult = 1.35;
      const catalog = buildDesignCatalog({
        theme,
        season: "summer",
        weatherKind: "drought",
        costMult,
      });
      for (const item of catalog.terrain) {
        expect(item.buildPrice).toBe(
          terrainConstructionUnitCost(item.terrain!, theme, costMult),
        );
        expect(item.salvageValue).toBe(
          terrainSalvageUnitValue(item.terrain!, theme, costMult),
        );
      }
      for (const item of catalog.nature.filter((entry) => entry.plantId)) {
        const plant = PLANT_REGISTRY[item.plantId!];
        if (plant.semantics.kind === "obstacle") {
          expect(item.buildPrice).toBe(naturalFeatureInstallationQuote({
            theme,
            obstacleType: plant.semantics.obstacleType,
            plantId: plant.id,
            costMult,
          }).net);
          expect(item.salvageValue).toBe(naturalFeatureRemovalQuote({
            theme,
            obstacle: {
              type: plant.semantics.obstacleType,
              plantId: plant.id,
              origin: "player",
            },
            costMult,
          }).salvage);
        } else {
          const decoration: Decoration = {
            kind: plant.semantics.decorationKind,
            x: 0,
            y: 0,
            rotation: 0,
            plantId: plant.id,
            origin: "player",
          };
          expect(item.buildPrice).toBe(
            decorationCost(decoration, theme, costMult),
          );
          expect(item.salvageValue).toBe(
            decorationRemovalQuote(decoration, theme, costMult).salvage,
          );
        }
      }
      for (const item of catalog.decor) {
        const spec = DECORATION_SPECS[item.decorationKind!];
        const decoration: Decoration = {
          kind: item.decorationKind!,
          x: 0,
          y: 0,
          rotation: 0,
          ...(item.plantId
            ? { plantId: item.plantId, origin: "player" as const }
            : {}),
          ...(spec.defaultSpan ? { span: spec.defaultSpan } : {}),
        };
        expect(item.buildPrice).toBe(
          decorationCost(decoration, theme, costMult),
        );
        expect(item.salvageValue).toBe(
          decorationRemovalQuote(decoration, theme, costMult).salvage,
        );
      }
    }
  });

  it("re-quotes bridge and boardwalk facts from the live selected span", () => {
    const theme = "parkland";
    const costMult = 1.25;
    const prices: number[] = [];
    for (const requestedSpan of [1, 4, 8]) {
      const catalog = buildDesignCatalog({
        theme,
        season: "summer",
        weatherKind: "clear",
        costMult,
        decorationSpan: requestedSpan,
      });
      for (const kind of ["bridge", "boardwalk"] as const) {
        const spec = DECORATION_SPECS[kind];
        const span = Math.min(spec.maxSpan ?? 1, requestedSpan);
        const decoration: Decoration = {
          kind,
          x: 0,
          y: 0,
          rotation: 0,
          span,
        };
        const item = catalog.decor.find(
          (candidate) => candidate.id === `decor:${kind}`,
        )!;
        expect(item.buildPrice).toBe(
          decorationCost(decoration, theme, costMult),
        );
        expect(item.salvageValue).toBe(
          decorationRemovalQuote(decoration, theme, costMult).salvage,
        );
        if (kind === "bridge") prices.push(item.buildPrice);
      }
    }
    expect(new Set(prices).size).toBeGreaterThan(1);
  });

  it("uses the authoritative active-season treatments for terrain and plants", () => {
    const game = createNewGame({
      mode: "sandbox",
      courseName: "Design dock seasons",
      seed: 648_053,
      theme: "parkland",
      difficulty: "normal",
    });
    const stateAt = (absoluteDay: number) => seasonalVisualState({
      course: game.course,
      world: {
        ...game.world,
        week: Math.floor(absoluteDay / 7) + 1,
      },
      day: absoluteDay % 7,
    });
    const springState = stateAt(28);
    const winterState = stateAt(196);
    const catalogFor = (
      state: ReturnType<typeof seasonalVisualState>,
    ) => buildDesignCatalog({
      theme: "parkland",
      season: state.climate.calendar.season,
      weatherKind: state.weather.kind,
      seasonalVisualState: state,
      graphicsQuality: "high",
      reducedMotion: false,
    });
    const spring = catalogFor(springState);
    const winter = catalogFor(winterState);
    const treatment = (
      catalog: ReturnType<typeof catalogFor>,
      id: string,
    ) => {
      const item = [...catalog.terrain, ...catalog.nature]
        .find((candidate) => candidate.id === id)!;
      return {
        tint: item.previewTint,
        alpha: item.previewAlpha,
        color: item.fallbackColor,
        variant: item.previewSeasonalVariant,
      };
    };
    expect(treatment(spring, "terrain:fairway"))
      .not.toEqual(treatment(winter, "terrain:fairway"));
    expect(treatment(spring, "plant:parkland-oak"))
      .not.toEqual(treatment(winter, "plant:parkland-oak"));

    const safeBase = buildDesignCatalog({
      theme: "parkland",
      season: "winter",
      weatherKind: "clear",
    });
    expect(safeBase.terrain[0].previewTint).toBe(0xffffff);
    expect(safeBase.nature.find((item) => item.id === "plant:parkland-oak"))
      .toMatchObject({
        previewTint: 0xffffff,
        previewAlpha: 1,
        previewSeasonalVariant: "parkland-oak:base",
      });
  });

  it("routes every category label and supporting copy through typed translations", () => {
    const catalog = buildDesignCatalog({
      theme: "desert",
      season: "summer",
      weatherKind: "drought",
      t: (key, params) => translate("pseudo", key, params),
    });
    expect(catalog.terrain.every((item) => item.label.startsWith("⟦")))
      .toBe(true);
    expect(catalog.nature.every((item) => item.label.startsWith("⟦")))
      .toBe(true);
    expect(catalog.decor.every((item) => item.label.startsWith("⟦")))
      .toBe(true);
    expect(catalog.terrain.every((item) =>
      item.degradationPath.startsWith("⟦")
      && item.seasonalRisk.label.startsWith("⟦")
    )).toBe(true);
    expect(catalog.nature.find(
      (item) => item.id === "plant:parkland-oak",
    )?.fallbackReason).toMatch(/^⟦/u);
  });

  it("documents same-biome art fallbacks without changing semantic ids", () => {
    const desert = buildDesignCatalog({
      theme: "desert",
      season: "summer",
      weatherKind: "drought",
    });
    const importedOak = desert.nature.find(
      (item) => item.id === "plant:parkland-oak",
    )!;
    expect(importedOak.ecologicalFit).toBe("imported");
    expect(importedOak.atlasFrame.startsWith("desert_")).toBe(true);
    expect(importedOak.fallbackReason).toContain("preserving Oak economics and semantics");
    expect(importedOak.seasonalRisk.level).toBe("high");
  });

  it("renders one accessible listbox with persistent inspector and exact facts", () => {
    const catalog = buildDesignCatalog({
      theme: "parkland",
      season: "spring",
      weatherKind: "rain",
    });
    const html = renderToStaticMarkup(
      <DesignDock
        theme="parkland"
        quality="low"
        catalog={catalog}
        selectedItemId="terrain:fairway"
        cash={25_000}
        reputation={100}
        terrainTool="curve"
        onTerrainTool={() => undefined}
        terrainBrushWidth={5}
        onTerrainBrushWidth={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onSelect={() => undefined}
        decorationAction="place"
        onDecorationAction={() => undefined}
        decorationRotation={0}
        onDecorationRotation={() => undefined}
        decorationSpan={3}
        onDecorationSpan={() => undefined}
        onOpenGolfopedia={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Course design dock"');
    expect(html).toContain('data-tutorial-target="terrain-palette"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('id="design-tab-terrain"');
    expect(html).toContain('aria-controls="design-panel-terrain"');
    expect(html).toContain('id="design-panel-terrain"');
    expect(html).toContain('id="design-panel-nature"');
    expect(html).toContain('id="design-panel-decor"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-seasonal-variant=');
    expect(html).toContain('data-preview-tint=');
    expect(html).toContain('aria-label="Selected design material details"');
    expect(html).toContain("Weekly care");
    expect(html).toContain("Current-season risk");
    expect(html).toContain("Terrain brush width");
  });
});
