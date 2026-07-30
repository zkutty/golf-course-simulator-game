import type { Course, Obstacle, Point, Terrain, World } from "../models/types";
import type {
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
} from "../playerPro/playerPro";
import type { GolferCapabilities } from "../live/m47Types";
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
import type { ShotLie } from "../rules/contracts";
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
import {
  createRenderPerfLiveState,
  liveRenderData,
} from "../live/simulation";

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
    fuzzShots: number;
    architectureEvidence: number;
    performanceHoles: number;
    performanceGolfers: number;
    performanceIterations: number;
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
      legal && optionsCorrect && hashCanonicalValue(first) === hashCanonicalValue(second),
      "OB, red, and yellow rulings each add one stroke and select deterministic legal, not-nearer relief.",
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

interface PlayerCertificationResult {
  checks: M50CertificationCheck[];
  architectureEvidence: number;
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
    const trace = review.overlay.traces.find((candidate) => candidate.id === evidence?.id);
    return evidence?.from.x === shot.from.x
      && evidence?.from.y === shot.from.y
      && evidence?.landing.x === shot.landing.x
      && evidence?.landing.y === shot.landing.y
      && evidence?.rest.x === shot.rest.x
      && evidence?.rest.y === shot.rest.y
      && trace?.from.x === shot.from.x
      && trace?.to.x === shot.rest.x;
  });

  const legacyActive = {
    version: 1 as const,
    id: "m50-active-v19",
    kind: "casual" as const,
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
    ball: { x: 1, y: 1 },
    lie: "tee",
    strokes: 0,
    penalties: 0,
    scorecard: [],
    shots: [],
    pendingShot: null,
    rngSeed: 50_553,
    rngCursor: 0,
    autoPlay: false,
    rewardsApplied: false,
    startedWeek: 1,
    startedDay: 0,
  };
  const historicalHash = hashCanonicalValue(settlement.career.rounds);
  const v19 = {
    schemaVersion: 19,
    savedAt: 50_553,
    course: DEFAULT_COURSE,
    world: {
      ...world,
      playerPro: {
        ...settlement.career,
        activeRound: legacyActive,
      },
    },
    history: [],
  };
  const migrated = normalizeLoadedSaveResult(v19);
  const repeatedMigration = normalizeLoadedSaveResult(JSON.parse(JSON.stringify(v19)));
  const migrationAgrees = migrated.ok && repeatedMigration.ok && migrated.migratedFrom === 19;
  const activeRoundAgrees = migrated.ok
    && migrated.payload.world.playerPro?.activeRound?.rulesSnapshot?.version === 2;
  const historyAgrees = migrated.ok
    && historicalHash === hashCanonicalValue(migrated.payload.world.playerPro?.rounds);
  const repeatedSnapshotAgrees = migrated.ok
    && repeatedMigration.ok
    && hashCanonicalValue(migrated.payload.world.playerPro?.activeRound?.rulesSnapshot ?? null)
      === hashCanonicalValue(repeatedMigration.payload.world.playerPro?.activeRound?.rulesSnapshot ?? null);
  const saveAgrees = migrationAgrees
    && activeRoundAgrees
    && historyAgrees
    && repeatedSnapshotAgrees;

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
        "player-preview-execution-parity",
        parity && scoreAgrees,
        "Player Pro preview, committed flight, ruling penalties, and scorecard remain byte-equivalent and additive.",
      ),
      check(
        "save-v19-v20-history",
        saveAgrees,
        `A v19 active round gains one deterministic v20 rules snapshot while completed shot history remains unchanged (migration:${migrationAgrees}, active:${activeRoundAgrees}, history:${historyAgrees}, repeat:${repeatedSnapshotAgrees}).`,
      ),
      check(
        "architecture-evidence",
        architectureAgrees
          && review.evidence.length === settlement.round.shots.length
          && review.overlay.traces.length === settlement.round.shots.length,
        "Settled Player Pro shots retain matching architecture evidence and review traces.",
      ),
      check(
        "representative-legacy-behavior",
        legacyAgrees,
        "A fairway follow-up without M50 recovery context preserves the legacy positional intent contract.",
      ),
    ],
    architectureEvidence: review.evidence.length,
    hash: hashCanonicalValue({
      preview: preview.sharedOutcome,
      completed: {
        strokes: completed.strokes,
        penalties: completed.penalties,
        scorecard: completed.scorecard,
      },
      history: migrated.ok ? migrated.payload.world.playerPro?.rounds : null,
      architecture: review.evidence,
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

function runPerformanceCheck() {
  const compact = createM47CertificationCourse(36);
  const height = Math.max(compact.height, 145);
  const cells = compact.width * height;
  const course: Course = {
    ...compact,
    height,
    tiles: [
      ...compact.tiles,
      ...new Array<Terrain>(cells - compact.tiles.length).fill("rough"),
    ],
    elevations: [
      ...compact.elevations,
      ...new Array<number>(cells - compact.elevations.length).fill(0),
    ],
  };
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
  const passed = course.holes.length === 36
    && live.golfers.length === 100
    && renderedGolfers === 100
    && fixtureMs <= 15_000
    && averageRenderStateMs <= 8;
  return {
    check: check(
      "bounded-36-hole-100-golfer-performance",
      passed,
      `The existing 36-hole/100-golfer render-state fixture built in ${fixtureMs.toFixed(1)}ms and averaged ${averageRenderStateMs.toFixed(3)}ms across ${iterations} derivations.`,
    ),
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
  const penalty = runPenaltyReliefCheck(fixture);
  const obstacle = runObstacleCheck();
  const lie = runLieBalanceCheck();
  const recovery = runLiveRecoveryCheck();
  const player = runPlayerSaveArchitectureCheck();
  const fuzz = runFiniteFuzzCheck(fixture);
  const performance = runPerformanceCheck();
  const checks = [
    penalty.check,
    obstacle.check,
    lie.check,
    ...recovery.checks,
    ...player.checks,
    fuzz.check,
    performance.check,
  ];
  const determinismHash = hashCanonicalValue({
    penalty: penalty.hash,
    obstacle: obstacle.hash,
    lie: lie.hash,
    recovery: recovery.hash,
    player: player.hash,
    fuzz: fuzz.hash,
  });
  return {
    version: 1,
    checks,
    metrics: {
      recoveryCandidates: recovery.candidates,
      recoveryShapes: recovery.shapes,
      penaltyCases: penalty.count,
      fuzzShots: fuzz.count,
      architectureEvidence: player.architectureEvidence,
      performanceHoles: performance.holes,
      performanceGolfers: performance.golfers,
      performanceIterations: performance.iterations,
      performanceFixtureMs: Number(performance.fixtureMs.toFixed(3)),
      performanceAverageRenderStateMs: Number(performance.averageRenderStateMs.toFixed(6)),
    },
    determinismHash,
    remainingHumanGates: M50_REMAINING_HUMAN_GATES,
    passed: checks.every((candidate) => candidate.passed),
  };
}
