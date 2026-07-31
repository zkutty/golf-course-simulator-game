import { expect, test } from "@playwright/test";
import type { AmbientMix, AudioDebugSnapshot } from "../src/audio/AudioManager";

const natureFamilies = ["birds", "water", "wind", "crickets", "rain"] as const;

function mix(patch: Partial<AmbientMix> = {}): AmbientMix {
  return {
    enabled: true,
    season: "summer",
    weatherKind: "clear",
    birds: 0.8,
    water: 0.4,
    wind: 0.3,
    murmur: 0.2,
    crickets: 0.6,
    rain: 0,
    bed: "parkland",
    paused: false,
    ...patch,
  };
}

async function snapshot(page: import("@playwright/test").Page): Promise<AudioDebugSnapshot> {
  return page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    return audioManager.debugSnapshot();
  });
}

async function applyMix(
  page: import("@playwright/test").Page,
  next: AmbientMix,
  context: "live" | "silent" | "tension" | "tournament-local" = "live",
) {
  await page.evaluate(async ({ nextMix, nextContext }) => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setSurface("game");
    await audioManager.setMusicOverride(nextContext);
    audioManager.setAmbientMix(nextMix);
  }, { nextMix: next, nextContext: context });
}

async function installDeferredAmbience(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    const pending: Array<{
      path: string;
      released: boolean;
      release: () => void;
    }> = [];
    HTMLMediaElement.prototype.play = function deferredAmbiencePlay(this: HTMLMediaElement) {
      if (!new URL(this.src, location.href).pathname.includes("/audio/ambience/")) {
        return nativePlay.call(this);
      }
      return new Promise<void>((resolve, reject) => {
        const entry = {
          path: new URL(this.src, location.href).pathname,
          released: false,
          release: () => {
            if (entry.released) return;
            entry.released = true;
            void nativePlay.call(this).then(resolve, reject);
          },
        };
        pending.push(entry);
      });
    };
    Object.defineProperty(window, "__zk570DeferredAmbience", {
      configurable: true,
      value: {
        state: () => pending.map(({ path, released }) => ({ path, released })),
        release: (index: number) => pending[index]?.release(),
      },
    });
  });
}

test("ZK-570 deterministically owns seasonal/weather families across protected transitions", async ({ page }) => {
  await page.addInitScript(() => {
    let playCalls = 0;
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function auditedPlay(this: HTMLMediaElement) {
      playCalls += 1;
      return nativePlay.call(this);
    };
    Object.defineProperty(window, "__zk570PlayCalls", {
      configurable: true,
      get: () => playCalls,
    });
  });
  await page.goto("/");

  // Context may be selected before consent, but neither WebAudio sources nor a
  // file-backed play attempt may begin until a real pointer/key gesture.
  await applyMix(page, mix());
  const beforeGesture = await snapshot(page);
  expect(beforeGesture.unlocked).toBe(false);
  expect(beforeGesture.contextState).toBe("unavailable");
  expect(beforeGesture.proceduralSourceCount).toBe(0);
  expect(await page.evaluate(() => (window as Window & { __zk570PlayCalls?: number }).__zk570PlayCalls)).toBe(0);

  await page.getByRole("button", { name: "Options" }).click();
  await expect.poll(() => snapshot(page).then((state) => state.unlocked)).toBe(true);
  await applyMix(page, mix());
  const summer = await snapshot(page);
  expect(summer.proceduralSourceCount).toBe(6);
  expect(summer.proceduralSourceCounts).toEqual({
    birds: 1,
    water: 1,
    wind: 1,
    murmur: 1,
    crickets: 1,
    rain: 1,
  });
  expect(summer.desiredActiveProceduralFamilies).toEqual(["birds", "water", "wind", "murmur", "crickets"]);
  await expect.poll(() => snapshot(page).then((state) => state.actualActiveProceduralFamilies)).toEqual([
    "birds",
    "water",
    "wind",
    "murmur",
    "crickets",
  ]);
  expect(summer.proceduralTargets).toEqual({
    birds: 0.17600000000000002,
    water: 0.08800000000000001,
    wind: 0.066,
    murmur: 0.044000000000000004,
    crickets: 0.132,
    rain: 0,
  });

  await applyMix(page, mix({ season: "autumn", birds: 0.42, wind: 0.72, crickets: 0.2 }));
  const autumn = await snapshot(page);
  expect(autumn.transition).toMatchObject({
    fromSeason: "summer",
    toSeason: "autumn",
    fromWeather: "clear",
    toWeather: "clear",
    durationMs: 1600,
  });
  expect(autumn.proceduralTargets.wind).toBeCloseTo(0.1584);
  expect(autumn.proceduralTargets.birds).toBeCloseTo(0.0924);

  await applyMix(page, mix({
    season: "autumn",
    weatherKind: "storm",
    birds: 0,
    wind: 0.95,
    crickets: 0,
    rain: 1,
    bed: "rain",
  }));
  const storm = await snapshot(page);
  expect(storm.priority).toBe("weather");
  expect(storm.transition).toMatchObject({
    fromSeason: "autumn",
    toSeason: "autumn",
    fromWeather: "clear",
    toWeather: "storm",
    durationMs: 650,
  });
  expect(storm.proceduralTargets.birds).toBe(0);
  expect(storm.proceduralTargets.crickets).toBe(0);
  expect(storm.proceduralTargets.rain).toBe(0.22);

  await applyMix(page, mix({
    season: "autumn",
    weatherKind: "storm",
    birds: 0,
    wind: 0.95,
    crickets: 0,
    rain: 1,
    bed: "rain",
  }), "tournament-local");
  const tournament = await snapshot(page);
  expect(tournament.priority).toBe("score");
  expect(tournament.resolvedMusicContext).toBe("tournament-local");
  expect(tournament.authoredAmbienceAllowed).toBe(false);
  expect(tournament.proceduralTargets.rain).toBe(0.14);
  expect(tournament.proceduralTargets.wind).toBeCloseTo(0.133);

  await applyMix(page, mix({ season: "winter", crickets: 0, birds: 0.1, wind: 0.8 }), "tension");
  const crisis = await snapshot(page);
  expect(crisis.priority).toBe("score");
  expect(crisis.resolvedMusicContext).toBe("tension");
  expect(crisis.proceduralTargets.rain).toBe(0);
  expect(crisis.proceduralTargets.crickets).toBe(0);
  expect(crisis.proceduralTargets.birds).toBeCloseTo(0.005);
  expect(crisis.proceduralTargets.wind).toBeCloseTo(0.04);

  // Rapid updates synchronously cancel each family's prior AudioParam ramp.
  const rampVersion = crisis.proceduralRampVersion;
  await page.evaluate(async ({ spring, summer, winter }) => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setAmbientMix(spring);
    audioManager.setAmbientMix(summer);
    audioManager.setAmbientMix(winter);
  }, {
    spring: mix({ season: "spring", birds: 0.9, wind: 0.2 }),
    summer: mix({ season: "summer", birds: 0.7, wind: 0.3 }),
    winter: mix({ season: "winter", birds: 0.08, wind: 0.9, crickets: 0 }),
  });
  const settled = await snapshot(page);
  expect(settled.proceduralRampVersion).toBe(rampVersion + 3);
  expect(settled.transition).toMatchObject({
    fromSeason: "summer",
    toSeason: "winter",
    toWeather: "clear",
    durationMs: 1600,
  });
  expect(settled.proceduralTargets.birds).toBeCloseTo(0.004);
  expect(settled.proceduralTargets.wind).toBeCloseTo(0.045);

  // An authored bed owns all nature families; a media failure instead exposes
  // the procedural fallback, never both owners for the same family.
  await applyMix(page, mix({ season: "winter", birds: 0.08, wind: 0.9, crickets: 0, bed: "winter" }), "silent");
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.authoredNatureOwner || state.authoredFallback;
  }).toBe(true);
  const silent = await snapshot(page);
  if (silent.authoredNatureOwner) {
    await page.waitForTimeout(450);
    const settledAuthored = await snapshot(page);
    for (const family of natureFamilies) {
      expect(settledAuthored.proceduralTargets[family]).toBe(0);
      expect(settledAuthored.proceduralActuals[family]).toBeCloseTo(0, 5);
    }
    expect(settledAuthored.authoredMedia?.paused).toBe(false);
    expect(settledAuthored.authoredMedia?.volume).toBeGreaterThan(0);
  } else {
    expect(silent.authoredFallback).toBe(true);
    expect(silent.playingAmbience).toBeNull();
  }

  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    await audioManager.setMusicOverride("live");
    audioManager.setVolumes({
      masterVolume: 0.8,
      ambienceVolume: 0.5,
      masterMuted: false,
      muteWhenHidden: true,
    });
  });
  expect((await snapshot(page)).effectiveAmbienceBus).toBeCloseTo(0.4);
  await expect.poll(() => snapshot(page).then((state) => state.actualAmbienceBusGain)).toBeCloseTo(0.4);
  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setVolumes({ masterMuted: true });
  });
  expect((await snapshot(page)).effectiveAmbienceBus).toBe(0);
  await expect.poll(() => snapshot(page).then((state) => state.actualAmbienceBusGain)).toBeCloseTo(0);
  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setVolumes({ masterMuted: false });
  });
  expect((await snapshot(page)).effectiveAmbienceBus).toBeCloseTo(0.4);
  await expect.poll(() => snapshot(page).then((state) => state.actualAmbienceBusGain)).toBeCloseTo(0.4);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await snapshot(page)).effectiveAmbienceBus).toBe(0);
  await expect.poll(() => snapshot(page).then((state) => state.actualAmbienceBusGain)).toBeCloseTo(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await snapshot(page)).effectiveAmbienceBus).toBeCloseTo(0.4);
  await expect.poll(() => snapshot(page).then((state) => state.actualAmbienceBusGain)).toBeCloseTo(0.4);
});

test("ZK-570 keeps failed authored ambience on a stable procedural fallback", async ({ page }) => {
  await page.addInitScript(() => {
    let ambiencePlayAttempts = 0;
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function controlledPlay(this: HTMLMediaElement) {
      if (new URL(this.src, location.href).pathname.includes("/audio/ambience/")) {
        ambiencePlayAttempts += 1;
        return Promise.reject(new DOMException("Deterministic authored ambience rejection", "NotSupportedError"));
      }
      return nativePlay.call(this);
    };
    Object.defineProperty(window, "__zk570AmbiencePlayAttempts", {
      configurable: true,
      get: () => ambiencePlayAttempts,
    });
  });
  await page.goto("/");
  await applyMix(page, mix(), "silent");
  await page.getByRole("button", { name: "Options" }).click();
  await expect.poll(() => snapshot(page).then((state) => state.authoredFallback)).toBe(true);
  expect(await page.evaluate(() =>
    (window as Window & { __zk570AmbiencePlayAttempts?: number }).__zk570AmbiencePlayAttempts
  )).toBe(1);

  await page.waitForTimeout(450);
  const initialFallback = await snapshot(page);
  expect(initialFallback.authoredNatureOwner).toBe(false);
  expect(initialFallback.authoredFallbackBed).toBe("parkland");
  expect(initialFallback.authoredAttempts).toEqual({ total: 1, inFlightBeds: [], current: null });
  expect(initialFallback.proceduralTargets.birds).toBeGreaterThan(0);
  expect(initialFallback.proceduralActuals.birds).toBeGreaterThan(0);

  for (let index = 0; index < 12; index++) {
    await page.evaluate(async ({ next, index: updateIndex }) => {
      const { audioManager } = await import("/src/audio/AudioManager.ts");
      audioManager.setAmbientMix({
        ...next,
        birds: 0.55 + updateIndex * 0.01,
        murmur: updateIndex / 20,
      });
    }, { next: mix(), index });
    const duringFallback = await snapshot(page);
    expect(duringFallback.proceduralTargets.birds).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() =>
    (window as Window & { __zk570AmbiencePlayAttempts?: number }).__zk570AmbiencePlayAttempts
  )).toBe(1);
  expect((await snapshot(page)).authoredAttempts.total).toBe(1);

  // A meaningful bed change is one bounded retry. Subsequent ordinary mix
  // updates on that failed bed remain procedural and do not retry.
  await applyMix(page, mix({
    season: "winter",
    birds: 0.12,
    wind: 0.8,
    crickets: 0,
    bed: "winter",
  }), "silent");
  await expect.poll(() => snapshot(page).then((state) => state.authoredFallbackBed)).toBe("winter");
  expect(await page.evaluate(() =>
    (window as Window & { __zk570AmbiencePlayAttempts?: number }).__zk570AmbiencePlayAttempts
  )).toBe(2);
  for (let index = 0; index < 8; index++) {
    await page.evaluate(async ({ next, index: updateIndex }) => {
      const { audioManager } = await import("/src/audio/AudioManager.ts");
      audioManager.setAmbientMix({ ...next, wind: 0.7 + updateIndex * 0.02 });
    }, {
      next: mix({ season: "winter", birds: 0.12, wind: 0.8, crickets: 0, bed: "winter" }),
      index,
    });
  }
  expect(await page.evaluate(() =>
    (window as Window & { __zk570AmbiencePlayAttempts?: number }).__zk570AmbiencePlayAttempts
  )).toBe(2);

  await page.waitForTimeout(1100);
  const settledFallback = await snapshot(page);
  expect(settledFallback.authoredAttempts).toEqual({ total: 2, inFlightBeds: [], current: null });
  expect(settledFallback.authoredMedia?.paused).toBe(true);
  expect(settledFallback.authoredMedia?.volume).toBe(0);
  expect(settledFallback.proceduralActuals.birds).toBeGreaterThan(0);
  expect(settledFallback.proceduralActuals.wind).toBeGreaterThan(0);
  expect(settledFallback.proceduralActuals.crickets).toBeCloseTo(0, 5);

  // Leaving and re-entering the gameplay surface explicitly permits one retry.
  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setSurface("menu");
    audioManager.setSurface("game");
  });
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __zk570AmbiencePlayAttempts?: number }).__zk570AmbiencePlayAttempts
  )).toBe(3);
  await expect.poll(() => snapshot(page).then((state) => state.authoredFallback)).toBe(true);
  expect((await snapshot(page)).authoredAttempts.total).toBe(3);
});

test("ZK-570 mute invalidates active media fades and restores only the current owner", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Options" }).click();
  await expect.poll(() => snapshot(page).then((state) => state.unlocked)).toBe(true);
  await applyMix(page, mix(), "live");
  await expect.poll(() => snapshot(page).then((state) =>
    state.mediaSlots.music.filter((slot) => !slot.paused && slot.volume > 0).length
  )).toBe(1);

  // Mute in the same task that schedules the incoming score fade. The pending
  // rAF must be invalidated rather than restoring volume behind master mute.
  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    await audioManager.setMusicOverride("tension");
    audioManager.setVolumes({ masterMuted: true });
  });
  await page.waitForTimeout(600);
  const mutedMusic = await snapshot(page);
  expect(mutedMusic.masterMuted).toBe(true);
  expect([...mutedMusic.mediaSlots.music, ...mutedMusic.mediaSlots.ambience].every((slot) => slot.volume === 0))
    .toBe(true);
  expect(mutedMusic.mediaSlots.music.some((slot) => !slot.paused)).toBe(true);

  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setVolumes({ masterMuted: false });
  });
  await expect.poll(() => snapshot(page).then((state) =>
    state.mediaSlots.music.filter((slot) => !slot.paused && slot.volume > 0).length
  )).toBe(1);
  const restoredMusic = await snapshot(page);
  expect(restoredMusic.playingMusicContext).toBe("tension");
  expect(restoredMusic.mediaSlots.ambience.every((slot) => slot.volume === 0)).toBe(true);

  // Repeat during the successful procedural-to-authored handoff.
  await page.evaluate(async ({ next }) => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setAmbientMix(next);
    await audioManager.setMusicOverride("silent");
    audioManager.setVolumes({ masterMuted: true });
  }, { next: mix({ bed: "parkland" }) });
  await page.waitForTimeout(600);
  const mutedAuthored = await snapshot(page);
  expect(mutedAuthored.playingAmbience).toBe("parkland");
  expect([...mutedAuthored.mediaSlots.music, ...mutedAuthored.mediaSlots.ambience].every((slot) => slot.volume === 0))
    .toBe(true);
  expect(mutedAuthored.mediaSlots.ambience.some((slot) => !slot.paused)).toBe(true);

  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setVolumes({ masterMuted: false });
  });
  await expect.poll(() => snapshot(page).then((state) =>
    state.mediaSlots.ambience.filter((slot) => !slot.paused && slot.volume > 0).length
  )).toBe(1);
  const restoredAuthored = await snapshot(page);
  expect(restoredAuthored.mediaSlots.music.every((slot) => slot.volume === 0)).toBe(true);
  expect(restoredAuthored.mediaSlots.ambience.filter((slot) => !slot.paused && slot.volume > 0)).toHaveLength(1);
});

test("ZK-570 rejects stale authored success across A-to-B-to-A generations", async ({ page }) => {
  await installDeferredAmbience(page);
  await page.goto("/");
  await applyMix(page, mix({ bed: "parkland" }), "silent");
  await page.getByRole("button", { name: "Options" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience?: { state: () => unknown[] };
    }).__zk570DeferredAmbience?.state().length
  )).toBe(1);

  await applyMix(page, mix({ season: "winter", bed: "winter", crickets: 0 }), "silent");
  await applyMix(page, mix({ season: "spring", bed: "parkland" }), "silent");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience?: { state: () => unknown[] };
    }).__zk570DeferredAmbience?.state().length
  )).toBe(3);
  const requested = await snapshot(page);
  expect(requested.authoredAttempts.total).toBe(3);
  expect(requested.authoredAttempts.inFlightBeds).toEqual(["parkland", "winter", "parkland"]);
  expect(requested.authoredAttempts.current?.bed).toBe("parkland");

  // Resolve stale B, then stale A. Neither may become the authored owner even
  // though both play promises eventually fulfill.
  await page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience: { release: (index: number) => void };
    }).__zk570DeferredAmbience.release(1)
  );
  await expect.poll(() => snapshot(page).then((state) => state.authoredAttempts.inFlightBeds.length)).toBe(2);
  expect((await snapshot(page)).playingAmbience).toBeNull();
  await page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience: { release: (index: number) => void };
    }).__zk570DeferredAmbience.release(0)
  );
  await expect.poll(() => snapshot(page).then((state) => state.authoredAttempts.inFlightBeds.length)).toBe(1);
  expect((await snapshot(page)).playingAmbience).toBeNull();

  await page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience: { release: (index: number) => void };
    }).__zk570DeferredAmbience.release(2)
  );
  await expect.poll(() => snapshot(page).then((state) => state.playingAmbience)).toBe("parkland");
  const settled = await snapshot(page);
  expect(settled.authoredNatureOwner).toBe(true);
  expect(settled.authoredAttempts.current).toBeNull();
  expect(settled.authoredAttempts.inFlightBeds).toEqual([]);
});

test("ZK-570 issues a fresh generation when surface lifecycle invalidates a pending bed", async ({ page }) => {
  await installDeferredAmbience(page);
  await page.goto("/");
  await applyMix(page, mix({ bed: "parkland" }), "silent");
  await page.getByRole("button", { name: "Options" }).click();
  await expect.poll(() => snapshot(page).then((state) => state.authoredAttempts.total)).toBe(1);
  const firstGeneration = (await snapshot(page)).authoredAttempts.current?.generation;

  await page.evaluate(async () => {
    const { audioManager } = await import("/src/audio/AudioManager.ts");
    audioManager.setSurface("menu");
    audioManager.setSurface("game");
  });
  await expect.poll(() => snapshot(page).then((state) => state.authoredAttempts.total)).toBe(2);
  const reentered = await snapshot(page);
  expect(reentered.authoredAttempts.current?.bed).toBe("parkland");
  expect(reentered.authoredAttempts.current?.generation).toBeGreaterThan(firstGeneration ?? 0);

  await page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience: { release: (index: number) => void };
    }).__zk570DeferredAmbience.release(0)
  );
  await expect.poll(() => snapshot(page).then((state) => state.authoredAttempts.inFlightBeds.length)).toBe(1);
  expect((await snapshot(page)).playingAmbience).toBeNull();

  await page.evaluate(() =>
    (window as Window & {
      __zk570DeferredAmbience: { release: (index: number) => void };
    }).__zk570DeferredAmbience.release(1)
  );
  await expect.poll(() => snapshot(page).then((state) => state.playingAmbience)).toBe("parkland");
  expect((await snapshot(page)).authoredNatureOwner).toBe(true);
});
