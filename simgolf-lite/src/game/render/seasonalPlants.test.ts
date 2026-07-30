import { describe, expect, it } from "vitest";
import type { SeasonalVisualState } from "../presentation/seasonalVisualState";
import type { SeasonalPlantClimate } from "./seasonalPlants";
import {
  seasonalDecorationPlantForm,
  seasonalPlantClimate,
  seasonalPlantPresentation,
  seasonalPlantSceneSignature,
} from "./seasonalPlants";

const climate = (
  overrides: Partial<SeasonalPlantClimate> = {},
): SeasonalPlantClimate => {
  const foliage = overrides.foliage ?? "full";
  return {
    biome: "parkland",
    absoluteDay: 87,
    season: "summer",
    seasonProgress: 0.4,
    foliage,
    foliageFrom: overrides.foliageFrom ?? foliage,
    foliageTo: overrides.foliageTo ?? foliage,
    transitionBlend: 0,
    dormancy: 0.08,
    flowering: 0.35,
    dryness: 0.35,
    windMph: 8,
    temperatureF: 76,
    weatherKind: "clear",
    exposure: "moderate",
    ...overrides,
  };
};

const presentation = (
  overrides: Partial<Parameters<typeof seasonalPlantPresentation>[0]> = {},
) => seasonalPlantPresentation({
  identity: "parkland-oak",
  profile: "deciduous",
  form: "canopy",
  x: 12,
  y: 18,
  cultivated: false,
  elevation: 1,
  nearWater: false,
  climate: climate(),
  ...overrides,
});

function state(
  overrides: {
    day?: number;
    kind?: SeasonalPlantClimate["weatherKind"];
    wind?: number;
    dryness?: number;
    foliage?: SeasonalPlantClimate["foliage"];
  } = {},
): SeasonalVisualState {
  const day = overrides.day ?? 87;
  return {
    climate: {
      biome: "parkland",
      calendar: {
        absoluteDay: day,
        year: 1,
        weekOfYear: 13,
        season: "summer",
        weekInSeason: 5,
        dayOfWeek: 2,
        seasonProgress: 0.4,
      },
      identity: {
        regime: "temperate-four-season",
        exposure: "moderate",
      },
      transition: {
        fromSeason: "summer",
        toSeason: "summer",
        blend: 0,
        phase: "stable",
      },
      climate: {
        targetTemperatureF: 76,
        precipitationChance: 0.2,
        windBaseMph: 8,
        stormChance: 0.04,
        droughtChance: 0.06,
      },
      vegetation: {
        dormancy: 0.08,
        flowering: 0.35,
        foliage: {
          from: overrides.foliage ?? "full",
          to: overrides.foliage ?? "full",
          dominant: overrides.foliage ?? "full",
        },
        moisture: {
          from: "balanced",
          to: "balanced",
          dominant: "balanced",
        },
      },
      frost: {
        enabled: false,
        maximumTemperatureF: 34,
        precipitationChanceMultiplier: 0.7,
      },
      snow: {
        enabled: false,
        maximumTemperatureF: 32,
        chance: 0,
      },
    },
    weather: {
      absoluteDay: day,
      kind: overrides.kind ?? "clear",
      temperatureF: 76,
      windMph: overrides.wind ?? 8,
      rainInches: 0,
      severity: 0,
      theme: "parkland",
      season: "summer",
    },
    renderer: {
      sceneTint: 0xffffff,
      vegetationDormancy: 0.08,
      flowering: 0.35,
      wetness: 1 - (overrides.dryness ?? 0.35),
      dryness: overrides.dryness ?? 0.35,
      frost: 0,
    },
  } as SeasonalVisualState;
}

describe("ZK-568 seasonal vegetation presentation", () => {
  it("provides bounded safe treatments for every profile and plant form", () => {
    const profiles = [
      "deciduous",
      "evergreen",
      "flowering",
      "coastal-heath",
      "coastal-deciduous",
      "drought-deciduous",
      "succulent",
    ] as const;
    const forms = ["canopy", "shrub", "flower", "ground-cover"] as const;
    for (const profile of profiles) {
      for (const form of forms) {
        const result = presentation({ profile, form });
        expect(result.tint).toBeGreaterThanOrEqual(0);
        expect(result.tint).toBeLessThanOrEqual(0xffffff);
        expect(result.alpha).toBeGreaterThanOrEqual(0.68);
        expect(result.alpha).toBeLessThanOrEqual(1);
        expect(result.scaleX).toBeGreaterThanOrEqual(0.78);
        expect(result.scaleY).toBeGreaterThanOrEqual(0.9);
        expect(result.shadowScale).toBeGreaterThanOrEqual(0.62);
        expect(result.swayScale).toBeGreaterThanOrEqual(0);
        expect(result.signature).toContain("parkland-oak");
      }
    }
  });

  it("uses an immutable same-biome base treatment when climate is unavailable", () => {
    expect(presentation({ climate: undefined })).toEqual({
      variant: "base",
      tint: 0xffffff,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      shadowScale: 1,
      swayScale: 1,
      bloomAccent: 0,
      leafFallAccent: 0,
      signature: "parkland-oak:base",
    });
    expect(seasonalPlantSceneSignature(undefined)).toBe(
      "seasonal-plants:base",
    );
  });

  it("keeps geography and phenology plausible instead of importing temperate states", () => {
    const winter = climate({
      season: "winter",
      foliage: "dormant",
      dormancy: 0.94,
      flowering: 0,
      temperatureF: 29,
    });
    expect(presentation({ profile: "deciduous", climate: winter }).variant)
      .toBe("dormant");
    expect(presentation({ profile: "evergreen", climate: winter }).variant)
      .toBe("evergreen");

    const aridAutumn = climate({
      biome: "desert",
      season: "autumn",
      foliage: "sparse",
      dormancy: 0.5,
      dryness: 0.88,
      weatherKind: "drought",
    });
    expect(["autumn-color", "leaf-fall", "dormant"]).not.toContain(
      presentation({ profile: "succulent", climate: aridAutumn }).variant,
    );
    expect(["autumn-color", "leaf-fall"]).not.toContain(
      presentation({
        profile: "drought-deciduous",
        climate: aridAutumn,
      }).variant,
    );
  });

  it("gives Links winter a selective sparse/dormant matrix", () => {
    const sparseLinksWinter = climate({
      biome: "links",
      season: "winter",
      seasonProgress: 0.3,
      foliage: "sparse",
      dormancy: 0.66,
      flowering: 0,
      dryness: 0.42,
      windMph: 24,
      exposure: "exposed",
    });
    const dormantLinksWinter = climate({
      ...sparseLinksWinter,
      seasonProgress: 0.72,
      foliage: "dormant",
      foliageFrom: "dormant",
      foliageTo: "dormant",
      dormancy: 0.9,
    });

    expect(presentation({
      identity: "links-hawthorn",
      profile: "coastal-deciduous",
      climate: sparseLinksWinter,
    }).variant).toBe("leaf-fall");
    expect(presentation({
      identity: "links-hawthorn",
      profile: "coastal-deciduous",
      climate: dormantLinksWinter,
    }).variant).toBe("dormant");
    expect(presentation({
      identity: "links-wind-pine",
      profile: "evergreen",
      climate: dormantLinksWinter,
    }).variant).toBe("wind-exposed");
    expect(presentation({
      identity: "links-gorse",
      profile: "coastal-heath",
      climate: dormantLinksWinter,
    }).variant).toBe("wind-exposed");
  });

  it("is deterministic within a day and distributes bloom/leaf fall by stable identity and position", () => {
    const spring = climate({
      season: "spring",
      seasonProgress: 0.56,
      foliage: "emerging",
      flowering: 0.88,
      dryness: 0.22,
    });
    const first = presentation({
      profile: "flowering",
      form: "flower",
      climate: spring,
    });
    expect(presentation({
      profile: "flowering",
      form: "flower",
      climate: { ...spring },
    })).toEqual(first);

    const bloom = Array.from({ length: 80 }, (_, x) =>
      presentation({
        profile: "flowering",
        form: "flower",
        x,
        climate: spring,
      }));
    expect(new Set(bloom.map((entry) => entry.bloomAccent.toFixed(3))).size)
      .toBeGreaterThan(20);
    expect(bloom.some((entry) => entry.variant === "blossom")).toBe(true);
    expect(bloom.some((entry) => entry.variant !== "blossom")).toBe(true);

    const autumn = climate({
      season: "autumn",
      seasonProgress: 0.72,
      foliage: "turning",
      dormancy: 0.48,
      flowering: 0,
    });
    const stand = Array.from({ length: 80 }, (_, x) =>
      presentation({ x, climate: autumn }));
    expect(stand.some((entry) => entry.variant === "autumn-color")).toBe(true);
    expect(stand.some((entry) => entry.variant === "leaf-fall")).toBe(true);
  });

  it("consumes cultivation, elevation, water proximity, exposure, and weather without changing gameplay geometry", () => {
    const drought = climate({
      biome: "desert",
      dryness: 0.7,
      weatherKind: "drought",
      windMph: 14,
      exposure: "exposed",
    });
    const exposed = presentation({
      profile: "drought-deciduous",
      climate: drought,
      elevation: 7,
      cultivated: false,
      nearWater: false,
    });
    const sheltered = presentation({
      profile: "drought-deciduous",
      climate: drought,
      elevation: 0,
      cultivated: true,
      nearWater: true,
    });
    expect(exposed.variant).toBe("dry");
    expect(sheltered.alpha).toBeGreaterThan(exposed.alpha);
    expect(exposed.swayScale).toBeGreaterThan(sheltered.swayScale);
    expect(exposed.scaleX).toBeLessThanOrEqual(1);
    // The presentation has no position, collision, obstacle type, or rotation
    // output, so renderer dressing cannot mutate shared gameplay physics.
    expect(Object.keys(exposed)).not.toEqual(
      expect.arrayContaining(["x", "y", "obstacleType", "rotation"]),
    );
    const imported = presentation({
      profile: "drought-deciduous",
      climate: drought,
      ecologicalFit: "imported",
      cultivated: true,
      nearWater: true,
    });
    expect(imported.alpha).toBeLessThan(sheltered.alpha);
  });

  it("maps semantic planting decorations to coherent forms", () => {
    expect(seasonalDecorationPlantForm("flower_bed", "flowering"))
      .toBe("ground-cover");
    expect(seasonalDecorationPlantForm("planter", "flowering"))
      .toBe("flower");
    expect(seasonalDecorationPlantForm("ornamental_feature", "deciduous"))
      .toBe("canopy");
    expect(seasonalDecorationPlantForm("ornamental_feature", "succulent"))
      .toBe("shrub");
  });

  it("invalidates the renderer signature for authoritative daily and weather changes", () => {
    const baseline = state();
    expect(seasonalPlantClimate(baseline)).toEqual(climate());
    expect(seasonalPlantSceneSignature(state())).toBe(
      seasonalPlantSceneSignature(baseline),
    );
    expect(seasonalPlantSceneSignature(state({ day: 88 }))).not.toBe(
      seasonalPlantSceneSignature(baseline),
    );
    expect(seasonalPlantSceneSignature(state({
      kind: "drought",
      dryness: 0.9,
    }))).not.toBe(seasonalPlantSceneSignature(baseline));
    expect(seasonalPlantSceneSignature(state({
      wind: 28,
    }))).not.toBe(seasonalPlantSceneSignature(baseline));

    const sameMountedState = state();
    const mountedSignature = seasonalPlantSceneSignature(sameMountedState);
    const mutable = sameMountedState as unknown as {
      climate: { calendar: { absoluteDay: number } };
      weather: { absoluteDay: number; kind: SeasonalPlantClimate["weatherKind"] };
    };
    mutable.climate.calendar.absoluteDay += 1;
    mutable.weather.absoluteDay += 1;
    mutable.weather.kind = "rain";
    expect(seasonalPlantSceneSignature(sameMountedState)).not.toBe(
      mountedSignature,
    );

    const sameDayBlend = state();
    const mutablePhenology = sameDayBlend as unknown as {
      climate: {
        transition: { blend: number };
        vegetation: {
          foliage: {
            from: SeasonalPlantClimate["foliage"];
            to: SeasonalPlantClimate["foliage"];
          };
        };
      };
    };
    mutablePhenology.climate.vegetation.foliage.from = "full";
    mutablePhenology.climate.vegetation.foliage.to = "turning";
    mutablePhenology.climate.transition.blend = 0.49;
    const sameDaySignature = seasonalPlantSceneSignature(sameDayBlend);
    mutablePhenology.climate.transition.blend = 0.51;
    expect(seasonalPlantSceneSignature(sameDayBlend)).not.toBe(
      sameDaySignature,
    );
  });

  it("blends through a categorical foliage handoff without a treatment pop", () => {
    const before = presentation({
      climate: climate({
        season: "autumn",
        foliage: "full",
        foliageFrom: "full",
        foliageTo: "turning",
        transitionBlend: 0.49,
        dormancy: 0.34,
      }),
    });
    const after = presentation({
      climate: climate({
        season: "autumn",
        foliage: "turning",
        foliageFrom: "full",
        foliageTo: "turning",
        transitionBlend: 0.51,
        dormancy: 0.35,
      }),
    });
    const channels = (tint: number) => [
      (tint >>> 16) & 0xff,
      (tint >>> 8) & 0xff,
      tint & 0xff,
    ];
    const beforeChannels = channels(before.tint);
    const afterChannels = channels(after.tint);
    expect(Math.max(...beforeChannels.map((value, index) =>
      Math.abs(value - afterChannels[index])))).toBeLessThanOrEqual(4);
    expect(Math.abs(before.alpha - after.alpha)).toBeLessThan(0.01);
    expect(Math.abs(before.scaleX - after.scaleX)).toBeLessThan(0.01);
    expect(before.variant).not.toBe(after.variant);
  });

  it("is camera-rotation independent and leaves registry density/occlusion authoritative", () => {
    const rotations = [0, 1, 2, 3].map(() => presentation());
    expect(rotations.every((entry) => entry.signature === rotations[0].signature))
      .toBe(true);
    expect(Object.keys(rotations[0])).not.toEqual(
      expect.arrayContaining(["rotation", "density", "occlusion"]),
    );
  });
});
