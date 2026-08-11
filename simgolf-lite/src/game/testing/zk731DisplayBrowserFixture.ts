import type { InventoryItem } from "../competition/types";
import type { World } from "../models/types";
import { createZk725BrowserFixture } from "./zk725BrowserFixture";

function item(id: string, name: string, ownerId: string, category: InventoryItem["category"]): InventoryItem {
  return {
    id,
    definitionId: id,
    name,
    category,
    ownerId,
    custodianId: ownerId,
    authoredValue: 500,
    remainingValue: 500,
    prestige: 40,
    unique: false,
    confirmationRequired: false,
    transferable: true,
    transferHistory: [],
    ...(category === "plant-stock" ? { remainingPlacements: 4, frozenInstallValueEach: 125, speciesId: "flower_native" } : {}),
  };
}

export function createZk731DisplayBrowserFixture(base: World) {
  const fixture = createZk725BrowserFixture(base);
  const career = fixture.world.playerPro!;
  const vehicle = item("zk731-roadster", "ZK-731 Roadster", career.identity.id, "vehicle");
  const bag = item("zk731-bag", "ZK-731 Bag", career.identity.id, "bag");
  const outfit = item("zk731-outfit", "ZK-731 Outfit", career.identity.id, "outfit");
  const watch = item("zk731-watch", "ZK-731 Watch", career.identity.id, "watch");
  const trophy = item("zk731-trophy", "ZK-731 Trophy", career.identity.id, "trophy");
  const keepsake = item("zk731-keepsake", "ZK-731 Keepsake", career.identity.id, "keepsake");
  const stock = item("zk731-stock", "ZK-731 Plant Stock", career.identity.id, "plant-stock");
  const playerPro = {
    ...career,
    inventory: {
      ...career.inventory,
      items: [...career.inventory.items, vehicle, bag, outfit, watch, trophy, keepsake, stock],
      selectedVehicleId: vehicle.id,
      displayItemIds: [trophy.id, keepsake.id, stock.id],
    },
    equipmentLoadout: {
      ...career.equipmentLoadout,
      bagItemId: bag.id,
      outfitItemId: outfit.id,
      watchItemId: watch.id,
    },
  };
  return { ...fixture, world: { ...fixture.world, playerPro } };
}

export function moveZk731DisplayVehicleToCustody(world: World): World {
  const career = world.playerPro;
  if (!career) return world;
  const vehicleId = career.inventory.selectedVehicleId;
  const vehicle = career.inventory.items.find((entry) => entry.id === vehicleId && entry.category === "vehicle");
  if (!vehicle) return world;
  const held = {
    ...vehicle,
    ownerId: "rival-one",
    custodianId: "rival-one",
    transferHistory: [...vehicle.transferHistory, {
      id: "zk731-display-settlement",
      week: world.week,
      day: 0,
      fromOwnerId: career.identity.id,
      toOwnerId: "rival-one",
      custodianId: "rival-one",
      reason: "stake" as const,
    }],
  };
  return {
    ...world,
    playerPro: {
      ...career,
      inventory: {
        ...career.inventory,
        items: career.inventory.items.filter((entry) => entry.id !== vehicle.id),
        selectedVehicleId: undefined,
      },
      rivalCustody: [...career.rivalCustody, {
        id: `zk731-display-custody:${vehicle.id}`,
        rivalId: "rival-one",
        rivalName: "Rival One",
        challengeId: "zk731-display-challenge",
        settlementId: "zk731-display-settlement",
        itemId: vehicle.id,
        itemSnapshot: held,
        acquiredWeek: world.week,
        acquiredDay: 0,
        status: "held" as const,
      }],
      settlementLedger: [...career.settlementLedger, "zk731-display-settlement"],
    },
  };
}
