import { transferItem, type CareerAssets } from "./inventory";

export function recoverRivalItem(args: {
  assets: CareerAssets;
  custodyId: string;
  settlementId: string;
  playerId: string;
  week: number;
  day: number;
}): CareerAssets {
  if (args.assets.settlementLedger.includes(args.settlementId)) return args.assets;
  const custody = args.assets.rivalCustody.find((entry) => entry.id === args.custodyId && entry.status === "held");
  if (!custody) throw new Error("Rival-held item is not available for recovery.");
  if (args.assets.inventory.items.some((item) => item.id === custody.itemId)) throw new Error("Recovery would duplicate an existing inventory item.");
  const recovered = transferItem(custody.itemSnapshot, {
    transferId: args.settlementId,
    toOwnerId: args.playerId,
    custodianId: args.playerId,
    week: args.week,
    day: args.day,
    reason: "recovery",
  });
  return {
    ...args.assets,
    inventory: { ...args.assets.inventory, items: [...args.assets.inventory.items, recovered] },
    rivalCustody: args.assets.rivalCustody.map((entry) => entry.id === custody.id ? {
      ...entry,
      status: "recovered" as const,
      recoveredWeek: args.week,
      recoveredDay: args.day,
    } : entry),
    settlementLedger: [...args.assets.settlementLedger, args.settlementId],
  };
}
