import { afterEach, describe, expect, it, vi } from "vitest";

type MediaEvent = {
  audio: MockAudio;
  type: "pause" | "play" | "volume";
  value?: number;
};

class MockAudio {
  static instances: MockAudio[] = [];
  static events: MediaEvent[] = [];
  static holdPlayPromises = false;
  static pendingPlayResolvers: Array<() => void> = [];

  preload = "";
  private source = "";
  srcAssignments = 0;
  loadCount = 0;
  currentTime = 0;
  ended = false;
  paused = true;
  dataset: Record<string, string> = {};
  private gain = 1;

  constructor() {
    MockAudio.instances.push(this);
  }

  get volume(): number {
    return this.gain;
  }

  set volume(value: number) {
    this.gain = value;
    MockAudio.events.push({ audio: this, type: "volume", value });
  }

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = new URL(value, "https://coursecraft.test").href;
    this.srcAssignments += 1;
  }

  addEventListener(): void {}
  load(): void {
    this.loadCount += 1;
  }

  play(): Promise<void> {
    this.paused = false;
    MockAudio.events.push({ audio: this, type: "play" });
    if (MockAudio.holdPlayPromises) {
      return new Promise((resolve) => {
        MockAudio.pendingPlayResolvers.push(() => {
          this.currentTime = Math.max(this.currentTime, 0.25);
          resolve();
        });
      });
    }
    this.currentTime = Math.max(this.currentTime, 0.25);
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    MockAudio.events.push({ audio: this, type: "pause" });
  }

  static resolvePendingPlays(): void {
    const resolvers = MockAudio.pendingPlayResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

async function managerWithDelayedAnimationFrames() {
  const animationFrames: FrameRequestCallback[] = [];
  MockAudio.instances = [];
  MockAudio.events = [];
  MockAudio.holdPlayPromises = false;
  MockAudio.pendingPlayResolvers = [];
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.resetModules();
  const { audioManager } = await import("./AudioManager");
  return { animationFrames, audioManager };
}

function activeStreams(): MockAudio[] {
  return MockAudio.instances.filter((audio) => !audio.paused && audio.currentTime > 0 && audio.volume > 0);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("AudioManager media handoff", () => {
  it("prepares only the requested Player Pro track and consumes it without restarting resource selection", async () => {
    const { audioManager } = await managerWithDelayedAnimationFrames();
    await audioManager.setMusicContext("title");
    await audioManager.unlock();

    expect(MockAudio.instances.some((audio) => audio.src.endsWith("/player-pro-01.mp3"))).toBe(false);
    const outgoing = MockAudio.instances.find((audio) => audio.src.endsWith("/title-01.mp3"));
    audioManager.prepareMusicContext("play");
    const prepared = MockAudio.instances.find((audio) => audio.src.endsWith("/player-pro-01.mp3"));

    expect(prepared).toMatchObject({ paused: true, volume: 0, preload: "auto", loadCount: 1, srcAssignments: 1 });
    expect(activeStreams()).toEqual([outgoing]);
    audioManager.prepareMusicContext("play");
    expect(prepared).toMatchObject({ loadCount: 1, srcAssignments: 1 });

    MockAudio.holdPlayPromises = true;
    const transition = audioManager.setMusicContext("play");
    expect(prepared).toMatchObject({ paused: false, currentTime: 0, volume: 0.025, preload: "none" });
    expect(prepared).toMatchObject({ loadCount: 1, srcAssignments: 1 });
    expect(outgoing).toMatchObject({ paused: true, volume: 0 });

    MockAudio.holdPlayPromises = false;
    MockAudio.resolvePendingPlays();
    await transition;
    expect(activeStreams()).toEqual([prepared]);
  });

  it("establishes exclusive Player Pro gain while play remains pending", async () => {
    const { audioManager } = await managerWithDelayedAnimationFrames();
    await audioManager.setMusicContext("title");
    await audioManager.unlock();

    const outgoing = MockAudio.instances.find((audio) => audio.src.endsWith("/title-01.mp3"));
    expect(outgoing).toBeDefined();
    MockAudio.events = [];
    MockAudio.holdPlayPromises = true;

    const transition = audioManager.setMusicContext("play");
    const incoming = MockAudio.instances.find((audio) => audio.src.endsWith("/player-pro-01.mp3"));

    expect(incoming).toMatchObject({ paused: false, currentTime: 0, volume: 0.025 });
    expect(outgoing).toMatchObject({ paused: true, volume: 0 });
    expect(MockAudio.pendingPlayResolvers).toHaveLength(1);
    const outgoingPause = MockAudio.events.findIndex((event) => event.audio === outgoing && event.type === "pause");
    const incomingGain = MockAudio.events.findIndex(
      (event) => event.audio === incoming && event.type === "volume" && (event.value ?? 0) > 0,
    );
    expect(outgoingPause).toBeGreaterThanOrEqual(0);
    expect(incomingGain).toBeGreaterThan(outgoingPause);

    MockAudio.holdPlayPromises = false;
    MockAudio.resolvePendingPlays();
    await transition;
    expect(activeStreams()).toEqual([incoming]);
  });

  it("makes Player Pro audible before a delayed animation frame without overlapping the outgoing score", async () => {
    const { animationFrames, audioManager } = await managerWithDelayedAnimationFrames();
    await audioManager.setMusicContext("title");
    await audioManager.unlock();

    const outgoing = MockAudio.instances.find((audio) => audio.src.endsWith("/title-01.mp3"));
    expect(outgoing).toBeDefined();
    expect(activeStreams()).toEqual([outgoing]);

    MockAudio.events = [];
    await audioManager.setMusicContext("play");

    const incoming = MockAudio.instances.find((audio) => audio.src.endsWith("/player-pro-01.mp3"));
    expect(incoming).toBeDefined();
    expect(animationFrames.length).toBeGreaterThan(0);
    expect(incoming?.volume).toBeCloseTo(0.025);
    expect(activeStreams()).toEqual([incoming]);
    expect(outgoing).toMatchObject({ paused: true, volume: 0 });

    const outgoingPause = MockAudio.events.findIndex((event) => event.audio === outgoing && event.type === "pause");
    const incomingGain = MockAudio.events.findIndex(
      (event) => event.audio === incoming && event.type === "volume" && (event.value ?? 0) > 0,
    );
    expect(outgoingPause).toBeGreaterThanOrEqual(0);
    expect(incomingGain).toBeGreaterThan(outgoingPause);
  });

  it("keeps exactly one audible stream through rapid delayed-frame context changes", async () => {
    const { audioManager } = await managerWithDelayedAnimationFrames();
    await audioManager.setMusicContext("title");
    await audioManager.unlock();

    MockAudio.holdPlayPromises = true;
    const superseded = audioManager.setMusicContext("build-parkland");
    const latest = audioManager.setMusicContext("live");
    const pendingOwner = MockAudio.instances.find((audio) => audio.src.endsWith("/operate-01.mp3"));
    expect(MockAudio.instances.filter((audio) => !audio.paused && audio.volume > 0)).toEqual([pendingOwner]);
    expect(MockAudio.instances
      .filter((audio) => audio !== pendingOwner)
      .every((audio) => audio.paused && audio.volume === 0)).toBe(true);
    MockAudio.holdPlayPromises = false;
    MockAudio.resolvePendingPlays();
    await Promise.all([superseded, latest]);

    for (const context of ["play", "tension", "victory"] as const) {
      await audioManager.setMusicContext(context);
      expect(activeStreams()).toHaveLength(1);
      expect(MockAudio.instances
        .filter((audio) => audio !== activeStreams()[0])
        .every((audio) => audio.paused && audio.volume === 0)).toBe(true);
    }
  });
});
