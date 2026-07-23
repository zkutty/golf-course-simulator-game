import { expect, test } from "@playwright/test";

test("M31-M33 property enterprise builds access, campus, resort, and community", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?propertyFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 30_000 }).toBe("game");

  await page.getByTestId("open-property-management").click();
  const panel = page.getByTestId("property-management-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("property-asset-road")).toContainText("gravel");
  await page.getByTestId("upgrade-road").click();
  await page.getByTestId("upgrade-parking").click();
  await expect(page.getByTestId("property-asset-road")).toContainText("asphalt");

  for (const kind of ["driving_range", "putting_green", "clubhouse", "pro_shop", "restaurant", "locker_room", "event_space"] as const) {
    await page.getByTestId(`build-${kind}`).click();
    await expect(page.getByTestId(`upgrade-${kind}`)).toBeVisible();
  }
  await page.getByTestId("rotate-driving_range").click();
  await page.getByLabel("Driving range upkeep policy").selectOption("premium");
  await panel.locator("article").filter({ hasText: "Club professionals" }).getByRole("button").click();
  await panel.locator("article").filter({ hasText: "Memberships and lockers" }).getByRole("button").click();
  await page.getByTestId("outing-preview-golf_only").getByRole("button").click();
  await expect(page.getByTestId("property-notice")).toContainText("booked for week");
  await page.getByTestId("install-module-check_in").click();
  await page.getByTestId("install-module-pro_shop").click();
  await expect(page.getByTestId("property-module-check_in")).toContainText("Close module");
  await page.getByTestId("property-shell-modules").evaluate((element) => element.scrollIntoView({ block: "start" }));
  const campusShot = await page.screenshot({ fullPage: true, path: "artifacts/m31-club-campus.png" });
  await testInfo.attach("club-campus", { body: campusShot, contentType: "image/png" });

  await page.getByTestId("property-tab-resort").click();
  await page.getByTestId("build-lodge").click();
  await panel.locator("article").filter({ hasText: "Front desk" }).getByRole("button").click();
  await panel.locator("article").filter({ hasText: "Housekeeping" }).getByRole("button").click();
  await panel.locator("article").filter({ hasText: "Food service" }).getByRole("button").click();
  await panel.getByRole("button", { name: "Book stay and play" }).click();
  await expect(page.getByTestId("property-notice")).toContainText("booked for week");

  await page.getByTestId("property-tab-community").click();
  await page.getByTestId("build-safety_buffer").click();
  await page.getByTestId("build-netting").click();
  await page.getByTestId("build-houses").click();

  const textState = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(textState.course.property.panelOpen).toBe(true);
  expect(textState.course.property.accessCapacity).toBeGreaterThan(60);
  expect(textState.course.property.assets.map((asset: { kind: string }) => asset.kind)).toEqual(expect.arrayContaining(["driving_range", "clubhouse", "lodge", "houses", "netting"]));
  expect(textState.course.property.professionals).toBe(1);
  expect(textState.course.property.membership.active).toBe(true);
  expect(textState.course.property.reservations).toBe(1);
  expect(textState.course.property.outings).toBe(1);
  expect(textState.course.property.assets.find((asset: { kind: string }) => asset.kind === "clubhouse").modules).toEqual(["check_in", "pro_shop"]);
  expect(textState.course.property.assets.find((asset: { kind: string }) => asset.kind === "driving_range").upkeep).toBe("premium");

  const shot = await page.screenshot({ fullPage: true, path: "artifacts/m31-property-enterprise.png" });
  await testInfo.attach("property-enterprise", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
