import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import type { RegularGolfer } from "../livingClub/types";
import type { PersonOccupation } from "../livingClub/types";
import { assignPersonProfile } from "./characters";
import { emptyPlayerInventory } from "./inventory";
import { createNewGame } from "../gen/newGame";
import { createDefaultPlayerPro, normalizePlayerPro } from "../playerPro/playerPro";
import { canPlaceDecoration, decorationCost, decorationRemovalQuote } from "../models/decorations";
import { dailyPlantCareCost, defaultDecorationPlantId, plantWaterDemand } from "../models/plantRegistry";
import { applyPlantRewardPlacement, hasPlantRewardPlacement } from "./rewardPlacement";
import {
  consumePlantStock,
  consumeServiceCredit,
  emptyRewardEntitlementState,
  grantAuthoredReward,
  normalizeRewardEntitlementState,
  transferRewardEntitlement,
} from "./rewardEntitlements";

function regular(id: string): RegularGolfer {
  return {
    id,
    kind: "regular",
    name: `Person ${id}`,
    archetype: "casual",
    appearance: { portrait: "cap", palette: 1, accent: 2 },
    skill: .6,
    preferences: { pace: "balanced", challenge: "social", hospitality: "club" },
    loyalty: 50,
    visits: 8,
    rounds: 4,
    bestToPar: 3,
    member: false,
    relationship: { score: 70, tier: "friend", interactionIds: [] },
    memories: [],
    recentThoughts: [],
    history: [],
  };
}

function personFor(occupation: PersonOccupation): RegularGolfer {
  for (let index = 0; index < 2_000; index += 1) {
    const person = assignPersonProfile(regular(`reward-${index}`), 724);
    if (person.backstory?.occupation === occupation) return person;
  }
  throw new Error(`No deterministic fixture for ${occupation}`);
}

function grant(person: RegularGolfer, matchId = "match-1", biome: "parkland" | "links" | "desert" = "parkland") {
  return grantAuthoredReward({
    assets: { inventory: emptyPlayerInventory("player"), rewards: emptyRewardEntitlementState() },
    person,
    hookId: person.backstory!.rewardHooks[0].id,
    ownerId: "player",
    context: { matchId, completed: true, outcome: "win", relationshipTier: "friend", week: 8, day: 2, biome },
  });
}

describe("ZK-724 finite authored reward entitlements", () => {
  it("audits every occupation hook for gates, finite value, save behavior, and person/match provenance", () => {
    const occupations: PersonOccupation[] = [
      "nursery-horticulture", "club-fitter", "instructor", "landscaper-agronomist",
      "contractor-builder", "restaurateur-chef", "tailor-apparel", "mechanic-dealer",
      "jeweler-watch-collector", "card-dealer-casino-host", "hotelier-event-organizer",
      "photographer-artist",
    ];
    for (const occupation of occupations) {
      const person = personFor(occupation);
      const failed = grantAuthoredReward({
        assets: { inventory: emptyPlayerInventory("player"), rewards: emptyRewardEntitlementState() },
        person,
        hookId: person.backstory!.rewardHooks[0].id,
        ownerId: "player",
        context: { matchId: `loss-${occupation}`, completed: true, outcome: "loss", relationshipTier: "friend", week: 1, day: 0, biome: "parkland" },
      });
      expect(failed.ok).toBe(false);
      const result = grant(person, `win-${occupation}`);
      expect(result.ok).toBe(true);
      expect(result.entitlement).toMatchObject({
        version: 1,
        ownerId: "player",
        saveBehavior: "player-career",
        initialQuantity: expect.any(Number),
        remainingQuantity: expect.any(Number),
        unlockConditions: expect.arrayContaining([expect.objectContaining({ kind: "completed-match" })]),
        provenance: {
          grantingPersonId: person.id,
          grantingPersonName: person.name,
          authoredPersonId: person.backstory!.authoredId,
          occupation,
          matchId: `win-${occupation}`,
          rewardDefinitionId: person.backstory!.rewardHooks[0].id,
          grantedWeek: 8,
          grantedDay: 2,
        },
      });
      expect(Number.isFinite(result.entitlement!.remainingValue)).toBe(true);
    }
  });

  it("grants biome-appropriate stock and consumes one zero-install placement exactly once", () => {
    const granted = grant(personFor("nursery-horticulture"), "nursery-win", "desert");
    const entitlement = granted.entitlement!;
    expect(entitlement).toMatchObject({ kind: "plant-stock", biome: "desert", speciesId: "desert-xeric-bed", remainingQuantity: 8 });
    const first = consumePlantStock({
      assets: granted,
      entitlementId: entitlement.id,
      consumptionId: "place-1",
      speciesId: "desert-xeric-bed",
      biome: "desert",
      week: 9,
      day: 1,
      installationCost: 275,
    });
    expect(first).toMatchObject({ ok: true, appliedValue: 275, entitlement: { remainingQuantity: 7, status: "active" } });
    expect(first.entitlement?.consumption[0].note).toContain("care, water, seasonality, removal, and salvage remain unchanged");
    const duplicate = consumePlantStock({
      assets: first,
      entitlementId: entitlement.id,
      consumptionId: "place-1",
      speciesId: "desert-xeric-bed",
      biome: "desert",
      week: 9,
      day: 1,
      installationCost: 275,
    });
    expect(duplicate.entitlement?.remainingQuantity).toBe(7);
    expect(duplicate.appliedValue).toBe(0);
    let current = duplicate;
    for (let index = 2; index <= 8; index += 1) current = consumePlantStock({
      assets: current,
      entitlementId: entitlement.id,
      consumptionId: `place-${index}`,
      speciesId: "desert-xeric-bed",
      biome: "desert",
      week: 9,
      day: index % 7,
      installationCost: 275,
    });
    expect(current.entitlement).toMatchObject({ remainingQuantity: 0, remainingValue: 0, status: "consumed" });
    expect(current.inventory.items[0]).toMatchObject({ remainingPlacements: 0, remainingValue: 0 });
  });

  it("integrates plant stock with core placement while preserving ordinary ongoing economics", () => {
    const run = createNewGame({ mode: "sandbox", courseName: "Reward Course", seed: 724, theme: "desert", difficulty: "normal" });
    const career = createDefaultPlayerPro({ seed: 724, name: "Reward Tester" });
    const granted = grantAuthoredReward({
      assets: { inventory: career.inventory, rewards: career.rewardEntitlements },
      person: personFor("nursery-horticulture"),
      hookId: personFor("nursery-horticulture").backstory!.rewardHooks[0].id,
      ownerId: career.identity.id,
      context: { matchId: "integration-win", completed: true, outcome: "win", relationshipTier: "friend", week: 1, day: 0, biome: "desert" },
    });
    const plantId = defaultDecorationPlantId("desert", "flower_bed");
    let decoration: { kind: "flower_bed"; x: number; y: number; rotation: 0; plantId: typeof plantId; origin: "player" } | undefined;
    for (let y = 0; y < run.course.height && !decoration; y += 1) for (let x = 0; x < run.course.width && !decoration; x += 1) {
      const candidate = { kind: "flower_bed" as const, x, y, rotation: 0 as const, plantId, origin: "player" as const };
      if (canPlaceDecoration(run.course, candidate).ok) decoration = candidate;
    }
    expect(decoration).toBeDefined();
    const installCost = decorationCost(decoration!, "desert", 1);
    expect(installCost).toBeGreaterThan(0);
    globalThis.__ccRP = undefined;
    const ordinary = {
      course: run.course,
      world: { ...run.world, cash: installCost, playerPro: career },
      selectedTerrain: "fairway" as const,
      terrainVersion: 0,
      obstaclesVersion: 0,
      markersVersion: 0,
      economyVersion: 0,
    };
    const paid = applyAction(ordinary, { type: "PLACE_DECORATION", decoration: decoration! });
    expect(paid.course.decorations).toHaveLength((ordinary.course.decorations?.length ?? 0) + 1);
    expect(paid.world.cash).toBe(0);
    const unfunded = applyAction({ ...ordinary, world: { ...ordinary.world, cash: 0 } }, { type: "PLACE_DECORATION", decoration: decoration! });
    expect(unfunded.course.decorations).toHaveLength(ordinary.course.decorations?.length ?? 0);
    expect(unfunded.world.cash).toBe(0);

    globalThis.__ccRP = { apply: applyPlantRewardPlacement, eligible: hasPlantRewardPlacement };
    const state = {
      course: run.course,
      world: { ...run.world, cash: 0, playerPro: { ...career, inventory: granted.inventory, rewardEntitlements: granted.rewards } },
      selectedTerrain: "fairway" as const,
      terrainVersion: 0,
      obstaclesVersion: 0,
      markersVersion: 0,
      economyVersion: 0,
    };
    const placed = applyAction(state, { type: "PLACE_DECORATION", decoration: decoration! });
    expect(placed.world.cash).toBe(0);
    expect(placed.course.decorations?.at(-1)).toMatchObject({ plantId, origin: "player" });
    expect(placed.world.playerPro?.rewardEntitlements.entitlements[0]).toMatchObject({ remainingQuantity: 7 });
    expect(dailyPlantCareCost("desert", plantId)).toBeGreaterThan(0);
    expect(plantWaterDemand("desert", plantId)).toBeGreaterThan(0);
    expect(decorationRemovalQuote(placed.course.decorations!.at(-1)!, "desert", 1).net).not.toBe(0);

    let second: typeof decoration;
    for (let y = 0; y < placed.course.height && !second; y += 1) for (let x = 0; x < placed.course.width && !second; x += 1) {
      const candidate = { kind: "flower_bed" as const, x, y, rotation: 0 as const, plantId, origin: "player" as const };
      if (canPlaceDecoration(placed.course, candidate).ok) second = candidate;
    }
    const nextPlacement = applyAction(placed, { type: "PLACE_DECORATION", decoration: second! });
    expect(nextPlacement.course.decorations).toHaveLength(placed.course.decorations!.length + 1);
    expect(nextPlacement.world.playerPro?.rewardEntitlements.entitlements[0]).toMatchObject({ remainingQuantity: 6 });
  });

  it("decrements scoped credits partially and fully without becoming a universal discount", () => {
    const granted = grant(personFor("contractor-builder"), "builder-win");
    const entitlement = granted.entitlement!;
    expect(entitlement).toMatchObject({ kind: "service-credit", serviceScope: "construction", remainingValue: 1200 });
    const wrong = consumeServiceCredit({ assets: granted, entitlementId: entitlement.id, consumptionId: "wrong", scope: "turf-care", week: 9, day: 0, charge: 500 });
    expect(wrong.ok).toBe(false);
    expect(wrong.rewards).toBe(granted.rewards);
    const partial = consumeServiceCredit({ assets: granted, entitlementId: entitlement.id, consumptionId: "build-1", scope: "construction", week: 9, day: 0, charge: 450 });
    expect(partial).toMatchObject({ appliedValue: 450, entitlement: { remainingValue: 750, status: "active" } });
    const full = consumeServiceCredit({ assets: partial, entitlementId: entitlement.id, consumptionId: "build-2", scope: "construction", week: 9, day: 1, charge: 2_000 });
    expect(full).toMatchObject({ appliedValue: 750, entitlement: { remainingValue: 0, remainingQuantity: 0, status: "consumed" } });
    expect(full.entitlement?.consumption[1].note).toContain("no recurring discount or upkeep waiver");
  });

  it("transfers allowed finite rewards, blocks knowledge transfer, reloads, and settles duplicate grants idempotently", () => {
    const tangible = grant(personFor("club-fitter"), "fitter-win");
    const transferred = transferRewardEntitlement({ assets: tangible, entitlementId: tangible.entitlement!.id, transferId: "gift-1", toOwnerId: "friend", week: 10, day: 3 });
    expect(transferred).toMatchObject({ ok: true, entitlement: { ownerId: "friend", status: "active", consumption: [expect.objectContaining({ id: "gift-1", system: "transfer" })] } });
    expect(transferred.inventory.items[0]).toMatchObject({ ownerId: "friend", custodianId: "friend" });
    const duplicateTransfer = transferRewardEntitlement({ assets: transferred, entitlementId: tangible.entitlement!.id, transferId: "gift-1", toOwnerId: "friend", week: 10, day: 3 });
    expect(duplicateTransfer.ok).toBe(true);
    expect(duplicateTransfer.entitlement).toBe(transferred.entitlement);

    const plant = grant(personFor("nursery-horticulture"), "plant-gift", "desert");
    const giftedPlant = transferRewardEntitlement({ assets: plant, entitlementId: plant.entitlement!.id, transferId: "plant-transfer", toOwnerId: "friend", week: 10, day: 3 });
    const consumedGift = consumePlantStock({
      assets: giftedPlant,
      entitlementId: plant.entitlement!.id,
      consumptionId: "friend-planting",
      speciesId: plant.entitlement!.speciesId!,
      biome: "desert",
      week: 10,
      day: 4,
      installationCost: 275,
    });
    expect(consumedGift).toMatchObject({ ok: true, entitlement: { ownerId: "friend", status: "active", remainingQuantity: 7 } });
    expect(consumedGift.entitlement?.consumption.map((entry) => entry.id)).toEqual(["plant-transfer", "friend-planting"]);
    expect(consumedGift.inventory.items[0]).toMatchObject({ ownerId: "friend", custodianId: "friend", remainingPlacements: 7 });

    const knowledge = grant(personFor("instructor"), "lesson-win");
    expect(knowledge.entitlement).toMatchObject({
      kind: "mentor-hook",
      nonTransferableKind: "learned-technique",
      techniqueId: "fairway-finder",
      transferability: "non-transferable",
    });
    expect(transferRewardEntitlement({ assets: knowledge, entitlementId: knowledge.entitlement!.id, transferId: "bad-gift", toOwnerId: "friend", week: 10, day: 3 }).ok).toBe(false);

    const tailored = grant(personFor("tailor-apparel"), "tailor-win");
    expect(tailored.entitlement).toMatchObject({
      kind: "profile-unlock",
      nonTransferableKind: "profile-unlock",
      profileStyleId: "heritage-tailored",
      transferability: "non-transferable",
      inventoryItemId: expect.any(String),
    });
    expect(tailored.inventory.items[0]).toMatchObject({ definitionId: "heritage-outfit", ownerId: "player" });

    const reloaded = normalizeRewardEntitlementState(JSON.parse(JSON.stringify(tangible.rewards)), "player");
    expect(reloaded).toEqual(tangible.rewards);
    const person = personFor("club-fitter");
    const duplicateGrant = grantAuthoredReward({
      assets: tangible,
      person,
      hookId: person.backstory!.rewardHooks[0].id,
      ownerId: "player",
      context: { matchId: "fitter-win", completed: true, outcome: "win", relationshipTier: "friend", week: 8, day: 2, biome: "parkland" },
    });
    expect(duplicateGrant.rewards).toBe(tangible.rewards);
    expect(duplicateGrant.inventory).toBe(tangible.inventory);

    const career = createDefaultPlayerPro({ seed: 724, name: "Reload Tester" });
    const careerPerson = personFor("club-fitter");
    const careerGrant = grantAuthoredReward({
      assets: { inventory: career.inventory, rewards: career.rewardEntitlements },
      person: careerPerson,
      hookId: careerPerson.backstory!.rewardHooks[0].id,
      ownerId: career.identity.id,
      context: { matchId: "career-reload", completed: true, outcome: "win", relationshipTier: "friend", week: 8, day: 2, biome: "parkland" },
    });
    const careerReload = normalizePlayerPro(JSON.parse(JSON.stringify({
      ...career,
      inventory: careerGrant.inventory,
      rewardEntitlements: careerGrant.rewards,
    })), { seed: 724 });
    expect(careerReload.rewardEntitlements).toEqual(careerGrant.rewards);
    expect(careerReload.inventory).toEqual(careerGrant.inventory);
    expect(normalizeRewardEntitlementState(JSON.parse(JSON.stringify(tailored.rewards)), "player")).toEqual(tailored.rewards);
    const hostileReload = normalizePlayerPro({
      ...career,
      rewardEntitlements: { version: 1, entitlements: [{}], settlementLedger: ["truthy-malformed"] },
    }, { seed: 724 });
    expect(hostileReload.rewardEntitlements).toEqual({ version: 1, entitlements: [], settlementLedger: [] });
  });

  it("derives casino-host capacity only from the authored licensed holding", () => {
    const host = personFor("card-dealer-casino-host");
    const granted = grant(host, "host-win");
    expect(granted.entitlement).toMatchObject({ kind: "casino-host-capacity", capability: "casino-host-capacity" });
    const stripped = {
      ...host,
      backstory: { ...host.backstory!, holdings: host.backstory!.holdings.map((holding) => ({ ...holding, capabilities: [] })) },
    };
    expect(grant(stripped, "host-unlicensed").ok).toBe(false);
  });
});
