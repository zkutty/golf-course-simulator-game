import { expect, test } from "@playwright/test";

test("M25 surveys, centers, and purchases an adjacent parcel with keyboard controls", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m25Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 45_000 }).toBe("M25 Survey Estate");

  await page.getByTestId("open-land-office").click();
  const panel = page.getByTestId("land-office");
  await expect(panel).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(before.course.estate.parcels).toHaveLength(9);
  expect(before.course.estate.ownedParcelIds).toEqual(["parcel-5"]);
  const parcel = before.course.estate.parcels.find((entry: { id: string; owned: boolean; adjacent: string[] }) => !entry.owned && entry.adjacent.includes("parcel-5"));
  expect(parcel).toBeTruthy();

  const parcelButton = page.getByTestId(`parcel-${parcel.id}`);
  await parcelButton.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Fixed appraisal")).toBeVisible();
  await panel.getByRole("button", { name: "View parcel" }).click();
  const purchase = panel.getByTestId("purchase-parcel");
  await purchase.focus();
  await page.keyboard.press("Enter");
  await expect(purchase).toContainText("Confirm purchase");
  await page.keyboard.press("Enter");

  await expect.poll(() => page.evaluate((id) => JSON.parse(window.render_game_to_text?.() ?? "{}").course.estate.ownedParcelIds.includes(id), parcel.id)).toBe(true);
  const after = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(after.economy.cash).toBe(before.economy.cash - parcel.price);
  const shot = await page.screenshot({ path: "artifacts/m25-land-office.png", fullPage: true });
  await testInfo.attach("m25-land-office", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
