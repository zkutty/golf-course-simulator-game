import { beforeEach, describe, expect, it, vi } from "vitest";

const { assetsLoad } = vi.hoisted(() => ({ assetsLoad: vi.fn() }));
vi.mock("pixi.js", () => ({
  Assets: { load: assetsLoad },
  Spritesheet: class {},
  Texture: class {},
}));

import {
  __resetAtlasForTests,
  atlasFallbackDiagnostics,
  getLandscapeMaterialField,
  loadAtlases,
  loadedBiomeBundle,
  loadedSeasonalOverlay,
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
              materials: { fairway: { image: "autumn-fairway.123456789abc.png" } },
              props: sheet("autumn-props"),
              decals: sheet("autumn-decals"),
            },
            spring: {
              materials: { fairway: { image: "spring-fairway.123456789abc.png" } },
              props: null,
              decals: null,
            },
          }
          : {},
      },
    ])),
  ]));
  return {
    version: 2,
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
    await loadAtlases("parkland", "high", "autumn");
    resolveSpring({ source: { style: {} }, marker: "late-spring" });
    await springLoad;

    expect(
      (getLandscapeMaterialField("parkland", "fairway", "high") as unknown as { marker: string }).marker,
    ).toContain("autumn-fairway");
  });
});
