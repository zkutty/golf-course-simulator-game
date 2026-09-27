import { expect, test } from "@playwright/test";

test("ZK-712 keeps a connected lake level and solely owned through rotation and quality changes", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
      accessibility: { reducedMotion: true },
    }));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m35LandformFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));

  const initialAuthority = await page.evaluate(() => {
    const surface = window.__coursecraftTest!.terrainSurfaceState();
    return {
      courseHash: window.__coursecraftTest!.state().courseHash,
      terrainVersion: window.__coursecraftTest!.state().terrainVersion,
      tiles: surface.tiles,
      elevations: surface.elevations,
    };
  });
  expect(initialAuthority.courseHash).toBe("05b74d13");

  const basin = await page.evaluate(() => {
    const surface = window.__coursecraftTest!.terrainSurfaceState();
    const start = surface.tiles.findIndex((terrain) => terrain === "water");
    if (start < 0) return null;
    const component = new Set<number>();
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      if (component.has(index) || surface.tiles[index] !== "water") continue;
      component.add(index);
      const x = index % surface.width;
      const y = Math.floor(index / surface.width);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= surface.width || ny >= surface.height) continue;
        queue.push(ny * surface.width + nx);
      }
    }
    const levels = [...component].map((index) => surface.elevations[index]);
    const boundary = new Set<number>();
    for (const index of component) {
      const x = index % surface.width;
      const y = Math.floor(index / surface.width);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= surface.width || ny >= surface.height) continue;
        const neighbor = ny * surface.width + nx;
        if (!component.has(neighbor)) boundary.add(surface.elevations[neighbor]);
      }
    }
    return {
      cells: component.size,
      minimumLevel: Math.min(...levels),
      maximumLevel: Math.max(...levels),
      boundaryLevels: [...boundary].sort((a, b) => a - b),
    };
  });
  expect(basin).not.toBeNull();
  expect(basin!.cells).toBeGreaterThan(20);
  expect(basin!.maximumLevel - basin!.minimumLevel).toBe(0);
  expect(basin!.boundaryLevels.length).toBeGreaterThan(1);
  expect(Math.max(...basin!.boundaryLevels)).toBeGreaterThan(basin!.maximumLevel);

  const matrix: Array<{ rotation: number; quality: "medium" | "high" }> = [];
  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      window.__coursecraftPixiTest!.rendererAtlasState().landformDepth.camera.rotation
    ))).toBe(rotation);

    for (const quality of ["medium", "high"] as const) {
      await page.evaluate(({ quality }) => {
        window.__coursecraftTest!.setGraphicsQualityFixture(quality);
        window.__coursecraftPixiTest!.focusTileForTest(8, 16, 1);
      }, { quality });
      await expect.poll(() => page.evaluate(() => {
        const renderer = window.__coursecraftPixiTest!.rendererAtlasState();
        return {
          pending: renderer.activation.pending,
          quality: renderer.rendered.quality,
          zoom: Number(renderer.camera.zoom.toFixed(3)),
          targetZoom: Number(renderer.camera.targetZoom.toFixed(3)),
        };
      }), { timeout: 30_000 }).toEqual({
        pending: null,
        quality,
        zoom: 1,
        targetZoom: 1,
      });

      const depth = await page.evaluate(() => {
        const diagnostics = window.__coursecraftPixiTest!.rendererAtlasState().landformDepth;
        return {
          owners: diagnostics.waterSurfaceOwners,
          water: diagnostics.hazards.filter((entry) => entry.terrain === "water"),
        };
      });
      expect(depth.owners.chunkSprites).toBe(0);
      expect(depth.owners.chunkFoam).toBe(0);
      expect(depth.owners.joinedMeshes).toBeGreaterThan(0);
      expect(depth.water.length).toBeGreaterThan(0);
      expect(depth.water.every((entry) => entry.nearFaces > 0 && entry.farFaces > 0)).toBe(true);
      expect(Math.min(...depth.water.map((entry) => entry.minimumDropPx))).toBeGreaterThanOrEqual(6);
      expect(depth.water.every((entry) => (
        entry.floorBoundaryOwner === "shared" && entry.interiorFaceAreaPx > 50
      ))).toBe(true);
      matrix.push({ rotation, quality });
    }
  }

  const finalAuthority = await page.evaluate(() => {
    const surface = window.__coursecraftTest!.terrainSurfaceState();
    return {
      courseHash: window.__coursecraftTest!.state().courseHash,
      terrainVersion: window.__coursecraftTest!.state().terrainVersion,
      tiles: surface.tiles,
      elevations: surface.elevations,
    };
  });
  expect(finalAuthority).toEqual(initialAuthority);
  expect(matrix).toHaveLength(8);
  expect(new Set(matrix.map(({ rotation, quality }) => `${rotation}:${quality}`)).size).toBe(8);
  expect(errors).toEqual([]);
});
