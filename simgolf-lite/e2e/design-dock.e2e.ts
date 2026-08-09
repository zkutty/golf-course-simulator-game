import { expect, test, type Page } from "@playwright/test";

async function enterGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(
    () => page.evaluate(() => window.__coursecraftTest?.state().screen),
  ).toBe("game");
  const tutorialOffer = page.getByRole("dialog", {
    name: "First-launch tutorial",
  });
  if (await tutorialOffer.count()) {
    await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  }
}

test("registry Design dock supports keyboard, touch, responsive layout, and exact inspector facts", async ({ page }) => {
  await enterGame(page);
  const dock = page.getByTestId("design-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("tab")).toHaveCount(3);
  await expect(dock.locator('[role="tabpanel"]')).toHaveCount(3);
  await expect(dock.locator("#design-panel-terrain")).toBeVisible();
  await expect(dock.locator("#design-panel-nature")).toBeHidden();
  await expect(dock.locator("#design-panel-decor")).toBeHidden();
  const terrainTab = dock.getByRole("tab", { name: "Terrain" });
  const natureTab = dock.getByRole("tab", { name: "Nature" });
  const decorTab = dock.getByRole("tab", { name: "Decor" });
  await terrainTab.focus();
  await page.keyboard.press("End");
  await expect(decorTab).toBeFocused();
  await expect(decorTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(terrainTab).toBeFocused();
  await expect(terrainTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(natureTab).toBeFocused();
  await expect(natureTab).toHaveAttribute("aria-selected", "true");
  for (const category of ["terrain", "nature", "decor"]) {
    const tab = dock.locator(`#design-tab-${category}`);
    await expect(tab).toHaveAttribute("aria-controls", `design-panel-${category}`);
    await expect(dock.locator(`#design-panel-${category}`)).toHaveCount(1);
  }

  await terrainTab.click();
  const terrainPalette = page.getByTestId("design-palette-terrain");
  await expect(terrainPalette.getByRole("option")).toHaveCount(10);
  await expect(terrainPalette.locator('[tabindex="0"]')).toHaveCount(1);

  const terrainCards = terrainPalette.getByRole("option");
  await terrainCards.first().focus();
  await page.keyboard.press("ArrowDown");
  const rough = page.getByTestId("design-card-terrain-rough");
  await expect(rough).toBeFocused();
  await expect(terrainPalette.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(rough).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(rough).toBeFocused();

  const firstBox = await terrainCards.nth(0).boundingBox();
  const secondBox = await terrainCards.nth(1).boundingBox();
  const thirdBox = await terrainCards.nth(2).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(thirdBox).not.toBeNull();
  expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(2);
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y);
  expect(thirdBox!.x).toBeGreaterThan(firstBox!.x);
  expect(firstBox!.width).toBeGreaterThanOrEqual(60);
  expect(firstBox!.height).toBeGreaterThanOrEqual(46);

  await natureTab.click();
  const naturePalette = page.getByTestId("design-palette-nature");
  await expect(naturePalette.getByRole("option")).toHaveCount(16);
  const oak = page.getByTestId("design-card-plant-parkland-oak");
  await oak.focus();
  await expect(oak).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const shrub = page.getByTestId("design-card-plant-parkland-wild-shrub");
  await expect(shrub).toBeFocused();
  await expect(naturePalette.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(shrub).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Enter");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "OBSTACLE",
    selectedDesignItem: "plant:parkland-wild-shrub",
    selectedPlantId: "parkland-wild-shrub",
  });
  await expect(page.getByTestId("design-inspector")).toContainText("Weekly care");
  await expect(page.getByTestId("design-inspector")).toContainText("Current-season risk");
  await expect(page.getByTestId("design-inspector")).toContainText("Water");

  const imported = page.getByTestId("design-card-plant-desert-mesquite");
  await imported.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await page.waitForTimeout(560);
  await imported.dispatchEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor.selectedPlantId),
  ).toBe("desert-mesquite");
  await expect(page.getByTestId("design-inspector")).toContainText("Safe art fallback");

  await decorTab.click();
  const decorPalette = page.getByTestId("design-palette-decor");
  await expect(decorPalette.getByRole("option")).toHaveCount(11);
  const bridgeCard = page.getByTestId("design-card-decor-bridge");
  await bridgeCard.focus();
  await page.keyboard.press("Enter");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "DECOR",
    selectedDesignItem: "decor:bridge",
    selectedDecoration: "bridge",
  });
  const inspector = page.getByTestId("design-inspector");
  const quoteBefore = await bridgeCard.getAttribute("aria-label");
  const inspectorBefore = await inspector.innerText();
  await page.getByLabel("Decoration span").fill("5");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor.decorationSpan),
  ).toBe(5);
  await expect.poll(() => bridgeCard.getAttribute("aria-label"))
    .not.toBe(quoteBefore);
  await expect.poll(() => inspector.innerText()).not.toBe(inspectorBefore);
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(0));
  await expect(bridgeCard).toHaveAttribute("data-affordable", "false");
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(1_000_000));
  await expect(bridgeCard).toHaveAttribute("data-affordable", "true");

  const previewSources = await decorPalette.getByRole("option").evaluateAll((cards) =>
    cards.map((card) => card.querySelector("[data-preview-source]")?.getAttribute("data-preview-source"))
  );
  expect(previewSources.every((source) => source === "atlas" || source === "fallback")).toBe(true);
  await test.info().attach("design-dock-desktop", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await page.setViewportSize({ width: 760, height: 900 });
  const narrowBox = await dock.boundingBox();
  expect(narrowBox).not.toBeNull();
  expect(narrowBox!.width).toBeLessThanOrEqual(302);
  expect(narrowBox!.x).toBeLessThan(50);
  await expect(page.getByRole("tab", { name: "Decor" })).toBeVisible();
  await test.info().attach("design-dock-narrow", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("tool and new-run activation keep the full design selection coherent", async ({ page }) => {
  await enterGame(page);
  const dock = page.getByTestId("design-dock");

  await dock.getByRole("tab", { name: "Decor" }).click();
  await page.getByTestId("design-card-decor-bridge").focus();
  await page.keyboard.press("Enter");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "DECOR",
    selectedDesignItem: "decor:bridge",
    selectedPlantId: null,
    selectedDecoration: "bridge",
  });

  await page.locator(".cc-hud").getByRole("button", {
    name: "Design",
    exact: true,
  }).click();
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "PAINT",
    selectedTerrain: "fairway",
    selectedDesignItem: "terrain:fairway",
    selectedPlantId: null,
  });
  await expect(dock).toHaveAttribute("data-category", "terrain");

  await dock.getByRole("tab", { name: "Decor" }).click();
  await page.getByTestId("design-card-decor-bridge").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("design-tool-curve").click();
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "PAINT",
    terrainTool: "curve",
    selectedTerrain: "fairway",
    selectedDesignItem: "terrain:fairway",
    selectedPlantId: null,
  });
  await expect(dock).toHaveAttribute("data-category", "terrain");
  await expect(page.getByTestId("design-card-terrain-fairway"))
    .toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("KeyO");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "OBSTACLE",
    selectedDesignItem: "plant:parkland-oak",
    selectedPlantId: "parkland-oak",
  });
  await page.keyboard.press("KeyT");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "PAINT",
    selectedTerrain: "fairway",
    selectedDesignItem: "terrain:fairway",
    selectedPlantId: null,
  });

  await dock.getByRole("tab", { name: "Nature" }).click();
  await page.getByTestId("design-card-plant-parkland-wild-shrub").click();
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "OBSTACLE",
    selectedDesignItem: "plant:parkland-wild-shrub",
    selectedPlantId: "parkland-wild-shrub",
  });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Quit to title/ }).click();
  await expect(page.getByRole("button", { name: "Quick Start" })).toBeVisible();
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor),
  ).toMatchObject({
    mode: "PAINT",
    terrainTool: "curve",
    selectedTerrain: "fairway",
    selectedDesignItem: "terrain:fairway",
    selectedPlantId: null,
    selectedDecoration: "bench",
  });
  await expect(page.getByTestId("design-dock"))
    .toHaveAttribute("data-category", "terrain");
});

test("terrain drag exposes the shared material ghost and full precommit summary", async ({ page }) => {
  await enterGame(page);
  await page.getByRole("tab", { name: "Terrain" }).click();
  await page.getByTestId("design-card-terrain-green").click();
  const canvas = page.locator(".cc-course-pane canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.48;
  const y = box!.y + box!.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 18, { steps: 4 });
  const summary = page.getByTestId("terrain-stroke-preview");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Precommit summary");
  await expect(summary).toContainText("Construction");
  await expect(summary).toContainText("terrain salvage");
  await expect(summary).toContainText("Weekly upkeep weight");
  await expect(summary).toContainText("irrigation demand");
  await expect(summary).toContainText("scarcity ×");
  await expect(summary).toHaveAttribute("data-affordable", /true|false/);
  await test.info().attach("design-dock-precommit", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.mouse.up();
});

test("live terrain ghosts clear when the selected material changes", async ({ page }) => {
  await enterGame(page);
  await page.getByRole("tab", { name: "Terrain" }).click();
  await page.getByTestId("design-card-terrain-green").click();
  const canvas = page.locator(".cc-course-pane canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.48;
  const y = box!.y + box!.height * 0.34;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y + 14, { steps: 4 });
  await expect.poll(() => page.evaluate(
    () => window.__coursecraftPixiTest?.terrainPreview() ?? null,
  )).toMatchObject({
    previewKind: "stroke",
    selectedTerrain: "green",
    materials: ["green"],
  });
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="design-card-terrain-fairway"]',
      ) as HTMLButtonElement | null
    )?.click();
  });
  await expect.poll(() => page.evaluate(
    () => window.__coursecraftPixiTest?.terrainPreview() ?? null,
  )).toBeNull();
  await expect(page.getByTestId("terrain-stroke-preview")).toHaveCount(0);
  await page.mouse.up();
});

test("terrain and planting swatches refresh from authoritative season state", async ({ page }) => {
  await enterGame(page);
  const dock = page.getByTestId("design-dock");
  const readTreatments = async () => {
    await dock.getByRole("tab", { name: "Terrain" }).click();
    const terrain = page
      .getByTestId("design-card-terrain-fairway")
      .locator("[data-seasonal-variant]");
    const terrainFacts = await terrain.evaluate((element) => ({
      variant: element.getAttribute("data-seasonal-variant"),
      tint: element.getAttribute("data-preview-tint"),
      alpha: element.getAttribute("data-preview-alpha"),
      fallback: element.getAttribute("style"),
      source: element.getAttribute("data-preview-source"),
    }));
    await dock.getByRole("tab", { name: "Nature" }).click();
    const plant = page
      .getByTestId("design-card-plant-parkland-oak")
      .locator("[data-seasonal-variant]");
    const plantFacts = await plant.evaluate((element) => ({
      variant: element.getAttribute("data-seasonal-variant"),
      tint: element.getAttribute("data-preview-tint"),
      alpha: element.getAttribute("data-preview-alpha"),
      fallback: element.getAttribute("style"),
      source: element.getAttribute("data-preview-source"),
    }));
    return { terrain: terrainFacts, plant: plantFacts };
  };

  await page.evaluate(() =>
    window.__coursecraftTest!.setM53SeasonalFixture("summer"));
  await expect.poll(() => page.evaluate(
    () => JSON.parse(window.render_game_to_text!()).seasons.calendar.season,
  )).toBe("summer");
  const summer = await readTreatments();

  await page.evaluate(() =>
    window.__coursecraftTest!.setM53SeasonalFixture("winter"));
  await expect.poll(() => page.evaluate(
    () => JSON.parse(window.render_game_to_text!()).seasons.calendar.season,
  )).toBe("winter");
  const winter = await readTreatments();

  expect(winter.terrain).not.toEqual(summer.terrain);
  expect(winter.plant).not.toEqual(summer.plant);
  expect(["atlas", "fallback"]).toContain(winter.terrain.source);
  expect(["atlas", "fallback"]).toContain(winter.plant.source);
});

test("tutorial started from another workspace restores a usable fairway lesson", async ({ page }) => {
  await enterGame(page);
  await page.getByRole("tab", { name: "Terrain" }).click();
  await page.getByTestId("design-card-terrain-green").click();
  await page.getByTestId("workspace-operate").click();
  await expect(page.getByTestId("design-dock")).toHaveCount(0);

  await page.getByRole("button", { name: "Tutorial", exact: true }).click();
  await expect(page.getByTestId("tutorial-overlay"))
    .toHaveAttribute("data-step-id", "welcome");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text!());
    return {
      workspace: state.workspace,
      mode: state.editor.mode,
      tool: state.editor.terrainTool,
      terrain: state.editor.selectedTerrain,
      item: state.editor.selectedDesignItem,
      dock: state.editor.designDockVisible,
    };
  })).toEqual({
    workspace: "design",
    mode: "PAINT",
    tool: "curve",
    terrain: "fairway",
    item: "terrain:fairway",
    dock: true,
  });
  const dock = page.getByTestId("design-dock");
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute("data-tutorial-target", "terrain-palette");

  await page.getByRole("button", { name: "Start designing" }).click();
  await expect(page.getByTestId("tutorial-overlay"))
    .toHaveAttribute("data-step-id", "paint-fairway");
  await expect(page.getByTestId("design-card-terrain-fairway"))
    .toHaveAttribute("aria-selected", "true");
  const fairwayBefore = await page.evaluate(
    () => window.__coursecraftTest!.state().terrainCounts.fairway ?? 0,
  );
  const canvas = page.locator(".cc-course-pane canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.48;
  const y = box!.y + box!.height * 0.34;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 22, { steps: 8 });
  await page.mouse.up();
  await expect.poll(
    () => page.evaluate(
      () => window.__coursecraftTest!.state().terrainCounts.fairway ?? 0,
    ),
  ).toBeGreaterThanOrEqual(fairwayBefore + 4);
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});
