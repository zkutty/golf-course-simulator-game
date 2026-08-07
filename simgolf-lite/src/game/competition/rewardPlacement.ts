import type { PlayerProCareer } from "../models/playerProTypes";
import type { LandTheme } from "../models/biomes";
import type { PlantId } from "../models/plantTypes";

interface PlantRewardPlacementArgs {
  speciesId: PlantId;
  biome: LandTheme;
  x: number;
  y: number;
  week: number;
  installationCost: number;
}

type PlantRewardPlacementResolver = (career: PlayerProCareer, args: PlantRewardPlacementArgs) => { career: PlayerProCareer; applied: boolean };

declare global {
  // Installed by this preloaded issue-local chunk; callers use ordinary paid placement before it resolves.
  var __ccRP: {
    apply: PlantRewardPlacementResolver;
    eligible: (career: PlayerProCareer, speciesId: PlantId, biome: LandTheme) => boolean;
  } | undefined;
}

export const applyPlantRewardPlacement: PlantRewardPlacementResolver = (career, args) => {
  const reward = career.rewardEntitlements.entitlements.find((entry) => entry.kind === "plant-stock" && entry.status === "active"
    && entry.remainingQuantity > 0 && entry.speciesId === args.speciesId && entry.biome === args.biome);
  if (!reward || (reward.inventoryItemId && career.inventory.escrowItemIds.includes(reward.inventoryItemId))) return { career, applied: false };
  const consumptionId = `plant:${reward.id}:${reward.consumption.length}:${args.x}:${args.y}`;
  const remainingQuantity = reward.remainingQuantity - 1;
  const next = {
    ...reward,
    remainingQuantity,
    remainingValue: Math.max(0, reward.remainingValue - (reward.installationValueEach ?? 0)),
    status: remainingQuantity === 0 ? "consumed" as const : "active" as const,
    consumption: [...reward.consumption, {
      id: consumptionId,
      week: args.week,
      day: 0,
      system: "plant-installation" as const,
      quantity: 1,
      value: Math.max(0, Math.round(args.installationCost)),
      note: "Installation only; ordinary plant care and removal economics remain.",
    }].slice(-80),
  };
  return {
    applied: true,
    career: {
      ...career,
      inventory: {
        ...career.inventory,
        items: career.inventory.items.map((item) => item.id === next.inventoryItemId
          ? { ...item, remainingPlacements: next.remainingQuantity, remainingValue: next.remainingValue }
          : item),
      },
      rewardEntitlements: {
        ...career.rewardEntitlements,
        entitlements: career.rewardEntitlements.entitlements.map((entry) => entry.id === next.id ? next : entry),
      },
    },
  };
};

export function hasPlantRewardPlacement(career: PlayerProCareer, speciesId: PlantId, biome: LandTheme): boolean {
  return career.rewardEntitlements.entitlements.some((entry) => entry.kind === "plant-stock" && entry.status === "active"
    && entry.remainingQuantity > 0 && entry.speciesId === speciesId && entry.biome === biome
    && (!entry.inventoryItemId || !career.inventory.escrowItemIds.includes(entry.inventoryItemId)));
}

globalThis.__ccRP = { apply: applyPlantRewardPlacement, eligible: hasPlantRewardPlacement };
