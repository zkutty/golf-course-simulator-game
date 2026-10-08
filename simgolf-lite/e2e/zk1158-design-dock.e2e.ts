import { expect, test, type Locator, type Page } from "@playwright/test";

test.setTimeout(60_000);

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

function expectSameBox(
  before: Awaited<ReturnType<typeof box>>,
  after: Awaited<ReturnType<typeof box>>,
  name: string,
) {
  for (const dimension of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(before[dimension] - after[dimension]),
      `${name}.${dimension} should remain stable`,
    ).toBeLessThan(0.5);
  }
}

async function visibleGeometry(page: Page, cards: readonly Locator[]) {
  const dock = page.getByTestId("design-dock");
  const palette = page.getByRole("listbox");
  const inspector = page.getByTestId("design-inspector");
  return {
    dock: await box(dock),
    palette: await box(palette),
    inspector: await box(inspector),
    cards: await Promise.all(cards.map(box)),
  };
}

function expectSameGeometry(
  before: Awaited<ReturnType<typeof visibleGeometry>>,
  after: Awaited<ReturnType<typeof visibleGeometry>>,
) {
  expectSameBox(before.dock, after.dock, "dock");
  expectSameBox(before.palette, after.palette, "palette");
  expectSameBox(before.inspector, after.inspector, "inspector");
  for (let index = 0; index < before.cards.length; index++) {
    expectSameBox(before.cards[index], after.cards[index], `card-${index}`);
  }
}

test("DesignDock keeps geometry stable across inspector and card states", async ({ page }) => {
  await page.goto("/e2e/fixtures/zk1158-design-dock.html");
  const dock = page.getByTestId("design-dock");
  await expect(dock).toBeVisible();
  await dock.getByRole("button", { name: "Expand design dock" }).click();
  await dock.getByRole("tab", { name: "Decor" }).click();

  const bridge = page.getByTestId("design-card-decor-bridge");
  const ornamentalFeature = page.getByTestId("design-card-decor-ornamental_feature");
  const inspector = page.getByTestId("design-inspector");
  const decorCards = [bridge, ornamentalFeature] as const;
  await bridge.scrollIntoViewIfNeeded();
  await bridge.hover();
  await expect(inspector.getByLabel("Decoration span")).toBeVisible();
  const bridgeContent = await inspector.innerText();
  const bridgeGeometry = await visibleGeometry(page, decorCards);

  await ornamentalFeature.hover();
  await expect(inspector.getByLabel("Decoration span")).toBeHidden();
  await expect(inspector).toContainText("Safe art fallback");
  expect(await inspector.innerText()).not.toBe(bridgeContent);
  const ornamentalGeometry = await visibleGeometry(page, decorCards);
  expectSameGeometry(bridgeGeometry, ornamentalGeometry);

  // The mouse remains over this card during the quiet interval, so this also
  // catches content reflow that would move the hovered card out from under it.
  await page.waitForTimeout(250);
  expectSameGeometry(ornamentalGeometry, await visibleGeometry(page, decorCards));

  await bridge.click();
  await expect(bridge).toHaveAttribute("aria-selected", "true");
  const selectedGeometry = await visibleGeometry(page, decorCards);
  expectSameGeometry(ornamentalGeometry, selectedGeometry);

  const cardStateGeometry = async () => ({
    card: await box(bridge),
    swatch: await box(bridge.locator(".cc-design-swatch")),
    transform: await bridge.evaluate((card) => getComputedStyle(card).transform),
  });
  const selectedState = await cardStateGeometry();
  await bridge.focus();
  const focusedState = await cardStateGeometry();
  expectSameBox(selectedState.card, focusedState.card, "focused-card");
  expectSameBox(selectedState.swatch, focusedState.swatch, "focused-swatch");
  expect(selectedState.transform).toBe("none");
  expect(focusedState.transform).toBe("none");

  const originalCardState = await bridge.evaluate((card) => ({
    locked: card.getAttribute("data-locked"),
    affordable: card.getAttribute("data-affordable"),
    disabled: card.getAttribute("aria-disabled"),
    selected: card.getAttribute("aria-selected"),
    preview: card.querySelector(".cc-design-swatch")?.getAttribute("data-preview-source"),
  }));
  const assertCardStateGeometry = async () => {
    const state = await cardStateGeometry();
    expectSameBox(selectedState.card, state.card, "card-state");
    expectSameBox(selectedState.swatch, state.swatch, "swatch-state");
    expect(state.transform).toBe("none");
  };
  await bridge.evaluate((card) => {
    card.dataset.locked = "true";
    card.setAttribute("aria-disabled", "true");
  });
  await assertCardStateGeometry();
  await bridge.evaluate((card) => {
    card.dataset.affordable = "false";
  });
  await assertCardStateGeometry();
  await bridge.locator(".cc-design-swatch").evaluate((swatch) => {
    swatch.setAttribute("data-preview-source", "fallback");
  });
  await assertCardStateGeometry();
  await bridge.evaluate((card, original) => {
    card.setAttribute("data-locked", original.locked ?? "false");
    card.setAttribute("data-affordable", original.affordable ?? "true");
    card.setAttribute("aria-disabled", original.disabled ?? "false");
    card.setAttribute("aria-selected", original.selected ?? "false");
    card.querySelector(".cc-design-swatch")?.setAttribute(
      "data-preview-source",
      original.preview ?? "fallback",
    );
  }, originalCardState);

  await dock.getByRole("tab", { name: "Nature" }).click();
  const oak = page.getByTestId("design-card-plant-parkland-oak");
  const shrub = page.getByTestId("design-card-plant-parkland-wild-shrub");
  const natureCards = [oak, shrub] as const;
  await oak.hover();
  const oakContent = await inspector.innerText();
  const oakGeometry = await visibleGeometry(page, natureCards);
  await shrub.hover();
  expect(await inspector.innerText()).not.toBe(oakContent);
  const shrubGeometry = await visibleGeometry(page, natureCards);
  expectSameGeometry(oakGeometry, shrubGeometry);

  await page.setViewportSize({ width: 760, height: 520 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(oak).toBeVisible();
  await oak.focus();
  await expect(oak).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(shrub).toBeFocused();

  const palette = page.getByTestId("design-palette-nature");
  const scrollTop = await palette.evaluate((element) => {
    element.scrollTop = 80;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  await oak.focus();
  await expect(oak).toBeFocused();
  const compactGeometry = await visibleGeometry(page, natureCards);
  const compactScrollTop = await palette.evaluate((element) => element.scrollTop);
  await shrub.hover();
  expect(await palette.evaluate((element) => element.scrollTop)).toBe(compactScrollTop);
  expectSameGeometry(compactGeometry, await visibleGeometry(page, natureCards));
  const zoomScreenshot = await page.screenshot({
    path: "/private/tmp/zk1158-design-dock-200-percent-zoom.png",
  });
  await test.info().attach("zk1158-design-dock-200-percent-zoom", {
    body: zoomScreenshot,
    contentType: "image/png",
  });
});
