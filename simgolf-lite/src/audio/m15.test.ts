import { describe, expect, it } from "vitest";
import type { Course } from "../game/models/types";
import type { GolferRenderData } from "../game/live/types";
import { AMBIENCE_PLAYLISTS, MUSIC_PLAYLISTS } from "./AudioManager";
import { ambientMixFor, audioSurfaceFor, distanceVolume, musicContextFor, worldAmbienceEnabledFor } from "./environment";
import { deriveLiveAudioEvents } from "./liveEvents";

function course(): Course {
  const width = 8;
  const height = 4;
  return {
    width, height,
    tiles: [
      ...Array(8).fill("deep_rough"), ...Array(8).fill("rough"),
      ...Array(8).fill("water"), ...Array(8).fill("fairway"),
    ],
    elevations: Array(width * height).fill(0),
    holes: [], obstacles: [{ x: 1, y: 0, type: "tree" }, { x: 2, y: 0, type: "tree" }], buildings: [],
    yardsPerTile: 10, name: "Audio Test", baseGreenFee: 10, condition: 1,
  } as Course;
}

function golfer(patch: Partial<GolferRenderData> = {}): GolferRenderData {
  return {
    id: 1, x: 3, y: 3, ballX: null, ballY: null, ballToX: null, ballToY: null,
    color: "#fff", mood: .8, thought: null, archetype: "casual", segKind: "pause", segT: .9,
    shot: "swing", dirX: 1, dirY: 0, scoredHoles: 0, lastHoleDelta: 0, ...patch,
  };
}

describe("M15 contextual music", () => {
  it("owns audio explicitly by surface", () => {
    expect(audioSurfaceFor({ screen: "menu", showVision: true })).toBe("vision");
    expect(worldAmbienceEnabledFor("vision")).toBe(false);
    expect(worldAmbienceEnabledFor("menu")).toBe(false);
    expect(worldAmbienceEnabledFor("setup")).toBe(false);
    expect(worldAmbienceEnabledFor("loading")).toBe(false);
    expect(worldAmbienceEnabledFor("game")).toBe(true);
  });

  it("maps app state through one deterministic context selector", () => {
    expect(musicContextFor({ screen: "menu", viewMode: "COZY", cash: 10, liveRunning: false, won: false })).toBe("title");
    expect(musicContextFor({ screen: "game", viewMode: "ARCHITECT", cash: 10, liveRunning: true, won: false })).toBe("build-parkland");
    expect(musicContextFor({ screen: "game", viewMode: "ARCHITECT", cash: 10, liveRunning: true, won: false, theme: "links" })).toBe("build-links");
    expect(musicContextFor({ screen: "game", viewMode: "COZY", cash: 10, liveRunning: true, won: false })).toBe("live");
    expect(musicContextFor({ screen: "game", viewMode: "COZY", cash: 10, liveRunning: true, won: false, playerRoundActive: true })).toBe("play");
    expect(musicContextFor({ screen: "game", viewMode: "COZY", cash: 10, liveRunning: true, won: false, playerRoundActive: true, tournamentTier: "championship" })).toBe("tournament-championship");
    expect(musicContextFor({ screen: "game", viewMode: "COZY", cash: -1, liveRunning: true, won: false })).toBe("tension");
    expect(musicContextFor({ screen: "game", viewMode: "COZY", cash: 10, liveRunning: true, won: true })).toBe("victory");
  });

  it("ships the complete lazy Suno music and ambience library", () => {
    const tracks = new Map(Object.values(MUSIC_PLAYLISTS).flat().map((item) => [item.id, item]));
    const ambience = new Map(Object.values(AMBIENCE_PLAYLISTS).flat().map((item) => [item.id, item]));
    expect(tracks.size).toBe(22);
    expect(ambience.size).toBe(18);
    for (const item of tracks.values()) {
      expect(item.src).toMatch(/^\/audio\/music\/suno\/.+\.mp3$/);
      expect(item.sourceUrl).toMatch(/^https:\/\/suno\.com\/song\//);
    }
    for (const item of ambience.values()) {
      expect(item.src).toMatch(/^\/audio\/ambience\/suno\/.+\.mp3$/);
      expect(item.sourceUrl).toMatch(/^https:\/\/suno\.com\/song\//);
    }
  });
});

describe("M15 ambient mix", () => {
  it("changes character with camera terrain and time of day", () => {
    const c = course();
    const forest = ambientMixFor({ course: c, center: { x: 1, y: 0 }, dayMinute: 80, visibleGolfers: 0, paused: false, radius: 1 });
    const lake = ambientMixFor({ course: c, center: { x: 4, y: 2 }, dayMinute: 400, visibleGolfers: 0, paused: false, radius: 1 });
    const dusk = ambientMixFor({ course: c, center: { x: 4, y: 3 }, dayMinute: 800, visibleGolfers: 12, paused: true, radius: 1 });
    expect(forest.birds).toBeGreaterThan(lake.birds);
    expect(lake.water).toBeGreaterThan(forest.water);
    expect(dusk.crickets).toBeGreaterThan(.5);
    expect(dusk.murmur).toBeGreaterThan(.5);
    expect(forest.bed).toBe("parkland");
    expect(lake.bed).toBe("water");
    expect(dusk.bed).toBe("night");
    expect(dusk.paused).toBe(true);
    expect(forest.enabled).toBe(true);
    expect(ambientMixFor({
      course: c,
      center: { x: 1, y: 0 },
      dayMinute: 80,
      visibleGolfers: 0,
      paused: false,
      enabled: false,
    }).enabled).toBe(false);
  });

  it("prioritizes authored weather and season beds over terrain", () => {
    const c = course();
    expect(ambientMixFor({
      course: c,
      center: { x: 1, y: 0 },
      dayMinute: 300,
      visibleGolfers: 0,
      paused: false,
      weatherKind: "heavy_rain",
      season: "summer",
    }).bed).toBe("rain");
    expect(ambientMixFor({
      course: c,
      center: { x: 1, y: 0 },
      dayMinute: 300,
      visibleGolfers: 0,
      paused: false,
      weatherKind: "clear",
      season: "winter",
    }).bed).toBe("winter");
  });

  it("attenuates world sounds linearly from the camera", () => {
    expect(distanceVolume({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(1);
    expect(distanceVolume({ x: 14, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(.5);
    expect(distanceVolume({ x: 30, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });
});

describe("M15 live-event sound sequence", () => {
  it("derives shot, surface landing, and hole-out without mutating sim state", () => {
    const c = course();
    const address = golfer();
    const flight = golfer({ segKind: "flight", segT: .1, ballX: 3, ballY: 3, ballToX: 4, ballToY: 2 });
    expect(deriveLiveAudioEvents([address], [flight], c)).toEqual([
      { kind: "shot", golferId: 1, shot: "swing", from: { x: 3, y: 3 }, to: { x: 4, y: 2 } },
    ]);
    const landed = golfer({ segKind: "walk", scoredHoles: 1, lastHoleDelta: -1, x: 4, y: 2 });
    expect(deriveLiveAudioEvents([flight], [landed], c)).toEqual([
      { kind: "landing", golferId: 1, surface: "water", at: { x: 4, y: 2 } },
      { kind: "hole-out", golferId: 1, scoreDelta: -1, at: { x: 4, y: 2 } },
    ]);
  });
});
