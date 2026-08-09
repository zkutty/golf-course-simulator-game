import type { Course, Terrain, World } from "./types";
import { COURSE_WIDTH, COURSE_HEIGHT } from "./constants";
import { normalizeOperations } from "./courseOperations";
import { staffFromLevel } from "../live/pace";
import { emptyPropertyEnterprise, starterPropertyCourse } from "../property/property";
import { emptyLivingClubState } from "../livingClub/livingClub";
import { createSeasonalState } from "../seasons/seasons";
import { emptyM51CourseMobilityState, emptyM51MobilityState } from "../m51/mobility";
import { biomeCompatibilityMetadataFor } from "./biomes";
import {
  createFlatGreenSurfaceV1,
  createGreenProgram,
  createHealthyGreenLocalState,
} from "../greens/greenSurface";
import { createSystemControlState } from "../experience/systemControl";

export const DEFAULT_COURSE: Course = {
  name: "West Village Municipal",
  width: COURSE_WIDTH,
  height: COURSE_HEIGHT,
  tiles: Array.from({ length: COURSE_WIDTH * COURSE_HEIGHT }, () => "rough" as Terrain),
  elevations: Array.from({ length: COURSE_WIDTH * COURSE_HEIGHT }, () => 0),
  holes: Array.from({ length: 9 }, (_, i) => ({
    id: `hole-${i + 1}`,
    teeBoxes: { forward: null, member: null, championship: null },
    pinPositions: { A: null, B: null, C: null },
    tee: null,
    green: null,
    parByTee: { forward: { mode: "AUTO" as const }, member: { mode: "AUTO" as const }, championship: { mode: "AUTO" as const } },
    parMode: "AUTO" as const,
    parManual: undefined,
    name: `Hole ${i + 1}`,
  })),
  layouts: [{
    id: "course-primary",
    name: "West Village Municipal",
    draftHoleIds: Array.from({ length: 9 }, (_, i) => `hole-${i + 1}`),
    publishedHoleIds: Array.from({ length: 9 }, (_, i) => `hole-${i + 1}`),
    roundLength: 9,
    state: "open",
    greenFee: 65,
    operations: normalizeOperations(),
    legacyPartial: undefined,
  }],
  activeCourseId: "course-primary",
  activePinRotation: "A",
  obstacles: [],
  buildings: [],
  decorations: [],
  yardsPerTile: 10,
  baseGreenFee: 65,
  condition: 0.75,
  theme: "parkland",
  biomeCompatibility: biomeCompatibilityMetadataFor("parkland"),
  property: starterPropertyCourse(),
  m51: emptyM51CourseMobilityState(),
};

DEFAULT_COURSE.greenSurface = createFlatGreenSurfaceV1();
DEFAULT_COURSE.greenProgram = createGreenProgram("balanced");
DEFAULT_COURSE.greenLocalState = createHealthyGreenLocalState(DEFAULT_COURSE);

export const DEFAULT_WORLD: World = {
  week: 1,
  cash: 25_000,
  reputation: 40,
  staffLevel: 1,
  staffRoster: staffFromLevel(1, "course-primary"),
  marketingLevel: 0,
  maintenanceBudget: 900,
  runSeed: 1337,
  distressWeeks: 0,
  isBankrupt: false,
  lastWeekProfit: 0,
  lastBridgeLoanWeek: -999,
  loans: [],
  objectives: null,
  mode: "sandbox",
  experienceProfile: "classic",
  economicPressure: "balanced",
  systemControl: createSystemControlState("classic"),
  onboardingRewards: { version: 1, receipts: [] },
  tournaments: { version: 2, events: [] },
  enterprise: emptyPropertyEnterprise(),
  livingClub: emptyLivingClubState(),
  seasonal: createSeasonalState({ runSeed: 1337, theme: "parkland" }),
  paceOperations: { version: 1, courses: {} },
  m51: emptyM51MobilityState(),
};
