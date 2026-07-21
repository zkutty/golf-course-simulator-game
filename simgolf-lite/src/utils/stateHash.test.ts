import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../game/gameState";
import { hashGameState } from "./stateHash";

describe("hashGameState", () => {
  it("hashes only the game-state contract when passed a full save payload", () => {
    const base = { course: DEFAULT_STATE.course, world: DEFAULT_STATE.world };
    const withUiMetadata = { ...base, history: [], tutorial: null, supportNote: "not game state" };
    expect(hashGameState(withUiMetadata)).toBe(hashGameState(base));
  });

  it("treats a migrated empty decoration collection as semantic no-op", () => {
    const without = { ...DEFAULT_STATE.course };
    delete without.decorations;
    expect(hashGameState({ course: without, world: DEFAULT_STATE.world })).toBe(
      hashGameState({ course: { ...without, decorations: [] }, world: DEFAULT_STATE.world })
    );
  });
});
