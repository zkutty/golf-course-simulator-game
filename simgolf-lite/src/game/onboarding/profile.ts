import type { SpeedName } from "../live/liveConfig";
import { DEFAULT_KEYBINDINGS, normalizeKeybindings, type Keybindings } from "../../accessibility/keybindings";

export type AdvisorFrequency = "chatty" | "normal" | "important" | "off";
export type AutosaveCadence = "off" | "weekly" | "5m" | "15m";
export type ColorVisionMode = "standard" | "deuteranopia" | "protanopia" | "tritanopia";
export type TextScale = 90 | 100 | 115 | 130;
export interface EarnedAchievement { id: string; earnedAt: number; courseName: string }

export interface AppProfile {
  version: 4;
  tutorialOffered: boolean;
  tutorialCompleted: boolean;
  advisorFrequency: AdvisorFrequency;
  /** Stable one-shot advisor triggers that must survive save/load and reload. */
  advisorSeen: string[];
  gameplay: {
    autosaveCadence: AutosaveCadence;
    edgeScroll: boolean;
    edgeScrollSpeed: number;
    cameraSmoothing: boolean;
    confirmBulldoze: boolean;
    confirmSalvage: boolean;
    defaultGameSpeed: Exclude<SpeedName, "paused">;
    tickerVisible: boolean;
    momentCamera: boolean;
  };
  graphics: {
    animations: boolean;
    ambienceFx: boolean;
    waterAnimation: boolean;
    treeSway: boolean;
    resolutionScale: number;
    gridOverlays: boolean;
  };
  audio: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    ambienceVolume: number;
    masterMuted: boolean;
    muteWhenHidden: boolean;
  };
  accessibility: {
    colorVision: ColorVisionMode;
    terrainPatterns: boolean;
    reducedMotion: boolean;
    textScale: TextScale;
    keybindings: Keybindings;
  };
  achievements: { earned: EarnedAchievement[] };
}

const PROFILE_KEY = "coursecraft_app_profile_v4";
const LEGACY_PROFILE_KEY = "coursecraft_app_profile_v3";
const OLDER_PROFILE_KEY = "coursecraft_app_profile_v2";
const OLDEST_PROFILE_KEY = "coursecraft_app_profile_v1";
const LEGACY_AUDIO_KEY = "coursecraft_audio_volumes";

/** Shipping defaults. Keep additions migration-safe and covered by tests. */
export const DEFAULT_APP_PROFILE: AppProfile = {
  version: 4,
  tutorialOffered: false,
  tutorialCompleted: false,
  advisorFrequency: "normal",
  advisorSeen: [],
  gameplay: {
    autosaveCadence: "weekly",
    edgeScroll: true,
    edgeScrollSpeed: 1,
    cameraSmoothing: true,
    confirmBulldoze: true,
    confirmSalvage: true,
    defaultGameSpeed: "1x",
    tickerVisible: true,
    momentCamera: false,
  },
  graphics: {
    animations: true,
    ambienceFx: true,
    waterAnimation: true,
    treeSway: true,
    resolutionScale: 1,
    gridOverlays: false,
  },
  audio: {
    masterVolume: 1,
    musicVolume: 0.25,
    sfxVolume: 0.6,
    ambienceVolume: 0.4,
    masterMuted: false,
    muteWhenHidden: true,
  },
  accessibility: {
    colorVision: "standard",
    terrainPatterns: false,
    reducedMotion: false,
    textScale: 100,
    keybindings: { ...DEFAULT_KEYBINDINGS },
  },
  achievements: { earned: [] },
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function cloneDefaults(): AppProfile {
  return JSON.parse(JSON.stringify(DEFAULT_APP_PROFILE)) as AppProfile;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeProfile(value: unknown, storage?: StorageLike): AppProfile {
  const defaults = cloneDefaults();
  const raw = record(value);
  const gameplay = record(raw.gameplay);
  const graphics = record(raw.graphics);
  const audio = record(raw.audio);
  const accessibility = record(raw.accessibility);
  const achievements = record(raw.achievements);

  let legacyAudio: Record<string, unknown> = {};
  if (storage && raw.version !== 4) {
    try { legacyAudio = record(JSON.parse(storage.getItem(LEGACY_AUDIO_KEY) ?? "null")); } catch { /* defaults */ }
  }

  return {
    version: 4,
    tutorialOffered: raw.tutorialOffered === true,
    tutorialCompleted: raw.tutorialCompleted === true,
    advisorFrequency: oneOf(raw.advisorFrequency, ["chatty", "normal", "important", "off"], defaults.advisorFrequency),
    advisorSeen: Array.isArray(raw.advisorSeen) ? [...new Set(raw.advisorSeen.filter((value): value is string => typeof value === "string"))].slice(-100) : [],
    gameplay: {
      autosaveCadence: oneOf(gameplay.autosaveCadence, ["off", "weekly", "5m", "15m"], defaults.gameplay.autosaveCadence),
      edgeScroll: bool(gameplay.edgeScroll, defaults.gameplay.edgeScroll),
      edgeScrollSpeed: numberIn(gameplay.edgeScrollSpeed, 0.5, 2, defaults.gameplay.edgeScrollSpeed),
      cameraSmoothing: bool(gameplay.cameraSmoothing, defaults.gameplay.cameraSmoothing),
      confirmBulldoze: bool(gameplay.confirmBulldoze, defaults.gameplay.confirmBulldoze),
      confirmSalvage: bool(gameplay.confirmSalvage, defaults.gameplay.confirmSalvage),
      defaultGameSpeed: gameplay.defaultGameSpeed === "3x"
        ? "4x"
        : oneOf(gameplay.defaultGameSpeed, ["1x", "2x", "4x"], defaults.gameplay.defaultGameSpeed),
      tickerVisible: bool(gameplay.tickerVisible, defaults.gameplay.tickerVisible),
      momentCamera: bool(gameplay.momentCamera, defaults.gameplay.momentCamera),
    },
    graphics: {
      animations: bool(graphics.animations, defaults.graphics.animations),
      ambienceFx: bool(graphics.ambienceFx, storage?.getItem("coursecraft_ambience") !== "off"),
      waterAnimation: bool(graphics.waterAnimation, defaults.graphics.waterAnimation),
      treeSway: bool(graphics.treeSway, defaults.graphics.treeSway),
      resolutionScale: numberIn(graphics.resolutionScale, 0.5, 1.5, defaults.graphics.resolutionScale),
      gridOverlays: bool(graphics.gridOverlays, defaults.graphics.gridOverlays),
    },
    audio: {
      masterVolume: numberIn(audio.masterVolume, 0, 1, defaults.audio.masterVolume),
      musicVolume: numberIn(audio.musicVolume ?? legacyAudio.musicVolume, 0, 1, defaults.audio.musicVolume),
      sfxVolume: numberIn(audio.sfxVolume ?? legacyAudio.sfxVolume, 0, 1, defaults.audio.sfxVolume),
      ambienceVolume: numberIn(audio.ambienceVolume ?? legacyAudio.ambienceVolume, 0, 1, defaults.audio.ambienceVolume),
      masterMuted: bool(audio.masterMuted, defaults.audio.masterMuted),
      muteWhenHidden: bool(audio.muteWhenHidden, defaults.audio.muteWhenHidden),
    },
    accessibility: {
      colorVision: oneOf(accessibility.colorVision, ["standard", "deuteranopia", "protanopia", "tritanopia"], defaults.accessibility.colorVision),
      terrainPatterns: bool(accessibility.terrainPatterns, defaults.accessibility.terrainPatterns),
      reducedMotion: bool(accessibility.reducedMotion, defaults.accessibility.reducedMotion),
      textScale: [90, 100, 115, 130].includes(accessibility.textScale as number) ? accessibility.textScale as TextScale : defaults.accessibility.textScale,
      keybindings: normalizeKeybindings(accessibility.keybindings),
    },
    achievements: {
      earned: Array.isArray(achievements.earned)
        ? achievements.earned.filter((value): value is EarnedAchievement => {
            const item = record(value);
            return typeof item.id === "string" && typeof item.earnedAt === "number" && typeof item.courseName === "string";
          })
        : [],
    },
  };
}

function browserStorage(): StorageLike | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

export function loadAppProfile(storage = browserStorage()): AppProfile {
  if (!storage) return cloneDefaults();
  try {
    const current = storage.getItem(PROFILE_KEY);
    const legacy = current == null ? storage.getItem(LEGACY_PROFILE_KEY) ?? storage.getItem(OLDER_PROFILE_KEY) ?? storage.getItem(OLDEST_PROFILE_KEY) : null;
    const parsed = JSON.parse(current ?? legacy ?? "null");
    const profile = normalizeProfile(parsed, storage);
    const hasMotionPreference = "reducedMotion" in record(record(parsed).accessibility);
    if (!hasMotionPreference && typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      profile.accessibility.reducedMotion = true;
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  } catch {
    return cloneDefaults();
  }
}

export function saveAppProfile(profile: AppProfile, storage = browserStorage()): void {
  const normalized = normalizeProfile(profile, storage);
  storage?.setItem(PROFILE_KEY, JSON.stringify(normalized));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("coursecraft-profile-change", { detail: normalized }));
}

export function updateAppProfile(patch: Partial<AppProfile>): AppProfile {
  const current = loadAppProfile();
  const next = normalizeProfile({ ...current, ...patch });
  saveAppProfile(next);
  return next;
}

export type ProfileTab = "gameplay" | "graphics" | "audio" | "accessibility";

export function updateProfileTab<T extends ProfileTab>(tab: T, patch: Partial<AppProfile[T]>): AppProfile {
  const current = loadAppProfile();
  const next = normalizeProfile({ ...current, [tab]: { ...current[tab], ...patch } });
  saveAppProfile(next);
  return next;
}

export function resetProfileTab(tab: ProfileTab): AppProfile {
  const current = loadAppProfile();
  const next = normalizeProfile({ ...current, [tab]: cloneDefaults()[tab] });
  saveAppProfile(next);
  return next;
}

export const APP_PROFILE_STORAGE_KEY = PROFILE_KEY;
