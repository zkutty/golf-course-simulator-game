import { expect, test, type Page } from "@playwright/test";

const BIOMES = ["parkland", "links", "desert"] as const;
const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

async function layoutSignature(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? [rect.x, rect.y, rect.width, rect.height].map((value) =>
          Math.round(value))
        : null;
    };
    return {
      main: box(".cc-main"),
      course: box(".cc-course-frame"),
      sidebar: box(".cc-sidebar-frame"),
      nav: box(".cc-workspace-nav"),
      commands: [...document.querySelectorAll(
        ".cc-workspace-nav button",
      )].map((element) =>
        element.getAttribute("data-testid") ?? element.textContent?.trim()),
    };
  });
}

type LoadingContext = {
  theme: string;
  season: string;
  weather: string;
};

async function installLoadingContextRecorder(page: Page) {
  await page.evaluate(() => {
    const target = window as Window & {
      __zk626LoadingContexts?: Array<{
        theme: string;
        season: string;
        weather: string;
      }>;
      __zk626LoadingObserver?: MutationObserver;
    };
    target.__zk626LoadingContexts = [];
    target.__zk626LoadingObserver?.disconnect();
    const record = () => {
      const loading = document.querySelector(
        '[aria-busy="true"][data-biome]',
      );
      const theme = loading?.getAttribute("data-biome");
      const season = loading?.getAttribute("data-season");
      const weather = loading?.getAttribute("data-weather");
      if (theme && season && weather) {
        target.__zk626LoadingContexts?.push({ theme, season, weather });
      }
    };
    target.__zk626LoadingObserver = new MutationObserver(record);
    target.__zk626LoadingObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    record();
  });
}

async function recordedLoadingContexts(page: Page): Promise<LoadingContext[]> {
  return page.evaluate(() =>
    (window as Window & {
      __zk626LoadingContexts?: Array<{
        theme: string;
        season: string;
        weather: string;
      }>;
    }).__zk626LoadingContexts ?? []);
}

async function expectRecordedLoadingContext(
  page: Page,
  expected: LoadingContext,
) {
  await expect.poll(() => recordedLoadingContexts(page)).toContainEqual(
    expected,
  );
}

test("ZK-626 keeps one responsive command layout across every biome and season", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
      accessibility: {
        colorVision: "deuteranopia",
        reducedMotion: true,
      },
    }));
  });

  let desktopReference: Awaited<ReturnType<typeof layoutSignature>> | null =
    null;
  let narrowReference: Awaited<ReturnType<typeof layoutSignature>> | null =
    null;
  const neutralPatterns = new Map<string, string>();
  const warningPatterns = new Map<string, string>();
  const positivePatterns = new Map<string, string>();
  const cvdAccents = new Set<string>();
  const seasonSurfaces = new Map<string, Set<string>>();
  const warningSurfaces = new Map<string, Set<string>>();

  for (const biome of BIOMES) {
    for (const season of SEASONS) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(
        `/?m53Fixture=1&m53Theme=${biome}&m53Season=${season}&m53Quality=low&m53Rotation=0`,
      );
      const shell = page.locator(".cc-app");
      await expect(shell).toHaveAttribute("data-biome", biome);
      await expect(shell).toHaveAttribute("data-season", season);
      await expect(shell).toHaveCSS("--biome-motion-duration", "0ms");
      await expect(shell).toHaveCSS("--ui-focus", "#0b67a3");

      const courseFrame = page.locator(
        '[data-biome-context="course-frame"]',
      );
      const neutralStyle = await courseFrame.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          accent: style.getPropertyValue("--biome-accent").trim(),
          pattern: style.backgroundImage,
          surface: style.getPropertyValue("--biome-context-surface").trim(),
          backgroundColor: style.backgroundColor,
        };
      });
      cvdAccents.add(neutralStyle.accent);
      neutralPatterns.set(biome, neutralStyle.pattern);
      const biomeSeasonSurfaces = seasonSurfaces.get(biome) ?? new Set();
      biomeSeasonSurfaces.add(neutralStyle.surface);
      seasonSurfaces.set(biome, biomeSeasonSurfaces);
      expect(neutralStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(neutralStyle.pattern).not.toBe("none");

      for (const surface of [
        "course-frame",
        "course-header",
        "design-dock",
      ] as const) {
        const contextual = page.locator(
          `[data-biome-context="${surface}"]`,
        );
        await expect(contextual).toHaveAttribute("data-biome", biome);
        await expect(contextual).toHaveAttribute("data-season", season);
      }

      const desktop = await layoutSignature(page);
      desktopReference ??= desktop;
      expect(desktop).toEqual(desktopReference);

      await page.getByTestId("open-contextual-inspector").click();
      const inspector = page.getByTestId("contextual-inspector");
      await expect(inspector).toHaveAttribute("data-biome", biome);
      await expect(inspector).toHaveAttribute("data-season", season);
      await inspector.getByRole("button").first().click();

      const precedence = await courseFrame.evaluate((source) => {
        const result: Record<string, {
          edge: string;
          surface: string;
          pattern: string;
          backgroundColor: string;
        }> = {};
        for (const status of ["warning", "positive"]) {
          const probe = document.createElement("div");
          for (const attribute of source.attributes) {
            if (attribute.name.startsWith("data-biome")) {
              probe.setAttribute(attribute.name, attribute.value);
            }
          }
          probe.dataset.biomeContext = "notification";
          probe.dataset.statusTone = status;
          source.parentElement?.append(probe);
          const style = getComputedStyle(probe);
          result[status] = {
            edge: style.getPropertyValue("--biome-context-edge").trim(),
            surface: style.getPropertyValue("--biome-context-surface").trim(),
            pattern: style.backgroundImage,
            backgroundColor: style.backgroundColor,
          };
          probe.remove();
        }
        return result;
      });
      const rootStyle = await shell.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          warningEdge: style.getPropertyValue("--ui-warning-border").trim(),
          warningSurface: style.getPropertyValue("--ui-warning-surface").trim(),
          positiveEdge: style.getPropertyValue("--ui-positive-border").trim(),
          positiveSurface: style.getPropertyValue("--ui-positive-surface").trim(),
        };
      });
      expect(precedence.warning.edge).toBe(rootStyle.warningEdge);
      expect(precedence.warning.surface).toBe(rootStyle.warningSurface);
      expect(precedence.positive.edge).toBe(rootStyle.positiveEdge);
      expect(precedence.positive.surface).toBe(rootStyle.positiveSurface);
      warningPatterns.set(biome, precedence.warning.pattern);
      positivePatterns.set(biome, precedence.positive.pattern);
      const biomeWarningSurfaces = warningSurfaces.get(biome) ?? new Set();
      biomeWarningSurfaces.add(precedence.warning.backgroundColor);
      warningSurfaces.set(biome, biomeWarningSurfaces);

      await page.keyboard.press("Tab");
      await expect(page.locator(":focus-visible")).toHaveCount(1);

      await page.setViewportSize({ width: 760, height: 900 });
      const narrow = await layoutSignature(page);
      narrowReference ??= narrow;
      expect(narrow).toEqual(narrowReference);
    }
  }

  // Deuteranopia intentionally collapses accent hue. Pattern geometry remains
  // a registry-backed non-colour identifier, even under semantic surfaces.
  expect(cvdAccents.size).toBe(1);
  expect(new Set(neutralPatterns.values()).size).toBe(BIOMES.length);
  expect(new Set(warningPatterns.values()).size).toBe(BIOMES.length);
  expect(new Set(positivePatterns.values()).size).toBe(BIOMES.length);
  for (const biome of BIOMES) {
    expect(seasonSurfaces.get(biome)?.size).toBe(SEASONS.length);
    expect(warningSurfaces.get(biome)?.size).toBe(1);
  }
});

test("ZK-626 identifies seasonal and upkeep reports without changing their commands", async ({
  page,
}) => {
  for (const biome of BIOMES) {
    await page.goto(
      `/?m53Fixture=1&m53Theme=${biome}&m53Season=summer&m53Quality=low&m53Rotation=0`,
    );
    await page.getByTestId("workspace-legacy").click();
    await page.getByTestId("open-seasons-legacy").click();
    const seasons = page.getByTestId("seasons-legacy-panel");
    await expect(seasons).toHaveAttribute("data-biome-context", "seasons-legacy");
    await expect(seasons).toHaveAttribute("data-biome", biome);
    const supportingIllustration = seasons.getByTestId(
      "biome-supporting-illustration",
    );
    await expect(supportingIllustration).toHaveAttribute(
      "data-biome-context",
      "supporting-illustration",
    );
    await expect(supportingIllustration).toHaveAttribute("data-biome", biome);
    await expect(supportingIllustration).toHaveAttribute(
      "data-biome-illustration",
      biome === "parkland"
        ? "canopy"
        : biome === "links"
          ? "wind-lines"
          : "irrigation-rings",
    );

    const condition = seasons.getByTestId("surface-care-operations");
    if (await condition.count()) {
      await expect(condition).toHaveAttribute(
        "data-biome-context",
        "condition-report",
      );
      await expect(condition).toHaveAttribute("data-biome", biome);
      await expect(condition).toHaveAttribute(
        "data-biome-character",
        biome === "parkland"
          ? "neutral"
          : biome === "links"
            ? "coastal"
            : "mineral",
      );
    }

    await seasons.getByRole("button", { name: "Legacy", exact: true }).click();
    for (const testId of ["yearbook-empty-state", "timeline-empty-state"]) {
      const empty = seasons.getByTestId(testId);
      await expect(empty).toHaveAttribute("data-biome-context", "empty-state");
      await expect(empty).toHaveAttribute("data-biome", biome);
      await expect(empty).toHaveAttribute("data-season", "summer");
      await expect(empty).toHaveAttribute("data-status-tone", "neutral");
    }
    await seasons.getByRole("button", { name: "Close", exact: true }).click();

    await page.evaluate(() =>
      window.__coursecraftTest!.startWeekCloseFixture(3));
    const report = page.getByTestId("week-close-report");
    await expect(report).toBeVisible({ timeout: 15_000 });
    const surface = report.locator('[data-biome-context="upkeep-report"]');
    await expect(surface).toHaveAttribute("data-biome", biome);
    await expect(surface.getByTestId("week-close-continue")).toBeVisible();
    await surface.getByTestId("week-close-continue").click();
  }
});

test("ZK-626 loading uses the pending wizard and scenario destination biome", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
    }));
    localStorage.setItem("coursecraft_career_v1", JSON.stringify({
      version: 2,
      scenarios: {
        "back-nine": { completed: true, attempts: 1 },
        "muni-rescue": { completed: true, attempts: 1 },
        "swamp-deal": { completed: true, attempts: 1 },
      },
      unlocks: [],
      campaignChoices: [],
    }));
  });

  await page.goto(
    "/?m53Fixture=1&m53Theme=desert&m53Season=winter&m53Quality=low&m53Rotation=0",
  );
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().screen,
  )).toBe("game");
  await page.evaluate(() => window.__coursecraftTest!.returnToTitle());
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Sandbox" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: /Desert/ }).first().click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await installLoadingContextRecorder(page);
  await page.getByRole("button", { name: "⛳ Start building" }).click();
  await expectRecordedLoadingContext(page, {
    theme: "desert",
    season: "summer",
    weather: "clear",
  });
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.theme,
  )).toBe("desert");
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().loadingContext,
  )).toBeNull();

  await page.evaluate(() => window.__coursecraftTest!.returnToTitle());
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Career" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await installLoadingContextRecorder(page);
  await page.getByRole("button", { name: /Links by the Sea/ }).click();
  await expectRecordedLoadingContext(page, {
    theme: "links",
    season: "summer",
    weather: "clear",
  });
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.theme,
  )).toBe("links");
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().loadingContext,
  )).toBeNull();
});

test("ZK-626 Continue uses canonical legacy metadata then parsed save context", async ({
  page,
}) => {
  await page.goto(
    "/?m53Fixture=1&m53Theme=desert&m53Season=winter&m53Quality=low&m53Rotation=0",
  );
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().screen,
  )).toBe("game");
  const seeded = await page.evaluate(() =>
    window.__coursecraftTest!.seedLoadingSaveFixture({
      id: "zk626-legacy",
      theme: "links",
      week: 30,
      dayIndex: 4,
      omitManifestTheme: true,
    }));
  await page.evaluate(() => window.__coursecraftTest!.returnToTitle());
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await installLoadingContextRecorder(page);
  await page.getByRole("button", { name: "Continue" }).click();

  const canonical = {
    theme: "parkland",
    season: "summer",
    weather: "clear",
  };
  await expectRecordedLoadingContext(page, canonical);
  await expectRecordedLoadingContext(page, seeded.context);
  const contexts = await recordedLoadingContexts(page);
  expect(contexts.findIndex((context) =>
    JSON.stringify(context) === JSON.stringify(canonical)))
    .toBeLessThan(contexts.findIndex((context) =>
      JSON.stringify(context) === JSON.stringify(seeded.context)));
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().loadingContext,
  )).toBeNull();
});

test("ZK-626 selected save loads with parsed destination context", async ({
  page,
}) => {
  await page.goto(
    "/?m53Fixture=1&m53Theme=desert&m53Season=winter&m53Quality=low&m53Rotation=0",
  );
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().screen,
  )).toBe("game");
  const seeded = await page.evaluate(() =>
    window.__coursecraftTest!.seedLoadingSaveFixture({
      id: "zk626-selected",
      theme: "links",
      week: 44,
      dayIndex: 5,
    }));
  await page.evaluate(() => window.__coursecraftTest!.returnToTitle());
  await expect(page.getByRole("button", { name: "Load Game" })).toBeEnabled();
  await page.getByRole("button", { name: "Load Game" }).click();
  await installLoadingContextRecorder(page);
  await page.getByTestId("save-slot-zk626-selected")
    .getByRole("button", { name: "Load", exact: true }).click();
  await expectRecordedLoadingContext(page, seeded.context);
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().loadingContext,
  )).toBeNull();
});

test("ZK-626 failed Continue clears canonical pending context", async ({
  page,
}) => {
  await page.goto(
    "/?m53Fixture=1&m53Theme=desert&m53Season=winter&m53Quality=low&m53Rotation=0",
  );
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().screen,
  )).toBe("game");
  await page.evaluate(() =>
    window.__coursecraftTest!.seedLoadingSaveFixture({
      id: "zk626-missing",
      theme: "links",
      week: 30,
      dayIndex: 4,
      omitManifestTheme: true,
      deletePayload: true,
    }));
  await page.evaluate(() => window.__coursecraftTest!.returnToTitle());
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await installLoadingContextRecorder(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expectRecordedLoadingContext(page, {
    theme: "parkland",
    season: "summer",
    weather: "clear",
  });
  await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    window.__coursecraftTest?.state().loadingContext,
  )).toBeNull();
});
