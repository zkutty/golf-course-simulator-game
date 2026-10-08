/** ZK-660 authoring metadata only. None of these declarations schedules or loads wildlife. */
export const WILDLIFE_BIOMES = [
  "parkland", "links", "desert", "tropical-coastal-resort", "temperate-japan",
  "alpine-mountain", "heathland", "australian-sandbelt",
] as const;
export type WildlifeBiome = (typeof WILDLIFE_BIOMES)[number];
export const WILDLIFE_FAMILIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
export type WildlifeFamily = (typeof WILDLIFE_FAMILIES)[number];
export const WILDLIFE_CLIPS = [
  "idle", "slow-walk", "gentle-hop", "perch", "branch-walk", "still", "glide",
  "quiet-flight", "stand", "rest", "slow-crawl", "lateral-scuttle", "calm-hop", "remote-travel",
] as const;
export type WildlifeClip = (typeof WILDLIFE_CLIPS)[number];
export const WILDLIFE_HABITATS = [
  "woodland-edge", "meadow-margin", "woodland-support", "sheltered-pond", "wet-edge-support",
  "dune-margin", "coastal-rock", "scrub-wash", "natural-rock", "rock-bark", "ocean-beach",
  "canopy", "clearing-margin", "meadow-rock", "gorse-support", "sandy-heather-edge", "warm-woodland-floor",
] as const;
export type WildlifeHabitat = (typeof WILDLIFE_HABITATS)[number];
export type WildlifeAnchor = "G" | "W" | "P" | "F";
export type WildlifeScale = "XS" | "S" | "M" | "L" | "Flight";
export type WildlifeActivity = "dawn" | "morning" | "day" | "late-day" | "dusk" | "night";
export type WildlifeSeason = "spring" | "summer" | "autumn" | "winter";

export interface WildlifeAnimationCycle {
  readonly clip: WildlifeClip;
  readonly frames: 2 | 4 | 6;
  readonly fps: 2 | 4 | 6;
}
export const WILDLIFE_ANIMATION_FAMILIES: Readonly<Record<WildlifeFamily, readonly WildlifeAnimationCycle[]>> = {
  A: [{ clip: "idle", frames: 2, fps: 2 }, { clip: "slow-walk", frames: 6, fps: 6 }],
  B: [{ clip: "idle", frames: 2, fps: 2 }, { clip: "gentle-hop", frames: 6, fps: 6 }],
  C: [{ clip: "perch", frames: 2, fps: 2 }, { clip: "branch-walk", frames: 6, fps: 6 }],
  D: [{ clip: "still", frames: 2, fps: 2 }, { clip: "glide", frames: 4, fps: 4 }, { clip: "quiet-flight", frames: 6, fps: 6 }],
  E: [{ clip: "perch", frames: 2, fps: 2 }, { clip: "stand", frames: 2, fps: 2 }, { clip: "quiet-flight", frames: 6, fps: 6 }],
  F: [{ clip: "perch", frames: 2, fps: 2 }, { clip: "quiet-flight", frames: 6, fps: 6 }],
  G: [{ clip: "rest", frames: 2, fps: 2 }, { clip: "slow-crawl", frames: 4, fps: 4 }],
  H: [{ clip: "still", frames: 2, fps: 2 }, { clip: "lateral-scuttle", frames: 4, fps: 4 }],
  I: [{ clip: "rest", frames: 2, fps: 2 }, { clip: "slow-walk", frames: 6, fps: 6 }],
  J: [{ clip: "rest", frames: 2, fps: 2 }, { clip: "calm-hop", frames: 6, fps: 6 }],
};
export const WILDLIFE_ROADRUNNER_TRAVEL: WildlifeAnimationCycle = { clip: "remote-travel", frames: 6, fps: 6 };
export const WILDLIFE_SCALE_CANVASES: Readonly<Record<WildlifeScale, readonly [number, number]>> = {
  XS: [32, 32], S: [48, 48], M: [80, 80], L: [96, 112], Flight: [96, 64],
};
export interface WildlifeAtlasCandidate {
  readonly owner: WildlifeBiome;
  readonly speciesId: string;
  readonly family: WildlifeFamily;
  readonly cycle: WildlifeAnimationCycle;
  readonly canvas: readonly [width: number, height: number];
  readonly anchor: WildlifeAnchor;
  readonly pivot: readonly [x: number, y: number];
  readonly naturalSupport: string | null;
  readonly directionRows: number;
  readonly sourceSha256: string;
  readonly gutterPixels: 2;
  readonly maximumContactDriftPixels: 2;
}

/** Required on playable biome content; planned ownership is not an asset or activation flag. */
export interface WildlifeBundleOwnership<Key extends string = string> {
  readonly profile: Key;
  readonly bundleOwner: Key;
  readonly delivery: "planned";
  readonly fallback: "omit";
}

export const WILDLIFE_REVIEW_ROLES = ["ecology", "welfare", "cultural", "visual", "audio", "provenance"] as const;
export type WildlifeReviewRole = (typeof WILDLIFE_REVIEW_ROLES)[number];
export interface WildlifePendingProvenance {
  readonly status: "pending";
  readonly assetReferences: readonly [];
  readonly reviews: Readonly<Record<WildlifeReviewRole, "pending">>;
}

/** Future candidate evidence, deliberately separate from the planned roster and asset manifests. */
export interface WildlifeCandidateProvenance {
  readonly source: string;
  readonly licenseOrTerms: string;
  readonly authorOrProvider: string;
  readonly model: string | null;
  readonly createdAt: string;
  readonly prompt: string | null;
  readonly referenceIdsAndHashes: readonly { readonly id: string; readonly sha256: string }[];
  readonly rawSha256: string;
  readonly cleanupLineage: readonly { readonly step: string; readonly sha256: string }[];
  readonly productionSha256: string;
  readonly redistribution: "private-only" | "permitted";
  readonly reviews: Readonly<Record<WildlifeReviewRole, {
    readonly reviewer: string;
    readonly date: string;
    readonly decision: "approved" | "rejected";
    readonly assetSha256: string;
    readonly evidence: readonly string[];
    readonly notes: string;
  }>>;
}

export interface WildlifeSpecies {
  readonly id: string;
  readonly label: string;
  readonly scales: readonly WildlifeScale[];
  readonly silhouette: string;
  readonly anchors: readonly WildlifeAnchor[];
  readonly family: WildlifeFamily;
  readonly clips: readonly WildlifeClip[];
  readonly adultGroup: { readonly min: number; readonly max: number };
  readonly habitat: WildlifeHabitat;
  readonly habitatDescription: string;
  readonly activity: readonly WildlifeActivity[];
  readonly seasons: readonly WildlifeSeason[];
  readonly mildWeatherOnly: boolean;
  readonly restrictedGroundNestingPresentation: boolean;
  readonly audio: { readonly treatment: "silent" | "distant-call"; readonly description: string };
  readonly exclusionTiles: 3 | 5;
}

export interface WildlifeProfile {
  readonly biome: WildlifeBiome;
  readonly setting: "playable" | "staged";
  readonly ownership: WildlifeBundleOwnership<WildlifeBiome>;
  readonly provenance: WildlifePendingProvenance;
  readonly species: readonly WildlifeSpecies[];
}
export type WildlifeRegistry = Readonly<Record<WildlifeBiome, WildlifeProfile>>;

/** Proposed authoring targets from ZK-657, not measured performance or changed M35 caps. */
export const WILDLIFE_TIER_TARGETS = {
  high: { groups: 4, individuals: 12, travelingGroups: 2, flightGroups: 1, artBytes: 512 * 1024, decodedBytes: 4 * 1024 * 1024, callEventsPerMinute: 3 },
  medium: { groups: 2, individuals: 6, travelingGroups: 1, flightGroups: 1, artBytes: 256 * 1024, decodedBytes: 2 * 1024 * 1024, callEventsPerMinute: 2 },
  low: { groups: 0, individuals: 0, travelingGroups: 0, flightGroups: 0, artBytes: 0, decodedBytes: 0, callEventsPerMinute: 0 },
} as const;
export const WILDLIFE_DELIVERY_CONTRACT = {
  loadPolicy: "selected-biome-and-quality-only",
  missingOrUnapproved: "omit",
  lowQuality: "omit",
  unselectedRequests: 0,
  shellPrecacheAssets: 0,
  dedicatedCallBankBytes: 128 * 1024,
  selectedBiomeBudgetBytes: 6 * 1024 * 1024,
  individualAtlasBudgetBytes: 8 * 1024 * 1024,
  criticalLoadBudgetBytes: 8 * 1024 * 1024,
  mediumMultiBirdFlight: false,
  appearanceCooldownSeconds: 60,
  paused: "stop",
  reducedMotion: "static-or-omit",
  simulationEffects: false,
  playerInteraction: false,
} as const;
export const WILDLIFE_AUDIO_TARGETS = {
  foregroundCalls: 1, minimumEventSpacingSeconds: 20, repeatClipSpacingSeconds: 60,
  maximumEventSeconds: 3, gainRampMilliseconds: 150, pauseFadeMilliseconds: 250,
  truePeakDbtp: -6, rmsBelowClubImpactDb: 12, stormCalls: 0, nonGameOutput: 0,
  mutedOutput: 0, reducedMotionExtraCalls: 0,
} as const;
