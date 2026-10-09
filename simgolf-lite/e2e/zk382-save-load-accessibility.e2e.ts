import { expect, test } from "@playwright/test";
import type { SaveLoadFixture } from "./fixtures/zk382-save-load.fixture";
import { readFile } from "node:fs/promises";

declare global { interface Window { __saveLoadFixture: SaveLoadFixture } }
const fixture = "/e2e/fixtures/zk382-save-load.html";
const longName = "Willow_Creek_Championship_Course_Complete_Saved_Progress_With_A_Very_Long_Unbroken_Name";

test("Save Load has an explicit save name label and text scales with the root", async ({ page }) => {
  await page.goto(fixture);
  await page.getByTestId("open-save-load").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("New save name", { exact: true })).toBeVisible();
  await expect(dialog.locator(".cc-save-load-slot")).toHaveCount(3);
  const fonts = () => dialog.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("button, input:not([hidden]), h2, h3, p, label, span")).map((item) => Number.parseFloat(getComputedStyle(item).fontSize)));
  const before = await fonts();
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  expect(await page.locator("html").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(20.8, 2);
  const after = await fonts();
  before.forEach((size, index) => expect(Math.abs(after[index] / size - 1.3)).toBeLessThan(.01));
});

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`Save Load complete text and keyboard controls at 130%: ${locale} ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const pixiRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (/pixi|\/render\//i.test(request.url())) pixiRequests.push(request.url()); });
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture);
    const opener = page.getByTestId("open-save-load");
    await opener.click();
    const dialog = page.getByRole("dialog");
    const panel = dialog.locator(".cc-save-load-panel");
    await expect(dialog.locator(".cc-save-load-slot")).toHaveCount(3);
    await dialog.getByTestId("save-slot-fixture-manual").getByRole("button", { name: locale === "en" ? "Delete" : "⟦Dëlëtë ···⟧", exact: true }).click();
    await expect(dialog.getByTestId("save-slot-fixture-manual").getByRole("status")).toBeVisible();
    const sizes = () => panel.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("h2, h3, label, p, span, button, input:not([hidden])")).map((item) => parseFloat(getComputedStyle(item).fontSize)));
    const before = await sizes();
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    expect(await page.locator("html").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(20.8, 2);
    const after = await sizes();
    expect(after.length).toBe(before.length);
    after.forEach((font, index) => expect(Math.abs(font / before[index] - 1.3), `text element ${index}`).toBeLessThan(.01));
    const bounds = await panel.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, client: element.clientWidth, scroll: element.scrollWidth }; });
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const clipped = await panel.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("h2, h3, p, label, span, button")).filter((item) => item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1 || getComputedStyle(item).textOverflow === "ellipsis").map((item) => item.textContent));
    expect(clipped).toEqual([]);
    await expect(dialog.getByTestId("save-slot-fixture-manual").locator("h3")).toHaveText(longName);
    await expect(dialog.getByTestId("save-slot-fixture-manual").locator(".cc-save-load-summary")).toContainText("0/9");
    if (locale === "pseudo") await expect(dialog.getByTestId("save-slot-fixture-manual").locator(".cc-save-load-summary")).toContainText("wëëk 42");
    const controls = panel.locator("button, input:not([hidden])");
    await controls.first().focus();
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index);
      await expect(control).toBeFocused();
      const rect = await control.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left); expect(rect.right).toBeLessThanOrEqual(bounds.right);
      expect(rect.top).toBeGreaterThanOrEqual(bounds.top); expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      const description = await control.getAttribute("aria-describedby");
      if (await control.evaluate((element) => Boolean(element.closest(".cc-save-load-slot")))) {
        expect(description).not.toBeNull();
        await expect(control).toHaveAccessibleDescription(await page.locator(`[id="${description}"]`).textContent() ?? "");
      }
      await page.keyboard.press("Tab");
    }
    await expect(controls.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(controls.last()).toBeFocused();
    await panel.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/zk382/save-load/${locale}-${width}-130.png` });
    await testInfo.attach("scaled modal", { path: `artifacts/zk382/save-load/${locale}-${width}-130.png`, contentType: "image/png" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await opener.click(); await dialog.click({ position: { x: 1, y: 1 } }); await expect(dialog).toHaveCount(0);
    expect(await page.locator("canvas").count()).toBe(0); expect(pixiRequests).toEqual([]); expect(errors).toEqual([]);
  });
}

test("save, native rename, overwrite, subscription, delete cancellation and confirmation preserve slot contracts", async ({ page }) => {
  await page.goto(fixture); await page.getByTestId("open-save-load").click();
  const dialog = page.getByRole("dialog");
  const manual = page.getByTestId("save-slot-fixture-manual");
  await expect(manual).toBeVisible();
  const initial = await page.evaluate(() => window.__saveLoadFixture.slots());
  page.once("dialog", (prompt) => prompt.dismiss());
  await manual.getByRole("button", { name: "Rename", exact: true }).click();
  expect(await page.evaluate(() => window.__saveLoadFixture.slots())).toEqual(initial);
  page.once("dialog", async (prompt) => { expect(prompt.defaultValue()).toBe(longName); await prompt.accept("  Renamed Championship  "); });
  await manual.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(manual.locator("h3")).toHaveText("Renamed Championship");
  await page.evaluate(() => window.__saveLoadFixture.setWeek(77));
  for (const [id, kind] of [["fixture-manual", "manual"], ["auto-0", "auto"], ["quick", "quick"]] as const) {
    const prior = (await page.evaluate(() => window.__saveLoadFixture.slots())).find((slot) => slot.id === id)!;
    await page.getByTestId(`save-slot-${id}`).getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.__saveLoadFixture.slots())).find((slot) => slot.id === id)?.week).toBe(77);
    const current = (await page.evaluate(() => window.__saveLoadFixture.slots())).find((slot) => slot.id === id)!;
    expect(current).toMatchObject({ id, kind, name: prior.name });
    const loaded = await page.evaluate((slotId) => window.__saveLoadFixture.load(slotId), id);
    expect(loaded).toMatchObject({ ok: true, payload: { world: { week: 77 } } });
  }
  await dialog.getByLabel("New save name", { exact: true }).fill("  Named new slot  ");
  await dialog.getByRole("button", { name: "Save to new slot", exact: true }).click();
  await expect(dialog.getByRole("status").first()).toHaveText("Saved.");
  await expect(dialog.getByLabel("New save name", { exact: true })).toHaveValue("");
  await expect.poll(async () => (await page.evaluate(() => window.__saveLoadFixture.slots())).some((slot) => slot.name === "Named new slot" && slot.kind === "manual")).toBe(true);
  await dialog.getByRole("button", { name: "Save to new slot", exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__saveLoadFixture.slots())).some((slot) => slot.name === "Save — week 77")).toBe(true);
  expect((await page.evaluate(() => window.__saveLoadFixture.calls())).filter((call) => call.type === "saved")).toHaveLength(5);
  await page.evaluate(() => window.__saveLoadFixture.addExternal());
  await expect(page.getByTestId("save-slot-fixture-external")).toBeVisible();
  const beforeDelete = await page.evaluate(() => window.__saveLoadFixture.slots());
  await manual.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(manual.getByRole("status")).toContainText("Delete “Renamed Championship”?");
  expect(await page.evaluate(() => window.__saveLoadFixture.slots())).toEqual(beforeDelete);
  await manual.getByRole("button", { name: "Cancel delete", exact: true }).click();
  await expect(manual.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => window.__saveLoadFixture.slots())).toEqual(beforeDelete);
  await manual.getByRole("button", { name: "Delete", exact: true }).click();
  await manual.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(manual).toHaveCount(0);
  await expect(dialog.getByRole("status").first()).toHaveText("Deleted “Renamed Championship”.");
});

test("load-only permissions, empty states, failure status and successful load callbacks", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture); await page.getByTestId("open-load-only").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Load game");
  await expect(dialog.getByRole("heading", { name: "Load Game" })).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Overwrite|Save to new slot/ })).toHaveCount(0);
  await expect(page.getByTestId("save-slot-quick").getByRole("button", { name: "Rename", exact: true })).toBeVisible();
  await page.evaluate(() => window.__saveLoadFixture.removePayload("fixture-manual"));
  await page.getByTestId("save-slot-fixture-manual").getByRole("button", { name: "Load", exact: true }).click();
  await expect(dialog.getByRole("status").first()).toHaveText("That save slot is missing.");
  expect(await page.evaluate(() => window.__saveLoadFixture.calls())).toEqual([]);
  const expected = await page.evaluate(() => window.__saveLoadFixture.load("quick"));
  expect(expected.ok).toBe(true);
  await page.getByTestId("save-slot-quick").getByRole("button", { name: "Load", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__saveLoadFixture.calls())).toEqual([{ type: "loaded", payload: expected.ok ? expected.payload : undefined }, { type: "close" }]);
  await page.evaluate(() => window.__saveLoadFixture.clear());
  await page.getByTestId("open-load-only").click();
  await expect(dialog.locator(".cc-save-load-empty")).toHaveText("No saves yet.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("open-save-load").click();
  await expect(dialog.locator(".cc-save-load-empty")).toHaveText("No saves yet — save your course above.");
  expect(errors).toEqual([]);
});

test("file import failure and export/import/load preserve exact file bytes and normalized payload", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture); await page.getByTestId("open-save-load").click();
  const dialog = page.getByRole("dialog");
  const fileInput = dialog.locator("input[type=file]");
  const originalSlots = await page.evaluate(() => window.__saveLoadFixture.slots());
  await fileInput.setInputFiles({ name: "broken.coursecraft", mimeType: "application/json", buffer: Buffer.from("{broken") });
  const expectedImportError = await page.evaluate(() => window.__saveLoadFixture.parse("{broken"));
  expect(expectedImportError.ok).toBe(false);
  await expect(dialog.getByRole("status").first()).toHaveText(expectedImportError.ok ? "" : expectedImportError.error.message);
  expect(await page.evaluate(() => window.__saveLoadFixture.slots())).toEqual(originalSlots);
  const sourceBytes = await page.evaluate(() => window.__saveLoadFixture.bytes("fixture-manual"));
  const sourcePayload = await page.evaluate(() => window.__saveLoadFixture.load("fixture-manual"));
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("save-slot-fixture-manual").getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${longName}.coursecraft`);
  const path = await download.path(); expect(path).not.toBeNull();
  const downloadedBytes = await readFile(path!);
  expect(downloadedBytes.toString("utf8")).toBe(sourceBytes);
  const chooserPromise = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Import .coursecraft file…", exact: true }).click();
  await (await chooserPromise).setFiles({ name: "Restored exact bytes.coursecraft", mimeType: "application/json", buffer: downloadedBytes });
  await expect(dialog.getByRole("status").first()).toHaveText("Imported “Restored exact bytes”.");
  const imported = (await page.evaluate(() => window.__saveLoadFixture.slots())).find((slot) => slot.name === "Restored exact bytes")!;
  expect(imported).toMatchObject({ kind: "manual", week: 42, courseName: longName });
  expect(await page.evaluate(() => window.__saveLoadFixture.calls())).toEqual([]);
  const importedPayload = await page.evaluate((id) => window.__saveLoadFixture.load(id), imported.id);
  expect(importedPayload).toEqual(sourcePayload);
  await page.getByTestId(`save-slot-${imported.id}`).getByRole("button", { name: "Load", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__saveLoadFixture.calls())).toEqual([{ type: "loaded", payload: sourcePayload.ok ? sourcePayload.payload : undefined }, { type: "close" }]);
  expect(errors).toEqual([]);
});

for (const id of ["fixture-manual", "auto-0", "quick"]) {
  test(`UI load preserves the complete payload for ${id}`, async ({ page }) => {
    await page.goto(fixture); await page.getByTestId("open-save-load").click();
    const expected = await page.evaluate((slotId) => window.__saveLoadFixture.load(slotId), id);
    expect(expected.ok).toBe(true);
    await page.getByTestId(`save-slot-${id}`).getByRole("button", { name: "Load", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.__saveLoadFixture.calls())).toEqual([{ type: "loaded", payload: expected.ok ? expected.payload : undefined }, { type: "close" }]);
  });
}
