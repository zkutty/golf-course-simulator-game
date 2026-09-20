import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ActionClass = "terrain-stroke" | "tee" | "pin" | "prop" | "structure" | "occlusion-selection";
type Tier = "high" | "medium" | "low";
type Locus = "center" | "visible-edge";
type Point = { x: number; y: number };

const ACTIONS: readonly ActionClass[] = ["terrain-stroke", "tee", "pin", "prop", "structure", "occlusion-selection"];
const TIERS: readonly Tier[] = ["high", "medium", "low"];
const LOCI: readonly Locus[] = ["center", "visible-edge"];
const ROTATIONS = [0, 90, 180, 270] as const;
const MUTATING = new Set<ActionClass>(["terrain-stroke", "tee", "pin", "prop", "structure"]);
const EVIDENCE_DIR = process.env.ZK1205_EVIDENCE_DIR ?? "/private/tmp/zk1205-pointer-matrix-attempt2-evidence";
const MAX_ROWS = Number(process.env.ZK1205_MAX_ROWS ?? 144);
const START_ROW = Number(process.env.ZK1205_START_ROW ?? 0);
const SKIP_PERSISTENCE = process.env.ZK1205_SKIP_PERSISTENCE === "1";
const RUN_INTEGRATED = process.env.ZK1205_RUN_INTEGRATED === "1";
const ACTION_FILTER = new Set((process.env.ZK1205_ACTION_FILTER ?? "").split(",").filter(Boolean));
const EXPECTED_GROUND_COVER_TIER: Record<Tier, 0 | 1 | 2> = { high: 2, medium: 1, low: 0 };

type PlacementSnapshot = Awaited<ReturnType<NonNullable<Window["__coursecraftTest"]>["zk470PlacementSnapshot"]>>;

async function camera(page: Page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera as {
    rotation: number;
    zoom: number;
  });
}

async function rendererContext(page: Page) {
  return page.evaluate(() => {
    const state = window.__coursecraftPixiTest!.rendererAtlasState();
    return {
      requested: state.requested,
      rendered: state.rendered,
      camera: state.camera,
      parklandComposableCamera: state.parklandComposable.camera,
    };
  });
}

async function setRotation(page: Page, desired: number) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let turns = 0; turns < 4; turns++) {
    if ((await camera(page)).rotation === desired) return;
    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await camera(page)).rotation, { timeout: 10_000 }).not.toBe((desired + 270) % 360);
  }
  expect((await camera(page)).rotation).toBe(desired);
}

async function waitForActionConfiguration(page: Page, actionClass: ActionClass) {
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor), {
    timeout: 30_000,
  }).toMatchObject(actionClass === "terrain-stroke"
    ? { mode: "PAINT", terrainTool: "curve", selectedTerrain: "rough", setupPlacement: null }
    : actionClass === "tee"
      ? { mode: "HOLE_WIZARD", setupPlacement: { kind: "tee", key: "member" } }
      : actionClass === "pin"
        ? { mode: "HOLE_WIZARD", setupPlacement: { kind: "pin", key: "A" } }
        : actionClass === "prop"
          ? { mode: "OBSTACLE", setupPlacement: null }
          : { mode: "BUILDING", setupPlacement: null });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function resolvePointerPoint(page: Page, target: Point, locus: Locus) {
  return page.evaluate(({ target, locus }) => {
    const api = window.__coursecraftPixiTest!;
    const center = api.tileToScreen(target.x, target.y);
    if (!center) throw new Error(`Target ${target.x},${target.y} is not projectable`);
    const same = (point: Point | null) => point?.x === target.x && point.y === target.y;
    if (!same(api.screenToTile(center.x, center.y))) {
      throw new Error(`Projected center does not select target ${target.x},${target.y}`);
    }
    let selected = center;
    if (locus === "visible-edge") {
      let bestDistance = -1;
      for (let dy = -40; dy <= 40; dy += 1) {
        for (let dx = -72; dx <= 72; dx += 1) {
          const candidate = { x: center.x + dx, y: center.y + dy };
          if (!same(api.screenToTile(candidate.x, candidate.y))) continue;
          const distance = dx * dx + dy * dy;
          if (distance > bestDistance) {
            bestDistance = distance;
            selected = candidate;
          }
        }
      }
      if (bestDistance < 25) throw new Error(`No visible-edge point found for ${target.x},${target.y}`);
    }
    const selectedCell = api.screenToTile(selected.x, selected.y);
    const visualSurfacePoint = api.screenToWorld(selected.x, selected.y);
    return { screen: selected, selectedCell, visualSurfacePoint };
  }, { target, locus });
}

async function pointerAction(page: Page, actionClass: ActionClass, screen: Point, canvasOrigin: Point) {
  const point = { x: canvasOrigin.x + screen.x, y: canvasOrigin.y + screen.y };
  if (actionClass === "terrain-stroke") {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 0.25, point.y + 0.25);
    await page.mouse.up();
  } else {
    await page.mouse.click(point.x, point.y);
  }
  if (actionClass === "tee") {
    await page.getByTestId("tee-placement-confirm").getByRole("button", { name: "Confirm", exact: true }).click();
  }
}

test("ZK-1205 exact 144-row real-pointer placement matrix", async ({ page }) => {
  test.setTimeout(180 * 60_000);
  await mkdir(path.join(EVIDENCE_DIR, "screens"), { recursive: true });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const key = "coursecraft_app_profile_v5";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({
      ...current,
      version: 5,
      tutorialOffered: true,
      gameplay: {
        ...(current.gameplay ?? {}),
        confirmBulldoze: false,
        confirmSalvage: false,
      },
      accessibility: {
        ...(current.accessibility ?? {}),
        reducedMotion: true,
      },
    }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 120_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest?.screenToWorld));

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");
  const canvasOrigin = { x: box.x, y: box.y };
  const report: {
    candidate: string;
    expectedRows: number;
    rows: unknown[];
    persistence: unknown[];
    integrated: unknown | null;
    firstMismatch: unknown | null;
    errors: string[];
  } = {
    candidate: "878cb8118cbd4d94ffb1b62285b8ee5a0c8c7327+working-tree",
    expectedRows: 144,
    rows: [],
    persistence: [],
    integrated: null,
    firstMismatch: null,
    errors,
  };
  const reportPath = path.join(EVIDENCE_DIR, "zk470-placement-matrix-report.json");
  const flush = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const probed = new Set<ActionClass>();
  let baselineHashes: { course: string; world: string } | null = null;

  let plannedRow = 0;
  outer: for (const rotation of ROTATIONS) {
    await setRotation(page, rotation);
    for (const tier of TIERS) for (const locus of LOCI) for (const actionClass of ACTIONS) {
      const rowIndex = plannedRow++;
      if (rowIndex < START_ROW) continue;
      if (ACTION_FILTER.size > 0 && !ACTION_FILTER.has(actionClass)) continue;
      if (report.rows.length >= MAX_ROWS) break outer;
      const rowId = `r${rotation}-${tier}-${locus}-${actionClass}`;
      const errorStart = errors.length;
      try {
        const target = await page.evaluate((value) => window.__coursecraftTest!.setZk470PlacementFixture(value), actionClass);
        await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), {
          timeout: 30_000,
        }).toBe("ZK-470A deterministic placement fixture");
        await waitForActionConfiguration(page, actionClass);
        await page.evaluate((value) => window.__coursecraftTest!.setGraphicsQualityFixture(value), tier);
        await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").graphics?.quality)).toBe(tier);
        await setRotation(page, rotation);
        await page.evaluate(({ point }) => window.__coursecraftPixiTest!.focusTileForTest(point.x, point.y, 1.15), target);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const projected = await resolvePointerPoint(page, target.point, locus);
        expect(projected.selectedCell, `${rowId}: projected selection`).toEqual(target.point);
        expect(projected.visualSurfacePoint, `${rowId}: visual surface point`).not.toBeNull();
        const expectedGroundCoverTier = EXPECTED_GROUND_COVER_TIER[tier];
        await expect.poll(() => rendererContext(page), { timeout: 30_000 }).toMatchObject({
          requested: { quality: tier },
          rendered: { quality: tier },
          camera: { zoom: 1.15, targetZoom: 1.15, groundCoverTier: expectedGroundCoverTier },
          parklandComposableCamera: { rotation, zoom: 1.15, targetZoom: 1.15 },
        });
        const actionContext = await rendererContext(page);
        expect(actionContext.parklandComposableCamera.rotation, `${rowId}: action rotation`).toBe(rotation);
        expect(actionContext.camera.zoom, `${rowId}: action zoom`).toBe(1.15);
        expect(actionContext.camera.targetZoom, `${rowId}: action target zoom`).toBe(1.15);
        expect(actionContext.requested.quality, `${rowId}: requested quality`).toBe(tier);
        expect(actionContext.rendered.quality, `${rowId}: rendered quality`).toBe(tier);
        expect(actionContext.camera.groundCoverTier, `${rowId}: rendered ground-cover tier`).toBe(expectedGroundCoverTier);
        const before = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
        if (!baselineHashes) baselineHashes = { course: before.courseHash, world: before.worldHash };
        expect({ course: before.courseHash, world: before.worldHash }, `${rowId}: independent reset baseline`).toEqual(baselineHashes);
        expect(before.committedCell, `${rowId}: target starts uncommitted`).toEqual(
          actionClass === "occlusion-selection" ? target.point : null,
        );
        expect(before.handledPointerCell, `${rowId}: pointer observation starts empty`).toBeNull();
        await pointerAction(page, actionClass, projected.screen, canvasOrigin);
        try {
          await expect.poll(() => page.evaluate(async (value) => (
            (await window.__coursecraftTest!.zk470PlacementSnapshot(value)).committedCell
          ), actionClass), { timeout: 30_000 }).toEqual(target.point);
        } catch {
          const mismatch = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
          throw new Error(`${rowId}: commit mismatch ${JSON.stringify({ before, projected, afterPointer: mismatch })}`);
        }
        const after = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
        const postActionContext = await rendererContext(page);
        expect(after.committedCell, `${rowId}: committed cell`).toEqual(target.point);
        expect(after.handledPointerCell, `${rowId}: native handler cell`).toEqual(target.point);
        if (actionClass !== "terrain-stroke") expect(after.selectedCell, `${rowId}: handled pointer cell`).toEqual(target.point);
        let undoRedo: { undo: PlacementSnapshot; redo: PlacementSnapshot } | {
          undo: "not-applicable";
          redo: "not-applicable";
        } = { undo: "not-applicable", redo: "not-applicable" };
        if (MUTATING.has(actionClass)) {
          expect(after.courseHash, `${rowId}: authoritative mutation`).not.toBe(before.courseHash);
          await page.evaluate(() => window.__coursecraftTest!.zk470Undo());
          try {
            await expect.poll(() => page.evaluate(async (value) => (
              (await window.__coursecraftTest!.zk470PlacementSnapshot(value)).courseHash
            ), actionClass), { timeout: 30_000 }).toBe(before.courseHash);
          } catch {
            const mismatch = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
            throw new Error(`${rowId}: undo mismatch ${JSON.stringify({ before, after, undo: mismatch })}`);
          }
          const undo = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
          expect(undo.worldHash, `${rowId}: undo world`).toBe(before.worldHash);
          expect(undo.committedCell, `${rowId}: undo committed state`).toEqual(before.committedCell);
          await page.evaluate(() => window.__coursecraftTest!.zk470Redo());
          try {
            await expect.poll(() => page.evaluate(async (value) => (
              (await window.__coursecraftTest!.zk470PlacementSnapshot(value)).courseHash
            ), actionClass), { timeout: 30_000 }).toBe(after.courseHash);
          } catch {
            const mismatch = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
            throw new Error(`${rowId}: redo mismatch ${JSON.stringify({ before, after, undo, redo: mismatch })}`);
          }
          const redo = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
          expect(redo.worldHash, `${rowId}: redo world`).toBe(after.worldHash);
          expect(redo.committedCell, `${rowId}: redo committed state`).toEqual(after.committedCell);
          undoRedo = { undo, redo };
        } else {
          expect(after.courseHash, `${rowId}: selection is non-mutating`).toBe(before.courseHash);
          expect(after.worldHash, `${rowId}: selection world is non-mutating`).toBe(before.worldHash);
        }
        let persistence = null;
        if (!SKIP_PERSISTENCE && !probed.has(actionClass)) {
          persistence = await page.evaluate((value) => window.__coursecraftTest!.zk470PersistenceProbe(value), actionClass);
          expect(persistence.afterHash, `${rowId}: store payload exists`).toBe(persistence.beforeHash);
          expect(persistence.firstDifference, `${rowId}: persistence drift`).toBeNull();
          expect(persistence.cleanedUp, `${rowId}: persistence cleanup`).toBe(true);
          probed.add(actionClass);
          report.persistence.push({ actionClass, ...persistence });
        }
        const row = {
          id: rowId,
          actionClass,
          rotation: actionContext.parklandComposableCamera.rotation,
          zoom: actionContext.camera.zoom,
          tier: actionContext.requested.quality,
          renderedGroundCoverTier: actionContext.camera.groundCoverTier,
          actionContext,
          postActionContext,
          locus,
          target,
          screenPoint: projected.screen,
          projectedVisualSurfacePoint: projected.visualSurfacePoint,
          selectedCell: projected.selectedCell,
          handledPointerCell: after.handledPointerCell,
          committedCell: after.committedCell,
          before,
          after,
          undoRedo,
          persistence,
          courseStateHashes: { before: before.courseHash, after: after.courseHash },
          consolePageErrors: errors.slice(errorStart),
        };
        report.rows.push(row);
        if (tier === "high" && locus === "center") {
          await canvas.screenshot({ path: path.join(EVIDENCE_DIR, "screens", `${rowId}.png`) });
        }
        expect(errors.slice(errorStart), `${rowId}: runtime errors`).toEqual([]);
        await flush();
      } catch (error) {
        report.firstMismatch = {
          rowId,
          message: error instanceof Error ? error.message : String(error),
          consolePageErrors: errors.slice(errorStart),
        };
        await flush();
        throw error;
      }
    }
  }

  if (MAX_ROWS >= 144 || RUN_INTEGRATED) {
    if (MAX_ROWS >= 144) {
      expect(report.rows).toHaveLength(144);
      expect(probed).toEqual(new Set(ACTIONS));
    }

    const integratedRows: Array<{
      actionClass: ActionClass;
      target: Point;
      handledPointerCell: Point | null;
      committedCell: Point | null;
    }> = [];
    const firstTarget = await page.evaluate(() => window.__coursecraftTest!.setZk470PlacementFixture("terrain-stroke"));
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("high"));
    await setRotation(page, 0);
    for (const actionClass of ACTIONS) {
      await page.evaluate((value) => window.__coursecraftTest!.configureZk470PlacementAction(value), actionClass);
      const snapshot = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
      const target = actionClass === "terrain-stroke" ? firstTarget : snapshot.target;
      await page.evaluate(({ point }) => window.__coursecraftPixiTest!.focusTileForTest(point.x, point.y, 1.15), target);
      const projected = await resolvePointerPoint(page, target.point, "center");
      await pointerAction(page, actionClass, projected.screen, canvasOrigin);
      await expect.poll(() => page.evaluate(async (value) => (
        (await window.__coursecraftTest!.zk470PlacementSnapshot(value)).committedCell
      ), actionClass), { timeout: 30_000 }).toEqual(target.point);
      const committed = await page.evaluate((value) => window.__coursecraftTest!.zk470PlacementSnapshot(value), actionClass);
      expect(committed.handledPointerCell, `integrated ${actionClass}: native handler cell`).toEqual(target.point);
      integratedRows.push({
        actionClass,
        target: target.point,
        handledPointerCell: committed.handledPointerCell,
        committedCell: committed.committedCell,
      });
    }
    const integratedShot = path.join(EVIDENCE_DIR, "screens", "integrated-final.png");
    await canvas.screenshot({ path: integratedShot });
    report.integrated = {
      rows: integratedRows,
      final: await page.evaluate(() => window.__coursecraftTest!.zk470PlacementSnapshot("structure")),
      screenshot: integratedShot,
      consolePageErrors: errors,
    };
    expect(errors).toEqual([]);
    await flush();
  }
});
