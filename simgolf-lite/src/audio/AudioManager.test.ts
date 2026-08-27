import { afterEach, describe, expect, it, vi } from "vitest";

type MediaEvent = {
  audio: MockAudio;
  type: "pause" | "play" | "volume";
  value?: number;
};

class MockAudio {
  static instances: MockAudio[] = [];
  static events: MediaEvent[] = [];

  preload = "";
  src = "";
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

  addEventListener(): void {}
  load(): void {}

  async play(): Promise<void> {
    this.paused = false;
    this.currentTime = Math.max(this.currentTime, 0.25);
    MockAudio.events.push({ audio: this, type: "play" });
  }

  pause(): void {
    this.paused = true;
    MockAudio.events.push({ audio: this, type: "pause" });
  }
}

async function managerWithDelayedAnimationFrames() {
  const animationFrames: FrameRequestCallback[] = [];
  MockAudio.instances = [];
  MockAudio.events = [];
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

    for (const context of ["build-parkland", "live", "play", "tension", "victory"] as const) {
      await audioManager.setMusicContext(context);
      expect(activeStreams()).toHaveLength(1);
      expect(MockAudio.instances
        .filter((audio) => audio !== activeStreams()[0])
        .every((audio) => audio.paused && audio.volume === 0)).toBe(true);
    }
  });
});
