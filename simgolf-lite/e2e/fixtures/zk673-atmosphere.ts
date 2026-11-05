import * as PIXI from "pixi.js";
import { createAtmosphereSceneSystem } from "../../src/ui/renderer/scenes/atmosphereScene";
import { tileCenterIso, worldToIso, type IsoRotation } from "../../src/game/render/iso";
import type { Course, Terrain } from "../../src/game/models/types";
import type { RenderSnapshot } from "../../src/game/render/renderSnapshot";

// Component fixture only: actual atmosphere + Pixi/WebGL, synthetic terrain
// and population. It intentionally excludes app startup, saves, and gameplay.
const app = new PIXI.Application();
await app.init({ width: 1000, height: 760, resolution: 1, background: 0x28413b,
  preference: "webgl", antialias: false, autoStart: false });
document.body.appendChild(app.canvas);
const world = new PIXI.Container();
const terrain = new PIXI.Graphics();
const population = new PIXI.Graphics();
const seasonalTerrain = new PIXI.Container();
const objects = new PIXI.Container();
const fx = new PIXI.Container();
const screenOverlay = new PIXI.Container();
world.addChild(terrain, seasonalTerrain, population, objects, fx);
app.stage.addChild(world, screenOverlay);
const width = 60, height = 40;
const tiles: Terrain[] = Array.from({ length: width * height }, (_, index) => {
  const x = index % width, y = Math.floor(index / width);
  return (x - 30) ** 2 + (y - 20) ** 2 < 28 ? "water" : (x + y) % 9 < 3 ? "fairway" : "rough";
});
const course = { width, height, tiles, holes: [], obstacles: [] } as unknown as Course;
let snapshot: RenderSnapshot = {
  course, obstacles: [], effectiveTiles: tiles, holes: [], draftTee: null, draftGreen: null,
  rotation: 0, graphicsQuality: "high", colorVision: "standard", reducedMotion: false,
  animationsEnabled: true, showObstacles: true, atlasRevision: 1, surveyMode: false,
  worldSeed: 673, surfaceHeightAt: () => 0,
  revisions: { atmosphere: 1, surfaceCare: 0, structuresProps: 0, playerProCollection: 0,
    naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 },
};
const system = createAtmosphereSceneSystem({ stage: app.stage, world, seasonalTerrain,
  objects, fx, screenOverlay, screen: () => ({ width: 1000, height: 760 }) });
system.create!(snapshot);
function background(rotation: IsoRotation) {
  terrain.clear(); population.clear();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = tileCenterIso(x, y, 0, rotation);
    const color = tiles[y * width + x] === "water" ? 0x477b91
      : tiles[y * width + x] === "fairway" ? 0x8baf64 : (x + y) % 2 ? 0x63894c : 0x6b9152;
    terrain.poly([point.x, point.y - 16, point.x + 32, point.y,
      point.x, point.y + 16, point.x - 32, point.y]).fill(color);
  }
  for (let index = 0; index < 180; index++) {
    const x = (index * 17 + 3) % width + .5;
    const y = (index * 11 + 2) % height + .5;
    const point = worldToIso(x, y, 0, rotation);
    if (index < 110) {
      population.rect(point.x - 2, point.y - 14, 4, 14).fill(0x715c3e);
      population.ellipse(point.x, point.y - 22, 14, 20).fill(index % 2 ? 0x315d3e : 0x426a42);
    } else {
      population.circle(point.x, point.y - 7, 2.5).fill(0xf0cdb0);
      population.rect(point.x - 2, point.y - 5, 4, 6).fill(index % 2 ? 0xdadfcf : 0x5b66a0);
    }
  }
  const center = worldToIso(width / 2, height / 2, 0, rotation);
  world.scale.set(.28);
  world.position.set(500 - center.x * .28, 390 - center.y * .28);
}
background(0);
const gl = (app.renderer as unknown as { gl: WebGLRenderingContext }).gl;
let gpuDrawCalls = 0;
for (const name of ["drawElements", "drawArrays"] as const) {
  const original = gl[name].bind(gl);
  Object.defineProperty(gl, name, { configurable: true, value: (...args: number[]) => {
    gpuDrawCalls++;
    return (original as (...values: number[]) => void)(...args);
  } });
}
let clearCalls = 0;
const originalClear = PIXI.Graphics.prototype.clear;
PIXI.Graphics.prototype.clear = function () { clearCalls++; return originalClear.call(this); };
const initial = { stage: [...app.stage.children], fx: [...fx.children], objects: [...objects.children] };
function state() {
  return {
    stage: app.stage.children.length, fx: fx.children.length, objects: objects.children.length,
    skyGraphics: app.stage.children.filter(child => child instanceof PIXI.Graphics).length,
    clouds: fx.children.filter(child => child.blendMode !== "add").length,
    ownedCount: system.objectCount(),
    stable: initial.stage.every((child, index) => app.stage.children[index] === child)
      && initial.fx.every((child, index) => fx.children[index] === child)
      && initial.objects.every((child, index) => objects.children[index] === child),
    tint: (app.stage.children[1] as PIXI.Sprite).tint,
    shimmerVisible: fx.children.some(child => child.blendMode === "add" && child.visible),
    heronVisible: objects.children[0]?.visible ?? false,
  };
}
function pose(rotation: IsoRotation, dayMinute: number, nowMs: number, ambienceFx = true, animationsEnabled = true) {
  if (snapshot.rotation !== rotation) background(rotation);
  snapshot = { ...snapshot, rotation, animationsEnabled };
  system.update!(snapshot);
  system.tick({ dtMs: 6000, dayMinute, nowMs, ambienceFx });
  app.renderer.render(app.stage);
  return state();
}
function isolate(kind: "full" | "sky" | "clouds" | "shimmer" | "heron" | "tint") {
  world.visible = kind !== "sky";
  terrain.visible = population.visible = kind === "full" || kind === "tint";
  objects.visible = kind === "full" || kind === "heron";
  fx.visible = kind === "full" || kind === "clouds" || kind === "shimmer";
  for (const child of fx.children) child.visible = kind === "full"
    || (kind === "shimmer" ? child.blendMode === "add" : kind === "clouds" && child.blendMode !== "add");
  for (const child of app.stage.children) {
    if (child === world || child === screenOverlay) continue;
    child.visible = kind === "full" || kind === "tint" && child instanceof PIXI.Sprite
      || kind === "sky" && child instanceof PIXI.Graphics;
  }
  app.renderer.render(app.stage);
}
async function timeline() {
  isolate("full");
  let stable = true, peakSkyGraphics = 0, peakClouds = 0;
  // Include flight start/end and former later departures, reset, huge jump,
  // and editor frames without dayMinute. No real-time waiting is needed.
  const minutes = [0, 29, 30, 31, 37, 43.9, 44, 194, 195, 196, 360, 525, 690, 839, 0, 31, 1_000_000];
  let ticks = 0;
  for (const rotation of [0, 90, 180, 270] as const) {
    for (const animationsEnabled of [true, false]) for (const ambienceFx of [true, false]) {
      for (const dayMinute of minutes) {
        const current = pose(rotation, dayMinute, 20_000, ambienceFx, animationsEnabled);
        stable &&= current.stable;
        peakSkyGraphics = Math.max(peakSkyGraphics, current.skyGraphics);
        peakClouds = Math.max(peakClouds, current.clouds);
        ticks++;
      }
    }
    system.tick({ dtMs: 3_600_000, nowMs: 20_000, ambienceFx: true }); ticks++;
  }
  return { stable, peakSkyGraphics, peakClouds, ticks };
}
export interface Zk673Sample {
  frameMs: number;
  tickMs: number;
  submissionMs: number;
  drawCalls: number;
  clearCalls: number;
}
async function measure() {
  isolate("full"); pose(0, 37, 20_000);
  const samples: Zk673Sample[] = [];
  let previous = 0;
  for (let frame = 0; frame < 480; frame++) {
    const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
    const frameMs = previous ? now - previous : 0; previous = now;
    const clearStart = clearCalls;
    const tickStart = performance.now();
    // Amplify tiny CPU work; report per-tick time, not this 24-tick block.
    for (let repeat = 0; repeat < 24; repeat++) system.tick({ dtMs: 16.667, nowMs: 20_000 + frame * 16.667, dayMinute: 37, ambienceFx: true });
    const tickMs = (performance.now() - tickStart) / 24;
    const drawsBefore = gpuDrawCalls;
    const renderStart = performance.now(); app.renderer.render(app.stage);
    const submissionMs = performance.now() - renderStart;
    if (frame >= 120) samples.push({ frameMs, tickMs, submissionMs,
      drawCalls: gpuDrawCalls - drawsBefore, clearCalls: (clearCalls - clearStart) / 24 });
  }
  return samples;
}
function dispose() {
  const ownedTexture = (fx.children.find(child => child.blendMode === "add") as PIXI.Sprite).texture;
  const owned = [...fx.children, ...objects.children, ...app.stage.children.filter(child => child !== world && child !== screenOverlay)];
  system.destroy!(); system.destroy!();
  system.tick({ dtMs: 16, nowMs: 1_000_000, dayMinute: 31, ambienceFx: true });
  return { remaining: system.objectCount(), fx: fx.children.length, objects: objects.children.length,
    stage: app.stage.children.length, objectsDestroyed: owned.every(child => child.destroyed),
    ownedTextureDestroyed: ownedTexture.destroyed, borrowedWhiteDestroyed: PIXI.Texture.WHITE.destroyed };
}
const extension = gl.getExtension("WEBGL_debug_renderer_info");
Object.assign(window, { zk673Atmosphere: {
  pose, isolate, timeline, measure, dispose,
  renderer: { type: app.renderer.type, webglVersion: gl.getParameter(gl.VERSION),
    vendor: gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
    renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    terrainTiles: width * height, populationPrimitives: 180, resolution: 1 },
} });

declare global {
  interface Window {
    zk673Atmosphere: {
      pose: typeof pose;
      isolate: typeof isolate;
      timeline: typeof timeline;
      measure: typeof measure;
      dispose: typeof dispose;
      renderer: { type: number; webglVersion: string; vendor: string; renderer: string;
        terrainTiles: number; populationPrimitives: number; resolution: number };
    };
  }
}
