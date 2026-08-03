import type { Course, PinRotation, Point, Terrain, World } from "../models/types";
import type { DailyWeather } from "../seasons/types";
import type { GolferCapabilities } from "../live/m47Types";
import type { Personality } from "../live/personality";
import { DEFAULT_WORLD } from "../models/defaults";
import { createRenderPerfCourse, createTournamentStandardsCourse } from "./referenceCourse";
import {
  GREEN_ROLLOUT_MAX_PATH_POINTS,
  GREEN_ROLLOUT_MAX_STEPS,
  isValidGreenRollout,
  resolveGreenRollout,
  type GreenRolloutV1,
} from "../greens/greenRollout";
import {
  createFlatGreenSurfaceV1,
  createGreenProgram,
  createHealthyGreenLocalState,
  greenGeometryVersion,
  normalizeGreenLocalState,
  withNormalizedGreenContract,
} from "../greens/greenSurface";
import { computeFineGreenSculptPreview } from "../greens/fineGreenSculpt";
import { buildGreenSurfaceOverlayCommands, GREEN_OVERLAY_COMMAND_BUDGET } from "../greens/greenSurfaceRender";
import { advanceGreenKeepingDay, requiredGreenKeepingBudget } from "../greens/greenMaintenance";
import { analyzePinFairness, analyzePinRotation } from "../greens/pinFairness";
import { estimateAutomaticPutts, resolveAutomaticPutts } from "../greens/greenPutting";
import { courseForCourseSetup } from "../models/courseSetup";
import { liveCourseSnapshot, resolveLiveShot } from "../live/livePhysics";
import { planGreenLandingZones } from "../live/greenLandingStrategy";
import { capabilitiesToPlayerSkills, stableGolferHandedness } from "../live/capabilities";
import {
  autoFinishPlayerRound,
  commitPlayerShot,
  createDefaultPlayerPro,
  finishPlayerShot,
  previewPlayableShot,
  resolvePlayableShot,
  settlePlayerRound,
  startPlayableRound,
} from "../playerPro/playerPro";
import { recordPlayerRoundArchitecture } from "../livingClub/livingClub";
import { buildArchitectureReview, defaultArchitectureFilters, withGreenStrategyHeatmap } from "../architecture/review";
import { buildGreenStrategyHeatmap, buildGreenStrategyHeatmapForReview, GREEN_STRATEGY_MAX_OVERLAY_ITEMS } from "../architecture/greenStrategyHeatmap";
import { computeRatingForSetup } from "../sim/courseRating";
import { evaluateTournamentCourseQualification } from "../tournaments/eligibility";
import { createCoursePackage, canonicalPackageJson, packageText, validatePackageText } from "../contentPackages/packageFormat";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult, payloadForPersistence } from "../../utils/save";
import { canonicalJson, hashCanonicalValue } from "../../utils/canonical";
import { createRenderPerfLiveState } from "../live/simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";

export const M62_CERTIFICATION_SEED = 62_645 as const;
export const M62_FIXTURE_IDS = [
  "level",
  "tiered",
  "false-front",
  "bowl",
  "ridge",
  "uphill",
  "downhill",
  "sidehill",
  "wet-slow",
  "dry-fast",
  "worn",
  "recovered",
  "edge-pin",
  "severe-legal",
] as const;

export type M62FixtureId = (typeof M62_FIXTURE_IDS)[number];

export const M62_REMAINING_HUMAN_GATES = [
  "Human golf-authenticity playtest across the fourteen named green fixtures, including funnel-green and universal-target judgment.",
  "Assistive-technology and physical text-scaling review of the green overlays and reports.",
  "Physical supported-browser, installed-PWA, and packaged-desktop device review.",
  "Physical GPU/thermal soak on representative low- and high-tier hardware.",
  "Release-owner production sign-off after the exact integrated commit passes development and production monitoring.",
] as const;

export interface M62CertificationCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface M62CertificationReport {
  version: 1;
  fixture: {
    seed: number;
    width: number;
    height: number;
    holes: number;
    activeGolfers: number;
    greenFixtures: M62FixtureId[];
  };
  checks: M62CertificationCheck[];
  metrics: {
    fixtureCases: number;
    distinctFixtureHashes: number;
    aiCohorts: number;
    aiPreferredTargets: number;
    aiPreferredRoles: number;
    automaticPuttValues: number[];
    pinRotations: number;
    maintenancePrograms: number;
    packageBytes: number;
    currentSaveBytes: number;
    fullEstateSaveBytes: number;
    liveSnapshotBytes: number;
    architectureSamples: number;
    architectureOverlayItems: number;
    architectureBytes: number;
    fullEstateFixtureMs: number;
    architectureMs: number;
  };
  hashes: {
    fixtures: string;
    ai: string;
    putting: string;
    consequences: string;
    compatibility: string;
    architecture: string;
    fullEstate: string;
  };
  determinismHash: string;
  remainingHumanGates: readonly string[];
  passed: boolean;
}

const check = (id: string, passed: boolean, detail: string): M62CertificationCheck => ({ id, passed, detail });
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;

const personality: Personality = {
  skill: .72,
  consistency: .74,
  patience: .55,
  spendPropensity: .5,
  prefs: { difficulty: 0, scenery: 0, price: 0 },
};

function capabilities(index: number): GolferCapabilities {
  const styles = ["conservative", "balanced", "aggressive"] as const;
  return {
    version: 1,
    seed: M62_CERTIFICATION_SEED + index,
    power: 38 + index * 17 % 61,
    accuracy: 41 + index * 23 % 58,
    irons: 43 + index * 29 % 56,
    shortGame: 39 + index * 31 % 60,
    recovery: 42 + index * 19 % 57,
    consistency: 44 + index * 13 % 55,
    riskTolerance: .08 + index * 7 % 87 / 100,
    challengeSeeking: .07 + index * 11 % 89 / 100,
    sceneryAffinity: .5,
    valueSensitivity: .5,
    riskStyle: styles[index % styles.length],
    strengths: index % 3 === 0 ? ["power", "recovery"] : index % 3 === 1 ? ["accuracy", "irons"] : ["shortGame", "recovery"],
    weaknesses: index % 3 === 0 ? ["accuracy", "shortGame"] : index % 3 === 1 ? ["power", "recovery"] : ["power", "irons"],
  };
}

function fixtureWeather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    absoluteDay: 62,
    kind: "clear",
    temperatureF: 72,
    windMph: 7,
    rainInches: 0,
    severity: .1,
    theme: "parkland",
    season: "summer",
    ...overrides,
  };
}

function rolloutBase(): Course {
  const width = 10;
  const height = 5;
  const tiles = new Array<Terrain>(width * height).fill("green");
  const hole = {
    id: "m62-rollout",
    name: "M62 rollout fixture",
    tee: { x: 0, y: 2 },
    green: { x: 8, y: 2 },
    teeBoxes: { member: { x: 0, y: 2 } },
    pinPositions: { A: { x: 8, y: 2 }, B: { x: 8, y: 1 }, C: { x: 8, y: 3 } },
    parMode: "MANUAL" as const,
    parManual: 3 as const,
  };
  const course: Course = {
    name: "M62 rollout fixture",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [hole],
    layouts: [{ id: "m62-rollout", name: "M62 rollout", draftHoleIds: [hole.id], publishedHoleIds: [hole.id], roundLength: 9, state: "open", greenFee: 40, legacyPartial: true }],
    activeCourseId: "m62-rollout",
    activePinRotation: "A",
    obstacles: [],
    decorations: [],
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 40,
    condition: .9,
    theme: "parkland",
    greenSurface: createFlatGreenSurfaceV1(),
    greenProgram: createGreenProgram("balanced"),
  };
  course.greenLocalState = createHealthyGreenLocalState(course);
  return course;
}

function localCondition(course: Course, values: { health: number; moisture: number; compaction: number; wear: number }): Course {
  return {
    ...course,
    greenLocalState: normalizeGreenLocalState({
      version: 1,
      lastAdvancedAbsoluteDay: 61,
      holes: [{
        holeId: "m62-rollout",
        ...values,
        zones: [
          { zone: "landing", ...values, traffic: values.wear },
          { zone: "pin", ...values, traffic: values.wear },
        ],
      }],
    }, course),
  };
}

function surfaceFixture(id: M62FixtureId): Course {
  let course = rolloutBase();
  if (id === "tiered") {
    course.elevations = course.elevations.map((value, index) => index % course.width >= 5 ? value + 1.2 : value);
  } else if (id === "uphill") {
    course.elevations = course.elevations.map((_, index) => (index % course.width) * .2);
  } else if (id === "downhill") {
    course.elevations = course.elevations.map((_, index) => -(index % course.width) * .2);
  } else if (id === "sidehill") {
    course.elevations = course.elevations.map((_, index) => Math.floor(index / course.width) * .22);
    course.greenSurface = {
      version: 1,
      samplesPerAxis: 4,
      fixedPointScale: 1024,
      interpolation: "bilinear",
      tiles: Array.from({ length: course.width * course.height }, (_, index) => ({
        x: index % course.width,
        y: Math.floor(index / course.width),
        offsets: Array.from({ length: 16 }, (_, sample) => Math.round(Math.floor(sample / 4) / 3 * .22 * 1024)),
      })),
    };
  } else if (id === "false-front") {
    course.greenSurface = computeFineGreenSculptPreview({ course, points: [{ x: 2.2, y: 2.5 }, { x: 4.4, y: 2.5 }], brush: "tilt", radius: 1.5 }).surface;
  } else if (id === "bowl") {
    course.greenSurface = computeFineGreenSculptPreview({ course, points: [{ x: 5.5, y: 2.5 }], brush: "bowl", radius: 1.5 }).surface;
  } else if (id === "ridge") {
    course.greenSurface = computeFineGreenSculptPreview({ course, points: [{ x: 4.2, y: 1.4 }, { x: 6.8, y: 3.6 }], brush: "ridge", radius: 1.5 }).surface;
  } else if (id === "wet-slow") {
    course.greenProgram = createGreenProgram("receptive");
    course = localCondition(course, { health: .82, moisture: .9, compaction: .04, wear: .12 });
  } else if (id === "dry-fast") {
    course.greenProgram = createGreenProgram("championship");
    course = localCondition(course, { health: .96, moisture: .22, compaction: .72, wear: .04 });
  } else if (id === "worn") {
    course = localCondition(course, { health: .55, moisture: .4, compaction: .76, wear: .82 });
  } else if (id === "recovered") {
    course = localCondition(course, { health: .98, moisture: .58, compaction: .08, wear: .03 });
  } else if (id === "edge-pin") {
    course.tiles = course.tiles.map((terrain, index) => index % course.width === 9 ? "rough" : terrain);
    course.holes = [{ ...course.holes[0], green: { x: 8, y: 2 }, pinPositions: { A: { x: 8, y: 2 }, B: { x: 8, y: 1 }, C: { x: 8, y: 3 } } }];
    course.greenLocalState = createHealthyGreenLocalState(course);
  } else if (id === "severe-legal") {
    course.elevations = course.elevations.map((_, index) => -(index % course.width) * 1.15 + Math.floor(index / course.width) * .65);
    course.greenProgram = createGreenProgram("championship");
  }
  return withNormalizedGreenContract(course);
}

function rolloutForFixture(id: M62FixtureId): GreenRolloutV1 {
  const course = surfaceFixture(id);
  const wet = id === "wet-slow";
  const dry = id === "dry-fast";
  return resolveGreenRollout({
    course,
    holeId: "m62-rollout",
    landing: { x: id === "false-front" ? 3.8 : 1.25, y: 2.5 },
    direction: { x: id === "false-front" ? -1 : 1, y: 0 },
    requestedRollYards: id === "tiered" ? 75 : id === "severe-legal" ? 160 : 42,
    yardsPerTile: 10,
    club: "7 Iron",
    sourceLie: "fairway",
    launchAngleDegrees: 28,
    landingAngleDegrees: 42,
    trajectory: "standard",
    spin: "neutral",
    weather: wet ? { kind: "heavy_rain", rainInches: 1.2 } : dry ? { kind: "drought", rainInches: 0 } : { kind: "clear", rainInches: 0 },
    drainageLevel: wet ? 0 : dry ? 3 : 1,
    seed: M62_CERTIFICATION_SEED,
  });
}

function strategicCourse(rotation: PinRotation = "A"): Course {
  const width = 34;
  const height = 24;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  const elevations = new Array<number>(width * height).fill(0);
  for (let y = 7; y <= 16; y++) for (let x = 21; x <= 29; x++) {
    tiles[y * width + x] = "green";
    elevations[y * width + x] = x >= 26 ? 1 : y >= 12 ? .35 : 0;
  }
  for (let y = 5; y <= 10; y++) for (let x = 29; x <= 32; x++) tiles[y * width + x] = "water";
  for (let y = 15; y <= 19; y++) for (let x = 19; x <= 24; x++) tiles[y * width + x] = "sand";
  const tee = { x: 5, y: 12 };
  const hole = {
    id: "m62-strategy",
    name: "M62 strategy fixture",
    tee,
    green: { x: 23, y: 9 },
    teeBoxes: { member: tee },
    pinPositions: { A: { x: 23, y: 9 }, B: { x: 28, y: 13 }, C: { x: 25, y: 15 } },
    parMode: "MANUAL" as const,
    parManual: 3 as const,
  };
  const course: Course = {
    name: "M62 strategic green",
    width,
    height,
    tiles,
    elevations,
    holes: [hole],
    layouts: [{ id: "m62-strategy", name: "M62 strategy", draftHoleIds: [hole.id], publishedHoleIds: [hole.id], roundLength: 9, state: "open", greenFee: 65, legacyPartial: true }],
    activeCourseId: "m62-strategy",
    activePinRotation: rotation,
    obstacles: [],
    decorations: [],
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: .9,
    theme: "parkland",
    greenSurface: createFlatGreenSurfaceV1(),
    greenProgram: createGreenProgram("championship"),
  };
  const pinB = hole.pinPositions.B;
  course.greenSurface = {
    version: 1,
    samplesPerAxis: 4,
    fixedPointScale: 1024,
    interpolation: "bilinear",
    tiles: [{
      x: pinB.x,
      y: pinB.y,
      offsets: Array.from({ length: 16 }, (_, index) => Math.min(2048, ((index % 4) + Math.floor(index / 4)) * 348)),
    }],
  };
  course.greenLocalState = createHealthyGreenLocalState(course);
  return courseForCourseSetup(withNormalizedGreenContract(course), "member", rotation);
}

function buildFullEstateCourse(): Course {
  const source = createRenderPerfCourse("parkland");
  const width = 220;
  const height = 140;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  const holes: Course["holes"] = [];
  const obstacles: Course["obstacles"] = [];
  const decorations: NonNullable<Course["decorations"]> = [];
  const copies = [{ x: 0, y: 0 }, { x: 110, y: 70 }];
  for (const [copyIndex, offset] of copies.entries()) {
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const from = y * source.width + x;
      const to = (y + offset.y) * width + x + offset.x;
      tiles[to] = source.tiles[from];
      elevations[to] = source.elevations[from];
    }
    for (const [holeIndex, sourceHole] of source.holes.entries()) {
      const translate = (point: Point | null | undefined): Point | null => point ? { x: point.x + offset.x, y: point.y + offset.y } : null;
      const green = translate(sourceHole.green)!;
      const tee = translate(sourceHole.tee)!;
      holes.push({
        ...sourceHole,
        id: `m62-hole-${copyIndex * 18 + holeIndex + 1}`,
        tee,
        green,
        teeBoxes: { member: tee },
        pinPositions: {
          A: green,
          B: { x: green.x - 1, y: green.y },
          C: { x: green.x + 1, y: green.y },
        },
      });
    }
    obstacles.push(...source.obstacles.map((item) => ({ ...item, x: item.x + offset.x, y: item.y + offset.y })));
    decorations.push(...(source.decorations ?? []).map((item) => ({ ...item, x: item.x + offset.x, y: item.y + offset.y })));
  }
  const holeIds = holes.map((hole) => hole.id!);
  const course: Course = {
    ...source,
    name: "M62 220x140 release estate",
    width,
    height,
    tiles,
    elevations,
    holes,
    obstacles,
    decorations,
    buildings: [],
    layouts: [{ id: "m62-full-estate", name: "M62 full estate", draftHoleIds: holeIds, publishedHoleIds: holeIds, roundLength: 18, state: "open", greenFee: 95, legacyPartial: true }],
    activeCourseId: "m62-full-estate",
    activePinRotation: "A",
    greenSurface: createFlatGreenSurfaceV1(),
    greenProgram: createGreenProgram("balanced"),
  };
  course.greenLocalState = createHealthyGreenLocalState(course);
  return withNormalizedGreenContract(course);
}

function playerReadyCourse(source: Course): Course {
  const first = source.holes[0];
  const holes = Array.from({ length: 3 }, (_, index) => ({
    ...structuredClone(first),
    id: index === 0 ? "m62-strategy" : `m62-strategy-${index + 1}`,
    name: `M62 strategy fixture ${index + 1}`,
  }));
  const holeIds = holes.map((hole) => hole.id);
  const course: Course = {
    ...source,
    holes,
    layouts: [{ id: "m62-strategy", name: "M62 strategy", draftHoleIds: holeIds, publishedHoleIds: holeIds, roundLength: 9, state: "open", greenFee: 65, legacyPartial: true }],
  };
  course.greenLocalState = createHealthyGreenLocalState(course);
  return withNormalizedGreenContract(course);
}

async function resignPackage<T extends { manifest: { checksum: string }; payload: unknown }>(value: T): Promise<T> {
  const next = structuredClone(value);
  const { checksum: _checksum, ...manifest } = next.manifest;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPackageJson({ manifest, payload: next.payload })));
  next.manifest.checksum = [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
  return next;
}

function parityEvidence(sourceCourse: Course) {
  const course = playerReadyCourse(sourceCourse);
  const world: World = {
    ...structuredClone(DEFAULT_WORLD),
    runSeed: M62_CERTIFICATION_SEED,
    playerPro: createDefaultPlayerPro({ seed: M62_CERTIFICATION_SEED, name: "M62 Certifier" }),
  };
  const started = startPlayableRound({ course, world, layoutId: "m62-strategy", teeSet: "member", pinRotation: "A" });
  if (!started.ok) throw new Error(started.reason);
  const playable = { ...started.round, ball: { x: 19, y: 10 }, lie: "fairway" as const };
  const pin = playable.course.holes[0].pin;
  let selection: { club: string; aim: Point; power: number; technique: "normal" } | null = null;
  let preview: ReturnType<typeof previewPlayableShot> | null = null;
  for (let power = .18; power <= .9; power += .02) {
    const candidate = { club: "Pitching Wedge", aim: pin, power: Number(power.toFixed(2)), technique: "normal" as const };
    const result = previewPlayableShot(playable, world.playerPro!.skills, candidate);
    const candidateCommitted = commitPlayerShot(playable, world.playerPro!.skills, candidate);
    if (result.greenRollout && candidateCommitted.pendingShot?.greenPutting) {
      selection = candidate;
      preview = result;
      break;
    }
  }
  if (!selection || !preview) throw new Error("M62 parity fixture could not find a deterministic green arrival");
  const committed = commitPlayerShot(playable, world.playerPro!.skills, selection);
  const finished = finishPlayerShot(committed);
  const completed = autoFinishPlayerRound(finished, world.playerPro!.skills);
  const settlement = settlePlayerRound(world.playerPro!, completed);
  if (!settlement.round) throw new Error("M62 parity fixture did not settle its one-hole round");
  const recorded = recordPlayerRoundArchitecture(world, completed, settlement.round);
  const architecture = buildArchitectureReview(course, recorded.world, {
    ...defaultArchitectureFilters(course),
    sourceSegment: "player-pro",
  });
  const trace = architecture.evidence.find((item) => item.id.includes(settlement.round!.id));

  const liveCapabilities = capabilities(7);
  const liveIntent = {
    id: "m62-shared-parity",
    kind: "approach" as const,
    from: playable.ball,
    target: selection.aim,
    club: selection.club,
    power: selection.power,
    technique: selection.technique,
    expectedStrokes: 1,
    variance: 0,
    hazardRisk: 0,
    nextShotQuality: 1,
    facts: [],
  };
  const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
  const sharedSeed = 62_645_007;
  const live = resolveLiveShot({ snapshot, capabilities: liveCapabilities, holeId: "m62-strategy", shotNumber: 1, from: playable.ball, lie: "fairway", intent: liveIntent, seed: sharedSeed });
  const player = resolvePlayableShot({
    snapshot,
    holeId: "m62-strategy",
    shotNumber: 1,
    from: playable.ball,
    lie: "fairway",
    skills: capabilitiesToPlayerSkills(liveCapabilities),
    selection: { club: liveIntent.club, aim: liveIntent.target, power: liveIntent.power, technique: liveIntent.technique },
    handedness: stableGolferHandedness(liveCapabilities.seed),
    seed: sharedSeed,
  });
  return {
    passed: canonicalJson(preview.sharedOutcome) === canonicalJson(committed.pendingShot?.sharedOutcome)
      && canonicalJson(preview.greenRollout) === canonicalJson(committed.pendingShot?.greenRollout)
      && committed.pendingShot?.greenPutting != null
      && finished.shots[0]?.greenPutting?.putts === committed.pendingShot.greenPutting.putts
      && finished.scorecard[0]?.strokes === 1 + committed.pendingShot.greenPutting.putts
      && canonicalJson(settlement.round.shots[0]?.greenRollout) === canonicalJson(preview.greenRollout)
      && canonicalJson(trace?.greenRollout) === canonicalJson(preview.greenRollout)
      && canonicalJson(live.sharedOutcome) === canonicalJson(player.sharedOutcome)
      && canonicalJson(live.greenRollout) === canonicalJson(player.greenRollout)
      && canonicalJson(live.greenPutting) === canonicalJson(player.greenPutting),
    shot: settlement.round.shots[0],
    scorecard: completed.scorecard[0],
    architectureEvidence: trace,
    live,
    player,
  };
}

/**
 * Runs the deterministic, machine-verifiable portion of the M62 release gate.
 * Human authenticity and physical-device judgments are deliberately returned
 * as open gates rather than converted into synthetic pass results.
 */
export async function runM62Certification(): Promise<M62CertificationReport> {
  const checks: M62CertificationCheck[] = [];
  const fixtureRows = M62_FIXTURE_IDS.map((id) => {
    const first = rolloutForFixture(id);
    const second = rolloutForFixture(id);
    const course = surfaceFixture(id);
    return {
      id,
      rollout: first,
      deterministic: canonicalJson(first) === canonicalJson(second),
      valid: isValidGreenRollout(first),
      geometryVersion: greenGeometryVersion(course),
      fineTiles: course.greenSurface?.tiles.length ?? 0,
    };
  });
  const row = (id: M62FixtureId) => fixtureRows.find((item) => item.id === id)!;
  const fixtureHashes = fixtureRows.map((item) => hashCanonicalValue(item.rollout));
  const fixtureRelations = {
    uphillShorter: row("uphill").rollout.rollYards < row("level").rollout.rollYards,
    downhillLonger: row("downhill").rollout.rollYards > row("level").rollout.rollYards,
    sidehillBreaks: Math.abs(row("sidehill").rollout.breakTiles) > Math.abs(row("level").rollout.breakTiles),
    wetShorterThanDry: row("wet-slow").rollout.rollYards < row("dry-fast").rollout.rollYards,
    bowlFine: row("bowl").fineTiles > 0,
    ridgeFine: row("ridge").fineTiles > 0,
    falseFrontFine: row("false-front").fineTiles > 0,
  };
  const invalidFixtures = fixtureRows.filter((item) => !item.deterministic || !item.valid || item.rollout.path.length > GREEN_ROLLOUT_MAX_PATH_POINTS || item.rollout.evidence.steps > GREEN_ROLLOUT_MAX_STEPS).map((item) => item.id);
  const relationalPhysics = Object.values(fixtureRelations).every(Boolean);
  checks.push(check(
    "named-green-fixture-matrix",
    fixtureRows.length === M62_FIXTURE_IDS.length
      && fixtureRows.every((item) => item.deterministic && item.valid && item.rollout.path.length <= GREEN_ROLLOUT_MAX_PATH_POINTS && item.rollout.evidence.steps <= GREEN_ROLLOUT_MAX_STEPS)
      && relationalPhysics,
    `${fixtureRows.length} named fixtures produced bounded byte-stable rollout evidence with ${new Set(fixtureHashes).size} distinct hashes; invalid=${invalidFixtures.join(",") || "none"}; relations=${canonicalJson(fixtureRelations)}.`,
  ));

  const strategy = strategicCourse();
  const strategySnapshot = liveCourseSnapshot({ course: strategy, teeSet: "member", pinRotation: "A" });
  const aiRows = Array.from({ length: 100 }, (_, index) => {
    const golfer = capabilities(index);
    const candidates = planGreenLandingZones({
      course: strategy,
      hole: strategy.holes[0],
      from: strategy.holes[0].tee!,
      lie: "tee",
      capabilities: golfer,
      personality: {
        ...personality,
        prefs: { ...personality.prefs, difficulty: golfer.riskStyle === "conservative" ? -.8 : golfer.riskStyle === "aggressive" ? .8 : 0 },
      },
      snapshot: strategySnapshot,
    });
    return { seed: golfer.seed, target: candidates[0]?.target, role: candidates[0]?.role, count: candidates.length };
  });
  const targetKeys = new Set(aiRows.map((item) => `${item.target?.x},${item.target?.y}`));
  const roles = new Set(aiRows.map((item) => item.role));
  checks.push(check(
    "ai-differentiation-no-universal-target",
    aiRows.length === 100 && aiRows.every((item) => item.count > 0 && item.count <= 16) && targetKeys.size >= 3 && roles.size >= 3,
    `100 capability/style cohorts selected ${targetKeys.size} preferred targets across ${roles.size} green roles; every candidate set stayed within 16.`,
  ));

  const pin = strategySnapshot.holes[0].pin;
  const puttingScenarios = [
    { id: "strong-close", rest: pin, skills: { putting: 96, shortGame: 92, recovery: 90 } },
    { id: "balanced-medium", rest: { x: pin.x - 1.4, y: pin.y }, skills: { putting: 62, shortGame: 58, recovery: 60 } },
    { id: "weak-long", rest: { x: pin.x - 3.2, y: pin.y + 1 }, skills: { putting: 25, shortGame: 30, recovery: 28 } },
  ];
  const puttingRows = puttingScenarios.map((scenario) => {
    const estimate = estimateAutomaticPutts({ snapshot: strategySnapshot, holeId: "m62-strategy", rest: scenario.rest, skills: scenario.skills });
    const outcomes = Array.from({ length: 256 }, (_, seed) => resolveAutomaticPutts({ snapshot: strategySnapshot, holeId: "m62-strategy", rest: scenario.rest, skills: scenario.skills, seed }));
    return { id: scenario.id, estimate, outcomes, repeated: resolveAutomaticPutts({ snapshot: strategySnapshot, holeId: "m62-strategy", rest: scenario.rest, skills: scenario.skills, seed: 42 }) };
  });
  const puttValues = [...new Set(puttingRows.flatMap((item) => item.outcomes.map((outcome) => outcome.putts)))].sort();
  checks.push(check(
    "automatic-putting-1-3-and-skill",
    canonicalJson(puttingRows[0].repeated) === canonicalJson(puttingRows[0].outcomes[42])
      && puttingRows[0].estimate.expectedPutts < puttingRows[1].estimate.expectedPutts
      && puttingRows[1].estimate.expectedPutts < puttingRows[2].estimate.expectedPutts
      && canonicalJson(puttValues) === canonicalJson([1, 2, 3]),
    `Fixed frozen inputs resolved the complete 1–3 putt domain; expected putts increased monotonically from strong/close to weak/long.`,
  ));

  const rotations = (["A", "B", "C"] as const).map((rotation) => ({
    rotation,
    fairness: analyzePinRotation(strategicCourse(rotation), rotation),
    rating: computeRatingForSetup(strategicCourse(rotation), "member", rotation),
  }));
  const severe = analyzePinFairness(surfaceFixture("severe-legal"), surfaceFixture("severe-legal").holes[0], { x: 8, y: 2 }, "A");
  const edge = analyzePinFairness(surfaceFixture("edge-pin"), surfaceFixture("edge-pin").holes[0], { x: 8, y: 2 }, "A");
  const tournament = evaluateTournamentCourseQualification(strategicCourse(), "local");
  const pinRequirement = tournament.requirements.find((item) => item.id === "pin-fairness");
  checks.push(check(
    "abc-pin-rating-pace-complaint-tournament-consequences",
    rotations.every((item) => item.fairness.configuredHoles === 1 && item.fairness.legalHoles === 1)
      && new Set(rotations.map((item) => item.fairness.difficulty)).size >= 2
      && new Set(rotations.map((item) => item.rating.pinDifficultyDelta)).size >= 2
      && rotations.every((item) => Number.isFinite(item.fairness.paceMinutesDelta) && Number.isFinite(item.fairness.satisfactionDelta) && Number.isFinite(item.fairness.complaintRisk))
      && severe.legal && severe.warnings.length > 0 && edge.legal && edge.warnings.some((item) => item.code === "EDGE_PROXIMITY")
      && pinRequirement != null && pinRequirement.label.includes(`Pin ${tournament.pinRotation}`),
    `A/B/C stayed physically legal and produced distinct difficulty/rating evidence plus bounded pace, satisfaction, complaint, and tournament-readiness consequences; edge and severe legal pins remained warning-only.`,
  ));

  const maintenanceWorld = (overrides: Partial<World>): World => ({
    ...structuredClone(DEFAULT_WORLD),
    maintenanceBudget: 0,
    staffLevel: 0,
    staffRoster: [],
    ...overrides,
  });
  const programs = (["receptive", "balanced", "championship"] as const).map((preset) => {
    const course = { ...strategicCourse(), greenProgram: createGreenProgram(preset) };
    const result = advanceGreenKeepingDay({ course, world: maintenanceWorld({ maintenanceBudget: 4_000, staffLevel: 1 }), absoluteDay: 62, weather: fixtureWeather(), drainageLevel: 2, waterPolicy: "balanced", rounds: 42 });
    return { preset, required: requiredGreenKeepingBudget(course), report: result.report };
  });
  const neglected = advanceGreenKeepingDay({ course: { ...strategicCourse(), greenProgram: createGreenProgram("championship") }, world: maintenanceWorld({}), absoluteDay: 62, weather: fixtureWeather({ kind: "drought", temperatureF: 99 }), drainageLevel: 0, waterPolicy: "conserve", rounds: 100 });
  let recoveredCourse = neglected.course;
  let recoveredReport = neglected.report;
  for (let day = 63; day <= 69; day++) {
    const result = advanceGreenKeepingDay({ course: recoveredCourse, world: maintenanceWorld({ maintenanceBudget: 6_000, staffLevel: 1 }), absoluteDay: day, weather: fixtureWeather({ absoluteDay: day, kind: "rain", rainInches: .08 }), drainageLevel: 3, waterPolicy: "irrigate", rounds: 0, closedHoleIds: ["m62-strategy"] });
    recoveredCourse = result.course;
    recoveredReport = result.report;
  }
  checks.push(check(
    "maintenance-tradeoffs-wear-recovery-and-operations",
    programs[0].required < programs[1].required && programs[1].required < programs[2].required
      && new Set(programs.map((item) => item.report.realizedSpeedFeet)).size === 3
      && programs.every((item) => Number.isFinite(item.report.paceMinutesDelta) && Number.isFinite(item.report.satisfactionDelta))
      && recoveredReport.averageHealth > neglected.report.averageHealth
      && recoveredReport.averageWear < neglected.report.averageWear,
    `Receptive/balanced/championship exposed increasing cost and distinct realized speed (no universally dominant program); neglected greens accumulated operational harm and a seven-day closed/rested intervention recovered health and wear.`,
  ));

  const parity = parityEvidence(strategicCourse());
  checks.push(check(
    "preview-execution-scorecard-replay-trace-architecture-parity",
    parity.passed,
    `Player preview/commit, automatic scorecard settlement, completed-round replay evidence, Architecture Review trace, and live/Player shared physics retained one M62 rollout/putting outcome.`,
  ));

  const packageCourse = withNormalizedGreenContract(createTournamentStandardsCourse());
  const packed = await createCoursePackage({
    course: packageCourse,
    title: "M62 certification package",
    description: "Deterministic strategic-green portability fixture.",
    author: { id: "m62-certifier", displayName: "M62 Certifier" },
    requiredGameVersion: "1.0.0",
    now: new Date("2026-08-03T00:00:00.000Z"),
  });
  const compatible = await validatePackageText(packageText(packed));
  const hostile = structuredClone(packed);
  hostile.payload.course.greenSurface!.tiles = [{ x: -1, y: 0, offsets: new Array(16).fill(99_999) }];
  const hostileResult = await validatePackageText(packageText(await resignPackage(hostile)));

  const parityCourse = playerReadyCourse(strategicCourse());
  const v23 = normalizeLoadedSaveResult({ schemaVersion: 23, savedAt: 23, course: parityCourse, world: DEFAULT_WORLD });
  const career = createDefaultPlayerPro({ seed: M62_CERTIFICATION_SEED, name: "M62 Resume" });
  const resumableWorld = { ...structuredClone(DEFAULT_WORLD), playerPro: career };
  const resumable = startPlayableRound({ course: parityCourse, world: resumableWorld, layoutId: "m62-strategy", teeSet: "member", pinRotation: "B" });
  if (!resumable.ok) throw new Error(resumable.reason);
  const legacyActive = structuredClone(resumable.round);
  delete legacyActive.course.greenSnapshot;
  const v24 = normalizeLoadedSaveResult({ schemaVersion: 24, savedAt: 24, course: parityCourse, world: { ...resumableWorld, playerPro: { ...career, activeRound: legacyActive } } });
  const malformed = normalizeLoadedSaveResult({
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: 26,
    course: parityCourse,
    world: {
      ...resumableWorld,
      playerPro: {
        ...career,
        rounds: [{ id: "historical-m62", kind: "casual", courseId: "m62-strategy", courseName: "M62 strategic green", week: 1, strokes: 3, penalties: 0, par: 3, scoreToPar: 0, result: "complete", earnings: 0, scorecard: [], shots: [{ id: "historical-shot", seed: 7, greenRollout: { version: 99 } }], evidence: [], skillGains: {} }],
        activeRound: { ...resumable.round, course: { ...resumable.round.course, greenSnapshot: { version: 99 } } },
      },
    },
  });
  const v24Snapshot = v24.ok ? v24.payload.world.playerPro?.activeRound?.course.greenSnapshot : undefined;
  const malformedHistory = malformed.ok ? malformed.payload.world.playerPro?.rounds[0] : undefined;
  checks.push(check(
    "v23-v24-save-resume-freezing-history-malformed-package",
    v23.ok && v23.migratedFrom === 23
      && v24.ok && v24.migratedFrom === 24 && v24Snapshot?.geometryVersion === greenGeometryVersion(parityCourse)
      && v24Snapshot?.program.preset === parityCourse.greenProgram?.preset
      && malformed.ok && malformed.payload.world.playerPro?.activeRound == null
      && malformedHistory?.id === "historical-m62" && malformedHistory.shots[0]?.id === "historical-shot" && malformedHistory.shots[0]?.greenRollout == null
      && compatible.status === "compatible" && hostileResult.status === "corrupt",
    `v23 migrated to schema ${CURRENT_SAVE_SCHEMA_VERSION}; v24 rebuilt and froze the active green carrier; malformed active evidence was isolated while completed round/shot identity was preserved and its malformed carrier sanitized; signed hostile package contours were rejected.`,
  ));

  const fullEstateStarted = performance.now();
  const fullEstate = buildFullEstateCourse();
  const live = createRenderPerfLiveState(fullEstate, { ...structuredClone(DEFAULT_WORLD), runSeed: M62_CERTIFICATION_SEED, cash: 1_000_000, reputation: 95 });
  const fullEstateFixtureMs = performance.now() - fullEstateStarted;
  const liveSnapshot = snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "paused", selectedGolferId: null });
  const liveSnapshotText = JSON.stringify(liveSnapshot);
  const restoredLive = restoreLiveSimulation(JSON.parse(liveSnapshotText));
  const fullEstateSave = payloadForPersistence({ course: fullEstate, world: DEFAULT_WORLD });
  const currentSave = payloadForPersistence({ course: parityCourse, world: v24.ok ? v24.payload.world : resumableWorld });
  checks.push(check(
    "full-estate-36-hole-100-golfer-bounded-snapshots",
    fullEstate.width === 220 && fullEstate.height === 140 && fullEstate.tiles.length === 30_800
      && fullEstate.holes.length === 36 && fullEstate.greenLocalState?.holes.length === 36
      && live.golfers.length === 100 && restoredLive?.state.golfers.length === 100
      && bytes(liveSnapshotText) < 1_000_000 && bytes(fullEstateSave) < 5_000_000
      && fullEstateFixtureMs < 15_000,
    `The 220×140/30,800-cell estate carried 36 green contracts and 100 active golfers; live and course snapshots round-tripped below 1 MiB and 5 MiB in ${fullEstateFixtureMs.toFixed(1)} ms.`,
  ));

  const architectureStarted = performance.now();
  const architectureFilters = {
    kind: "green-rollout" as const,
    holeId: fullEstate.holes[0].id!,
    teeSet: "member" as const,
    pinRotation: "all" as const,
    cohortId: "all" as const,
  };
  const productionGeometryVersion = greenGeometryVersion(fullEstate);
  const architecture = buildGreenStrategyHeatmap({ course: fullEstate, filters: architectureFilters, evidence: [], currentGeometryVersion: productionGeometryVersion });
  const architectureRepeated = buildGreenStrategyHeatmap({ course: fullEstate, filters: architectureFilters, evidence: [], currentGeometryVersion: productionGeometryVersion });
  const architectureMs = performance.now() - architectureStarted;
  const architectureItems = architecture.overlay.cells.length + architecture.overlay.points.length + architecture.overlay.traces.length;
  const sculpted = surfaceFixture("ridge");
  const standardOverlay = buildGreenSurfaceOverlayCommands({ course: sculpted, quality: "high", colorVision: "standard" });
  const cvdOverlay = buildGreenSurfaceOverlayCommands({ course: sculpted, quality: "high", colorVision: "deuteranopia" });
  const reviewCourse = strategicCourse();
  const reviewFilters = { ...defaultArchitectureFilters(reviewCourse), kind: "green-rollout" as const, holeId: "m62-strategy", teeSet: "member" as const, pinRotation: "all" as const, cohortId: "all" as const };
  const baseReview = buildArchitectureReview(reviewCourse, DEFAULT_WORLD, reviewFilters);
  const integratedReview = withGreenStrategyHeatmap(baseReview, buildGreenStrategyHeatmapForReview({ course: reviewCourse, filters: reviewFilters, evidence: baseReview.evidence, currentGeometryVersion: baseReview.currentGeometryVersion }));
  checks.push(check(
    "architecture-accessibility-and-bounded-overlays",
    canonicalJson(architecture) === canonicalJson(architectureRepeated)
      && architecture.predictiveSamples > 0 && architecture.overlay.traces.length <= GREEN_STRATEGY_MAX_OVERLAY_ITEMS
      && architecture.reducedMotionSafe && architecture.legend.every((item) => item.pattern && item.meaning)
      && architecture.textSummary.includes("Forecast on current geometry")
      && architectureItems > 0 && bytes(architecture) < 256_000 && architectureMs < 30_000
      && standardOverlay.contours.length + standardOverlay.arrows.length + standardOverlay.fallLines.length + standardOverlay.shades.length <= GREEN_OVERLAY_COMMAND_BUDGET
      && canonicalJson(standardOverlay.contours) === canonicalJson(cvdOverlay.contours)
      && canonicalJson(standardOverlay.arrows) === canonicalJson(cvdOverlay.arrows)
      && integratedReview.greenStrategy?.forecastGeometryVersion === baseReview.currentGeometryVersion,
    `Architecture sampling was deterministic in ${architectureMs.toFixed(1)} ms, retained ${architectureItems} bounded static-pattern overlay items plus text evidence, preserved contour/arrow geometry across color-vision palettes, and integrated with the current review geometry.`,
  ));

  const hashes = {
    fixtures: hashCanonicalValue(fixtureRows.map((item) => ({ id: item.id, rollout: item.rollout, geometryVersion: item.geometryVersion }))),
    ai: hashCanonicalValue(aiRows),
    putting: hashCanonicalValue(puttingRows),
    consequences: hashCanonicalValue({ rotations, programs, neglected: neglected.report, recovered: recoveredReport, tournament: pinRequirement }),
    compatibility: hashCanonicalValue({ v23: v23.ok ? v23.payload.course : v23, v24: v24.ok ? v24Snapshot : v24, malformedHistory, packageManifest: packed.manifest }),
    architecture: hashCanonicalValue({ architecture, standardOverlay, integrated: integratedReview.greenStrategy }),
    fullEstate: hashCanonicalValue({ course: fullEstate, live: liveSnapshot }),
  };
  return {
    version: 1,
    fixture: {
      seed: M62_CERTIFICATION_SEED,
      width: fullEstate.width,
      height: fullEstate.height,
      holes: fullEstate.holes.length,
      activeGolfers: live.golfers.length,
      greenFixtures: [...M62_FIXTURE_IDS],
    },
    checks,
    metrics: {
      fixtureCases: fixtureRows.length,
      distinctFixtureHashes: new Set(fixtureHashes).size,
      aiCohorts: aiRows.length,
      aiPreferredTargets: targetKeys.size,
      aiPreferredRoles: roles.size,
      automaticPuttValues: puttValues,
      pinRotations: rotations.length,
      maintenancePrograms: programs.length,
      packageBytes: bytes(packageText(packed)),
      currentSaveBytes: bytes(currentSave),
      fullEstateSaveBytes: bytes(fullEstateSave),
      liveSnapshotBytes: bytes(liveSnapshotText),
      architectureSamples: architecture.predictiveSamples,
      architectureOverlayItems: architectureItems,
      architectureBytes: bytes(architecture),
      fullEstateFixtureMs,
      architectureMs,
    },
    hashes,
    determinismHash: hashCanonicalValue(hashes),
    remainingHumanGates: M62_REMAINING_HUMAN_GATES,
    passed: checks.every((item) => item.passed),
  };
}
