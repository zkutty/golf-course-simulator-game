import { normalizeLivingClub } from "../livingClub/livingClub";
import type { RegularGolfer } from "../livingClub/types";
import type { World } from "../models/types";
import type { PlayerProCareer } from "../models/playerProTypes";
import { normalizePeopleProfiles } from "../competition/characters";
import { inventoryItemValue } from "../competition/inventory";
import type { InventoryItem } from "../competition/types";
import { challengeGroupRoundTextState } from "../competition/challengeGroupRoundText";

export type PlayerProSocialSurface = "people" | "challenges" | "teamBuilder" | "equipment" | "wardrobe" | "collection" | "custody";

export interface SocialItemPresentation {
  id: string;
  name: string;
  category: InventoryItem["category"];
  value: number;
  prestige: number;
  unique: boolean;
  confirmationRequired: boolean;
  equipped: boolean;
  escrowed: boolean;
  displayed: boolean;
  transferWarnings: readonly ("unique-high-prestige" | "default-loadout-fallback")[];
}

export interface SocialPersonPresentation {
  id: string;
  name: string;
  archetype: RegularGolfer["archetype"];
  member: boolean;
  occupation: string | null;
  communityRole: string | null;
  biography: string | null;
  relationship: RegularGolfer["relationship"];
  rounds: number;
  handicap: number | null;
  preferredFormats: readonly string[];
  revealedHistory: readonly { id: string; text: string; revealedBy: string }[];
  knownHoldings: readonly SocialItemPresentation[];
  pastMatches: readonly {
    id: string;
    kind: string;
    status: string;
    result: string | null;
    relationship: number;
  }[];
  grantedRewardConnections: readonly { id: string; name: string; kind: string; status: string }[];
}

export interface PlayerProWorldDisplayItem {
  readonly id: string;
  readonly name: string;
  readonly category: "bag" | "outfit" | "watch" | "vehicle" | "trophy" | "keepsake" | "plant-stock";
}

/**
 * Visibility-safe world-render input. Its source is already-filtered player
 * presentation data rather than the career, rival profiles, or reward hooks.
 */
export interface PlayerProWorldDisplayPresentation {
  readonly revision: string;
  readonly vehicle: PlayerProWorldDisplayItem | null;
  readonly equipped: readonly PlayerProWorldDisplayItem[];
  readonly collection: readonly PlayerProWorldDisplayItem[];
}

export interface PlayerProWorldDisplaySource {
  readonly items: readonly SocialItemPresentation[];
  readonly selectedVehicleId?: string | null;
  readonly displayItemIds: readonly string[];
  readonly loadout: {
    readonly bagItemId?: string | null;
    readonly outfitItemId?: string | null;
    readonly watchItemId?: string | null;
  };
}

const WORLD_DISPLAY_COLLECTION_CATEGORIES = new Set<InventoryItem["category"]>([
  "trophy", "keepsake", "plant-stock",
]);

export function buildPlayerProWorldDisplayPresentation(
  source: PlayerProWorldDisplaySource,
): PlayerProWorldDisplayPresentation {
  const itemById = new Map(source.items.map((item) => [item.id, item]));
  const visible = (id: string | null | undefined, category: PlayerProWorldDisplayItem["category"]): PlayerProWorldDisplayItem | null => {
    const item = id ? itemById.get(id) : undefined;
    return item?.category === category
      ? { id: item.id, name: item.name, category }
      : null;
  };
  const vehicle = visible(source.selectedVehicleId, "vehicle");
  const equipped = [
    visible(source.loadout.bagItemId, "bag"),
    visible(source.loadout.outfitItemId, "outfit"),
    visible(source.loadout.watchItemId, "watch"),
  ].filter((item): item is PlayerProWorldDisplayItem => item !== null);
  const collection = [...new Set(source.displayItemIds)]
    .map((id) => itemById.get(id))
    .filter((item): item is SocialItemPresentation => item !== undefined && WORLD_DISPLAY_COLLECTION_CATEGORIES.has(item.category))
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category as PlayerProWorldDisplayItem["category"],
    }));
  const revision = [vehicle, ...equipped, ...collection]
    .map((item) => item ? `${item.category}:${item.id}` : "vehicle:none")
    .join("|");
  return { revision, vehicle, equipped, collection };
}

function isEquipped(career: PlayerProCareer, item: InventoryItem): boolean {
  const loadout = career.equipmentLoadout;
  return loadout.clubItemIds.includes(item.id)
    || loadout.bagItemId === item.id
    || loadout.outfitItemId === item.id
    || loadout.watchItemId === item.id;
}

function itemPresentation(career: PlayerProCareer, item: InventoryItem): SocialItemPresentation {
  const equipped = isEquipped(career, item);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    value: inventoryItemValue(item),
    prestige: item.prestige,
    unique: item.unique,
    confirmationRequired: item.confirmationRequired,
    equipped,
    escrowed: career.inventory.escrowItemIds.includes(item.id),
    displayed: career.inventory.displayItemIds.includes(item.id),
    transferWarnings: [
      ...(item.unique || item.prestige >= 75 || item.confirmationRequired ? ["unique-high-prestige" as const] : []),
      ...(equipped ? ["default-loadout-fallback" as const] : []),
    ],
  };
}

function personPresentation(regular: RegularGolfer, career: PlayerProCareer): SocialPersonPresentation {
  const backstory = regular.backstory;
  const knownIds = new Set(backstory?.knownHoldingIds ?? []);
  const knownHoldings = (backstory?.holdings ?? [])
    .filter((item) => knownIds.has(item.id))
    .map((item) => itemPresentation(career, item));
  return {
    id: regular.id,
    name: regular.name,
    archetype: regular.archetype,
    member: regular.member,
    occupation: backstory?.occupation ?? null,
    communityRole: backstory?.communityRole ?? null,
    biography: backstory?.publicBiography ?? null,
    relationship: { ...regular.relationship, interactionIds: [...regular.relationship.interactionIds] },
    rounds: regular.rounds,
    // Regular skill is not a handicap authority. Only frozen challenge-group
    // handicap snapshots may populate this field below.
    handicap: career.activeChallengeGroupRound?.golfers.find((golfer) => golfer.id === regular.id)?.handicap.handicapIndex ?? null,
    preferredFormats: [...(regular.rivalProfile?.preferredFormats ?? [])],
    revealedHistory: (backstory?.revealedHistory ?? []).map((fact) => ({
      id: fact.id,
      text: fact.text,
      revealedBy: fact.revealedBy?.kind ?? "revealed",
    })),
    knownHoldings,
    pastMatches: career.challenges.filter((challenge) => challenge.opponentId === regular.id).map((challenge) => ({
      id: challenge.id,
      kind: challenge.kind,
      status: challenge.status,
      result: challenge.result ?? challenge.challengeSettlement?.evidence.kind ?? null,
      relationship: challenge.relationship,
    })),
    // Retained entitlement provenance may evidence a historical grant even
    // after transfer. Raw rewardHooks are never consulted because their
    // connection may still be hidden.
    grantedRewardConnections: career.rewardEntitlements.entitlements
      .filter((reward) => reward.provenance.grantingPersonId === regular.id)
      .map((reward) => ({ id: reward.id, name: reward.name, kind: reward.kind, status: reward.status })),
  };
}

export function visiblePlayerProPeople(world: World, career: PlayerProCareer = world.playerPro!): readonly SocialPersonPresentation[] {
  if (!career) return [];
  const living = normalizePeopleProfiles(normalizeLivingClub(world.livingClub), world.runSeed);
  return living.regulars.map((regular) => personPresentation(regular, career));
}

/** Presentation-only filter. The accepted-contract command retains its own authority. */
export function visibleRivalHoldingIds(world: World): ReadonlyMap<string, ReadonlySet<string>> {
  const living = normalizePeopleProfiles(normalizeLivingClub(world.livingClub), world.runSeed);
  return new Map(living.regulars.map((regular) => [regular.id, new Set(regular.backstory?.knownHoldingIds ?? [])]));
}

export function buildPlayerProSocialPresentation(world: World, career: PlayerProCareer = world.playerPro!) {
  if (!career) return null;
  const people = visiblePlayerProPeople(world, career);
  const owned = career.inventory.items
    .filter((item) => item.ownerId === career.identity.id && item.custodianId === career.identity.id)
    .map((item) => itemPresentation(career, item));
  const equipment = owned.filter((item) => item.category === "club" || item.category === "bag" || item.category === "watch");
  const wardrobe = owned.filter((item) => item.category === "outfit");
  const collectionItems = owned.filter((item) => item.displayed || item.category === "trophy" || item.category === "keepsake" || item.category === "vehicle");
  const runtime = career.activeChallengeRuntime;
  const playerEscrow = runtime?.escrow?.parties.find((party) => party.captainId === career.identity.id) ?? null;
  const activeGroup = career.activeChallengeGroupRound ? challengeGroupRoundTextState(career.activeChallengeGroupRound) : null;
  const worldDisplay = buildPlayerProWorldDisplayPresentation({
    items: owned,
    selectedVehicleId: career.inventory.selectedVehicleId,
    displayItemIds: career.inventory.displayItemIds,
    loadout: career.equipmentLoadout,
  });
  return {
    surfaces: ["people", "challenges", "teamBuilder", "equipment", "wardrobe", "collection", "custody"] as const,
    people,
    relationships: people.map((person) => ({ personId: person.id, name: person.name, ...person.relationship })),
    teamBuilder: {
      supportedGroupSizes: [2, 3, 4] as const,
      candidates: people.map((person) => ({ id: person.id, name: person.name, relationship: person.relationship, handicap: person.handicap, preferredFormats: person.preferredFormats })),
      activeGroup,
    },
    inventory: {
      ownerId: career.inventory.ownerId,
      items: owned,
      escrowItemIds: [...career.inventory.escrowItemIds],
      displayItemIds: [...career.inventory.displayItemIds],
      selectedVehicleId: career.inventory.selectedVehicleId ?? null,
    },
    loadout: { ...career.equipmentLoadout, clubItemIds: [...career.equipmentLoadout.clubItemIds] },
    escrow: playerEscrow ? {
      reservedCash: playerEscrow.reservedCash,
      itemIds: [...playerEscrow.itemIds],
      defaultLoadoutAfterTransfer: playerEscrow.defaultLoadoutAfterTransfer,
    } : null,
    equipment: {
      items: equipment,
      loadout: { ...career.equipmentLoadout, clubItemIds: [...career.equipmentLoadout.clubItemIds] },
      defaultFallbackApplies: equipment.some((item) => item.equipped && item.escrowed),
    },
    wardrobe: {
      items: wardrobe,
      equippedOutfitItemId: career.equipmentLoadout.outfitItemId ?? null,
    },
    collection: {
      items: collectionItems,
      itemIds: collectionItems.map((item) => item.id),
      careerTrophies: career.trophies.map((trophy) => ({ ...trophy })),
      rewards: career.rewardEntitlements.entitlements.filter((reward) => reward.ownerId === career.identity.id).map((reward) => ({
        id: reward.id,
        name: reward.name,
        kind: reward.kind,
        status: reward.status,
        remainingQuantity: reward.remainingQuantity,
        remainingValue: reward.remainingValue,
        grantingPersonId: reward.provenance.grantingPersonId,
        grantingPersonName: reward.provenance.grantingPersonName,
        matchId: reward.provenance.matchId,
      })),
    },
    worldDisplay,
    challenge: {
      runtime: runtime ? {
        id: runtime.id,
        phase: runtime.phase,
        format: runtime.contract.terms.format,
        teams: runtime.contract.terms.teams.map((team) => ({ ...team, partnerIds: [...team.partnerIds], participantIds: [...team.participantIds] })),
        participantSetups: runtime.contract.terms.participantSetups.map((setup) => ({ ...setup })),
        sideBets: runtime.contract.terms.sideBets.map((sideBet) => ({ ...sideBet, holeIds: [...sideBet.holeIds] })),
        escrow: runtime.escrow ? {
          id: runtime.escrow.id,
          status: runtime.escrow.status,
          reservedAt: runtime.escrow.reservedAt,
          player: playerEscrow ? {
            reservedCash: playerEscrow.reservedCash,
            itemIds: [...playerEscrow.itemIds],
            defaultLoadoutAfterTransfer: playerEscrow.defaultLoadoutAfterTransfer,
          } : null,
        } : null,
        firstShot: runtime.firstShot,
        cancellation: runtime.cancellation,
      } : null,
      history: career.challenges.filter((challenge) => challenge.challengeContractId || challenge.challengeSettlement).map((challenge) => ({
        id: challenge.id,
        opponentId: challenge.opponentId,
        opponentName: challenge.opponentName,
        status: challenge.status,
        result: challenge.result ?? null,
        settlement: challenge.challengeSettlement ? {
          id: challenge.challengeSettlement.id,
          kind: challenge.challengeSettlement.evidence.kind,
          transferredItemIds: challenge.challengeSettlement.transferredItems.map((transfer) => transfer.itemId),
        } : null,
      })),
    },
    custody: career.rivalCustody.map((entry) => ({
      id: entry.id,
      rivalId: entry.rivalId,
      rivalName: entry.rivalName,
      challengeId: entry.challengeId,
      settlementId: entry.settlementId ?? null,
      rematchChallengeId: entry.rematchChallengeId ?? null,
      status: entry.status,
      item: itemPresentation(career, entry.itemSnapshot),
      itemName: entry.itemSnapshot.name,
      acquiredWeek: entry.acquiredWeek,
      acquiredDay: entry.acquiredDay,
      recoveredWeek: entry.recoveredWeek ?? null,
      recoveredDay: entry.recoveredDay ?? null,
    })),
  };
}

export type PlayerProSocialPresentation = NonNullable<ReturnType<typeof buildPlayerProSocialPresentation>>;
