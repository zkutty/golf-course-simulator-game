export type UnlockId = "FLAG_BLUE" | "FLAG_GOLD";

export interface LegacyState {
  legacyPoints: number;
  unlocked: Record<UnlockId, boolean>;
  selected: {
    flagColor: string;
  };
  lastAwardId?: string;
}

const KEY = "simgolf_lite_legacy_v1";

export const DEFAULT_LEGACY: LegacyState = {
  legacyPoints: 0,
  unlocked: {
    FLAG_BLUE: false,
    FLAG_GOLD: false,
  },
  selected: {
    flagColor: "rgba(220,38,38,0.92)", // default red
  },
  lastAwardId: undefined,
};

export function loadLegacy(): LegacyState {
  if (typeof localStorage === "undefined") return DEFAULT_LEGACY;
  const raw = localStorage.getItem(KEY);
  if (!raw) return DEFAULT_LEGACY;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyState>;
    return {
      ...DEFAULT_LEGACY,
      ...parsed,
      unlocked: { ...DEFAULT_LEGACY.unlocked, ...(parsed.unlocked ?? {}) },
      selected: { ...DEFAULT_LEGACY.selected, ...(parsed.selected ?? {}) },
    };
  } catch {
    return DEFAULT_LEGACY;
  }
}

export function saveLegacy(state: LegacyState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function legacyAwardForRun(args: { weeksSurvived: number; peakRep: number }) {
  const weeksPts = Math.floor(args.weeksSurvived / 4);
  const repBonus = Math.floor(args.peakRep / 25);
  return Math.max(0, weeksPts + repBonus);
}


