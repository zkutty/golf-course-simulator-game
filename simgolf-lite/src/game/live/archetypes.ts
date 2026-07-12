import type { GolferArchetypeName } from "./types";
import type { PersonalityBaseline } from "./personality";

// Archetypes describe *who* is playing: appearance, how often they show up, and
// the centre of the personality distribution they're drawn from. Each arriving
// golfer rolls an individual personality around this baseline (see
// rollPersonality), so an archetype is a crowd of related people, not a clone.
export interface Archetype {
  name: GolferArchetypeName;
  label: string;
  color: string;
  // Relative likelihood of showing up on a given day.
  weight: number;
  // Centre of this archetype's personality cloud.
  personality: PersonalityBaseline;
}

export const ARCHETYPES: Record<GolferArchetypeName, Archetype> = {
  pro: {
    name: "pro",
    label: "Pro",
    color: "#f8fafc",
    weight: 0.4,
    personality: {
      skill: 0.95,
      consistency: 0.9,
      patience: 0.7,
      spendPropensity: 0.5,
      prefs: { difficulty: 0.6, scenery: 0.2, price: 0.3 },
      spread: 0.08,
    },
  },
  lowHandicap: {
    name: "lowHandicap",
    label: "Low-handicap",
    color: "#38bdf8",
    weight: 1.6,
    personality: {
      skill: 0.8,
      consistency: 0.75,
      patience: 0.6,
      spendPropensity: 0.5,
      prefs: { difficulty: 0.4, scenery: 0.3, price: 0.1 },
      spread: 0.12,
    },
  },
  casual: {
    name: "casual",
    label: "Casual",
    color: "#fbbf24",
    weight: 3.0,
    personality: {
      skill: 0.4,
      consistency: 0.45,
      patience: 0.4,
      spendPropensity: 0.7,
      prefs: { difficulty: -0.3, scenery: 0.4, price: -0.2 },
      spread: 0.18,
    },
  },
  senior: {
    name: "senior",
    label: "Senior",
    color: "#a78bfa",
    weight: 1.6,
    personality: {
      skill: 0.5,
      consistency: 0.6,
      patience: 0.75,
      spendPropensity: 0.55,
      prefs: { difficulty: -0.2, scenery: 0.6, price: 0.0 },
      spread: 0.15,
    },
  },
  junior: {
    name: "junior",
    label: "Junior",
    color: "#34d399",
    weight: 1.0,
    personality: {
      skill: 0.35,
      consistency: 0.35,
      patience: 0.3,
      spendPropensity: 0.4,
      prefs: { difficulty: 0.1, scenery: 0.1, price: -0.4 },
      spread: 0.2,
    },
  },
  tourist: {
    name: "tourist",
    label: "Tourist",
    color: "#fb7185",
    weight: 1.2,
    personality: {
      skill: 0.4,
      consistency: 0.4,
      patience: 0.5,
      spendPropensity: 0.8,
      prefs: { difficulty: -0.1, scenery: 0.8, price: 0.2 },
      spread: 0.18,
    },
  },
};

const ARCHETYPE_LIST = Object.values(ARCHETYPES);

// Weighted pick of an archetype using a 0..1 random value.
export function pickArchetype(r: number): Archetype {
  const total = ARCHETYPE_LIST.reduce((a, x) => a + x.weight, 0);
  let t = r * total;
  for (const a of ARCHETYPE_LIST) {
    t -= a.weight;
    if (t <= 0) return a;
  }
  return ARCHETYPE_LIST[ARCHETYPE_LIST.length - 1];
}

const FIRST_NAMES = [
  "Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie",
  "Pat", "Drew", "Quinn", "Avery", "Robin", "Chris", "Dana", "Lee",
];
const LAST_INITIALS = "ABCDEFGHJKLMNPRSTW".split("");

export function golferName(r1: number, r2: number): string {
  const f = FIRST_NAMES[Math.floor(r1 * FIRST_NAMES.length) % FIRST_NAMES.length];
  const l = LAST_INITIALS[Math.floor(r2 * LAST_INITIALS.length) % LAST_INITIALS.length];
  return `${f} ${l}.`;
}
