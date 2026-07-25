import { expect, test, type Page } from "@playwright/test";

type AuditedAudio = {
  src: string;
  paused: boolean;
  currentTime: number;
  volume: number;
};

async function installAudioAudit(page: Page) {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    const elements: HTMLAudioElement[] = [];
    Object.defineProperty(window, "__coursecraftAudioElements", { value: elements });
    function AuditedAudioElement(src?: string) {
      const audio = new NativeAudio(src);
      elements.push(audio);
      return audio;
    }
    AuditedAudioElement.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(AuditedAudioElement, NativeAudio);
    Object.defineProperty(window, "Audio", {
      configurable: true,
      writable: true,
      value: AuditedAudioElement,
    });
  });
}

async function audioState(page: Page): Promise<AuditedAudio[]> {
  return page.evaluate(() => {
    const elements = (window as Window & {
      __coursecraftAudioElements: HTMLAudioElement[];
    }).__coursecraftAudioElements;
    return elements.map((audio) => ({
      src: audio.currentSrc || audio.src,
      paused: audio.paused,
      currentTime: audio.currentTime,
      volume: audio.volume,
    }));
  });
}

function audible(elements: AuditedAudio[]) {
  return elements.filter((audio) => !audio.paused && audio.currentTime > 0 && audio.volume > .001);
}

async function audibleTimeline(page: Page, durationMs: number, intervalMs = 50) {
  const timeline: AuditedAudio[][] = [];
  const samples = Math.ceil(durationMs / intervalMs);
  for (let index = 0; index < samples; index++) {
    timeline.push(audible(await audioState(page)));
    await page.waitForTimeout(intervalMs);
  }
  return timeline;
}

function expectSingleBackgroundStream(timeline: AuditedAudio[][], label: string) {
  const overlaps = timeline
    .filter((sample) => sample.length > 1)
    .map((sample) => sample.map((audio) => audio.src.split("/audio/")[1] ?? audio.src));
  expect(overlaps, `${label} must never overlap file-backed background tracks`).toEqual([]);
}

test("audio is lazy, mixer controls persist, and live play stays error-free", async ({ page }, testInfo) => {
  const audioRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/audio/music/")) audioRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.waitForTimeout(250);
  expect(audioRequests).toEqual([]);

  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Audio" }).click();
  await expect(page.getByRole("slider", { name: "Master volume", exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Mute in background")).toBeChecked();
  await expect.poll(() => audioRequests.length).toBeGreaterThan(0);
  expect(new Set(audioRequests.map((url) => url.split("?")[0])).size).toBe(1);

  await page.getByRole("slider", { name: "Master volume", exact: true }).fill("0.65");
  await page.getByRole("slider", { name: "Music volume", exact: true }).fill("0.35");
  await page.getByRole("slider", { name: "Sound effects", exact: true }).fill("0.45");
  await page.getByRole("slider", { name: "Ambience volume", exact: true }).fill("0.55");
  await page.getByRole("button", { name: "Test music" }).click();
  await page.getByRole("button", { name: "Test sound effects" }).click();
  await page.getByRole("button", { name: "Test ambience" }).click();
  await page.getByLabel("Mute all audio").check();
  await testInfo.attach("m15-audio-options", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("button", { name: "Done" }).click();

  await page.reload();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Audio" }).click();
  await expect(page.getByLabel("Mute all audio")).toBeChecked();
  await expect(page.getByRole("slider", { name: "Master volume", exact: true })).toHaveValue("0.65");
  await expect(page.getByRole("slider", { name: "Music volume", exact: true })).toHaveValue("0.35");
  await expect(page.getByRole("slider", { name: "Sound effects", exact: true })).toHaveValue("0.45");
  await expect(page.getByRole("slider", { name: "Ambience volume", exact: true })).toHaveValue("0.55");
  await page.getByLabel("Mute all audio").uncheck();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.waitForTimeout(1200);
  await testInfo.attach("m15-live-course", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  expect(consoleErrors).toEqual([]);
});

test("Vision, tutorial, and game own one Suno background stream through rapid transitions", async ({ page }) => {
  await installAudioAudit(page);
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/.*\.(?:m4a|mp3|ogg|wav)(?:\?|$)/.test(request.url())) {
      mediaRequests.push(request.url().split("?")[0]);
    }
  });

  await page.goto("/?view=vision");
  expect(mediaRequests).toEqual([]);
  await page.getByRole("link", { name: "The Story", exact: true }).click();
  await expect.poll(async () => audible(await audioState(page)).length).toBe(1);

  const visionAudio = audible(await audioState(page));
  expect(visionAudio).toHaveLength(1);
  expect(visionAudio[0].src).toContain("/audio/music/suno/title-01.mp3");
  expect(mediaRequests.some((url) => url.includes("/audio/ambience/"))).toBe(false);

  await page.locator(".cc-vision-brand").click();
  await expect(page.getByRole("button", { name: "Quick Start" })).toBeVisible();
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await expect(page.getByRole("button", { name: "Start guided course" })).toBeVisible();
  expectSingleBackgroundStream(await audibleTimeline(page, 3_000), "Tutorial offer");
  expect(audible(await audioState(page))).toHaveLength(1);

  await page.getByRole("button", { name: "Start guided course" }).click();
  expectSingleBackgroundStream(await audibleTimeline(page, 1_500), "Guided tutorial");
  expect(audible(await audioState(page))).toHaveLength(1);
  expect(mediaRequests.some((url) => url.includes("/audio/ambience/"))).toBe(false);
  expect(mediaRequests.every((url) => /\/audio\/music\/suno\/.+\.mp3$/.test(url))).toBe(true);
});

test("rapid game music transitions never overlap file-backed tracks", async ({ page }) => {
  await installAudioAudit(page);
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/audio\/.*\.(?:m4a|mp3|ogg|wav)(?:\?|$)/.test(request.url())) {
      mediaRequests.push(request.url().split("?")[0]);
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await expect(page.getByRole("button", { name: "Skip tutorial" })).toBeVisible();
  expectSingleBackgroundStream(await audibleTimeline(page, 1_000), "Game entry");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await expect.poll(async () => audible(await audioState(page)).length).toBe(1);

  await page.getByRole("button", { name: "Architect", exact: true }).click();
  await page.getByRole("button", { name: "Cozy", exact: true }).click();
  await page.getByRole("button", { name: "Architect", exact: true }).click();
  await page.getByRole("button", { name: "Cozy", exact: true }).click();
  expectSingleBackgroundStream(await audibleTimeline(page, 2_700), "Rapid mode changes");

  const settled = await audioState(page);
  const settledAudible = audible(settled);
  expect(settledAudible).toHaveLength(1);
  expect(settled.filter((audio) => !audio.paused)).toHaveLength(1);
  expect(settledAudible.filter((audio) => audio.src.includes("/audio/music/suno/"))).toHaveLength(1);
  expect(settledAudible.filter((audio) => audio.src.includes("/audio/ambience/suno/"))).toHaveLength(0);
  expect(mediaRequests.some((url) => url.includes("/audio/ambience/"))).toBe(false);
  expect(mediaRequests.every((url) => /\/audio\/music\/suno\/.+\.mp3$/.test(url))).toBe(true);
});
