import { beforeEach, describe, expect, it, vi } from "vitest";

const { assetsLoad } = vi.hoisted(() => ({ assetsLoad: vi.fn() }));
vi.mock("pixi.js", () => ({
  Assets: { load: assetsLoad },
  Spritesheet: class {},
  Texture: class {},
}));

import {
  __resetAtlasForTests,
  atlasActivationSnapshot,
  atlasResidencySnapshot,
  atlasFallbackDiagnostics,
  getLandscapeMaterialField,
  getPropFrame,
  getSeasonalFrame,
  getTerrainDetailFrame,
  getTerrainFrame,
  loadAtlases,
  loadedBiomeBundle,
  loadedSeasonalOverlay,
  supersedePendingAtlasLoad,
} from "./atlas";

const sheet = (name: string) => ({
  json: `${name}.123456789abc.json`,
  image: `${name}.abcdef123456.png`,
});

function base(theme: string, quality: string) {
  return {
    buildings: sheet(`buildings-${theme}-${quality}`),
    terrain: sheet(`terrain-${theme}-${quality}`),
    details: quality === "low" ? null : sheet(`details-${theme}-${quality}`),
    props: quality === "low" ? null : sheet(`props-${theme}-${quality}`),
    fields: quality === "low" ? {} : {
      fairway: { image: `field-${theme}-${quality}-fairway.123456789abc.png` },
    },
  };
}

function manifest() {
  const biomes = Object.fromEntries(["parkland", "links", "desert"].map((theme) => [
    theme,
    Object.fromEntries(["high", "medium", "low"].map((quality) => [
      quality,
      {
        base: base(theme, quality),
        seasonal: theme === "parkland" && quality === "high"
          ? {
            autumn: {
              owner: "parkland",
              season: "autumn",
              materials: { fairway: { image: "autumn-fairway.123456789abc.png" } },
              frames: {
                "natural-props": sheet("autumn-props"),
                "terrain-details": sheet("autumn-decals"),
                buildings: sheet("autumn-buildings"),
              },
            },
            spring: {
              owner: "parkland",
              season: "spring",
              materials: { fairway: { image: "spring-fairway.123456789abc.png" } },
              frames: {},
            },
          }
          : {},
      },
    ])),
  ]));
  return {
    version: 3,
    core: { golfers: sheet("core-golfers") },
    biomes,
  };
}

function installManifest() {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => manifest(),
  })));
}

beforeEach(() => {
  __resetAtlasForTests();
  assetsLoad.mockReset();
  assetsLoad.mockImplementation(async (url: string) => url.endsWith(".png")
    ? { source: { style: {} } }
    : { textures: {} });
  installManifest();
});

describe("incremental biome atlas loading", () => {
  it("loads only the selected base and current seasonal overlay", async () => {
    await loadAtlases("parkland", "high", "autumn");

    const urls = assetsLoad.mock.calls.map(([url]) => String(url));
    expect(loadedBiomeBundle("parkland", "high")).toBe(true);
    expect(loadedSeasonalOverlay("parkland", "high", "autumn")).toBe(true);
    expect(urls.some((url) => url.includes("parkland-high"))).toBe(true);
    expect(urls.some((url) => url.includes("autumn-"))).toBe(true);
    expect(urls.some((url) => url.includes("spring-"))).toBe(false);
    expect(urls.some((url) => url.includes("links-") || url.includes("desert-"))).toBe(false);
  });

  it("keeps seasonal frame families isolated from arbitrary structure names", async () => {
    assetsLoad.mockImplementation(async (url: string) => {
      if (url.includes("autumn-props") && url.endsWith(".json")) {
        return {
          textures: {
            parkland_tree_oak: { marker: "seasonal-natural" },
            clubhouse: { marker: "wrong-family-natural" },
          },
        };
      }
      if (url.includes("autumn-buildings") && url.endsWith(".json")) {
        return { textures: { clubhouse: { marker: "seasonal-building" } } };
      }
      if (url.includes("buildings-parkland-high") && url.endsWith(".json")) {
        return { textures: { clubhouse: { marker: "base-building" } } };
      }
      return url.endsWith(".png")
        ? { source: { style: {} } }
        : { textures: {} };
    });

    await loadAtlases("parkland", "high", "autumn");

    expect(getPropFrame("parkland", "high", "parkland_tree_oak") as unknown).toMatchObject({
      marker: "seasonal-natural",
    });
    expect(getPropFrame("parkland", "high", "clubhouse") as unknown).toMatchObject({
      marker: "seasonal-building",
    });
    expect(getSeasonalFrame("parkland", "high", "natural-props", "clubhouse") as unknown).toMatchObject({
      marker: "wrong-family-natural",
    });
  });

  it("keeps the base playable when an optional overlay is absent", async () => {
    await loadAtlases("parkland", "high", "winter");

    expect(loadedBiomeBundle("parkland", "high")).toBe(true);
    expect(loadedSeasonalOverlay("parkland", "high", "winter")).toBe(false);
    expect(assetsLoad.mock.calls.some(([url]) => String(url).includes("winter-"))).toBe(false);
    expect(atlasFallbackDiagnostics()).toEqual([]);
  });

  it("retries a failed optional overlay without re-downloading or poisoning the base", async () => {
    let failures = 1;
    assetsLoad.mockImplementation(async (url: string) => {
      if (url.includes("autumn-props") && failures-- > 0) throw new Error("transient overlay failure");
      return url.endsWith(".png") ? { source: { style: {} } } : { textures: {} };
    });

    await loadAtlases("parkland", "high", "autumn");
    const callsAfterFailure = assetsLoad.mock.calls.length;
    expect(loadedBiomeBundle("parkland", "high")).toBe(true);
    expect(loadedSeasonalOverlay("parkland", "high", "autumn")).toBe(false);
    expect(atlasFallbackDiagnostics().at(-1)?.reason).toMatch(/optional seasonal overlay unavailable/);

    await loadAtlases("parkland", "high", "autumn");
    const retried = assetsLoad.mock.calls.slice(callsAfterFailure).map(([url]) => String(url));
    expect(loadedSeasonalOverlay("parkland", "high", "autumn")).toBe(true);
    expect(retried.some((url) => url.includes("autumn-props"))).toBe(true);
    expect(retried.some((url) => url.includes("buildings-parkland-high"))).toBe(false);
  });

  it("keeps Low base-only and omits fields, details, props, and every overlay", async () => {
    await loadAtlases("parkland", "low", "autumn");

    const urls = assetsLoad.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("field-parkland-low"))).toBe(false);
    expect(urls.some((url) => url.includes("details-parkland-low"))).toBe(false);
    expect(urls.some((url) => url.includes("props-parkland-low"))).toBe(false);
    expect(urls.some((url) => url.includes("autumn-"))).toBe(false);
  });

  it("does not let a late previous-season overlay replace the current season", async () => {
    await loadAtlases("parkland", "high");
    let resolveSpring!: (texture: { source: { style: object }; marker: string }) => void;
    const springTexture = new Promise<{ source: { style: object }; marker: string }>((resolve) => {
      resolveSpring = resolve;
    });
    assetsLoad.mockImplementation(async (url: string) => {
      if (url.includes("spring-fairway")) return springTexture;
      return url.endsWith(".png")
        ? { source: { style: {} }, marker: url }
        : { textures: {} };
    });

    const springLoad = loadAtlases("parkland", "high", "spring");
    await vi.waitFor(() => {
      expect(assetsLoad.mock.calls.some(([url]) => String(url).includes("spring-fairway"))).toBe(true);
    });
    const autumn = await loadAtlases("parkland", "high", "autumn");
    resolveSpring({ source: { style: {} }, marker: "late-spring" });
    const spring = await springLoad;

    expect(autumn.status).toBe("activated");
    expect(spring.status).toBe("superseded");
    expect(atlasActivationSnapshot()).toMatchObject({
      bundleKey: "parkland:high",
      overlayKey: "parkland:high:autumn",
      generation: 2,
    });
    expect(
      (getLandscapeMaterialField("parkland", "fairway", "high") as unknown as { marker: string }).marker,
    ).toContain("autumn-fairway");
    expect(atlasResidencySnapshot().seasonalOverlays).toEqual([
      "parkland:high:autumn",
      "parkland:high:spring",
    ]);
  });

  it("keeps the previous generation active until a requested tier is complete", async () => {
    const high = await loadAtlases("parkland", "high");
    expect(high.context).toMatchObject({ bundleKey: "parkland:high", generation: 1 });

    let resolveMedium!: (sheet: { textures: object }) => void;
    const delayedMedium = new Promise<{ textures: object }>((resolve) => {
      resolveMedium = resolve;
    });
    assetsLoad.mockImplementation(async (url: string) => {
      if (url.includes("terrain-parkland-medium") && url.endsWith(".json")) return delayedMedium;
      return url.endsWith(".png") ? { source: { style: {} } } : { textures: {} };
    });

    const mediumLoad = loadAtlases("parkland", "medium");
    await vi.waitFor(() => {
      expect(assetsLoad.mock.calls.some(([url]) => String(url).includes("terrain-parkland-medium"))).toBe(true);
    });
    expect(atlasActivationSnapshot()).toMatchObject({
      bundleKey: "parkland:high",
      generation: 1,
      requestId: 1,
      latestRequestId: 2,
    });

    resolveMedium({ textures: {} });
    const medium = await mediumLoad;
    expect(medium).toMatchObject({
      status: "activated",
      context: { bundleKey: "parkland:medium", generation: 2 },
    });
    expect(atlasActivationSnapshot()).toMatchObject({
      bundleKey: "parkland:medium",
      generation: 2,
      requestId: 2,
      latestRequestId: 2,
    });
  });

  it("supersedes an in-flight A-to-B request when rendering returns to active A", async () => {
    await loadAtlases("parkland", "high", "summer");
    let resolveMedium!: (sheet: { textures: object }) => void;
    const delayedMedium = new Promise<{ textures: object }>((resolve) => {
      resolveMedium = resolve;
    });
    assetsLoad.mockImplementation(async (url: string) => {
      if (url.includes("terrain-parkland-medium") && url.endsWith(".json")) return delayedMedium;
      return url.endsWith(".png") ? { source: { style: {} } } : { textures: {} };
    });

    const toMedium = loadAtlases("parkland", "medium", "summer");
    await vi.waitFor(() => {
      expect(atlasActivationSnapshot().pending).toMatchObject({
        bundleKey: "parkland:medium",
        season: "summer",
      });
    });
    expect(supersedePendingAtlasLoad()).toBe(true);
    expect(atlasActivationSnapshot()).toMatchObject({
      bundleKey: "parkland:high",
      generation: 1,
      pending: null,
    });

    resolveMedium({ textures: {} });
    expect(await toMedium).toMatchObject({ status: "superseded", context: null });
    expect(atlasActivationSnapshot()).toMatchObject({
      bundleKey: "parkland:high",
      generation: 1,
      pending: null,
    });
  });

  it("keeps terrain, detail, and prop lookups pinned to their requested biome and tier", async () => {
    assetsLoad.mockImplementation(async (url: string) => {
      if (url.endsWith(".json")) {
        const marker = url.includes("parkland-high") ? "parkland-high"
          : url.includes("desert-low") ? "desert-low"
          : "other";
        return {
          textures: marker === "parkland-high"
            ? {
              parkland_fairway_base_0: { marker },
              parkland_short_grass_0: { marker },
              parkland_tree_oak: { marker },
            }
            : marker === "desert-low"
              ? { desert_fairway_base_0: { marker }, desert_saguaro: { marker } }
              : {},
        };
      }
      return { source: { style: {} } };
    });

    await loadAtlases("parkland", "high");
    await loadAtlases("desert", "low");

    expect(getTerrainFrame("parkland", "high", "parkland_fairway_base_0") as unknown).toMatchObject({ marker: "parkland-high" });
    expect(getTerrainFrame("desert", "low", "desert_fairway_base_0") as unknown).toMatchObject({ marker: "desert-low" });
    expect(getTerrainFrame("desert", "low", "parkland_fairway_base_0")).toBeNull();
    expect(getTerrainDetailFrame("parkland", "high", "parkland_short_grass_0") as unknown).toMatchObject({ marker: "parkland-high" });
    expect(getPropFrame("parkland", "high", "parkland_tree_oak") as unknown).toMatchObject({ marker: "parkland-high" });
    expect(getPropFrame("desert", "low", "parkland_tree_oak")).toBeNull();
  });
});
