import { assignPersonProfile } from "../competition/characters";
import { normalizeLivingClub } from "../livingClub/livingClub";
import type { RegularGolfer } from "../livingClub/types";
import { createDefaultPlayerPro } from "../playerPro/playerPro";
import type { World } from "../models/types";
import { createRenderPerfCourse } from "./referenceCourse";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import type { InventoryItem } from "../competition/types";

function holding(id: string, name: string, ownerId: string, value: number, unique = false, category: InventoryItem["category"] = "keepsake"): InventoryItem {
  return { id, definitionId: id, name, category, ownerId, custodianId: ownerId, authoredValue: value, remainingValue: value, prestige: unique ? 90 : 20, unique, confirmationRequired: unique, transferable: true, transferHistory: [] };
}

function regular(id: string, name: string, holdings: readonly InventoryItem[] = []): RegularGolfer {
  const profile = assignPersonProfile({
    id,
    kind: "regular",
    name,
    archetype: "lowHandicap",
    appearance: { portrait: "cap", palette: 0, accent: 0 },
    skill: .62,
    preferences: { pace: "balanced", challenge: "competitive", hospitality: "club" },
    loyalty: 70,
    visits: 8,
    rounds: 5,
    bestToPar: 3,
    member: true,
    relationship: { score: 20, tier: "acquaintance", interactionIds: [] },
    memories: [],
    recentThoughts: [],
    history: [],
  }, 725_101);
  return { ...profile, backstory: { ...profile.backstory!, holdings } };
}

export function createZk725BrowserFixture(base: World) {
  const course = normalizeCourseLayouts(createRenderPerfCourse("parkland"));
  const living = normalizeLivingClub(base.livingClub);
  const player = createDefaultPlayerPro({ seed: 725_101, name: "Contract Player" });
  const ordinary = holding("player-ordinary-keepsake", "Player Ordinary Keepsake", player.identity.id, 200);
  const prestige = holding("player-prestige-club", "Player High-Prestige Club", player.identity.id, 1_000, true, "club");
  const world: World = {
    ...base,
    cash: 10_000,
    reputation: 75,
    runSeed: 725_101,
    isBankrupt: false,
    distressWeeks: 0,
    livingClub: {
      ...living,
      regulars: [
        regular("rival-one", "Rival One", [
          holding("rival-ordinary-keepsake", "Rival Ordinary Keepsake", "rival-one", 200),
          holding("rival-prestige-club", "Rival High-Prestige Club", "rival-one", 1_000, true, "club"),
        ]),
        regular("partner-one", "Partner One"),
        regular("partner-two", "Partner Two"),
      ],
    },
    playerPro: {
      ...player,
      inventory: { ...player.inventory, items: [ordinary, prestige], displayItemIds: [ordinary.id] },
      equipmentLoadout: { ...player.equipmentLoadout, clubItemIds: [prestige.id] },
    },
  };
  return { course, world };
}
