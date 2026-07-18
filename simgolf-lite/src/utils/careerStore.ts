// Career progress store (ZKU-164). Its own localStorage key, separate from
// saves, so restarting or deleting a scenario save never wipes medals.
// Coordinates with the ZKU-129 unlock system later: completed medals are
// the intended unlock currency.

export interface ScenarioRecord {
  completed: boolean;
  attempts: number;
  /** Best (earliest) winning week. */
  bestWeek?: number;
  /** Cash at the best completion. */
  bestCash?: number;
  completedAt?: number;
}

export interface CareerState {
  version: 1;
  scenarios: Record<string, ScenarioRecord>;
}

const KEY = "coursecraft_career_v1";

export const DEFAULT_CAREER: CareerState = { version: 1, scenarios: {} };

// In-memory fallback (tests / storage-less environments).
let memory: CareerState | null = null;

function storage(): Storage | null {
  try {
    if (
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function" &&
      typeof localStorage.setItem === "function" &&
      typeof localStorage.removeItem === "function"
    ) return localStorage;
  } catch {
    // SecurityError / partial Node globals fall back to memory.
  }
  return null;
}

export function loadCareer(): CareerState {
  const store = storage();
  if (!store) return memory ?? DEFAULT_CAREER;
  const raw = store.getItem(KEY);
  if (!raw) return DEFAULT_CAREER;
  try {
    const parsed = JSON.parse(raw) as Partial<CareerState>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.scenarios !== "object") {
      return DEFAULT_CAREER;
    }
    return { version: 1, scenarios: { ...(parsed.scenarios as CareerState["scenarios"]) } };
  } catch {
    return DEFAULT_CAREER;
  }
}

export function saveCareer(state: CareerState): void {
  const store = storage();
  if (!store) {
    memory = state;
    return;
  }
  store.setItem(KEY, JSON.stringify(state));
}

function record(state: CareerState, id: string): ScenarioRecord {
  return state.scenarios[id] ?? { completed: false, attempts: 0 };
}

export function recordScenarioAttempt(id: string): CareerState {
  const state = loadCareer();
  const r = record(state, id);
  const next: CareerState = {
    ...state,
    scenarios: { ...state.scenarios, [id]: { ...r, attempts: r.attempts + 1 } },
  };
  saveCareer(next);
  return next;
}

/** Record a win; keeps the best (earliest) week across replays. */
export function recordScenarioCompleted(
  id: string,
  result: { week: number; cash: number }
): CareerState {
  const state = loadCareer();
  const r = record(state, id);
  const isBest = !r.completed || r.bestWeek == null || result.week < r.bestWeek;
  const next: CareerState = {
    ...state,
    scenarios: {
      ...state.scenarios,
      [id]: {
        ...r,
        completed: true,
        completedAt: r.completedAt ?? Date.now(),
        bestWeek: isBest ? result.week : r.bestWeek,
        bestCash: isBest ? Math.round(result.cash) : r.bestCash,
      },
    },
  };
  saveCareer(next);
  return next;
}

/**
 * Ladder rule: scenario 1 is always open; scenario N unlocks when the
 * scenario ordered N-1 is completed.
 */
export function isScenarioUnlocked(
  career: CareerState,
  scenarios: Array<{ id: string; order: number }>,
  id: string
): boolean {
  const target = scenarios.find((s) => s.id === id);
  if (!target) return false;
  if (target.order <= 1) return true;
  const prev = scenarios.find((s) => s.order === target.order - 1);
  if (!prev) return true;
  return career.scenarios[prev.id]?.completed === true;
}

/** Test hook: reset the in-memory fallback. */
export function __resetCareerForTests(): void {
  memory = null;
  storage()?.removeItem(KEY);
}
