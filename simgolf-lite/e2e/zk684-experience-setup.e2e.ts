import { expect, test, type Page } from "@playwright/test";

type ExperienceProfile = "relaxed" | "classic" | "simulation";
type EconomicPressure = "friendly" | "balanced" | "tight";

async function openExperienceSetup(page: Page, mode: "challenge" | "sandbox" = "challenge") {
  await page.goto("/");
  await page.getByRole("button", { name: "New Game" }).click();
  if (mode === "sandbox") await page.getByRole("button", { name: "Sandbox" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText("How hands-on do you want to be?")).toBeVisible();
}

async function expectExperienceText(page: Page, profile: ExperienceProfile, pressure: EconomicPressure) {
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).experience))
    .toEqual({ profile, economicPressure: pressure });
}

for (const [profile, pressure] of [
  ["relaxed", "friendly"],
  ["classic", "balanced"],
  ["simulation", "balanced"],
] as const) {
  test(`new-game ${profile} defaults to ${pressure} and carries both axes into the run`, async ({ page }) => {
    await openExperienceSetup(page);
    const profileCard = page.getByTestId(`experience-profile-${profile}`);
    await profileCard.focus();
    await page.keyboard.press("Enter");
    await expect(profileCard).toHaveAttribute("aria-pressed", "true");
    await expect(profileCard).toContainText("You manage");
    await expect(profileCard).toContainText("Your team manages");

    await page.getByTestId("economic-pressure-advanced").locator("summary").click();
    await expect(page.getByTestId(`economic-pressure-${pressure}`)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByText(new RegExp(`${profile}.*${pressure}`, "i"))).toBeVisible();
    await page.getByRole("button", { name: "⛳ Start building" }).click();
    await expectExperienceText(page, profile, pressure);
  });
}

test("explicit economic pressure survives a profile change without changing profile intent", async ({ page }) => {
  await openExperienceSetup(page);
  await page.getByTestId("experience-profile-relaxed").click();
  await page.getByTestId("economic-pressure-advanced").locator("summary").click();
  await page.getByTestId("economic-pressure-tight").click();
  await page.getByTestId("experience-profile-simulation").click();

  await expect(page.getByTestId("experience-profile-simulation")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("economic-pressure-tight")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText(/Simulation.*Tight/)).toBeVisible();
  await page.getByRole("button", { name: "⛳ Start building" }).click();
  await expectExperienceText(page, "simulation", "tight");
});

test("untouched pressure follows the profile defaults through every profile change", async ({ page }) => {
  await openExperienceSetup(page);
  await page.getByTestId("economic-pressure-advanced").locator("summary").click();

  for (const [profile, pressure] of [
    ["classic", "balanced"],
    ["relaxed", "friendly"],
    ["simulation", "balanced"],
    ["classic", "balanced"],
  ] as const) {
    await page.getByTestId(`experience-profile-${profile}`).click();
    await expect(page.getByTestId(`economic-pressure-${pressure}`)).toHaveAttribute("aria-pressed", "true");
  }
});

test("Sandbox carries an independent non-default profile and pressure", async ({ page }) => {
  await openExperienceSetup(page, "sandbox");
  await page.getByTestId("experience-profile-simulation").click();
  await page.getByTestId("economic-pressure-advanced").locator("summary").click();
  await page.getByTestId("economic-pressure-friendly").click();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByTestId("setup-review")).toContainText("Sandbox · Parkland · Simulation · Friendly");
  await page.getByRole("button", { name: "⛳ Start building" }).click();
  await expectExperienceText(page, "simulation", "friendly");
});

test("Quick Start remains a first-time tutorial handoff and deterministically uses Relaxed/Friendly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expectExperienceText(page, "relaxed", "friendly");
  await expect(page.getByRole("dialog", { name: "First-launch tutorial" })).toBeVisible();
});

test("experience setup remains scrollable at text scale in the pseudo locale with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto("/");
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Accessibility" }).click();
  await page.getByLabel("Reduced motion").check();
  await page.getByLabel("Text scale").selectOption("130");
  await page.getByRole("button", { name: "Done" }).click();
  await page.evaluate(() => window.localStorage.setItem("coursecraft_locale", "pseudo"));
  await page.reload();
  await page.getByRole("button", { name: /Ñëw Gámë/ }).click();
  await page.getByRole("button", { name: "Next →" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Next →" }).focus();
  await page.keyboard.press("Enter");

  const wizard = page.locator(".cc-biome-wizard");
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.getByTestId("experience-profile-simulation")).toBeVisible();
  await expect.poll(() => wizard.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))).toMatchObject({ overflowY: "auto" });
  const dimensions = await wizard.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await wizard.hover();
  await page.mouse.wheel(0, 640);
  await expect.poll(() => wizard.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next →" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("setup-review")).toBeVisible();
  const review = await page.getByTestId("setup-review").textContent();
  expect(review).toMatch(/^⟦.*sëëd \d+.*⟧$/i);
});
