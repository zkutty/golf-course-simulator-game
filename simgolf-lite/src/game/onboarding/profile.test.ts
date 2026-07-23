import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_PROFILE, loadAppProfile, resetProfileTab, updateProfileTab } from "./profile";

function storage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("versioned app profile", () => {
  beforeEach(() => vi.stubGlobal("window", { dispatchEvent: vi.fn() }));

  it("migrates the M14 profile and scattered audio/ambience keys", () => {
    const store = storage({
      coursecraft_app_profile_v1: JSON.stringify({ tutorialOffered: true, advisorFrequency: "important" }),
      coursecraft_audio_volumes: JSON.stringify({ musicVolume: 0.7, ambienceVolume: 0.2, sfxVolume: 0.4 }),
      coursecraft_ambience: "off",
    });
    const profile = loadAppProfile(store);
    expect(profile).toMatchObject({ version: 4, tutorialOffered: true, advisorFrequency: "important", achievements: { earned: [] } });
    expect(profile.audio).toMatchObject({ musicVolume: 0.7, ambienceVolume: 0.2, sfxVolume: 0.4 });
    expect(profile.graphics).toMatchObject({ ambienceFx: false });
  });

  it("persists tab updates and resets one tab without touching others", () => {
    const store = storage();
    vi.stubGlobal("localStorage", store);
    updateProfileTab("gameplay", { edgeScroll: false });
    updateProfileTab("audio", { musicVolume: 0.9 });
    resetProfileTab("gameplay");
    const profile = loadAppProfile(store);
    expect(profile.gameplay.edgeScroll).toBe(DEFAULT_APP_PROFILE.gameplay.edgeScroll);
    expect(profile.audio.musicVolume).toBe(0.9);
  });

  it("clamps malformed evolved fields instead of rejecting the profile", () => {
    const store = storage({ coursecraft_app_profile_v2: JSON.stringify({ version: 2, gameplay: { edgeScrollSpeed: 99 }, graphics: { resolutionScale: 0.1 } }) });
    const profile = loadAppProfile(store);
    expect(profile.gameplay.edgeScrollSpeed).toBe(2);
    expect(profile.graphics.resolutionScale).toBe(0.5);
    expect(profile.accessibility.keybindings.pause).toBe("Space");
    expect(profile.audio.masterVolume).toBe(1);
  });

  it("migrates the retired third speed preset from 3x to 4x", () => {
    const store = storage({ coursecraft_app_profile_v4: JSON.stringify({ version: 4, gameplay: { defaultGameSpeed: "3x" } }) });
    expect(loadAppProfile(store).gameplay.defaultGameSpeed).toBe("4x");
  });
});
  it("honors the operating-system reduced-motion preference on first boot", () => {
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      matchMedia: vi.fn(() => ({ matches: true })),
    });
    expect(loadAppProfile(storage()).accessibility.reducedMotion).toBe(true);
  });
