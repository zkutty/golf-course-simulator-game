// Career progress store (ZKU-164). Its own localStorage key, separate from
// saves, so restarting or deleting a scenario save never wipes medals.
// Coordinates with the ZKU-129 unlock system later: completed medals are
// the intended unlock currency.
import type { CampaignChoiceRecord, CampaignMedal } from "../game/campaign/types";

export interface ScenarioRecord {
  completed: boolean;
  attempts: number;
  /** Best (earliest) winning week. */
  bestWeek?: number;
  /** Cash at the best completion. */
  bestCash?: number;
  completedAt?: number;
  bestMedal?: CampaignMedal;
  choiceLedger?: CampaignChoiceRecord[];
  epilogueFacts?: string[];
}

export interface CareerState {
  version: 2;
  scenarios: Record<string, ScenarioRecord>;
  unlocks: string[];
  campaignChoices: CampaignChoiceRecord[];
}

const KEY = "coursecraft_career_v1";

export const DEFAULT_CAREER: CareerState = { version: 2, scenarios: {}, unlocks: [], campaignChoices: [] };

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
    const scenarios = Object.fromEntries(Object.entries(parsed.scenarios as CareerState["scenarios"]).map(([id, raw]) => {
      const record = raw && typeof raw === "object" ? raw : { completed: false, attempts: 0 };
      return [id, {
        ...record,
        attempts: Math.max(0, Math.floor(Number(record.attempts) || 0)),
        completed: record.completed === true,
        choiceLedger: Array.isArray(record.choiceLedger) ? record.choiceLedger.slice(-120) : [],
        epilogueFacts: Array.isArray(record.epilogueFacts) ? record.epilogueFacts.filter((item): item is string => typeof item === "string").slice(-64) : [],
      }];
    }));
    return {
      version: 2,
      scenarios,
      unlocks: Array.isArray(parsed.unlocks)
        ? [...new Set(parsed.unlocks.filter((item): item is string => typeof item === "string"))].slice(-120)
        : [],
      campaignChoices: Array.isArray(parsed.campaignChoices)
        ? parsed.campaignChoices.filter((choice): choice is CampaignChoiceRecord =>
          choice != null && typeof choice === "object" && typeof choice.chapterId === "string"
          && typeof choice.sceneId === "string" && typeof choice.choiceId === "string"
        ).slice(-120)
        : [],
    };
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
  result: {
    week: number;
    cash: number;
    medal?: CampaignMedal;
    choices?: CampaignChoiceRecord[];
    rewards?: string[];
    epilogueFacts?: string[];
  }
): CareerState {
  const state = loadCareer();
  const r = record(state, id);
  const isBest = !r.completed || r.bestWeek == null || result.week < r.bestWeek;
  const medalRank: Record<CampaignMedal, number> = { bronze: 1, silver: 2, gold: 3 };
  const bestMedal = result.medal && (!r.bestMedal || medalRank[result.medal] > medalRank[r.bestMedal])
    ? result.medal
    : r.bestMedal;
  const choiceLedger = result.choices?.length ? result.choices.slice(-120) : r.choiceLedger;
  const next: CareerState = {
    ...state,
    unlocks: [...new Set([...state.unlocks, ...(result.rewards ?? [])])].slice(-120),
    campaignChoices: result.choices?.length
      ? [...new Map([...state.campaignChoices, ...result.choices].map((choice) => [`${choice.chapterId}:${choice.sceneId}:${choice.choiceId}:${choice.week}`, choice])).values()].slice(-120)
      : state.campaignChoices,
    scenarios: {
      ...state.scenarios,
      [id]: {
        ...r,
        completed: true,
        completedAt: r.completedAt ?? Date.now(),
        bestWeek: isBest ? result.week : r.bestWeek,
        bestCash: isBest ? Math.round(result.cash) : r.bestCash,
        ...(bestMedal ? { bestMedal } : {}),
        ...(choiceLedger ? { choiceLedger } : {}),
        ...(result.epilogueFacts ? { epilogueFacts: [...new Set(result.epilogueFacts)].slice(-64) } : {}),
      },
    },
  };
  saveCareer(next);
  return next;
}

export function recordCampaignChoice(id: string, choice: CampaignChoiceRecord): CareerState {
  const state = loadCareer();
  const current = record(state, id);
  const key = `${choice.chapterId}:${choice.sceneId}:${choice.choiceId}:${choice.week}`;
  if (state.campaignChoices.some((entry) => `${entry.chapterId}:${entry.sceneId}:${entry.choiceId}:${entry.week}` === key)) return state;
  const next: CareerState = {
    ...state,
    campaignChoices: [...state.campaignChoices, choice].slice(-120),
    scenarios: {
      ...state.scenarios,
      [id]: {
        ...current,
        choiceLedger: [...(current.choiceLedger ?? []), choice].slice(-120),
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
