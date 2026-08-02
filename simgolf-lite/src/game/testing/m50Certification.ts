import type { Course, Obstacle, Point, Terrain, World } from "../models/types";
import type {
  PlayerPlayableRound,
  PlayerRoundCourseSnapshot,
} from "../models/playerProTypes";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import {
  autoFinishPlayerRound,
  caddieRecommendation,
  commitPlayerShot,
  createDefaultPlayerPro,
  finishPlayerShot,
  previewPlayableShot,
  resolvePlayableShot,
  settlePlayerRound,
  startPlayableRound,
  type PlayerShotSelection,
} from "../playerPro/playerPro";
import { M47_MAX_OUTCOMES, type GolferCapabilities } from "../live/m47Types";
import type { Personality } from "../live/personality";
import { capabilitiesToPlayerSkills } from "../live/capabilities";
import { liveCourseSnapshot, resolveLiveShot } from "../live/livePhysics";
import {
  followUpIntent,
  generateRecoveryCandidates,
} from "../live/strategicOptions";
import {
  availableShotClubs,
  calculateLieEffect,
} from "../rules/shotEffects";
import {
  isValidSharedShotOutcome,
  type ShotLie,
} from "../rules/contracts";
import { resolveObstacleCollision } from "../rules/obstacleCollision";
import {
  createControlledRoundSnapshotV2,
  decodeControlledRoundSnapshotV2,
  type ControlledRoundSnapshotV2,
  type HolePenaltyClassification,
} from "../rules/roundSnapshot";
import {
  distanceBetween,
  locatePenaltyAreaPoint,
  type PenaltyRulesSnapshot,
} from "../rules/penaltyAreas";
import { resolveSharedRules } from "../rules/sharedOutcome";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { hashCanonicalValue } from "../../utils/stateHash";
import {
  normalizeLivingClub,
  recordPlayerRoundArchitecture,
} from "../livingClub/livingClub";
import {
  buildArchitectureReview,
  defaultArchitectureFilters,
} from "../architecture/review";
import {
  createPlayerProReferenceCourse,
} from "./referenceCourse";
import { createM47CertificationCourse } from "./m47Certification";
import { buildStrategicGolferRound } from "../live/m47Round";
import {
  createRenderPerfLiveState,
  liveRenderData,
} from "../live/simulation";
import { mulberry32 } from "../../utils/rng";
import { createCampaignRun } from "../campaign/campaign";
import { COURSE_HEIGHT, COURSE_WIDTH } from "../models/constants";
import { createEstate } from "../estate/estate";

export interface M50CertificationCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface M50CertificationReport {
  version: 1;
  checks: M50CertificationCheck[];
  metrics: {
    recoveryCandidates: number;
    recoveryShapes: number;
    penaltyCases: number;
    previewParityCases: number;
    migrationHistoryRounds: number;
    hostileNormalizationCases: number;
    boundedPlayerRounds: number;
    boundedAiHoles: number;
    boundedAiOutcomes: number;
    fuzzShots: number;
    architectureEvidence: number;
    performanceWidth: number;
    performanceHeight: number;
    performanceCells: number;
    performanceHoles: number;
    performanceGolfers: number;
    performanceIterations: number;
    performanceAiRoundMs: number;
    performanceFixtureMs: number;
    performanceAverageRenderStateMs: number;
  };
  determinismHash: string;
  remainingHumanGates: readonly string[];
  passed: boolean;
}

export const M50_REMAINING_HUMAN_GATES = [
  "Three-biome Playwright screenshots for boundary, flight, collision, ruling, relief, and next-shot presentation.",
  "Keyboard-only, screen-reader, reduced-motion, text-scaling, and color-independent-marking accessibility checks.",
  "Human listening checks for shot, collision, penalty, relief, scorecard, and reaction audio presentation.",
  "Real-hardware GPU frame pacing and full-estate browser performance.",
  "Human golf-authenticity and balance review across Player Pro, live golf, matches, tournaments, and campaign play.",
  "Provider-backed packaging, distribution, and hosted-release checks, if required by the release process.",
  "Release-owner assignment of the final integration commit and release disposition.",
] as const;

const RECOVERY_PERSONALITY: Personality = {
  skill: 0.7,
  consistency: 0.72,
  patience: 0.55,
  spendPropensity: 0.5,
  prefs: { difficulty: 0, scenery: 0, price: 0 },
};

const RECOVERY_CAPABILITIES: GolferCapabilities = {
  version: 1,
  seed: 50_553,
  power: 78,
  accuracy: 82,
  irons: 80,
  shortGame: 76,
  recovery: 88,
  consistency: 84,
  riskTolerance: 0.52,
  challengeSeeking: 0.5,
  sceneryAffinity: 0.5,
  valueSensitivity: 0.5,
  riskStyle: "balanced",
  strengths: ["recovery", "accuracy"],
  weaknesses: ["power", "shortGame"],
};

function check(id: string, passed: boolean, detail: string): M50CertificationCheck {
  return { id, passed, detail };
}

function finiteTree(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (value && typeof value === "object") return Object.values(value).every(finiteTree);
  return true;
}

function setTile(tiles: Terrain[], width: number, point: Point, terrain: Terrain): void {
  tiles[Math.floor(point.y) * width + Math.floor(point.x)] = terrain;
}

function recoveryCourse(obstacles: Obstacle[] = [{ type: "tree", x: 15, y: 12.5 }]): Course {
  const width = 52;
  const height = 25;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const tee = { x: 3, y: 12 };
  const green = { x: 47, y: 12 };
  setTile(tiles, width, tee, "tee");
  for (let y = green.y - 1; y <= green.y + 1; y++) {
    for (let x = green.x - 1; x <= green.x + 1; x++) setTile(tiles, width, { x, y }, "green");
  }
  return {
    name: "M50 Recovery Certification",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{
      id: "m50-recovery-hole",
      name: "Recovery Matrix",
      tee,
      green,
      parMode: "MANUAL",
      parManual: 4,
    }],
    obstacles,
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 60,
    condition: 0.9,
    theme: "parkland",
  };
}

function fullEstateCertificationCourse(): Course {
  const compact = createM47CertificationCourse(36);
  const offset = { x: Math.floor((COURSE_WIDTH - compact.width) / 2), y: 12 };
  const tiles = new Array<Terrain>(COURSE_WIDTH * COURSE_HEIGHT).fill("rough");
  const elevations = new Array<number>(COURSE_WIDTH * COURSE_HEIGHT).fill(0);
  for (let y = 0; y < compact.height; y++) {
    for (let x = 0; x < compact.width; x++) {
      const source = y * compact.width + x;
      const target = (y + offset.y) * COURSE_WIDTH + x + offset.x;
      tiles[target] = compact.tiles[source];
      elevations[target] = compact.elevations[source];
    }
  }
  const translate = (point: Point): Point => ({ x: point.x + offset.x, y: point.y + offset.y });
  const holes = compact.holes.map((hole) => ({
    ...hole,
    tee: hole.tee ? translate(hole.tee) : null,
    green: hole.green ? translate(hole.green) : null,
    waypoints: hole.waypoints?.map(translate),
  }));
  const obstacleRecoveryMatrix: Obstacle[] = holes.flatMap((hole, index) => {
    if (!hole.tee || !hole.green) return [];
    return [{
      type: index % 5 === 0 ? "rock" as const : index % 3 === 0 ? "bush" as const : "tree" as const,
      x: Number(((hole.tee.x + hole.green.x) / 2).toFixed(3)),
      y: Number((((hole.tee.y + hole.green.y) / 2) + (index % 2 ? 0.65 : -0.65)).toFixed(3)),
    }];
  });
  const holeIds = holes.map((hole) => hole.id!);
  const course: Course = {
    ...compact,
    name: "M50 Full-Estate Rules Certification",
    width: COURSE_WIDTH,
    height: COURSE_HEIGHT,
    tiles,
    elevations,
    holes,
    obstacles: obstacleRecoveryMatrix,
    buildings: compact.buildings.map((building) => ({
      ...building,
      x: building.x + offset.x,
      y: building.y + offset.y,
    })),
    layouts: [{
      id: "m50-full-estate",
      name: "M50 Full Estate",
      draftHoleIds: holeIds,
      publishedHoleIds: holeIds,
      roundLength: 18,
      state: "open",
      greenFee: compact.baseGreenFee,
      legacyPartial: true,
    }],
    activeCourseId: "m50-full-estate",
  };
  const estate = createEstate(course, 50_553);
  course.estate = {
    ...estate,
    ownedParcelIds: estate.parcels.map((parcel) => parcel.id),
  };
  return course;
}

function factDetail(
  candidate: ReturnType<typeof generateRecoveryCandidates>[number],
  code: string,
): string {
  return candidate.facts.find((fact) => fact.code === code)?.detail ?? "";
}

function recoveryShape(
  candidate: ReturnType<typeof generateRecoveryCandidates>[number],
): string | undefined {
  return factDetail(candidate, "context").match(/shape:(around|under|over)/)?.[1];
}

interface RulesFixture {
  frozen: ControlledRoundSnapshotV2;
  snapshot: PenaltyRulesSnapshot;
  classification: HolePenaltyClassification;
  hole: Point;
}

function rulesFixture(): RulesFixture {
  const width = 12;
  const height = 8;
  const cells = width * height;
  const inBounds = new Array<boolean>(cells).fill(true);
  const penaltyMask = new Array<boolean>(cells).fill(false);
  for (const point of [{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 7, y: 5 }, { x: 7, y: 6 }]) {
    penaltyMask[point.y * width + point.x] = true;
  }
  const classification = {
    holeId: "m50-rules-hole",
    red: [1],
    yellow: [2],
  };
  const created = createControlledRoundSnapshotV2({
    width,
    height,
    inBounds,
    penaltyMask,
    holeClassifications: [classification],
  });
  if (!created.ok) throw new Error(created.error.message);
  const decoded = decodeControlledRoundSnapshotV2(created.value);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return {
    frozen: created.value,
    snapshot: {
      width,
      height,
      inBounds: decoded.value.inBounds,
      penaltyComponents: decoded.value.penaltyComponents,
      components: decoded.value.components,
    },
    classification,
    hole: { x: 10, y: 4 },
  };
}

function playerSnapshot(fixture: RulesFixture): PlayerRoundCourseSnapshot {
  const tiles = new Array<Terrain>(fixture.snapshot.width * fixture.snapshot.height).fill("fairway");
  fixture.snapshot.penaltyComponents.forEach((component, index) => {
    if (component > 0) tiles[index] = "water";
  });
  return {
    courseId: "m50-rules-course",
    courseName: "M50 Rules Matrix",
    theme: "parkland",
    width: fixture.snapshot.width,
    height: fixture.snapshot.height,
    yardsPerTile: 10,
    tiles,
    elevations: new Array(tiles.length).fill(0),
    obstacles: [
      { type: "tree", x: 6, y: 4.5 },
      { type: "bush", x: 8, y: 1 },
      { type: "rock", x: 8, y: 7 },
    ],
    holes: [{
      id: fixture.classification.holeId,
      name: "Rules Matrix",
      par: 4,
      tee: { x: 2, y: 4 },
      pin: fixture.hole,
      waypoints: [],
    }],
    rulesSnapshot: fixture.frozen,
  };
}

function runPenaltyReliefCheck(fixture: RulesFixture) {
  const previousPosition = { x: 2, y: 4 };
  const inputs = [
    {
      id: "out-of-bounds",
      physicalRest: { x: 12.5, y: 4 },
      rollPath: [{ x: 11.5, y: 4 }, { x: 12.5, y: 4 }],
    },
    {
      id: "red",
      physicalRest: { x: 4.5, y: 2.5 },
      rollPath: [{ x: 3.5, y: 2.5 }, { x: 4.5, y: 2.5 }],
    },
    {
      id: "yellow",
      physicalRest: { x: 7.5, y: 5.5 },
      rollPath: [{ x: 6.5, y: 5.5 }, { x: 7.5, y: 5.5 }],
    },
  ] as const;
  const resolve = () => inputs.map((input) => ({
    id: input.id,
    outcome: resolveSharedRules({
      rulesSnapshot: fixture.frozen,
      holeId: fixture.classification.holeId,
      hole: fixture.hole,
      previousPosition,
      physicalRest: input.physicalRest,
      rollPath: input.rollPath,
      clubLengthTiles: 4,
      holed: false,
    }),
  }));
  const first = resolve();
  const second = resolve();
  const legal = first.every(({ outcome }) => {
    const location = locatePenaltyAreaPoint(
      fixture.snapshot,
      outcome.finalPosition,
      fixture.classification,
    );
    const selected = outcome.relief.candidates.find(
      (candidate) => candidate.id === outcome.relief.selectedCandidateId,
    );
    const notNearer = !selected
      || (selected.type !== "back_on_line" && selected.type !== "lateral")
      || (outcome.ruling.referencePoint !== null
        && distanceBetween(selected.position, fixture.hole) + 1e-9
          >= distanceBetween(outcome.ruling.referencePoint, fixture.hole));
    return outcome.ruling.penaltyStrokes === 1
      && outcome.relief.status === "resolved"
      && selected?.legal === true
      && location.ok
      && location.value.kind === "in_bounds"
      && notNearer;
  });
  const everyLegalCandidateSatisfiesInvariants = first.every(({ outcome }) => {
    const reference = outcome.ruling.referencePoint ?? outcome.ruling.crossingPoint;
    return outcome.relief.candidates.filter((candidate) => candidate.legal).every((candidate) => {
      const location = locatePenaltyAreaPoint(
        fixture.snapshot,
        candidate.position,
        fixture.classification,
      );
      const mapLegal = location.ok && location.value.kind === "in_bounds";
      const typeLegal = outcome.ruling.penaltyKind === "out_of_bounds"
        ? candidate.type === "stroke_and_distance"
        : outcome.ruling.penaltyAreaClassification === "yellow"
          ? candidate.type === "stroke_and_distance" || candidate.type === "back_on_line"
          : outcome.ruling.penaltyAreaClassification === "red"
            ? candidate.type === "stroke_and_distance"
              || candidate.type === "back_on_line"
              || candidate.type === "lateral"
            : false;
      if (!mapLegal || !typeLegal) return false;
      if (candidate.type === "stroke_and_distance") {
        return distanceBetween(candidate.position, previousPosition) <= 1e-9;
      }
      if (!reference) return false;
      const notNearer = distanceBetween(candidate.position, fixture.hole) + 1e-9
        >= distanceBetween(reference, fixture.hole);
      if (candidate.type === "lateral") {
        return notNearer && distanceBetween(candidate.position, reference) <= 8 + 1e-9;
      }
      const route = {
        x: reference.x - fixture.hole.x,
        y: reference.y - fixture.hole.y,
      };
      const drop = {
        x: candidate.position.x - reference.x,
        y: candidate.position.y - reference.y,
      };
      const cross = route.x * drop.y - route.y * drop.x;
      const behindReference = route.x * drop.x + route.y * drop.y >= -1e-9;
      return notNearer && Math.abs(cross) <= 1e-9 * Math.max(1, Math.hypot(route.x, route.y))
        && behindReference;
    });
  });
  const red = first.find((item) => item.id === "red")!.outcome;
  const yellow = first.find((item) => item.id === "yellow")!.outcome;
  const outOfBounds = first.find((item) => item.id === "out-of-bounds")!.outcome;
  const optionsCorrect = outOfBounds.relief.type === "stroke_and_distance"
    && red.ruling.penaltyAreaClassification === "red"
    && red.relief.candidates.some((candidate) => candidate.type === "lateral" && candidate.legal)
    && yellow.ruling.penaltyAreaClassification === "yellow"
    && !yellow.relief.candidates.some((candidate) => candidate.type === "lateral" && candidate.legal);
  return {
    check: check(
      "penalty-relief-invariants",
      legal
        && everyLegalCandidateSatisfiesInvariants
        && optionsCorrect
        && hashCanonicalValue(first) === hashCanonicalValue(second),
      "OB, red, and yellow rulings each add one stroke; every selectable drop is in bounds, outside hazards, type-correct, and not nearer the hole.",
    ),
    count: first.length,
    hash: hashCanonicalValue(first),
  };
}

function runObstacleCheck() {
  const resolve = (obstacle: Obstacle, apexHeightYards: number) => resolveObstacleCollision({
    from: { x: 0, y: 4 },
    to: { x: 10, y: 4 },
    flight: { profile: "standard", apexHeightYards },
    width: 12,
    height: 9,
    yardsPerTile: 10,
    elevations: new Array(12 * 9).fill(0),
    tiles: new Array<Terrain>(12 * 9).fill("fairway"),
    obstacles: [obstacle],
  });
  const cases = {
    around: resolve({ type: "tree", x: 5, y: 5.2 }, 14),
    under: resolve({ type: "tree", x: 5, y: 4.5 }, 3),
    over: resolve({ type: "tree", x: 5, y: 4.5 }, 32),
    trunk: resolve({ type: "tree", x: 5, y: 4 }, 4),
    canopy: resolve({ type: "tree", x: 5, y: 4.5 }, 14),
    bush: resolve({ type: "bush", x: 5, y: 4 }, 1),
    rock: resolve({ type: "rock", x: 5, y: 4 }, 1),
  };
  const relationships = ["around", "under", "over"].every(
    (name) => cases[name as keyof typeof cases].clearance[0]?.relationship === name,
  );
  const collisions = (["trunk", "canopy", "bush", "rock"] as const).every(
    (name) => cases[name].collision.kind === "obstacle",
  );
  const repeated = resolve({ type: "tree", x: 5, y: 4.5 }, 14);
  return {
    check: check(
      "obstacle-flight-matrix",
      relationships
        && collisions
        && finiteTree(cases)
        && hashCanonicalValue(cases.canopy) === hashCanonicalValue(repeated),
      "Around/under/over clearance and trunk, canopy, bush, and rock collisions are finite and deterministic.",
    ),
    hash: hashCanonicalValue(cases),
  };
}

function runLieBalanceCheck() {
  const poorLies: ShotLie[] = ["rough", "deep_rough", "sand", "waste_area"];
  const rows = poorLies.map((lie) => {
    const effects = [0, 50, 100].map((skill) => calculateLieEffect(lie, skill));
    return {
      lie,
      effects,
      clubs: availableShotClubs(lie).map((club) => club.id),
    };
  });
  const fairway = [0, 50, 100].map((skill) => calculateLieEffect("fairway", skill));
  const monotonic = rows.every((row) =>
    row.clubs.length > 0
    && row.effects[0].carryMultiplier <= row.effects[1].carryMultiplier
    && row.effects[1].carryMultiplier <= row.effects[2].carryMultiplier
    && row.effects[0].dispersionMultiplier >= row.effects[1].dispersionMultiplier
    && row.effects[1].dispersionMultiplier >= row.effects[2].dispersionMultiplier
    && row.effects[2].carryMultiplier <= 1
    && row.effects[2].dispersionMultiplier >= 1
  );
  const legacyOrdinaryLie = fairway.every(
    (effect) => effect.carryMultiplier === 1
      && effect.dispersionMultiplier === 1
      && effect.rollMultiplier === 1,
  );
  return {
    check: check(
      "lie-recovery-balance",
      monotonic && legacyOrdinaryLie,
      "Recovery 0/50/100 improves every poor lie monotonically without outperforming the unchanged fairway baseline.",
    ),
    hash: hashCanonicalValue({ rows, fairway }),
  };
}

function runLiveRecoveryCheck() {
  const course = recoveryCourse();
  const from = { x: 8, y: 12 };
  const args = {
    course,
    hole: course.holes[0],
    from,
    lie: "deep_rough",
    capabilities: RECOVERY_CAPABILITIES,
    personality: RECOVERY_PERSONALITY,
    shotNumber: 2,
  };
  const candidates = generateRecoveryCandidates(args);
  const repeated = generateRecoveryCandidates(args);
  const shapes = new Set(candidates.map(recoveryShape).filter(Boolean));
  const selected = candidates[0];
  if (!selected) throw new Error("M50 recovery fixture produced no candidate");
  const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
  const live = resolveLiveShot({
    snapshot,
    capabilities: RECOVERY_CAPABILITIES,
    holeId: "m50-recovery-hole",
    shotNumber: 2,
    from,
    lie: "deep_rough",
    intent: selected,
    seed: 50_553,
  });
  const player = resolvePlayableShot({
    snapshot,
    holeId: "m50-recovery-hole",
    shotNumber: 2,
    from,
    lie: "deep_rough",
    skills: capabilitiesToPlayerSkills(RECOVERY_CAPABILITIES),
    selection: {
      club: selected.club,
      aim: selected.target,
      power: selected.power,
      technique: selected.technique,
      flightProfile: selected.flightProfile,
    },
    seed: 50_553,
  });
  const candidateClubsLegal = candidates.every((candidate) =>
    availableShotClubs("deep_rough").some((club) => club.label === candidate.club)
  );
  return {
    checks: [
      check(
        "live-recovery-shapes",
        shapes.size === 3
          && shapes.has("around")
          && shapes.has("under")
          && shapes.has("over")
          && candidateClubsLegal
          && hashCanonicalValue(candidates) === hashCanonicalValue(repeated),
        "Live recovery emits deterministic, legal around/under/over candidates with expected-cost evidence.",
      ),
      check(
        "live-player-shared-outcome",
        hashCanonicalValue(live.sharedOutcome) === hashCanonicalValue(player.sharedOutcome)
          && live.penaltyStrokes === player.penaltyStrokes
          && finiteTree(live),
        "Live recovery and direct Player Pro execution share the same physical/rules outcome for identical inputs.",
      ),
    ],
    candidates: candidates.length,
    shapes: shapes.size,
    hash: hashCanonicalValue({ candidates, live: live.sharedOutcome }),
  };
}

function runPreviewExecutionParityMatrix(fixture: RulesFixture) {
  const snapshot = playerSnapshot(fixture);
  const skills = capabilitiesToPlayerSkills(RECOVERY_CAPABILITIES);
  const cases: Array<{ lie: string; selection: PlayerShotSelection }> = [
    {
      lie: "fairway",
      selection: { club: "Driver", aim: { x: 10, y: 4 }, power: 0.45, technique: "normal", flightProfile: "standard" },
    },
    {
      lie: "rough",
      selection: { club: "7 Iron", aim: { x: 10, y: 4 }, power: 0.55, technique: "normal", flightProfile: "low" },
    },
    {
      lie: "deep_rough",
      selection: { club: "Pitching Wedge", aim: { x: 10, y: 4 }, power: 0.7, technique: "punch", flightProfile: "low" },
    },
    {
      lie: "waste_area",
      selection: { club: "5 Iron", aim: { x: 10, y: 4 }, power: 0.55, technique: "normal", flightProfile: "standard" },
    },
    {
      lie: "sand",
      selection: { club: "Sand Wedge", aim: { x: 10, y: 4 }, power: 0.9, technique: "flop", flightProfile: "high" },
    },
  ];
  const rows = cases.map(({ lie, selection }, index) => {
    const round: PlayerPlayableRound = {
      version: 1,
      id: `m50-parity-${lie}`,
      kind: "casual",
      phase: "awaiting_shot",
      course: snapshot,
      rulesSnapshot: fixture.frozen,
      teeSet: "member",
      pinRotation: "A",
      currentHoleIndex: 0,
      ball: { x: 2, y: 4 },
      lie,
      strokes: 0,
      penalties: 0,
      scorecard: [{
        holeId: fixture.classification.holeId,
        name: "Rules Matrix",
        par: 4,
        strokes: 0,
        penalties: 0,
        complete: false,
      }],
      shots: [],
      pendingShot: null,
      rngSeed: 50_553 + index * 101,
      rngCursor: 0,
      autoPlay: false,
      rewardsApplied: false,
      startedWeek: 1,
      startedDay: 0,
    };
    const seed = round.rngSeed;
    const preview = previewPlayableShot(round, skills, selection);
    const repeated = previewPlayableShot(round, skills, selection);
    const committed = commitPlayerShot(round, skills, selection);
    const direct = resolvePlayableShot({
      snapshot,
      rulesSnapshot: fixture.frozen,
      holeId: fixture.classification.holeId,
      shotNumber: 1,
      from: round.ball,
      lie,
      skills,
      selection,
      seed,
    });
    const pending = committed.pendingShot;
    return {
      lie,
      profile: selection.flightProfile,
      available: preview.available,
      phase: committed.phase,
      valid: isValidSharedShotOutcome(preview.sharedOutcome)
        && isValidSharedShotOutcome(pending?.sharedOutcome)
        && preview.flightProfile === selection.flightProfile
        && pending?.flightProfile === selection.flightProfile
        && hashCanonicalValue(preview) === hashCanonicalValue(repeated)
        && hashCanonicalValue(preview.sharedOutcome) === hashCanonicalValue(pending?.sharedOutcome)
        && hashCanonicalValue(preview.sharedOutcome) === hashCanonicalValue(direct.sharedOutcome)
        && pending?.penaltyStrokes === pending?.ruling?.penaltyStrokes
        && pending?.penaltyStrokes === direct.penaltyStrokes,
      outcome: preview.sharedOutcome,
    };
  });
  return {
    check: check(
      "preview-execution-parity-matrix",
      rows.every((row) => row.available && row.phase === "flight" && row.valid),
      "Five fairway/rough/deep-rough/waste/sand low-standard-high fixtures keep preview, committed animation trace, and direct execution byte-equivalent.",
    ),
    count: rows.length,
    hash: hashCanonicalValue(rows),
  };
}

interface PlayerCertificationResult {
  checks: M50CertificationCheck[];
  architectureEvidence: number;
  historyRounds: number;
  hostileCases: number;
  hash: string;
}

function runPlayerSaveArchitectureCheck(): PlayerCertificationResult {
  const course = createPlayerProReferenceCourse();
  const career = createDefaultPlayerPro({
    seed: 50_553,
    name: "Morgan Mulligan",
    background: "operator",
  });
  const world: World = {
    ...DEFAULT_WORLD,
    runSeed: 50_553,
    playerPro: career,
  };
  const started = startPlayableRound({
    course,
    world,
    layoutId: "player-pro-slice",
    teeSet: "member",
    pinRotation: "A",
  });
  if (!started.ok) throw new Error(started.reason);
  const selection = caddieRecommendation(started.round, career.skills);
  const preview = previewPlayableShot(started.round, career.skills, selection);
  const repeatedPreview = previewPlayableShot(started.round, career.skills, selection);
  const committed = commitPlayerShot(started.round, career.skills, selection);
  const parity = preview.available
    && committed.phase === "flight"
    && preview.sharedOutcome !== null
    && hashCanonicalValue(preview.sharedOutcome)
      === hashCanonicalValue(committed.pendingShot?.sharedOutcome)
    && hashCanonicalValue(preview) === hashCanonicalValue(repeatedPreview);
  const afterFirst = finishPlayerShot(committed);
  const completed = autoFinishPlayerRound(afterFirst, career.skills);
  const settlement = settlePlayerRound(career, completed);
  if (completed.phase !== "round_complete" || !settlement.round) {
    throw new Error("M50 Player Pro fixture did not complete and settle");
  }
  const scoreAgrees = completed.penalties
    === completed.scorecard.reduce((sum, hole) => sum + hole.penalties, 0)
    && completed.penalties
      === completed.shots.reduce((sum, shot) => sum + shot.penaltyStrokes, 0)
    && completed.shots.every((shot) =>
      (shot.ruling?.penaltyStrokes ?? shot.penaltyStrokes) === shot.penaltyStrokes
    );

  const recorded = recordPlayerRoundArchitecture(
    { ...world, playerPro: settlement.career },
    completed,
    settlement.round,
  );
  const filters = {
    ...defaultArchitectureFilters(course),
    kind: "traces" as const,
    recency: "all" as const,
  };
  const review = buildArchitectureReview(course, recorded.world, filters);
  const evidenceById = new Map(
    normalizeLivingClub(recorded.world.livingClub).architecture.evidence
      .map((evidence) => [evidence.id, evidence]),
  );
  const architectureAgrees = settlement.round.shots.every((shot) => {
    const evidence = evidenceById.get(`evidence-player-${settlement.round!.id}-${shot.id}`);
    const traces = review.overlay.traces.filter((candidate) => candidate.id.startsWith(`${evidence?.id}-`));
    const firstTrace = traces[0];
    const lastTrace = traces.at(-1);
    return evidence?.from.x === shot.from.x
      && evidence?.from.y === shot.from.y
      && evidence?.landing.x === shot.landing.x
      && evidence?.landing.y === shot.landing.y
      && evidence?.rest.x === shot.rest.x
      && evidence?.rest.y === shot.rest.y
      && firstTrace?.from.x === shot.from.x
      && firstTrace?.from.y === shot.from.y
      && lastTrace?.to.x === shot.rest.x
      && lastTrace?.to.y === shot.rest.y;
  });

  const baseHistory = settlement.round;
  const matchHistory = {
    ...baseHistory,
    id: "m50-history-match",
    kind: "friendly" as const,
    result: "won" as const,
    opponentId: "campaign-rival",
    opponentName: "Campaign Rival",
  };
  const tournamentHistory = {
    ...baseHistory,
    id: "m50-history-tournament",
    kind: "tournament" as const,
    result: "complete" as const,
    tournamentId: "m50-tournament",
    tournamentName: "M50 Invitational",
  };
  const historyRounds = [baseHistory, matchHistory, tournamentHistory];
  const campaign = {
    ...createCampaignRun("back-nine", "public-gem"),
    matches: [{
      definitionId: "back-nine-opening-match",
      roundId: matchHistory.id,
      status: "complete" as const,
      result: "won" as const,
    }],
  };
  const careerForSave = {
    ...settlement.career,
    rounds: historyRounds,
    challenges: [{
      id: "m50-challenge",
      opponentId: "campaign-rival",
      opponentName: "Campaign Rival",
      kind: "friendly" as const,
      status: "complete" as const,
      relationship: 4,
      wager: 0,
      roundId: matchHistory.id,
      result: "won" as const,
      settled: true,
    }],
    tournaments: [{
      id: "m50-tournament-record",
      eventId: "m50-tournament",
      name: "M50 Invitational",
      tier: "regional" as const,
      status: "complete" as const,
      roundId: tournamentHistory.id,
      finish: 3,
      fieldSize: 24,
      prize: 1_000,
      settled: true,
    }],
  };
  const defaultHoleId = DEFAULT_COURSE.holes[0].id!;
  const legacyActive: PlayerPlayableRound = {
    version: 1 as const,
    id: "m50-active-v19",
    kind: "tournament" as const,
    phase: "awaiting_shot" as const,
    course: {
      courseId: DEFAULT_COURSE.activeCourseId!,
      courseName: DEFAULT_COURSE.name,
      theme: DEFAULT_COURSE.theme!,
      width: DEFAULT_COURSE.width,
      height: DEFAULT_COURSE.height,
      yardsPerTile: DEFAULT_COURSE.yardsPerTile,
      tiles: [...DEFAULT_COURSE.tiles],
      elevations: [...DEFAULT_COURSE.elevations],
      obstacles: [],
      holes: DEFAULT_COURSE.holes.map((hole, index) => ({
        id: hole.id!,
        name: hole.name!,
        par: 4,
        tee: { x: 1, y: index + 1 },
        pin: { x: 10, y: index + 1 },
        waypoints: [],
      })),
    },
    teeSet: "member" as const,
    pinRotation: "A" as const,
    currentHoleIndex: 0,
    ball: { x: 3, y: 2 },
    lie: "rough",
    strokes: 2,
    penalties: 1,
    scorecard: [{
      holeId: defaultHoleId,
      name: DEFAULT_COURSE.holes[0].name!,
      par: 4,
      strokes: 2,
      penalties: 1,
      complete: false,
    }],
    shots: [],
    pendingShot: null,
    rngSeed: 50_553,
    rngCursor: 3,
    autoPlay: false,
    rewardsApplied: false,
    startedWeek: 1,
    startedDay: 0,
    returnToDesign: { holeId: defaultHoleId, shotId: null },
    tournamentId: "m50-tournament",
    tournamentName: "M50 Invitational",
  };
  const historicalHash = hashCanonicalValue(historyRounds);
  const challengeHash = hashCanonicalValue(careerForSave.challenges);
  const tournamentHash = hashCanonicalValue(careerForSave.tournaments);
  const campaignHash = hashCanonicalValue(campaign.matches);
  const architectureHash = hashCanonicalValue(
    normalizeLivingClub(recorded.world.livingClub).architecture.evidence,
  );
  const v19 = {
    schemaVersion: 19,
    savedAt: 50_553,
    course: DEFAULT_COURSE,
    world: {
      ...recorded.world,
      campaign,
      playerPro: {
        ...careerForSave,
        activeRound: legacyActive,
      },
    },
    history: [],
  };
  const migrated = normalizeLoadedSaveResult(v19);
  const repeatedMigration = normalizeLoadedSaveResult(JSON.parse(JSON.stringify(v19)));
  const migrationAgrees = migrated.ok && repeatedMigration.ok && migrated.migratedFrom === 19;
  const activeRoundAgrees = migrated.ok
    && migrated.payload.world.playerPro?.activeRound?.rulesSnapshot?.version === 2
    && migrated.payload.world.playerPro.activeRound.kind === "tournament"
    && migrated.payload.world.playerPro.activeRound.ball.x === legacyActive.ball.x
    && migrated.payload.world.playerPro.activeRound.ball.y === legacyActive.ball.y
    && hashCanonicalValue(migrated.payload.world.playerPro.activeRound.scorecard)
      === hashCanonicalValue(legacyActive.scorecard)
    && hashCanonicalValue(migrated.payload.world.playerPro.activeRound.returnToDesign)
      === hashCanonicalValue(legacyActive.returnToDesign);
  const historyAgrees = migrated.ok
    && historicalHash === hashCanonicalValue(migrated.payload.world.playerPro?.rounds);
  const competitionAndCampaignAgree = migrated.ok
    && challengeHash === hashCanonicalValue(migrated.payload.world.playerPro?.challenges)
    && tournamentHash === hashCanonicalValue(migrated.payload.world.playerPro?.tournaments)
    && campaignHash === hashCanonicalValue(migrated.payload.world.campaign?.matches);
  const savedArchitectureAgrees = migrated.ok
    && architectureHash === hashCanonicalValue(
      normalizeLivingClub(migrated.payload.world.livingClub).architecture.evidence,
    );
  const repeatedSnapshotAgrees = migrated.ok
    && repeatedMigration.ok
    && hashCanonicalValue(migrated.payload.world.playerPro?.activeRound?.rulesSnapshot ?? null)
      === hashCanonicalValue(repeatedMigration.payload.world.playerPro?.activeRound?.rulesSnapshot ?? null);
  const currentReload = migrated.ok
    ? normalizeLoadedSaveResult({
        schemaVersion: 20,
        savedAt: 50_554,
        ...migrated.payload,
      })
    : migrated;
  const currentReloadAgrees = currentReload.ok
    && currentReload.payload.world.playerPro?.activeRound?.rulesSnapshot?.version === 2
    && historicalHash === hashCanonicalValue(currentReload.payload.world.playerPro?.rounds);
  const saveAgrees = migrationAgrees
    && activeRoundAgrees
    && historyAgrees
    && competitionAndCampaignAgree
    && savedArchitectureAgrees
    && repeatedSnapshotAgrees
    && currentReloadAgrees;

  const hostileBase = {
    schemaVersion: 20 as const,
    savedAt: 50_555,
    course,
    world: {
      ...recorded.world,
      playerPro: {
        ...careerForSave,
        activeRound: structuredClone(committed),
      },
    },
    history: [],
  };
  type HostileSave = typeof hostileBase;
  const corruptions: Array<{ id: string; mutate: (save: HostileSave) => void }> = [
    {
      id: "mask",
      mutate: (save) => {
        save.world.playerPro.activeRound!.rulesSnapshot = {
          ...save.world.playerPro.activeRound!.rulesSnapshot!,
          width: 999,
        };
      },
    },
    {
      id: "flight",
      mutate: (save) => {
        save.world.playerPro.activeRound!.pendingShot!.sharedOutcome!.flight.apexHeightYards = Number.NaN;
      },
    },
    {
      id: "collision",
      mutate: (save) => {
        save.world.playerPro.activeRound!.pendingShot!.sharedOutcome!.collision = {
          kind: "obstacle",
          point: { x: Number.POSITIVE_INFINITY, y: 0 },
          obstacleType: "tree",
          distanceFromStartYards: 1,
          clearance: {
            point: { x: 1, y: 1 },
            pathHeightYards: 1,
            requiredHeightYards: 2,
            clearanceYards: -1,
          },
        };
      },
    },
    {
      id: "relief",
      mutate: (save) => {
        save.world.playerPro.activeRound!.pendingShot!.sharedOutcome!.relief = {
          ...save.world.playerPro.activeRound!.pendingShot!.sharedOutcome!.relief,
          status: "resolved",
          type: "lateral",
          selectedCandidateId: "missing",
          finalPosition: { x: 1, y: 1 },
        };
      },
    },
    {
      id: "shot-bound",
      mutate: (save) => {
        const trace = save.world.playerPro.activeRound!.pendingShot!;
        save.world.playerPro.activeRound!.shots = Array.from(
          { length: 241 },
          (_, index) => ({ ...trace, id: `hostile-${index}` }),
        );
      },
    },
    {
      id: "round-shape",
      mutate: (save) => {
        save.world.playerPro.activeRound!.course.holes = "hostile" as never;
      },
    },
  ];
  const hostileResults = corruptions.map(({ id, mutate }) => {
    const input = structuredClone(hostileBase);
    mutate(input);
    const result = normalizeLoadedSaveResult(input);
    return {
      id,
      acceptedSave: result.ok,
      activeInvalidated: result.ok && result.payload.world.playerPro?.activeRound === null,
      historyPreserved: result.ok
        && historicalHash === hashCanonicalValue(result.payload.world.playerPro?.rounds),
      error: result.ok ? null : `${result.error.code}:${result.error.message}`,
    };
  });
  const hostileAgrees = hostileResults.every((result) =>
    result.acceptedSave && result.activeInvalidated && result.historyPreserved
  );

  const legacyCourse = recoveryCourse([]);
  const legacyIntent = followUpIntent({
    course: legacyCourse,
    hole: legacyCourse.holes[0],
    from: { x: 18, y: 12 },
    lie: "fairway",
    capabilities: RECOVERY_CAPABILITIES,
    personality: RECOVERY_PERSONALITY,
    shotNumber: 2,
  });
  const legacyAgrees = legacyIntent.id === "m50-recovery-hole-follow-2"
    && legacyIntent.kind === "positional"
    && legacyIntent.technique === "normal"
    && legacyIntent.flightProfile === undefined;

  return {
    checks: [
      check(
        "scorecard-ruling-agreement",
        parity && scoreAgrees,
        "Player Pro execution, ruling penalties, round totals, and scorecard totals remain byte-equivalent and additive.",
      ),
      check(
        "save-v19-v20-compatibility",
        saveAgrees,
        `V19→v20 compatibility (migration:${migrationAgrees}, active:${activeRoundAgrees}, history:${historyAgrees}, competition/campaign:${competitionAndCampaignAgree}, architecture:${savedArchitectureAgrees}, repeat:${repeatedSnapshotAgrees}, current:${currentReloadAgrees}, currentActive:${currentReload.ok ? currentReload.payload.world.playerPro?.activeRound?.rulesSnapshot?.version ?? "null" : currentReload.error.code}, currentHistory:${currentReload.ok && historicalHash === hashCanonicalValue(currentReload.payload.world.playerPro?.rounds)}).`,
      ),
      check(
        "hostile-input-normalization",
        hostileAgrees,
        `Malformed active-round cases preserve the save/history and invalidate only that round; failures:${hostileResults.filter((result) => !result.acceptedSave || !result.activeInvalidated || !result.historyPreserved).map((result) => `${result.id}[save:${result.acceptedSave},active:${result.activeInvalidated},history:${result.historyPreserved},error:${result.error}]`).join(",") || "none"}.`,
      ),
      check(
        "architecture-evidence",
        architectureAgrees
          && review.evidence.length === settlement.round.shots.length
          && review.overlay.traces.length >= settlement.round.shots.length
          && review.overlay.traces.length <= settlement.round.shots.length * 99,
        "Settled Player Pro shots retain matching architecture evidence and review traces.",
      ),
      check(
        "representative-legacy-behavior",
        legacyAgrees,
        "A fairway follow-up without M50 recovery context preserves the legacy positional intent contract.",
      ),
    ],
    architectureEvidence: review.evidence.length,
    historyRounds: historyRounds.length,
    hostileCases: hostileResults.length,
    hash: hashCanonicalValue({
      preview: preview.sharedOutcome,
      completed: {
        strokes: completed.strokes,
        penalties: completed.penalties,
        scorecard: completed.scorecard,
      },
      history: migrated.ok ? migrated.payload.world.playerPro?.rounds : null,
      campaign: migrated.ok ? migrated.payload.world.campaign?.matches : null,
      architecture: review.evidence,
      hostile: hostileResults,
      legacyIntent,
    }),
  };
}

function runFiniteFuzzCheck(fixture: RulesFixture) {
  const snapshot = playerSnapshot(fixture);
  const skills = capabilitiesToPlayerSkills(RECOVERY_CAPABILITIES);
  const lies: ShotLie[] = ["fairway", "rough", "deep_rough", "sand", "waste_area"];
  const outcomes: Array<{
    seed: number;
    penalty: number;
    relief: string | undefined;
    final: Point | undefined;
  }> = [];
  let legal = true;
  const fuzzShots = 120;
  for (let index = 0; index < fuzzShots; index++) {
    const lie = lies[index % lies.length];
    const clubs = availableShotClubs(lie);
    const club = clubs[index % clubs.length];
    const seed = 50_553 + index * 977;
    const aim = {
      x: -5 + ((index * 37) % 23),
      y: -3 + ((index * 19) % 15),
    };
    const shot = resolvePlayableShot({
      snapshot,
      holeId: fixture.classification.holeId,
      shotNumber: index + 1,
      from: { x: 2, y: 4 },
      lie,
      skills: { ...skills, recovery: (index * 17) % 101 },
      selection: {
        club: club.label,
        aim,
        power: 0.25 + (index % 10) * 0.09,
        technique: "normal",
        flightProfile: "standard",
      },
      seed,
    });
    const location = shot.finalPosition
      ? locatePenaltyAreaPoint(fixture.snapshot, shot.finalPosition, fixture.classification)
      : null;
    const legalFinal = location?.ok === true && location.value.kind === "in_bounds";
    const legalPenalty = shot.penaltyStrokes === 0
      || (shot.penaltyStrokes === 1 && shot.relief?.status === "resolved");
    legal = legal
      && finiteTree(shot)
      && legalFinal
      && legalPenalty
      && clubs.some((candidate) => candidate.label === shot.club);
    outcomes.push({
      seed,
      penalty: shot.penaltyStrokes,
      relief: shot.relief?.type,
      final: shot.finalPosition,
    });
  }
  const repeated = resolvePlayableShot({
    snapshot,
    holeId: fixture.classification.holeId,
    shotNumber: 1,
    from: { x: 2, y: 4 },
    lie: "rough",
    skills,
    selection: {
      club: availableShotClubs("rough")[0].label,
      aim: { x: 17, y: 4 },
      power: 1.1,
      technique: "normal",
      flightProfile: "standard",
    },
    seed: 50_553,
  });
  const repeatedAgain = resolvePlayableShot({
    snapshot,
    holeId: fixture.classification.holeId,
    shotNumber: 1,
    from: { x: 2, y: 4 },
    lie: "rough",
    skills,
    selection: {
      club: availableShotClubs("rough")[0].label,
      aim: { x: 17, y: 4 },
      power: 1.1,
      technique: "normal",
      flightProfile: "standard",
    },
    seed: 50_553,
  });
  return {
    check: check(
      "finite-legal-fuzz",
      legal && hashCanonicalValue(repeated) === hashCanonicalValue(repeatedAgain),
      `${fuzzShots} bounded hostile shots emitted no NaN, impossible club, illegal final position, or unresolved penalty.`,
    ),
    count: fuzzShots,
    hash: hashCanonicalValue(outcomes),
  };
}

function runBoundedRoundCheck(course: Course) {
  const career = createDefaultPlayerPro({
    seed: 50_553,
    name: "Bounded Round",
    background: "operator",
  });
  const world: World = {
    ...DEFAULT_WORLD,
    runSeed: 50_553,
    playerPro: career,
  };
  const started = startPlayableRound({
    course,
    world,
    layoutId: course.activeCourseId!,
    teeSet: "member",
    pinRotation: "A",
  });
  if (!started.ok) throw new Error(started.reason);
  const playerKinds = [
    { kind: "casual" as const },
    {
      kind: "friendly" as const,
      opponent: {
        id: "campaign-rival",
        name: "Campaign Rival",
        skill: 0.7,
        relationshipDelta: 0,
        wager: 0,
        projectedStrokes: 160,
      },
    },
    {
      kind: "tournament" as const,
      tournamentId: "m50-tournament",
      tournamentName: "M50 Invitational",
    },
  ];
  const playerRounds = playerKinds.map((identity, index) => {
    const completed = autoFinishPlayerRound({
      ...started.round,
      ...identity,
      id: `m50-bounded-player-${index}`,
    }, career.skills);
    const scorecardTotal = completed.scorecard.reduce(
      (sum, hole) => sum + hole.strokes + hole.penalties,
      0,
    );
    return {
      kind: completed.kind,
      phase: completed.phase,
      holes: completed.scorecard.length,
      allComplete: completed.scorecard.every((hole) => hole.complete),
      shots: completed.shots.length,
      penalties: completed.penalties,
      totalsAgree: scorecardTotal === completed.strokes + completed.penalties
        && completed.penalties === completed.shots.reduce((sum, shot) => sum + shot.penaltyStrokes, 0),
      validOutcomes: completed.shots.every((shot) =>
        shot.sharedOutcome == null || isValidSharedShotOutcome(shot.sharedOutcome)
      ),
    };
  });

  const entry = course.holes[0].tee!;
  const aiStarted = performance.now();
  const buildAi = () => buildStrategicGolferRound({
    course,
    entry,
    rng: mulberry32(50_553),
    personality: RECOVERY_PERSONALITY,
    capabilities: RECOVERY_CAPABILITIES,
    teeSet: "member",
    pinRotation: "A",
    skipPreRoundPurchases: true,
  });
  const ai = buildAi();
  const aiRoundMs = performance.now() - aiStarted;
  const repeatedAi = buildAi();
  const aiScore = ai.holeStrokes.reduce((sum, strokes) => sum + strokes, 0);
  const aiOutcomeScore = ai.shotOutcomes?.reduce(
    (sum, outcome) => sum + 1 + outcome.penaltyStrokes,
    0,
  ) ?? 0;
  const retainedOutcomesCoverWholeRound = (ai.shotOutcomes?.length ?? 0) < M47_MAX_OUTCOMES;
  const aiOutcomesValid = ai.shotOutcomes?.every((outcome) =>
    finiteTree(outcome)
    && (outcome.sharedOutcome == null || isValidSharedShotOutcome(outcome.sharedOutcome))
  ) === true;
  const aiAvoidsPenaltyLies = ai.shotOutcomes?.every((outcome) =>
    !["water", "wetland", "out_of_bounds"].includes(outcome.lieBefore)
  ) === true;
  const aiPerHoleBounded = ai.holeStrokes.every((strokes, index) =>
    strokes <= Math.max(4, ai.holePar[index] + 5) * 2
  );
  const aiDeterministic = hashCanonicalValue(ai) === hashCanonicalValue(repeatedAi);
  const aiAgrees = ai.holePar.length === 36
    && ai.holeStrokes.length === 36
    && (ai.shotOutcomes?.length ?? 0) <= M47_MAX_OUTCOMES
    && aiOutcomesValid
    && aiAvoidsPenaltyLies
    && (!retainedOutcomesCoverWholeRound || aiScore === aiOutcomeScore)
    && aiPerHoleBounded
    && aiDeterministic
    && aiRoundMs <= 30_000;
  return {
    check: check(
      "bounded-player-ai-rounds",
      playerRounds.every((round) =>
        round.phase === "round_complete"
        && round.holes === 36
        && round.allComplete
        && round.shots <= 240
        && round.totalsAgree
        && round.validOutcomes
      ) && aiAgrees,
      `Bounded rounds: players=${JSON.stringify(playerRounds)}, ai={holes:${ai.holeStrokes.length},outcomes:${ai.shotOutcomes?.length ?? 0},score:${aiScore},outcomeScore:${aiOutcomeScore},outcomesValid:${aiOutcomesValid},noPenaltyLies:${aiAvoidsPenaltyLies},perHoleBound:${aiPerHoleBounded},deterministic:${aiDeterministic},valid:${aiAgrees},ms:${aiRoundMs.toFixed(1)}}.`,
    ),
    playerRounds: playerRounds.length,
    aiHoles: ai.holeStrokes.length,
    aiOutcomes: ai.shotOutcomes?.length ?? 0,
    aiRoundMs,
    hash: hashCanonicalValue({ playerRounds, ai }),
  };
}

function runPerformanceCheck(course: Course) {
  const cells = course.width * course.height;
  const fixtureStarted = performance.now();
  const live = createRenderPerfLiveState(course, {
    ...DEFAULT_WORLD,
    runSeed: 50_553,
    cash: 1_000_000,
    reputation: 95,
  });
  const fixtureMs = performance.now() - fixtureStarted;
  const iterations = 250;
  const renderStarted = performance.now();
  let renderedGolfers = 0;
  for (let index = 0; index < iterations; index++) {
    renderedGolfers = liveRenderData(live).length;
  }
  const averageRenderStateMs = (performance.now() - renderStarted) / iterations;
  const passed = course.width === COURSE_WIDTH
    && course.height === COURSE_HEIGHT
    && cells === COURSE_WIDTH * COURSE_HEIGHT
    && course.holes.length === 36
    && live.golfers.length === 100
    && renderedGolfers === 100
    && fixtureMs <= 15_000
    && averageRenderStateMs <= 8;
  return {
    check: check(
      "full-estate-36-hole-100-golfer-performance",
      passed,
      `The 220×140 full-estate 36-hole/100-golfer fixture built in ${fixtureMs.toFixed(1)}ms and averaged ${averageRenderStateMs.toFixed(3)}ms across ${iterations} render-state derivations.`,
    ),
    width: course.width,
    height: course.height,
    cells,
    holes: course.holes.length,
    golfers: live.golfers.length,
    iterations,
    fixtureMs,
    averageRenderStateMs,
  };
}

/** Bounded automated M50 certification. Browser, audio, accessibility, and human-authenticity gates remain explicit. */
export function runM50Certification(): M50CertificationReport {
  const fixture = rulesFixture();
  const fullEstate = fullEstateCertificationCourse();
  const penalty = runPenaltyReliefCheck(fixture);
  const obstacle = runObstacleCheck();
  const lie = runLieBalanceCheck();
  const parity = runPreviewExecutionParityMatrix(fixture);
  const recovery = runLiveRecoveryCheck();
  const player = runPlayerSaveArchitectureCheck();
  const fuzz = runFiniteFuzzCheck(fixture);
  const bounded = runBoundedRoundCheck(fullEstate);
  const performance = runPerformanceCheck(fullEstate);
  const checks = [
    penalty.check,
    obstacle.check,
    lie.check,
    parity.check,
    ...recovery.checks,
    ...player.checks,
    fuzz.check,
    bounded.check,
    performance.check,
  ];
  const determinismHash = hashCanonicalValue({
    penalty: penalty.hash,
    obstacle: obstacle.hash,
    lie: lie.hash,
    parity: parity.hash,
    recovery: recovery.hash,
    player: player.hash,
    fuzz: fuzz.hash,
    bounded: bounded.hash,
  });
  return {
    version: 1,
    checks,
    metrics: {
      recoveryCandidates: recovery.candidates,
      recoveryShapes: recovery.shapes,
      penaltyCases: penalty.count,
      previewParityCases: parity.count,
      migrationHistoryRounds: player.historyRounds,
      hostileNormalizationCases: player.hostileCases,
      boundedPlayerRounds: bounded.playerRounds,
      boundedAiHoles: bounded.aiHoles,
      boundedAiOutcomes: bounded.aiOutcomes,
      fuzzShots: fuzz.count,
      architectureEvidence: player.architectureEvidence,
      performanceWidth: performance.width,
      performanceHeight: performance.height,
      performanceCells: performance.cells,
      performanceHoles: performance.holes,
      performanceGolfers: performance.golfers,
      performanceIterations: performance.iterations,
      performanceAiRoundMs: Number(bounded.aiRoundMs.toFixed(3)),
      performanceFixtureMs: Number(performance.fixtureMs.toFixed(3)),
      performanceAverageRenderStateMs: Number(performance.averageRenderStateMs.toFixed(6)),
    },
    determinismHash,
    remainingHumanGates: M50_REMAINING_HUMAN_GATES,
    passed: checks.every((candidate) => candidate.passed),
  };
}
