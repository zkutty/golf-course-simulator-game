import { expect, test } from "@playwright/test";

test("ZK-652 private blueprint capture and bounded library metadata", async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/zk652-content-library.html", { waitUntil: "networkidle", timeout: 30_000 });
  const panel = page.getByTestId("content-library");
  const capture = panel.getByRole("button", { name: "Save hole template", exact: true });
  const attestation = panel.getByRole("checkbox", { name: "I have the right to use this hole's source for my private blueprint." });
  await expect(attestation).not.toBeChecked();
  await expect(capture).toBeDisabled();
  await attestation.check();
  await expect(capture).toBeEnabled();
  await attestation.uncheck();
  await expect(capture).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Export private copy", exact: true })).toBeVisible();
  await expect(panel.getByText("Source: Player-built proof hole · Imported: 2026-08-05T12:00:00.000Z · Fidelity: Sketch (approximate)", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Player photos and unknown rights allow private copies only/)).toBeVisible();
  await expect(panel.getByText(/Calibrated requires reviewed control points and verified yardage/)).toBeVisible();
  await expect(panel.getByText(/Do not scrape course sites or map providers/)).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("zk652-fail-metadata-read")));
  await panel.getByRole("button", { name: "Import package", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Fixture metadata read failed");
  await expect(panel.locator("article")).toHaveCount(0);
  await expect(panel.getByText("No local packages yet.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
