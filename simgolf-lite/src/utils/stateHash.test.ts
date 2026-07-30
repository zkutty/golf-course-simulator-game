import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../game/gameState";
import { biomeCompatibilityMetadataFor } from "../game/models/biomes";
import { createDefaultPlayerPro, startPlayableRound } from "../game/playerPro/playerPro";
import { createPlayerProReferenceCourse } from "../game/testing/referenceCourse";
import { hashGameState } from "./stateHash";

function activeRoundState() {
  const course = createPlayerProReferenceCourse();
  const playerPro = createDefaultPlayerPro({ seed: DEFAULT_STATE.world.runSeed });
  const world = { ...DEFAULT_STATE.world, playerPro };
  const started = startPlayableRound({ course, world });
  if (!started.ok) throw new Error(started.reason);
  return {
    course,
    world: {
      ...world,
      playerPro: { ...playerPro, activeRound: started.round },
    },
  };
}

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

  it("treats missing and canonical biome compatibility evidence as the same state", () => {
    const without = { ...DEFAULT_STATE.course };
    delete without.biomeCompatibility;
    expect(hashGameState({ course: without, world: DEFAULT_STATE.world })).toBe(
      hashGameState({
        course: {
          ...without,
          biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
        },
        world: DEFAULT_STATE.world,
      })
    );
  });

  it("rejects unsupported or contradictory biome identity instead of hashing it", () => {
    expect(() => hashGameState({
      course: { ...DEFAULT_STATE.course, theme: "moonbase" as never },
      world: DEFAULT_STATE.world,
    })).toThrow('Cannot hash unsupported biome "moonbase".');

    expect(() => hashGameState({
      course: {
        ...DEFAULT_STATE.course,
        biomeCompatibility: biomeCompatibilityMetadataFor("links"),
      },
      world: DEFAULT_STATE.world,
    })).toThrow('Biome metadata "links" does not match course biome "parkland".');
  });

  it("canonicalizes missing and historical active-round biome evidence", () => {
    const current = activeRoundState();
    const canonicalHash = hashGameState(current);
    const activeRound = current.world.playerPro.activeRound!;
    const withoutCompatibility = {
      ...current,
      world: {
        ...current.world,
        playerPro: {
          ...current.world.playerPro,
          activeRound: {
            ...activeRound,
            course: {
              ...activeRound.course,
              biomeCompatibility: undefined,
            },
          },
        },
      },
    };
    const withHistoricalAlias = {
      ...current,
      world: {
        ...current.world,
        playerPro: {
          ...current.world.playerPro,
          activeRound: {
            ...activeRound,
            course: {
              ...activeRound.course,
              theme: "Parkland" as never,
            },
          },
        },
      },
    };

    expect(hashGameState(withoutCompatibility)).toBe(canonicalHash);
    expect(hashGameState(withHistoricalAlias)).toBe(canonicalHash);
  });

  it("rejects unsupported or contradictory active-round biome evidence", () => {
    const current = activeRoundState();
    const activeRound = current.world.playerPro.activeRound!;
    expect(() => hashGameState({
      ...current,
      world: {
        ...current.world,
        playerPro: {
          ...current.world.playerPro,
          activeRound: {
            ...activeRound,
            course: { ...activeRound.course, theme: "moonbase" as never },
          },
        },
      },
    })).toThrow('Cannot hash active round with unsupported biome "moonbase".');

    expect(() => hashGameState({
      ...current,
      world: {
        ...current.world,
        playerPro: {
          ...current.world.playerPro,
          activeRound: {
            ...activeRound,
            course: {
              ...activeRound.course,
              biomeCompatibility: biomeCompatibilityMetadataFor("links"),
            },
          },
        },
      },
    })).toThrow('Biome metadata "links" does not match course biome "parkland".');
  });
});
