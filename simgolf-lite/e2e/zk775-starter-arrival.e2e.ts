import { expect, test } from "@playwright/test";

for (const theme of ["parkland", "links", "desert"] as const) {
  test(`ZK-775 renders a connected ${theme} starter arrival`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?zk775ArrivalFixture=1&zk775Theme=${theme}&zk775Seed=424242`);
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 30_000 }).toBe("game");
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.rendererAtlasState().rendered.status), { timeout: 120_000 }).toBe("activated");

    const property = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.property);
    expect(property.accessCapacity).toBeGreaterThanOrEqual(40);
    const road = property.assets.find((asset: { id: string }) => asset.id === "property-road-starter");
    const parking = property.assets.find((asset: { id: string }) => asset.id === "property-parking-starter");
    expect(road.route.length).toBeGreaterThan(8);
    expect(parking.pedestrianRoute.length).toBeGreaterThan(1);
    expect(road.route.at(-1).x).toBeGreaterThanOrEqual(parking.x);
    expect(road.route.at(-1).x).toBeLessThan(parking.x + 6);
    expect(road.route.at(-1).y).toBeGreaterThanOrEqual(parking.y);
    expect(road.route.at(-1).y).toBeLessThan(parking.y + 5);

    const shot = await page.screenshot({ path: testInfo.outputPath(`${theme}-starter-arrival.png`), fullPage: true });
    await testInfo.attach(`${theme}-starter-arrival`, { body: shot, contentType: "image/png" });
    expect(errors).toEqual([]);
  });
}
