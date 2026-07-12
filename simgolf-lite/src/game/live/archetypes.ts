import type { GolferArchetypeName } from "./types";
import type { GolferProfile } from "../sim/golferProfiles";

// Archetypes describe *who* is playing. In Phase 1 they mainly affect skill
// (which solver profile plans their shots), appearance, and putting variance.
// Phase 2 layers on patience, spending, and scenery/difficulty preferences.
export interface Archetype {
  name: GolferArchetypeName;
  label: string;
  solverProfile: GolferProfile["name"]; // which shot model plans their round
  color: string;
  // Relative likelihood of showing up on a given day.
  weight: number;
  // Putting inconsistency: higher = more 1/3-putt swings.
  puttVariance: number;
}

export const ARCHETYPES: Record<GolferArchetypeName, Archetype> = {
  pro: {
    name: "pro",
    label: "Pro",
    solverProfile: "SCRATCH",
    color: "#f8fafc",
    weight: 0.4,
    puttVariance: 0.1,
  },
  lowHandicap: {
    name: "lowHandicap",
    label: "Low-handicap",
    solverProfile: "SCRATCH",
    color: "#38bdf8",
    weight: 1.6,
    puttVariance: 0.18,
  },
  casual: {
    name: "casual",
    label: "Casual",
    solverProfile: "BOGEY",
    color: "#fbbf24",
    weight: 3.0,
    puttVariance: 0.35,
  },
  senior: {
    name: "senior",
    label: "Senior",
    solverProfile: "BOGEY",
    color: "#a78bfa",
    weight: 1.6,
    puttVariance: 0.3,
  },
  junior: {
    name: "junior",
    label: "Junior",
    solverProfile: "BOGEY",
    color: "#34d399",
    weight: 1.0,
    puttVariance: 0.4,
  },
  tourist: {
    name: "tourist",
    label: "Tourist",
    solverProfile: "BOGEY",
    color: "#fb7185",
    weight: 1.2,
    puttVariance: 0.38,
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
