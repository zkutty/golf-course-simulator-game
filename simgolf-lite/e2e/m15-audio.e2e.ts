import { expect, test, type Page } from "@playwright/test";
import { ALL_SUNO_AUDIO } from "../src/audio/sunoLibrary";

type AuditedAudio = {
  id: number;
  src: string;
  paused: boolean;
  currentTime: number;
  volume: number;
  error: number | null;
};

type AudioSample = {
  label: string;
  elements: AuditedAudio[];
};

const MANIFEST_URLS = new Set(ALL_SUNO_AUDIO.map((asset) => asset.src));
const AUDIO_URL = /\/audio\/.*\.(?:m4a|mp3|ogg|wav)(?:\?|$)/i;

function pathFor(url: string) {
  return new URL(url).pathname;
}

function fileBacked(audio: AuditedAudio) {
  return AUDIO_URL.test(audio.src);
}

function audible(elements: AuditedAudio[]) {
  return elements.filter((audio) => fileBacked(audio) && !audio.paused && audio.currentTime > 0 && audio.volume > .001);
}

async function installAudioAudit(page: Page) {
  await page.addInitScript(() => {
    const elements: HTMLAudioElement[] = [];
    let nextId = 1;
    const ids = new WeakMap<HTMLAudioElement, number>();
    const record = (audio: HTMLAudioElement) => {
      if (!ids.has(audio)) {
        ids.set(audio, nextId++);
        elements.push(audio);
      }
      return audio;
    };

    Object.defineProperty(window, "__coursecraftAudioElements", { configurable: true, value: elements });
    const NativeAudio = window.Audio;
    function AuditedAudioElement(src?: string) {
      return record(new NativeAudio(src));
    }
    AuditedAudioElement.prototype = NativeAudio.prototype;
    Object.setPrototypeOf(AuditedAudioElement, NativeAudio);
    Object.defineProperty(window, "Audio", {
      configurable: true,
      writable: true,
      value: AuditedAudioElement,
    });

    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function auditedPlay(this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) record(this);
      return nativePlay.call(this);
    };
    document.addEventListener("error", (event) => {
      if (event.target instanceof HTMLAudioElement) record(event.target);
    }, true);
  });
}

async function audioState(page: Page): Promise<AuditedAudio[]> {
  return page.evaluate(() => {
    const recorded = (window as Window & {
      __coursecraftAudioElements: HTMLAudioElement[];
    }).__coursecraftAudioElements ?? [];
    const elements = [...new Set([...recorded, ...document.querySelectorAll("audio")])];
    return elements.map((audio, index) => ({
      id: index + 1,
      src: audio.currentSrc || audio.src,
      paused: audio.paused,
      currentTime: audio.currentTime,
      volume: audio.volume,
      error: audio.error?.code ?? null,
    }));
  });
}

async function sampleAudio(page: Page, samples: AudioSample[], label: string, durationMs = 700, intervalMs = 50) {
  const captured = await page.evaluate(async ({ label: sampleLabel, durationMs: duration, intervalMs: interval }) => {
    const recorded = (window as Window & {
      __coursecraftAudioElements: HTMLAudioElement[];
    }).__coursecraftAudioElements ?? [];
    const read = () => {
      const elements = [...new Set([...recorded, ...document.querySelectorAll("audio")])];
      return elements.map((audio, index) => ({
        id: index + 1,
        src: audio.currentSrc || audio.src,
        paused: audio.paused,
        currentTime: audio.currentTime,
        volume: audio.volume,
        error: audio.error?.code ?? null,
      }));
    };
    const output: AudioSample[] = [];
    const deadline = performance.now() + duration;
    do {
      output.push({ label: sampleLabel, elements: read() });
      const remaining = deadline - performance.now();
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, Math.min(interval, remaining)));
    } while (performance.now() < deadline);
    return output;
  }, { label, durationMs, intervalMs });
  samples.push(...captured);
}

function expectBoundedStreams(samples: AudioSample[], label: string) {
  const competing = samples
    .map((sample) => ({ label: sample.label, tracks: audible(sample.elements).map((audio) => pathFor(audio.src)) }))
    .filter((sample) => sample.tracks.length > 1);
  expect(competing, `${label} must never overlap file-backed background streams`).toEqual([]);
}

function expectManifestOnly(samples: AudioSample[], mediaRequests: string[]) {
  const requested = [...new Set(mediaRequests.map(pathFor))];
  const observed = samples.flatMap((sample) => sample.elements.map((audio) => audio.src).filter((src) => AUDIO_URL.test(src)).map(pathFor));
  expect([...new Set([...requested, ...observed])].filter((url) => !MANIFEST_URLS.has(url))).toEqual([]);
}

function expectStoppedOutgoingSlots(elements: AuditedAudio[]) {
  const active = audible(elements);
  expect(active).toHaveLength(1);
  const outgoing = elements.filter((audio) => fileBacked(audio) && audio.id !== active[0].id);
  expect(outgoing.map((audio) => ({ src: pathFor(audio.src), paused: audio.paused, volume: audio.volume }))).toEqual(
    outgoing.map((audio) => ({ src: pathFor(audio.src), paused: true, volume: 0 })),
  );
}

async function expectTrack(page: Page, expectedPath: string) {
  await expect.poll(async () => audible(await audioState(page)).map((audio) => pathFor(audio.src))).toContain(expectedPath);
}

async function setContextOverride(page: Page, context: string | null) {
  await page.evaluate(async (next) => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    await audioManager.setMusicOverride(next as Parameters<typeof audioManager.setMusicOverride>[0]);
  }, context);
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

test("ZK-443 bounds Vision/title, design, and operations audio", async ({ page }, testInfo) => {
  const samples: AudioSample[] = [];
  const mediaRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedMedia: string[] = [];
  await installAudioAudit(page);
  page.on("request", (request) => {
    if (AUDIO_URL.test(request.url())) mediaRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (AUDIO_URL.test(response.url()) && response.status() >= 400) failedMedia.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "request failed";
    if (AUDIO_URL.test(request.url()) && !errorText.includes("ERR_ABORTED")) failedMedia.push(`${errorText} ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?view=vision");
  await page.getByRole("link", { name: "The Story", exact: true }).click();
  await expectTrack(page, "/audio/music/suno/title-01.mp3");
  await sampleAudio(page, samples, "vision-title");
  expectBoundedStreams(samples, "Vision/title");

  await page.locator(".cc-vision-brand").click();
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const skipTutorial = page.getByRole("button", { name: "Skip tutorial" });
  if (await skipTutorial.count()) await skipTutorial.click();
  await page.getByTestId("workspace-design").click();
  await page.locator("button").filter({ hasText: /^Architect$/ }).click();
  await setContextOverride(page, "build-parkland");
  await expectTrack(page, "/audio/music/suno/build-parkland-01.mp3");
  await sampleAudio(page, samples, "design");
  await setContextOverride(page, "live");
  await page.locator("button").filter({ hasText: /^Cozy$/ }).click();
  await expectTrack(page, "/audio/music/suno/operate-01.mp3");
  await sampleAudio(page, samples, "operations");

  expectBoundedStreams(samples, "Vision, title, design, and operations");
  expectManifestOnly(samples, mediaRequests);
  expect((await audioState(page)).filter((audio) => audio.error !== null)).toEqual([]);
  expect(failedMedia).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await testInfo.attach("zk-443-route-audio-audit", {
    body: JSON.stringify({ manifestEntries: MANIFEST_URLS.size, mediaRequests: [...new Set(mediaRequests.map(pathFor))], samples }, null, 2),
    contentType: "application/json",
  });
});

test("ZK-443 bounds Player Pro audio", async ({ page }, testInfo) => {
  const samples: AudioSample[] = [];
  const mediaRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedMedia: string[] = [];
  await installAudioAudit(page);
  page.on("request", (request) => {
    if (AUDIO_URL.test(request.url())) mediaRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (AUDIO_URL.test(response.url()) && response.status() >= 400) failedMedia.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "request failed";
    if (AUDIO_URL.test(request.url()) && !errorText.includes("ERR_ABORTED")) failedMedia.push(`${errorText} ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const skipTutorial = page.getByRole("button", { name: "Skip tutorial" });
  if (await skipTutorial.count()) await skipTutorial.click();
  await page.evaluate(() => window.__coursecraftTest!.setPlayerProFixture());
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Play", exact: true }).click();
  await page.getByTestId("start-player-round").click();
  await expectTrack(page, "/audio/music/suno/player-pro-01.mp3");
  await sampleAudio(page, samples, "player-pro");

  expectBoundedStreams(samples, "Player Pro");
  expectManifestOnly(samples, mediaRequests);
  expect((await audioState(page)).filter((audio) => audio.error !== null)).toEqual([]);
  expect(failedMedia).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await testInfo.attach("zk-443-player-pro-audio-audit", {
    body: JSON.stringify({ manifestEntries: MANIFEST_URLS.size, mediaRequests: [...new Set(mediaRequests.map(pathFor))], samples }, null, 2),
    contentType: "application/json",
  });
});

test("ZK-443 bounds tournament, tension, victory, pause, and rapid context changes", async ({ page }, testInfo) => {
  const samples: AudioSample[] = [];
  const mediaRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedMedia: string[] = [];
  await installAudioAudit(page);
  page.on("request", (request) => {
    if (AUDIO_URL.test(request.url())) mediaRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (AUDIO_URL.test(response.url()) && response.status() >= 400) failedMedia.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "request failed";
    if (AUDIO_URL.test(request.url()) && !errorText.includes("ERR_ABORTED")) failedMedia.push(`${errorText} ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?m24Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 15000 }).toBe("game");
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();
  await page.getByLabel("Close tournaments").click();
  await page.evaluate(() => window.__coursecraftTest!.startTournamentFixture());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.active?.teeSet)).toBe("member");
  await expectTrack(page, "/audio/music/suno/tournament-local-01.mp3");
  await sampleAudio(page, samples, "tournament");

  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(-1));
  await setContextOverride(page, "tension");
  await expectTrack(page, "/audio/music/suno/tension-01.mp3");
  await sampleAudio(page, samples, "tension");

  // Victory is a release-only app outcome. The existing development override
  // reaches the same manager path without manufacturing a production win state.
  await setContextOverride(page, "victory");
  await expectTrack(page, "/audio/music/suno/victory-01.mp3");
  await sampleAudio(page, samples, "victory");

  // The tournament panel is closed above. Return keyboard focus to a visible
  // in-game control before exercising the app-wide Escape shortcut, rather
  // than dispatching from the panel's just-unmounted close button.
  await page.getByRole("button", { name: "Open pause menu" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  await sampleAudio(page, samples, "pause");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toHaveCount(0);
  await sampleAudio(page, samples, "resume");

  for (const context of ["title", "build-links", "live", "play", "tournament-regional", "tension", "victory"] as const) {
    await setContextOverride(page, context);
    await sampleAudio(page, samples, `rapid-${context}`, 180, 30);
  }
  await setContextOverride(page, null);
  await sampleAudio(page, samples, "rapid-settle", 800, 50);

  expectBoundedStreams(samples, "gameplay and rapid route/context changes");
  expectManifestOnly(samples, mediaRequests);
  const finalElements = await audioState(page);
  expect(finalElements.filter((audio) => audio.error !== null)).toEqual([]);
  expectStoppedOutgoingSlots(finalElements);
  expect(failedMedia).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await testInfo.attach("zk-443-audio-audit", {
    body: JSON.stringify({ manifestEntries: MANIFEST_URLS.size, mediaRequests: [...new Set(mediaRequests.map(pathFor))], samples }, null, 2),
    contentType: "application/json",
  });
});
