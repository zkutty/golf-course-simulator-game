import type { SavePayload } from "../utils/save";

export type GameEdition = "full" | "demo";

export const GAME_EDITION: GameEdition =
  import.meta.env.VITE_EDITION === "demo" ? "demo" : "full";
export const IS_DEMO = GAME_EDITION === "demo";
export const DEMO_SCENARIO_IDS = ["back-nine"] as const;

export function scenarioAvailableInEdition(id: string, edition: GameEdition = GAME_EDITION): boolean {
  return edition === "full" || DEMO_SCENARIO_IDS.includes(id as (typeof DEMO_SCENARIO_IDS)[number]);
}

/**
 * Demo builds accept only their curated campaign slice. Full builds
 * intentionally accept demo saves because both editions use the same
 * forward-migrated save schema.
 */
export function saveAvailableInEdition(save: Pick<SavePayload, "world">, edition: GameEdition = GAME_EDITION): boolean {
  return edition === "full" || (
    save.world.mode === "career" &&
    typeof save.world.scenarioId === "string" &&
    scenarioAvailableInEdition(save.world.scenarioId, edition)
  );
}
