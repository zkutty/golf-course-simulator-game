import type { Terrain } from "../../game/models/types";
import { ARCHETYPES } from "../../game/live/archetypes";
import { TERRAIN_BUILD_COST, TERRAIN_MAINT_WEIGHT, TERRAIN_SALVAGE_VALUE } from "../../game/models/terrainEconomics";

export type GolfopediaSection = "Terrain" | "Golfers" | "Management" | "Controls";

export interface GolfopediaEntry {
  id: string;
  section: GolfopediaSection;
  title: string;
  summary: string;
  details: string[];
  facts?: { label: string; value: string }[];
}

const terrainCopy: Record<Terrain, { title: string; summary: string }> = {
  fairway: { title: "Fairway", summary: "The safe, short-grass route from tee to green." },
  rough: { title: "Rough", summary: "Forgiving natural ground; free to paint and useful as your default canvas." },
  deep_rough: { title: "Deep Rough", summary: "Punishing grass that makes recovery shots less reliable." },
  sand: { title: "Sand", summary: "A strategic hazard that adds difficulty and visual character." },
  water: { title: "Water", summary: "A severe hazard. Carries and shorelines strongly shape shot choice." },
  green: { title: "Green", summary: "The putting surface and destination of every hole." },
  tee: { title: "Tee", summary: "The starting surface for a hole." },
  path: { title: "Path", summary: "Fast walking terrain that helps golfers and staff move around the property." },
};

const terrainEntries: GolfopediaEntry[] = (Object.keys(terrainCopy) as Terrain[]).map((terrain) => ({
  id: `terrain-${terrain}`,
  section: "Terrain",
  title: terrainCopy[terrain].title,
  summary: terrainCopy[terrain].summary,
  details: [
    "Build and salvage values come directly from the live balance tables.",
    `Maintenance pressure is ${TERRAIN_MAINT_WEIGHT[terrain].toFixed(2)}× the base tile weight.`,
  ],
  facts: [
    { label: "Build", value: `$${TERRAIN_BUILD_COST[terrain].toLocaleString()} / tile` },
    { label: "Salvage", value: `$${TERRAIN_SALVAGE_VALUE[terrain].toLocaleString()} / tile` },
    { label: "Upkeep weight", value: `${TERRAIN_MAINT_WEIGHT[terrain].toFixed(2)}×` },
  ],
}));

const golferEntries: GolfopediaEntry[] = Object.values(ARCHETYPES).map((archetype) => ({
  id: `golfer-${archetype.name}`,
  section: "Golfers",
  title: archetype.label,
  summary: `${archetype.label} golfers are one crowd archetype; each arrival still rolls an individual personality.`,
  details: [
    `Typical skill ${Math.round(archetype.personality.skill * 100)}%, patience ${Math.round(archetype.personality.patience * 100)}%, and spending tendency ${Math.round(archetype.personality.spendPropensity * 100)}%.`,
    `They care most about ${Object.entries(archetype.personality.prefs).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0]}.`,
  ],
  facts: [
    { label: "Skill", value: `${Math.round(archetype.personality.skill * 100)}%` },
    { label: "Patience", value: `${Math.round(archetype.personality.patience * 100)}%` },
    { label: "Spending", value: `${Math.round(archetype.personality.spendPropensity * 100)}%` },
  ],
}));

const managementEntries: GolfopediaEntry[] = [
  {
    id: "management-rating",
    section: "Management",
    title: "Course rating & slope",
    summary: "Rating estimates expected scoring difficulty; slope describes how sharply difficulty rises for non-scratch golfers.",
    details: ["Distance, hazards, elevation, landing corridors, and recoverability all contribute.", "A hard course can be excellent — difficulty should feel deliberate, not accidental."],
  },
  {
    id: "management-demand",
    section: "Management",
    title: "Demand",
    summary: "Demand combines course quality, condition, reputation, price, marketing, and staff into expected visitors.",
    details: ["Each factor has a visible contribution in the Results tab.", "Capacity can still cap rounds even when demand is strong."],
  },
  {
    id: "management-cash",
    section: "Management",
    title: "Cash & profit",
    summary: "Cash is your runway. Profit is one period's revenue minus operating costs.",
    details: ["A profitable week grows cash; capital construction can reduce cash without appearing as an operating expense.", "Keep several weeks of normal costs in reserve."],
  },
  {
    id: "management-reputation",
    section: "Management",
    title: "Reputation",
    summary: "Reputation is the market's memory of satisfaction, reliability, and course quality.",
    details: ["It recovers more slowly than it falls.", "Missed loan payments and poor maintenance can accelerate a decline."],
  },
  {
    id: "management-condition",
    section: "Management",
    title: "Course condition",
    summary: "Condition measures the health of the playing surfaces from 0–100%. Traffic causes wear; maintenance restores it.",
    details: ["Premium turf has higher maintenance weight.", "Low condition reduces satisfaction even on a well-designed course."],
  },
];
const controlEntries: GolfopediaEntry[] = [
  { id: "controls-camera", section: "Controls", title: "Camera", summary: "Pan, zoom, rotate, and fit the active hole.", details: ["Mouse wheel: zoom", "Middle drag or edge scroll: pan", "[ and ]: previous/next hole", "F: fit active hole"] },
  { id: "controls-simulation", section: "Controls", title: "Simulation clock", summary: "Pause or run the living course at 1×, 2×, or 3×.", details: ["Use 1× when observing a design problem.", "Higher speeds are best for validating finances over several days."] },
  { id: "controls-tools", section: "Controls", title: "Design tools", summary: "Paint terrain, build holes, add obstacles, sculpt elevation, and place amenities.", details: ["Escape cancels the current placement flow.", "Tooltips show live costs before you commit."] },
];

export const GOLFOPEDIA_ENTRIES: readonly GolfopediaEntry[] = [
  ...terrainEntries,
  ...golferEntries,
  ...managementEntries,
  ...controlEntries,
];
