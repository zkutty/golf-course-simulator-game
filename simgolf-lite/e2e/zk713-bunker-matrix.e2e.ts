import { expect, test } from "@playwright/test";
import { BIOME_KEYS } from "../src/game/models/biomes";

test("ZK713 shipped biome and tier bunker contour matrix", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const evidence: unknown[] = [];
  for (const theme of BIOME_KEYS) {
    await page.goto(`/?m20Fixture=1&m20Theme=${theme}`);
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 150_000 }).toBe("game");
    await page.evaluate(() => { window.__coursecraftTest!.setPaintCash(1_000_000); window.__coursecraftTest!.setGraphicsQualityFixture("medium"); });
    await page.getByRole("button", { name: "Expand design dock" }).click();
    await page.getByTestId("design-tool-curve").click();
    await page.getByLabel("Brush width").fill("3");
    await page.getByTestId("design-card-terrain-sand").click();
    const canvas = page.locator(".cc-pixi-stage canvas");
    const box = (await canvas.boundingBox())!;
    const featureCount = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length);
    await page.mouse.move(box.x + box.width * .72, box.y + box.height * .24);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .78, box.y + box.height * .23, { steps: 8 });
    await page.mouse.move(box.x + box.width * .82, box.y + box.height * .25, { steps: 8 });
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.terrainPreview()?.authoredBunkerRings?.length ?? 0)).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const preview = await page.evaluate(() => window.__coursecraftPixiTest!.terrainPreview()!.authoredBunkerRings);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(featureCount + 1);
    const authored = (await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.at(-1)))!;
    await page.getByRole("button", { name: "Collapse design dock" }).click();
    const state = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
    const roughCell = state.tiles.findIndex((tile, cell) => tile === "rough" && state.owned[cell]
      && cell % state.width > 12 && cell % state.width < state.width - 8 && Math.floor(cell / state.width) > 8
      && [cell - 1, cell + 1, cell - state.width, cell + state.width].every((neighbor) => state.tiles[neighbor] === "rough")
      && !state.obstacles.some((obstacle) => obstacle.x === cell % state.width && obstacle.y === Math.floor(cell / state.width)));
    expect(roughCell).toBeGreaterThanOrEqual(0);
    await page.getByRole("button", { name: "Expand design dock" }).click();
    await page.getByLabel("Brush width").fill("1");
    await page.getByRole("button", { name: "Collapse design dock" }).click();
    await page.evaluate(({ x, y }) => window.__coursecraftPixiTest!.focusTileForTest(x, y, 1), { x: roughCell % state.width, y: Math.floor(roughCell / state.width) });
    await expect.poll(() => page.evaluate(({ x, y }) => { const p = window.__coursecraftPixiTest!.tileToScreen(x, y); return !!p && p.x > 100 && p.x < 900 && p.y > 100 && p.y < 700; }, { x: roughCell % state.width, y: Math.floor(roughCell / state.width) })).toBe(true);
    const point = (await page.evaluate(({ x, y }) => window.__coursecraftPixiTest!.tileToScreen(x, y), { x: roughCell % state.width, y: Math.floor(roughCell / state.width) }))!;
    await page.mouse.click(box.x + point.x, box.y + point.y);
    await expect.poll(() => page.evaluate((cell) => window.__coursecraftPixiTest!.bunkerContours().some((component) => component.cells.length === 1 && component.cells[0] === cell), roughCell)).toBe(true);
    const finalAuthored = () => page.evaluate((cells) => window.__coursecraftPixiTest!.bunkerContours().find((c) => c.cells.length === cells.length && cells.every((cell) => c.cells.includes(cell)))?.boundary, authored.coverage);
    await expect.poll(finalAuthored).toEqual(preview);
    const targets = await page.evaluate(({ authoredCells, potCell }) => {
      const components = window.__coursecraftPixiTest!.bunkerContours();
      return [components.find((c) => c.cells.length === 1 && c.cells[0] === potCell)!, components.find((c) => c.cells.length > 1 && !c.cells.some((cell) => authoredCells.includes(cell)))!, components.find((c) => c.cells.length === authoredCells.length && authoredCells.every((cell) => c.cells.includes(cell)))!].map((c) => c.cells);
    }, { authoredCells: authored.coverage, potCell: roughCell });
    expect(targets.every(Boolean)).toBe(true);
    for (const rotation of [0, 90, 180, 270]) {
      if (rotation) await page.keyboard.press("KeyE");
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.committed)).toBe(rotation);
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.tweening)).toBe(false);
      await expect.poll(() => page.evaluate((rotation) => window.__coursecraftPixiTest!.bunkerContours().every((component) => component.rotation === rotation), rotation)).toBe(true);
      let lowGrounding: Array<{ x: number; y: number; height: number }> = [];
      for (const quality of ["low", "medium", "high"] as const) {
        await page.evaluate((quality) => window.__coursecraftTest!.setGraphicsQualityFixture(quality), quality);
        await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().activation.pending)).toBeNull();
        await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().rendered.quality)).toBe(quality);
        const grounding = await page.evaluate(async () => {
          const modulePath = "/src/game/render/bunkerPresentation.ts";
          const presentation = await import(modulePath);
          const surface = window.__coursecraftTest!.terrainSurfaceState();
          return window.__coursecraftPixiTest!.bunkerContours().flatMap((component) => component.cells.map((cell) => {
            const shown = presentation.bunkerDisplayPoint({ x: cell % surface.width + .49, y: Math.floor(cell / surface.width) + .49 }, surface.width, [{ cells: component.cells, rings: component.floor }]);
            return { ...shown, height: window.__coursecraftPixiTest!.surfaceHeightAt(shown.x, shown.y) };
          }));
        });
        if (quality === "low") lowGrounding = grounding;
        if (quality === "high") expect(grounding).toEqual(lowGrounding);
        const depth = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().landformDepth);
        const sandDepth = depth.hazards.filter((hazard) => hazard.terrain === "sand");
        expect(sandDepth.length).toBeGreaterThan(0);
        expect(sandDepth.every((hazard) => hazard.floorBoundaryOwner === "shared" && hazard.minimumDropPx > 0 && hazard.maximumDropPx >= hazard.minimumDropPx && hazard.nearFaces + hazard.farFaces > 0)).toBe(true);
        const geometry = await page.evaluate(() => {
          const surface = window.__coursecraftTest!.terrainSurfaceState();
          return window.__coursecraftPixiTest!.bunkerContours().map((c) => ({ ...c, allSand: c.cells.every((cell) => surface.tiles[cell] === "sand"), valid: [...c.boundary, ...c.floor].every((ring) => ring.length >= 3 && ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && new Set(ring.map((p) => `${p.x},${p.y}`)).size === ring.length) }));
        });
        if (quality === "low") {
          const mapping = await page.evaluate(async () => {
            const modulePath = "/src/game/render/bunkerPresentation.ts";
            const presentation = await import(modulePath);
            const surface = window.__coursecraftTest!.terrainSurfaceState();
            const features = surface.features.map((feature, order) => ({ id: feature.id, terrain: feature.terrain, order,
              coverage: feature.coverage, renderRings: feature.renderRings,
              geometry: feature.kind === "corridor" ? { kind: "corridor", knots: feature.points } : { kind: "region", ring: feature.points } }));
            const captured = presentation.cachedBunkerPresentation(surface.tiles, surface.width, surface.height, features);
            return window.__coursecraftPixiTest!.bunkerContours().every((actual) => {
              const authority = captured.find((c: { cells: number[] }) => c.cells.length === actual.cells.length && actual.cells.every((cell) => c.cells.includes(cell)));
              if (!authority || JSON.stringify(authority.rings) !== JSON.stringify(actual.floor)) return false;
              return actual.cells.every((cell) => {
                const canonical = { x: cell % surface.width + .49, y: Math.floor(cell / surface.width) + .49 };
                const saved = JSON.stringify(canonical);
                const shown = presentation.bunkerDisplayPoint(canonical, surface.width, captured);
                return presentation.insideBunkerRings(shown, actual.floor) && saved === JSON.stringify(canonical);
              });
            });
          });
          expect(mapping).toBe(true);
        }
        expect(geometry.every((c) => c.rotation === rotation && c.allSand && c.valid)).toBe(true);
        await expect.poll(finalAuthored).toEqual(preview);
        for (const [kind, cells] of targets.entries()) {
          const x = cells.reduce((sum, cell) => sum + cell % state.width + .5, 0) / cells.length;
          const y = cells.reduce((sum, cell) => sum + Math.floor(cell / state.width) + .5, 0) / cells.length;
          await page.evaluate(({ x, y }) => window.__coursecraftPixiTest!.focusTileForTest(x, y, 1), { x, y });
          await expect.poll(() => page.evaluate(({ x, y }) => { const p = window.__coursecraftPixiTest!.tileToScreen(x, y); return !!p && p.x > 150 && p.x < 850 && p.y > 120 && p.y < 650; }, { x, y })).toBe(true);
          await testInfo.attach(`${theme}-${quality}-${rotation}-${["pot", "connected", "authored"][kind]}`, { body: await canvas.screenshot({ path: testInfo.outputPath(`${theme}-${quality}-${rotation}-${kind}.png`) }), contentType: "image/png" });
        }
        evidence.push({ theme, quality, rotation, geometry, depth, grounding, sharedContourGate: "pass" });
      }
    }
    const beforeReload = await page.evaluate(() => window.__coursecraftPixiTest!.bunkerContours().map(({ cells, boundary, floor }) => ({ cells, boundary, floor })));
    await page.getByTestId("design-dock").locator(".cc-design-toolbar strong").click();
    await page.keyboard.press("Control+KeyS");
    await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
    await page.locator(".cc-sidebar-footer").getByRole("button", { name: /Load$/ }).click();
    await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.bunkerContours().map(({ cells, boundary, floor }) => ({ cells, boundary, floor })))).toEqual(beforeReload);
  }
  expect(errors).toEqual([]);
  expect(evidence).toHaveLength(BIOME_KEYS.length * 3 * 4);
  await testInfo.attach("matrix-contours", { body: Buffer.from(JSON.stringify({ evidence, gaps: ["Fallback preview rings are not exposed by existing diagnostics", "No displayed-ball endpoint diagnostic: canonical and pure mapping unit evidence remains", "Fixture reload is not a real multi-course switch", "Legacy metadata normalization covered by unit tests, not this browser matrix"] }, null, 2)), contentType: "application/json" });
});
