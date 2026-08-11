import { describe, expect, it } from "vitest";
import { activeCourseLayout } from "../models/courseLayouts";
import { DEFAULT_WORLD } from "../models/defaults";
import type { World } from "../models/types";
import { normalizeLivingClub } from "../livingClub/livingClub";
import type { InventoryItem, RewardEntitlement } from "../competition/types";
import { createZk725BrowserFixture } from "../testing/zk725BrowserFixture";
import { startPlayerChallengeContract, type PlayerChallengeContractDraft } from "./challengePlayerProAdapter";
import { buildPlayerProSocialPresentation, buildPlayerProWorldDisplayPresentation, visiblePlayerProPeople, visibleRivalHoldingIds } from "./socialPresentation";

const item = (id: string, name: string, ownerId: string, category: InventoryItem["category"] = "keepsake", prestige = 20): InventoryItem => ({
  id,
  definitionId: id,
  name,
  category,
  ownerId,
  custodianId: ownerId,
  authoredValue: 400,
  remainingValue: 400,
  prestige,
  unique: prestige >= 75,
  confirmationRequired: prestige >= 75,
  transferable: true,
  transferHistory: [],
});

describe("ZK-731 Player Pro social presentation", () => {
  it("never includes hidden facts, unknown holdings, or unrevealed reward hooks", () => {
    const fixture = createZk725BrowserFixture(DEFAULT_WORLD);
    const living = normalizeLivingClub(fixture.world.livingClub);
    const rival = living.regulars[0]!;
    const hidden = item("rival-hidden-vault", "DO NOT LEAK HOLDING", rival.id);
    const known = rival.backstory!.holdings[0]!;
    const world: World = {
      ...fixture.world,
      livingClub: {
        ...living,
        regulars: [{
          ...rival,
          backstory: {
            ...rival.backstory!,
            holdings: [known, hidden],
            knownHoldingIds: [known.id],
            revealedHistory: [{ id: "revealed-history", text: "Visible after the recorded round.", allowedTriggers: ["completed-round" as const], revealedBy: { kind: "completed-round" as const, roundId: "round-visible" } }],
            hiddenFacts: [{ id: "hidden-story", text: "DO NOT LEAK STORY", allowedTriggers: ["story" as const] }],
            rewardHooks: [{ id: "hidden-hook", name: "DO NOT LEAK REWARD", itemDefinitionId: hidden.definitionId }],
          },
          rivalProfile: { ...rival.rivalProfile!, knownHoldingIds: [known.id] },
        }],
      },
    };
    const people = visiblePlayerProPeople(world, world.playerPro!);
    const serialized = JSON.stringify(people);
    expect(serialized).toContain("Visible after the recorded round.");
    expect(serialized).toContain(known.name);
    expect(serialized).not.toContain("DO NOT LEAK");
    expect(people[0]?.knownHoldings.map((entry) => entry.id)).toEqual([known.id]);
    expect([...visibleRivalHoldingIds(world).get(rival.id)!]).toEqual([known.id]);
    expect(JSON.stringify(buildPlayerProSocialPresentation(world, world.playerPro!))).not.toContain("DO NOT LEAK");
  });

  it("derives world dressing only from owned/custodied visible selection and equipped carriers", () => {
    const visible = (id: string, category: InventoryItem["category"], equipped = false) => ({
      id,
      name: id,
      category,
      value: 1,
      prestige: 1,
      unique: false,
      confirmationRequired: false,
      equipped,
      escrowed: false,
      displayed: true,
      transferWarnings: [],
    });
    const display = buildPlayerProWorldDisplayPresentation({
      items: [
        visible("owned-vehicle", "vehicle"),
        visible("equipped-bag", "bag", true),
        visible("equipped-outfit", "outfit", true),
        visible("equipped-watch", "watch", true),
        visible("selected-trophy", "trophy"),
        visible("selected-keepsake", "keepsake"),
        visible("selected-stock", "plant-stock"),
        visible("selected-credit", "service-credit"),
      ],
      selectedVehicleId: "owned-vehicle",
      displayItemIds: ["selected-trophy", "selected-keepsake", "selected-stock", "selected-credit"],
      loadout: { bagItemId: "equipped-bag", outfitItemId: "equipped-outfit", watchItemId: "equipped-watch" },
    });

    expect(display.vehicle).toMatchObject({ id: "owned-vehicle", category: "vehicle" });
    expect(display.equipped.map((entry) => entry.category)).toEqual(["bag", "outfit", "watch"]);
    expect(display.collection.map((entry) => entry.category)).toEqual(["trophy", "keepsake", "plant-stock"]);
    expect(display.revision).not.toContain("service-credit");
  });

  it("removes a selected vehicle immediately when settlement moves it into rival custody", () => {
    const fixture = createZk725BrowserFixture(DEFAULT_WORLD);
    const career = fixture.world.playerPro!;
    const vehicle = item("player-selected-vehicle", "Player Selected Vehicle", career.identity.id, "vehicle", 80);
    const beforeCareer = {
      ...career,
      inventory: { ...career.inventory, items: [...career.inventory.items, vehicle], selectedVehicleId: vehicle.id },
    };
    const before = buildPlayerProSocialPresentation({ ...fixture.world, playerPro: beforeCareer }, beforeCareer)!;
    expect(before.worldDisplay.vehicle?.id).toBe(vehicle.id);

    const held = { ...vehicle, ownerId: "rival-one", custodianId: "rival-one" };
    const afterCareer = {
      ...beforeCareer,
      inventory: {
        ...beforeCareer.inventory,
        items: beforeCareer.inventory.items.filter((entry) => entry.id !== vehicle.id),
        selectedVehicleId: undefined,
      },
      rivalCustody: [{
        id: `custody:${vehicle.id}`,
        rivalId: "rival-one",
        rivalName: "Rival One",
        challengeId: "challenge-vehicle",
        settlementId: "settlement-vehicle",
        itemId: vehicle.id,
        itemSnapshot: held,
        acquiredWeek: 4,
        acquiredDay: 1,
        status: "held" as const,
      }],
    };
    const after = buildPlayerProSocialPresentation({ ...fixture.world, playerPro: afterCareer }, afterCareer)!;
    expect(after.worldDisplay.vehicle).toBeNull();
    expect(after.custody).toEqual([expect.objectContaining({ itemName: vehicle.name, status: "held" })]);
  });

  it("reports owned inventory/loadout, escrow fallback, 2–4 group support, custody, relationships, and collection provenance", () => {
    const fixture = createZk725BrowserFixture(DEFAULT_WORLD);
    const player = fixture.world.playerPro!;
    const outfit = item("player-heritage-outfit", "Player Heritage Outfit", player.identity.id, "outfit", 80);
    const reward: RewardEntitlement = {
      version: 1,
      id: "reward-visible",
      definitionId: "reward-visible-definition",
      name: "Visible Match Reward",
      kind: "authored-item",
      ownerId: player.identity.id,
      transferability: "transferable",
      initialQuantity: 1,
      remainingQuantity: 1,
      initialValue: 400,
      remainingValue: 400,
      status: "active",
      unlockConditions: [{ kind: "completed-match", outcome: "win" }],
      consumption: [],
      provenance: {
        rewardDefinitionId: "reward-visible-definition",
        grantingPersonId: "rival-one",
        grantingPersonName: "Rival One",
        authoredPersonId: "rival-one",
        occupation: "club-fitter",
        matchId: "match-visible",
        grantedWeek: 3,
        grantedDay: 2,
      },
      saveBehavior: "player-career",
    };
    const seededWorld = {
      ...fixture.world,
      playerPro: {
        ...player,
        inventory: { ...player.inventory, items: [...player.inventory.items, outfit] },
        equipmentLoadout: { ...player.equipmentLoadout, outfitItemId: outfit.id },
        rewardEntitlements: { version: 1 as const, entitlements: [reward], settlementLedger: [reward.id] },
      },
    };
    const setup = { teeSet: "member" as const, pinRotation: "A" as const };
    const draft: PlayerChallengeContractDraft = {
      opponentId: "rival-one",
      layoutId: activeCourseLayout(fixture.course).id,
      teamFormat: "four-ball",
      scoring: "net-match",
      participantSetups: { player: setup, rival: setup, playerPartner: setup, rivalPartner: setup },
      playerPartnerId: "partner-one",
      rivalPartnerId: "partner-two",
      playerCash: 0,
      rivalCash: 0,
      playerItemIds: ["player-prestige-club"],
      rivalItemIds: ["rival-prestige-club"],
      sideBets: [],
      ownerTransfersConfirmed: true,
      prestigeTransfersConfirmed: true,
      rivalTransfersConfirmed: true,
    };
    const started = startPlayerChallengeContract({ course: fixture.course, world: seededWorld, day: 2, draft });
    const custodyItem = item("player-held-keepsake", "Player Held Keepsake", "rival-one");
    const career = {
      ...started.career,
      rivalCustody: [{
        id: "custody-visible",
        rivalId: "rival-one",
        rivalName: "Rival One",
        challengeId: "challenge-visible",
        settlementId: "settlement-visible",
        rematchChallengeId: "rematch-visible",
        itemId: custodyItem.id,
        itemSnapshot: custodyItem,
        acquiredWeek: 3,
        acquiredDay: 2,
        status: "held" as const,
      }],
    };
    const presentation = buildPlayerProSocialPresentation({ ...started.world, playerPro: career }, career)!;
    expect(presentation.surfaces).toEqual(["people", "challenges", "teamBuilder", "equipment", "wardrobe", "collection", "custody"]);
    expect(presentation.teamBuilder.supportedGroupSizes).toEqual([2, 3, 4]);
    expect(presentation.teamBuilder.activeGroup?.golfers).toHaveLength(4);
    expect(presentation.inventory.escrowItemIds).toContain("player-prestige-club");
    expect(presentation.equipment.defaultFallbackApplies).toBe(true);
    expect(presentation.equipment.items.find((entry) => entry.id === "player-prestige-club")?.transferWarnings).toEqual([
      "unique-high-prestige",
      "default-loadout-fallback",
    ]);
    expect(presentation.wardrobe.equippedOutfitItemId).toBe(outfit.id);
    expect(presentation.challenge.runtime).toMatchObject({ phase: "escrowed", escrow: { player: { reservedCash: 0, itemIds: ["player-prestige-club"] } } });
    expect(presentation.custody[0]).toMatchObject({ id: "custody-visible", item: { name: "Player Held Keepsake" }, status: "held" });
    expect(presentation.relationships.find((entry) => entry.personId === "rival-one")).toMatchObject({ score: 20, tier: "acquaintance" });
    expect(presentation.collection.rewards[0]).toMatchObject({ name: "Visible Match Reward", grantingPersonId: "rival-one", matchId: "match-visible" });
  });

  it("omits transferred-away entitlements from the player's current collection", () => {
    const fixture = createZk725BrowserFixture(DEFAULT_WORLD);
    const career = fixture.world.playerPro!;
    const transferred: RewardEntitlement = {
      version: 1,
      id: "reward-transferred",
      definitionId: "reward-transferred-definition",
      name: "Transferred Match Reward",
      kind: "authored-item",
      ownerId: "rival-one",
      transferability: "transferable",
      initialQuantity: 1,
      remainingQuantity: 1,
      initialValue: 400,
      remainingValue: 400,
      status: "active",
      unlockConditions: [{ kind: "completed-match", outcome: "win" }],
      consumption: [],
      provenance: {
        rewardDefinitionId: "reward-transferred-definition",
        grantingPersonId: "rival-one",
        grantingPersonName: "Rival One",
        authoredPersonId: "rival-one",
        occupation: "club-fitter",
        matchId: "match-transferred",
        grantedWeek: 3,
        grantedDay: 2,
      },
      saveBehavior: "player-career",
    };
    const transferredCareer = {
      ...career,
      rewardEntitlements: { version: 1 as const, entitlements: [transferred], settlementLedger: [transferred.id] },
    };
    const presentation = buildPlayerProSocialPresentation({ ...fixture.world, playerPro: transferredCareer }, transferredCareer)!;
    expect(presentation.collection.rewards).toEqual([]);
    expect(presentation.people.find((person) => person.id === "rival-one")?.grantedRewardConnections).toEqual([
      expect.objectContaining({ id: transferred.id, name: transferred.name }),
    ]);
  });
});
