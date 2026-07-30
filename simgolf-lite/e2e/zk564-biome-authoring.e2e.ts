import { expect, test } from "@playwright/test";
import { BIOME_KEYS } from "../src/game/models/biomes";
import { DECORATION_KINDS } from "../src/game/models/decorations";
import { TERRAIN_KINDS } from "../src/game/render/terrainMaterials";
import {
  BIOME_REFERENCE_ROTATIONS,
  BIOME_REFERENCE_VIEWS,
  type BiomeReferenceView,
} from "../src/game/testing/biomeAuthoring";

const expectedFocus: Record<BiomeReferenceView, string> = {
  overview: "whole-course",
  build: "authoring-yard",
  "golfer-follow": "golfer",
  "direct-play": "ball-and-green",
};

test("ZK-564 executes every biome, view, and rotation reference state", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
      accessibility: { reducedMotion: true },
    }));
  });

  for (const biome of BIOME_KEYS) {
    for (const view of BIOME_REFERENCE_VIEWS) {
      await page.goto(`/?m52Fixture=1&m52Theme=${biome}&m52View=${view}&m52Rotation=0`);
      await expect.poll(() => page.evaluate(() => {
        const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
        return state.screen === "game" ? state.course?.theme : null;
      }), { timeout: 90_000 }).toBe(biome);

      const initial = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
      expect(Object.keys(initial.course.terrainCounts).sort()).toEqual([...TERRAIN_KINDS].sort());
      expect(Object.keys(initial.course.obstacleCounts).sort()).toEqual(["bush", "rock", "tree"]);
      expect(new Set(initial.course.decorations.map((item: { kind: string }) => item.kind))).toEqual(new Set(DECORATION_KINDS));
      expect(initial.camera.reference).toMatchObject({
        id: `${view}-r0`,
        view,
        focus: expectedFocus[view],
        expectedRotation: 0,
      });
      expect(initial.camera.viewMode).toBe(view === "overview" || view === "build" ? "ARCHITECT" : "COZY");
      if (view === "golfer-follow") {
        expect(initial.simulation.following).not.toBeNull();
        expect(initial.simulation.golfers.length).toBeGreaterThan(0);
      } else if (view === "direct-play") {
        expect(initial.playerPro.activeRound).toMatchObject({
          phase: "awaiting_shot",
          editingLocked: true,
          aim: { x: expect.any(Number), y: expect.any(Number) },
        });
      } else {
        expect(initial.simulation.following).toBeNull();
        expect(initial.playerPro.activeRound).toBeNull();
      }

      const canvas = page.locator(".cc-pixi-stage canvas");
      await expect(canvas).toBeVisible();
      for (const rotation of BIOME_REFERENCE_ROTATIONS) {
        await page.evaluate(({ activeView, activeRotation }) => {
          window.__coursecraftTest!.setM52ReferenceBookmark(activeView, activeRotation);
        }, { activeView: view, activeRotation: rotation });
        await expect.poll(() => page.evaluate(() => {
          const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
          return {
            id: state.camera?.reference?.id,
            expected: state.camera?.reference?.expectedRotation,
            actual: state.camera?.rotation,
          };
        })).toEqual({
          id: `${view}-r${rotation}`,
          expected: rotation * 90,
          actual: rotation * 90,
        });
        const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
        expect(state.camera.center.x).toBeGreaterThanOrEqual(0);
        expect(state.camera.center.x).toBeLessThan(state.course.width);
        expect(state.camera.center.y).toBeGreaterThanOrEqual(0);
        expect(state.camera.center.y).toBeLessThan(state.course.height);
        expect(state.camera.zoom).toBeCloseTo(state.camera.reference.expectedZoom, 3);
      }

      const shot = await canvas.screenshot({
        path: `artifacts/zk-564/matrix-${biome}-${view}.png`,
      });
      await testInfo.attach(`${biome}-${view}`, { body: shot, contentType: "image/png" });
    }
  }

  expect(errors).toEqual([]);
});
