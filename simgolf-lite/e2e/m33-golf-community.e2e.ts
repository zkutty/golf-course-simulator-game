import { expect, test } from "@playwright/test";

test("M33 safe retained phase, resident claim, mitigation, and save reconciliation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?propertyFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 30_000 }).toBe("game");

  const result = await page.evaluate(() => window.__coursecraftTest!.runM33GoldenPath());
  expect(result.beforeHash).toBe(result.afterHash);
  expect(result).toMatchObject({
    strategy: "retain",
    status: "complete",
    tenure: "retained",
    complaintStatus: "compensated",
    claimStatus: "settled",
    protectedEasements: 3,
  });
  expect(result.units).toBeGreaterThan(10);
  expect(result.households).toBeGreaterThan(0);
  expect(result.incidentKind).not.toBe("missing");
  expect(result.riskWithMitigation).toBeLessThan(result.riskWithoutMitigation);
  expect(result.realEstateRevenue).toBeGreaterThan(0);
  expect(result.realEstateCosts).toBeGreaterThan(0);
  expect(result.residentLocalSpend).toBeGreaterThan(0);
  expect(result.residentMembers).toBeGreaterThan(0);
  expect(result.cash).toBeGreaterThan(0);

  await page.getByTestId("open-property-management").click();
  await page.getByTestId("property-tab-community").click();
  const dashboard = page.getByTestId("m33-community-dashboard");
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId("development-pipeline")).toContainText("retained rental");
  await expect(dashboard).toContainText("Residents & HOA");
  await expect(dashboard).toContainText("Claims & insurance");
  await expect(page.getByTestId("m33-safety-heatmap")).toBeVisible();
  await expect(dashboard).toContainText("No open damage claims");
  await expect(dashboard).toContainText("No open complaints");

  const textState = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(textState.course.property.developments[0]).toMatchObject({ strategy: "retain", status: "complete" });
  expect(textState.course.property.units).toHaveLength(result.units);
  expect(textState.course.property.households).toHaveLength(result.households);
  expect(textState.course.property.claims.at(-1).status).toBe("settled");
  expect(textState.course.property.complaintDetails.at(-1).status).toBe("compensated");
  expect(textState.course.property.safety.heatCells).toBeGreaterThan(0);
  expect(textState.course.property.easements.every((easement: { protected: boolean }) => easement.protected)).toBe(true);

  const overflow = await page.getByTestId("property-management-panel").evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth + 1,
    vertical: element.scrollHeight > element.clientHeight,
  }));
  expect(overflow.horizontal).toBe(false);
  expect(overflow.vertical).toBe(false);

  await dashboard.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const shot = await page.screenshot({ fullPage: true, path: "artifacts/m33-golf-community.png" });
  await testInfo.attach("m33-community", { body: shot, contentType: "image/png" });
  await page.getByRole("heading", { name: "Claims & insurance" }).evaluate((element) => element.scrollIntoView({ block: "start" }));
  const claimsShot = await page.screenshot({ fullPage: true, path: "artifacts/m33-residents-claims.png" });
  await testInfo.attach("m33-residents-claims", { body: claimsShot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
