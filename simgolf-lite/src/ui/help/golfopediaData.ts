import type { Terrain } from "../../game/models/types";
import { ARCHETYPES } from "../../game/live/archetypes";
import { TERRAIN_BUILD_COST, TERRAIN_MAINT_WEIGHT, TERRAIN_SALVAGE_VALUE } from "../../game/models/terrainEconomics";
import type { Translator } from "../../i18n/context";
import { translate } from "../../i18n/core";
import { formatCurrency, formatNumber } from "../../i18n/format";
import type { MessageKey } from "../../i18n/catalog";

export type GolfopediaSection = "Terrain" | "Golfers" | "Management" | "Controls";
export interface GolfopediaEntry { id: string; section: GolfopediaSection; title: string; summary: string; details: string[]; facts?: { label: string; value: string }[]; }

const terrainKeys: Record<Terrain, { title: MessageKey; summary: MessageKey }> = {
  fairway: { title: "golfopedia.terrain.fairway.title", summary: "golfopedia.terrain.fairway.summary" },
  rough: { title: "golfopedia.terrain.rough.title", summary: "golfopedia.terrain.rough.summary" },
  deep_rough: { title: "golfopedia.terrain.deepRough.title", summary: "golfopedia.terrain.deepRough.summary" },
  sand: { title: "golfopedia.terrain.sand.title", summary: "golfopedia.terrain.sand.summary" },
  waste_area: { title: "golfopedia.terrain.wasteArea.title", summary: "golfopedia.terrain.wasteArea.summary" },
  water: { title: "golfopedia.terrain.water.title", summary: "golfopedia.terrain.water.summary" },
  wetland: { title: "golfopedia.terrain.wetland.title", summary: "golfopedia.terrain.wetland.summary" },
  green: { title: "golfopedia.terrain.green.title", summary: "golfopedia.terrain.green.summary" },
  tee: { title: "golfopedia.terrain.tee.title", summary: "golfopedia.terrain.tee.summary" },
  path: { title: "golfopedia.terrain.path.title", summary: "golfopedia.terrain.path.summary" },
};
const golferLabelKeys = { pro: "golfer.pro", lowHandicap: "golfer.lowHandicap", casual: "golfer.casual", senior: "golfer.senior", junior: "golfer.junior", tourist: "golfer.tourist" } as const;

export function buildGolfopediaEntries(t: Translator): readonly GolfopediaEntry[] {
  const terrainEntries = (Object.keys(terrainKeys) as Terrain[]).map((terrain) => ({
    id: `terrain-${terrain}`, section: "Terrain" as const, title: t(terrainKeys[terrain].title), summary: t(terrainKeys[terrain].summary),
    details: [t("golfopedia.terrain.balance"), t("golfopedia.terrain.maintenance", { weight: TERRAIN_MAINT_WEIGHT[terrain].toFixed(2) })],
    facts: [
      { label: t("golfopedia.fact.build"), value: t("golfopedia.value.perTile", { value: formatCurrency(TERRAIN_BUILD_COST[terrain]) }) },
      { label: t("golfopedia.fact.salvage"), value: t("golfopedia.value.perTile", { value: formatCurrency(TERRAIN_SALVAGE_VALUE[terrain]) }) },
      { label: t("golfopedia.fact.upkeep"), value: `${TERRAIN_MAINT_WEIGHT[terrain].toFixed(2)}×` },
    ],
  }));
  const golferEntries = Object.values(ARCHETYPES).map((archetype) => {
    const label = t(golferLabelKeys[archetype.name]);
    const topPreference = Object.entries(archetype.personality.prefs).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0];
    return {
      id: `golfer-${archetype.name}`, section: "Golfers" as const, title: label,
      summary: t("golfopedia.golfer.summary", { label }),
      details: [t("golfopedia.golfer.typical", { skill: formatNumber(archetype.personality.skill, "en", { style: "percent" }), patience: formatNumber(archetype.personality.patience, "en", { style: "percent" }), spending: formatNumber(archetype.personality.spendPropensity, "en", { style: "percent" }) }), t("golfopedia.golfer.preference", { preference: topPreference })],
      facts: [{ label: t("golfopedia.fact.skill"), value: formatNumber(archetype.personality.skill, "en", { style: "percent" }) }, { label: t("golfopedia.fact.patience"), value: formatNumber(archetype.personality.patience, "en", { style: "percent" }) }, { label: t("golfopedia.fact.spending"), value: formatNumber(archetype.personality.spendPropensity, "en", { style: "percent" }) }],
    };
  });
  const management = ["rating", "demand", "cash", "reputation", "condition"] as const;
  const managementEntries = management.map((id) => ({ id: `management-${id}`, section: "Management" as const, title: t(`golfopedia.management.${id}.title`), summary: t(`golfopedia.management.${id}.summary`), details: [t(`golfopedia.management.${id}.detail1`), t(`golfopedia.management.${id}.detail2`)] }));
  const controls = ["camera", "simulation", "tools"] as const;
  const controlEntries = controls.map((id) => ({ id: `controls-${id}`, section: "Controls" as const, title: t(`golfopedia.controls.${id}.title`), summary: t(`golfopedia.controls.${id}.summary`), details: [t(`golfopedia.controls.${id}.detail1`), t(`golfopedia.controls.${id}.detail2`)] }));
  return [...terrainEntries, ...golferEntries, ...managementEntries, ...controlEntries];
}

export const GOLFOPEDIA_ENTRIES = buildGolfopediaEntries((key, params) => translate("en", key, params));
