import type {
  BackstoryRevealTrigger,
  LivingClubState,
  PersonBackstory,
  PersonOccupation,
  RegularGolfer,
  RelationshipGatedFact,
} from "../livingClub/types";
import type { ChallengeRivalProfile, EquipmentModifier, InventoryCategory, InventoryItem, LearnedTechnique, RewardDefinition } from "./types";

interface AuthoredItemDefinition {
  id: string;
  name: string;
  category: InventoryCategory;
  authoredValue: number;
  prestige: number;
  unique: boolean;
  remainingValue?: number;
  remainingPlacements?: number;
  frozenInstallValueEach?: number;
  speciesId?: string;
  modifiers?: readonly EquipmentModifier[];
  capabilities?: readonly "casino-host-capacity"[];
}

interface OccupationPackage {
  id: string;
  occupation: PersonOccupation;
  communityRole: string;
  biography: string;
  origin: string;
  motivation: string;
  personality: string;
  temperament: PersonBackstory["competitiveTemperament"];
  risk: number;
  signatureSkill: string;
  technique?: LearnedTechnique;
  formats: ChallengeRivalProfile["preferredFormats"];
  stakes: readonly InventoryCategory[];
  holdingDefinitionId: string;
  reward: RewardDefinition;
}

const ITEM_DEFINITIONS: readonly AuthoredItemDefinition[] = [
  { id: "heirloom-bloom-stock", name: "Heirloom Bloom Stock", category: "plant-stock", authoredValue: 45, remainingValue: 360, prestige: 35, unique: false, remainingPlacements: 8, frozenInstallValueEach: 45, speciesId: "flower_native" },
  { id: "workshop-flighted-iron", name: "Workshop Flighted Iron", category: "club", authoredValue: 900, prestige: 55, unique: true, modifiers: [{ channel: "carry", multiplier: .94, context: "iron-low-flight" }, { channel: "dispersion", multiplier: .9, context: "iron-low-flight" }] },
  { id: "annotated-lesson-book", name: "Annotated Lesson Book", category: "keepsake", authoredValue: 350, prestige: 60, unique: true },
  { id: "turf-treatment-credit", name: "Bounded Turf Treatment Credit", category: "service-credit", authoredValue: 600, remainingValue: 600, prestige: 30, unique: false },
  { id: "construction-credit", name: "Construction Material Credit", category: "service-credit", authoredValue: 1200, remainingValue: 1200, prestige: 40, unique: false },
  { id: "event-service-credit", name: "Event Service Credit", category: "service-credit", authoredValue: 500, remainingValue: 500, prestige: 35, unique: false },
  { id: "heritage-outfit", name: "Hand-cut Heritage Outfit", category: "outfit", authoredValue: 850, prestige: 65, unique: true, modifiers: [{ channel: "recovery", multiplier: 1.08, context: "difficult-recovery" }, { channel: "dispersion", multiplier: 1.05, context: "difficult-recovery" }] },
  { id: "restored-roadster", name: "Restored Roadster", category: "vehicle", authoredValue: 18000, prestige: 82, unique: true },
  { id: "field-chronometer", name: "Field Chronometer", category: "watch", authoredValue: 4200, prestige: 78, unique: true, modifiers: [{ channel: "putting", multiplier: 1.08, context: "green-putting" }, { channel: "carry", multiplier: .94, context: "green-putting" }] },
  { id: "midnight-coupe", name: "Midnight Coupe", category: "vehicle", authoredValue: 24000, prestige: 88, unique: true, capabilities: ["casino-host-capacity"] },
  { id: "tournament-stay-credit", name: "Tournament Stay Credit", category: "service-credit", authoredValue: 900, remainingValue: 900, prestige: 50, unique: false },
  { id: "course-portrait", name: "Original Course Portrait", category: "keepsake", authoredValue: 1300, prestige: 72, unique: true },
];

const PACKAGES: readonly OccupationPackage[] = [
  ["nursery", "nursery-horticulture", "Runs the local nursery and volunteers on the garden committee.", "Learned through twilight rounds after Sunday deliveries.", "Trades ideas about land and seasons.", "Patient, observant, and quietly stubborn.", "measured", 38, "Soft Hands", "soft-hands", ["stableford", "four-ball"], ["plant-stock", "keepsake", "service-credit"], "heirloom-bloom-stock", { id: "reward-heirloom-blooms", name: "Heirloom Bloom Stock", itemDefinitionId: "heirloom-bloom-stock", speciesId: "flower_native" }],
  ["fitter", "club-fitter", "Operates an independent fitting workshop beside the practice range.", "Started caddying and repairing clubs as a teenager.", "Tests repeatable ideas rather than expensive shortcuts.", "Exacting, dry-witted, and generous with earned advice.", "fierce", 52, "Knockdown Approach", "knockdown-approach", ["net-match", "nassau"], ["club", "bag", "service-credit"], "workshop-flighted-iron", { id: "reward-workshop-iron", name: "Workshop Flighted Iron", itemDefinitionId: "workshop-flighted-iron" }],
  ["instructor", "instructor", "Teaches juniors and returning players at the municipal range.", "Grew up hitting balls into a school field.", "Wants players to commit to a plan under pressure.", "Direct, encouraging, and allergic to excuses.", "fierce", 28, "Fairway Finder", "fairway-finder", ["gross-match", "net-match"], ["keepsake"], "annotated-lesson-book", { id: "reward-fairway-finder", name: "Fairway Finder", nonTransferableKind: "learned-technique", techniqueId: "fairway-finder" }],
  ["agronomist", "landscaper-agronomist", "Advises parks and courses on resilient turf and native landscapes.", "Joined the game while studying turf science.", "Looks for courses that play well because they fit their land.", "Practical, curious, and hard to bluff.", "measured", 32, "Splash Specialist", "splash-specialist", ["stableford", "net-stroke"], ["plant-stock", "service-credit"], "turf-treatment-credit", { id: "reward-turf-credit", name: "Turf Treatment Credit", itemDefinitionId: "turf-treatment-credit" }],
  ["builder", "contractor-builder", "Builds small commercial projects and restores old clubhouses.", "Took up golf through charity scrambles.", "Enjoys team formats and tangible, plainly stated stakes.", "Gregarious, decisive, and fair about the terms.", "social", 62, "Recovery", undefined, ["scramble", "four-ball"], ["service-credit", "vehicle"], "construction-credit", { id: "reward-construction-credit", name: "Construction Material Credit", itemDefinitionId: "construction-credit" }],
  ["chef", "restaurateur-chef", "Owns a neighborhood restaurant that caters local events.", "Learned during quiet Monday afternoons.", "Plays for company, stories, and dramatic finishes.", "Warm, theatrical, and shrewd.", "social", 44, "Lag Putt", "lag-putt", ["stableford", "pro-am"], ["service-credit", "keepsake"], "event-service-credit", { id: "reward-event-menu", name: "Chef's Tournament Menu", itemDefinitionId: "event-service-credit" }],
  ["tailor", "tailor-apparel", "Runs a tailoring and apparel shop on the high street.", "Made team jackets before joining the team.", "Likes precise match play and memorable presentation.", "Elegant, perceptive, and playfully competitive.", "measured", 47, "Composure", undefined, ["net-match", "four-ball"], ["outfit", "bag", "watch"], "heritage-outfit", { id: "reward-tailored-style", name: "Tailored Heritage Style", itemDefinitionId: "heritage-outfit", nonTransferableKind: "profile-unlock", profileStyleId: "heritage-tailored" }],
  ["mechanic", "mechanic-dealer", "Restores older road cars and manages a modest local dealership.", "Started in an auto-trade league.", "Prefers clear terms and decisive holes.", "Blunt, loyal, and delighted by a comeback.", "fierce", 74, "Fairway Finder", "fairway-finder", ["gross-match", "skins"], ["vehicle", "keepsake"], "restored-roadster", { id: "reward-classic-roadster", name: "Restored Roadster", itemDefinitionId: "restored-roadster" }],
  ["jeweler", "jeweler-watch-collector", "Repairs watches and curates small estate collections.", "Joined clients for nine holes and stayed for the rhythm.", "Plays patient golf for objects with stories.", "Reserved, precise, and quietly sentimental.", "measured", 58, "Lag Putt", "lag-putt", ["net-match", "nassau"], ["watch", "keepsake"], "field-chronometer", { id: "reward-field-chronometer", name: "Field Chronometer", itemDefinitionId: "field-chronometer" }],
  ["host", "card-dealer-casino-host", "Deals private card nights and hosts licensed local events.", "A regular taught the game after late shifts.", "Enjoys negotiated stakes without hidden terms.", "Unflappable, sociable, and scrupulous about settlement.", "fierce", 88, "Pressure Putting", undefined, ["skins", "nassau"], ["vehicle", "watch", "keepsake"], "midnight-coupe", { id: "reward-midnight-coupe", name: "Midnight Coupe", itemDefinitionId: "midnight-coupe", rewardKind: "casino-host-capacity" }],
  ["hotelier", "hotelier-event-organizer", "Runs a small hotel and coordinates regional gatherings.", "Learned while hosting visiting societies.", "Builds ambitious Pro-Am groups.", "Organized, expansive, and diplomatically competitive.", "social", 50, "Team Captaincy", undefined, ["pro-am", "four-ball"], ["service-credit", "keepsake"], "tournament-stay-credit", { id: "reward-stay-credit", name: "Tournament Stay Credit", itemDefinitionId: "tournament-stay-credit" }],
  ["artist", "photographer-artist", "Photographs local landscapes and paints clubhouse commissions.", "Began carrying a camera for a parent who played.", "Chases expressive shots and memorable places.", "Reflective, adventurous, and indifferent to status.", "social", 36, "Soft Hands", "soft-hands", ["stableford", "gross-stroke"], ["keepsake", "trophy"], "course-portrait", { id: "reward-course-portrait", name: "Original Course Portrait", itemDefinitionId: "course-portrait" }],
].map((row) => ({
  id: row[0] as string,
  occupation: row[1] as PersonOccupation,
  communityRole: row[2] as string,
  biography: row[2] as string,
  origin: row[3] as string,
  motivation: row[4] as string,
  personality: row[5] as string,
  temperament: row[6] as PersonBackstory["competitiveTemperament"],
  risk: row[7] as number,
  signatureSkill: row[8] as string,
  technique: row[9] as LearnedTechnique | undefined,
  formats: row[10] as ChallengeRivalProfile["preferredFormats"],
  stakes: row[11] as readonly InventoryCategory[],
  holdingDefinitionId: row[12] as string,
  reward: row[13] as RewardDefinition,
}));

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function authoredItem(definitionId: string, ownerId: string): InventoryItem {
  const definition = ITEM_DEFINITIONS.find((item) => item.id === definitionId);
  if (!definition) throw new Error(`Unknown authored item definition ${definitionId}.`);
  return {
    ...definition,
    id: `${ownerId}:${definition.id}`,
    definitionId: definition.id,
    ownerId,
    custodianId: ownerId,
    remainingValue: definition.remainingValue ?? definition.authoredValue,
    confirmationRequired: definition.unique || definition.prestige >= 75,
    transferable: true,
    transferHistory: [],
  };
}

export function occupationPackageFor(worldSeed: number, personId: string): OccupationPackage {
  return PACKAGES[hash(`${worldSeed >>> 0}:${personId}`) % PACKAGES.length];
}

const HISTORY = ["grew up beside the old rail line", "returned after years away", "learned the town through volunteer work", "keeps a notebook of every local course"];
const CONNECTION = ["the junior league", "the garden committee", "the high-street association", "a multigenerational local family"];

export function assignPersonProfile(regular: RegularGolfer, worldSeed: number): RegularGolfer {
  if (regular.backstory) return regular;
  if (regular.id === "anchor-mara-vale") return {
    ...regular,
    backstory: AUTHORED_ANCHOR_BACKSTORY,
    rivalProfile: {
      version: 1,
      riskTolerance: AUTHORED_ANCHOR_BACKSTORY.riskTolerance,
      preferredFormats: ["net-match", "gross-match"],
      preferredTees: ["member"],
      preferredStakeCategories: ["plant-stock", "keepsake"],
      preferredPartnerIds: [],
      signatureTechnique: "soft-hands",
      knownHoldingIds: [],
      mentorMatchesRequired: 2,
    },
  };
  const pack = occupationPackageFor(worldSeed, regular.id);
  const detailSeed = hash(`${regular.id}:${worldSeed >>> 0}:details`);
  const holding = authoredItem(pack.holdingDefinitionId, regular.id);
  const hiddenFacts: RelationshipGatedFact[] = [
    { id: `${regular.id}:origin`, text: pack.origin, allowedTriggers: ["conversation", "completed-round"] },
    { id: `${regular.id}:motivation`, text: pack.motivation, allowedTriggers: ["conversation", "rematch", "story"] },
    { id: `${regular.id}:holding`, text: `May be willing to discuss ${holding.name}.`, allowedTriggers: ["rematch", "story"] },
  ];
  const backstory: PersonBackstory = {
    version: 1,
    source: "curated-package",
    authoredId: `occupation:${pack.id}`,
    occupation: pack.occupation,
    communityRole: pack.communityRole,
    publicBiography: `${regular.name} ${pack.biography.charAt(0).toLowerCase()}${pack.biography.slice(1)}`,
    golfOrigin: pack.origin,
    motivation: pack.motivation,
    personality: pack.personality,
    competitiveTemperament: pack.temperament,
    riskTolerance: pack.risk,
    preferredPartners: [],
    signatureSkill: pack.signatureSkill,
    holdings: [holding],
    rewardHooks: [pack.reward],
    generatedDetails: {
      history: HISTORY[detailSeed % HISTORY.length],
      familyOrCommunityConnection: CONNECTION[Math.floor(detailSeed / 7) % CONNECTION.length],
      favoriteCourseId: regular.favoriteCourseId,
      favoriteHoleId: regular.favoriteHoleId,
    },
    publicFactIds: [`${regular.id}:biography`, `${regular.id}:role`],
    revealedHistory: [],
    knownHoldingIds: [],
    hiddenFacts,
  };
  const rivalProfile: ChallengeRivalProfile = {
    version: 1,
    riskTolerance: pack.risk,
    preferredFormats: pack.formats,
    preferredTees: regular.skill > 0.72 ? ["championship", "member"] : ["member", "forward"],
    preferredStakeCategories: pack.stakes,
    preferredPartnerIds: [],
    signatureTechnique: pack.technique,
    knownHoldingIds: [],
    mentorMatchesRequired: 2,
  };
  return { ...regular, backstory, rivalProfile };
}

export function revealBackstoryFact(regular: RegularGolfer, factId: string, trigger: BackstoryRevealTrigger): RegularGolfer {
  if (!regular.backstory) return regular;
  const fact = regular.backstory.hiddenFacts.find((candidate) => candidate.id === factId);
  if (!fact || fact.revealedBy || !fact.allowedTriggers.includes(trigger.kind)) return regular;
  const revealed = { ...fact, revealedBy: trigger };
  const holdingId = factId.endsWith(":holding") ? regular.backstory.holdings[0]?.id : undefined;
  const knownHoldingIds = holdingId ? [...new Set([...regular.backstory.knownHoldingIds, holdingId])] : regular.backstory.knownHoldingIds;
  return {
    ...regular,
    backstory: {
      ...regular.backstory,
      revealedHistory: [...regular.backstory.revealedHistory, revealed],
      knownHoldingIds,
      hiddenFacts: regular.backstory.hiddenFacts.map((candidate) => candidate.id === factId ? revealed : candidate),
    },
    rivalProfile: regular.rivalProfile ? { ...regular.rivalProfile, knownHoldingIds } : regular.rivalProfile,
  };
}

export function normalizePeopleProfiles(state: LivingClubState, worldSeed: number): LivingClubState {
  return { ...state, regulars: state.regulars.map((regular) => assignPersonProfile(regular, worldSeed)) };
}

export const AUTHORED_ANCHOR_BACKSTORY: PersonBackstory = {
  version: 1,
  source: "authored-anchor",
  authoredId: "anchor:mara-vale",
  occupation: "nursery-horticulture",
  communityRole: "Third-generation owner of Vale Nursery and keeper of the town's heritage roses.",
  publicBiography: "Mara Vale is a precise nine-hole player with a formidable match-play instinct.",
  golfOrigin: "Her grandfather traded nursery deliveries for junior lessons.",
  motivation: "She wants the course to become a garden the town can still recognize.",
  personality: "Grounded, wry, and protective of local history.",
  competitiveTemperament: "fierce",
  riskTolerance: 55,
  preferredPartners: [],
  signatureSkill: "Soft Hands",
  holdings: [],
  rewardHooks: [{ id: "anchor-mara-heritage-rose", name: "Vale Heritage Rose", nonTransferableKind: "species-knowledge", speciesId: "flower_native" }],
  generatedDetails: { history: "Authored campaign anchor", familyOrCommunityConnection: "Vale Nursery" },
  publicFactIds: ["mara:biography"],
  revealedHistory: [],
  knownHoldingIds: [],
  hiddenFacts: [],
};
