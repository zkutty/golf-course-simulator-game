import type { Course, Point, TeeSet, World } from "../models/types";
import { isOwnedTile } from "../estate/estate";
import { resolveCourseSetup } from "../models/courseSetup";
import type { ArchitectureShotEvidence } from "../livingClub/types";
import { classifyPenaltyAreaComponents } from "../rules/penaltyAreas";
import { createControlledRoundSnapshotV2, decodeControlledRoundSnapshotV2, type ControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { resolveSharedRules } from "../rules/sharedOutcome";
import type { ArchitectureRulesEvidence, ArchitectureRulesFeedback, ArchitectureRulesReview } from "./reviewTypes";
import type { M48StrategicHoleEvaluation } from "./m48Types";

const MAX_RULES_EVIDENCE = 180;
const TROUBLE_LIES = new Set(["rough", "deep_rough", "sand", "waste_area", "water", "wetland", "out_of_bounds"]);

interface RulesContext {
  snapshot: ControlledRoundSnapshotV2;
  holes: Map<string, Point>;
}

function bounded<T>(values: T[], maximum: number): T[] {
  if (values.length <= maximum) return values;
  const stride = values.length / maximum;
  return Array.from({ length: maximum }, (_, index) => values[Math.floor(index * stride)]!);
}

function rulesContext(course: Course, teeSet: TeeSet): RulesContext | null {
  const holes = course.holes.map((hole, index) => {
    const setup = resolveCourseSetup(hole, teeSet, course.activePinRotation ?? "A");
    const tee = setup.tee ?? hole.tee;
    const pin = setup.pin ?? hole.green;
    if (!tee || !pin) return null;
    return { id: hole.id ?? `hole-${index + 1}`, tee, pin, waypoints: hole.waypoints ?? [] };
  });
  if (holes.some((hole) => hole === null)) return null;
  const complete = holes as Array<{ id: string; tee: Point; pin: Point; waypoints: Point[] }>;
  const cells = course.width * course.height;
  const inBounds = Array.from({ length: cells }, (_, index) => isOwnedTile(course, index % course.width, Math.floor(index / course.width)));
  const penaltyMask = inBounds.map((owned, index) => owned && (course.tiles[index] === "water" || course.tiles[index] === "wetland"));
  const base = createControlledRoundSnapshotV2({
    width: course.width,
    height: course.height,
    inBounds,
    penaltyMask,
    holeClassifications: complete.map((hole) => ({ holeId: hole.id, red: [], yellow: [] })),
  });
  if (!base.ok) return null;
  const decoded = decodeControlledRoundSnapshotV2(base.value);
  if (!decoded.ok) return null;
  const snapshot = {
    width: decoded.value.snapshot.width,
    height: decoded.value.snapshot.height,
    inBounds: decoded.value.inBounds,
    penaltyComponents: decoded.value.penaltyComponents,
    components: decoded.value.components,
  };
  const classifications = complete.map((hole) => classifyPenaltyAreaComponents({
    snapshot,
    holeId: hole.id,
    route: [hole.tee, ...hole.waypoints, hole.pin],
  }));
  if (classifications.some((item) => !item.ok)) return null;
  const frozen = createControlledRoundSnapshotV2({
    width: course.width,
    height: course.height,
    inBounds,
    penaltyMask,
    holeClassifications: classifications.map((item) => item.ok ? item.value : { holeId: "invalid", red: [], yellow: [] }),
  });
  return frozen.ok ? { snapshot: frozen.value, holes: new Map(complete.map((hole) => [hole.id, hole.pin])) } : null;
}

function retainedShot(world: World, evidence: ArchitectureShotEvidence) {
  if (evidence.source !== "playerPro") return null;
  const round = world.playerPro?.rounds.find((item) => item.id === evidence.roundId);
  return round?.shots.find((shot) => evidence.id.endsWith(`-${shot.id}`)) ?? null;
}

function emptyEvidence(evidence: ArchitectureShotEvidence, geometry: "current" | "historical", status: ArchitectureRulesEvidence["status"]): ArchitectureRulesEvidence {
  return {
    evidenceId: evidence.id,
    holeId: evidence.holeId,
    geometry,
    status,
    penalty: null,
    obstacle: { collision: "not-retained", type: null },
    recovery: { attempted: evidence.shotType === "recovery", troubleLie: TROUBLE_LIES.has(evidence.lieBefore ?? "") },
    relief: { required: false, status: "unknown", type: "unknown", legalCandidates: 0 },
  };
}

function fromRetained(evidence: ArchitectureShotEvidence, shot: NonNullable<ReturnType<typeof retainedShot>>): ArchitectureRulesEvidence {
  const outcome = shot.sharedOutcome;
  const ruling = outcome?.ruling ?? shot.ruling;
  const relief = outcome?.relief ?? shot.relief;
  const collision = outcome?.collision;
  return {
    ...emptyEvidence(evidence, "current", "retained"),
    penalty: ruling ? {
      strokes: ruling.penaltyStrokes,
      kind: ruling.penaltyKind,
      classification: ruling.penaltyAreaClassification,
    } : null,
    obstacle: collision
      ? { collision: collision.kind, type: collision.kind === "obstacle" ? collision.obstacleType : null }
      : { collision: "not-retained", type: null },
    recovery: {
      attempted: evidence.shotType === "recovery",
      troubleLie: TROUBLE_LIES.has(evidence.lieBefore ?? "") || collision?.kind === "obstacle",
    },
    relief: relief ? {
      required: ruling?.status === "penalty",
      status: relief.status,
      type: relief.type,
      legalCandidates: relief.candidates.filter((candidate) => candidate.legal).length,
    } : { required: ruling?.status === "penalty", status: "unknown", type: "unknown", legalCandidates: 0 },
  };
}

function reconstruct(evidence: ArchitectureShotEvidence, context: RulesContext | null): ArchitectureRulesEvidence {
  if (!context) return emptyEvidence(evidence, "current", "unavailable");
  const hole = context.holes.get(evidence.holeId);
  if (!hole) return emptyEvidence(evidence, "current", "unavailable");
  const resolved = resolveSharedRules({
    rulesSnapshot: context.snapshot,
    holeId: evidence.holeId,
    hole,
    previousPosition: evidence.from,
    physicalRest: evidence.rest,
    rollPath: [evidence.landing, evidence.rest],
    clubLengthTiles: 1,
    holed: false,
  });
  return {
    ...emptyEvidence(evidence, "current", resolved.usedFrozenSnapshot ? "reconstructed" : "unavailable"),
    penalty: {
      strokes: resolved.ruling.penaltyStrokes,
      kind: resolved.ruling.penaltyKind,
      classification: resolved.ruling.penaltyAreaClassification,
    },
    relief: {
      required: resolved.ruling.status === "penalty",
      status: resolved.relief.status,
      type: resolved.relief.type,
      legalCandidates: resolved.relief.candidates.filter((candidate) => candidate.legal).length,
    },
  };
}

function strategicFeedback(holes: M48StrategicHoleEvaluation[]): ArchitectureRulesFeedback[] {
  return holes.flatMap((hole) => {
    if (hole.status !== "complete") return [];
    const missingBailout = hole.safeRouteViability < 58 || hole.bailoutQuality < 32;
    if (hole.unavoidablePunishment < 50 || !missingBailout) return [];
    return [{
      id: `rules-${hole.id}-bailout`,
      level: "warning" as const,
      holeId: hole.holeId,
      message: `Unavoidable punishment is high on ${hole.holeId}; add a reachable bailout or open a relief route before the forced hazard.`,
    }];
  });
}

export function buildArchitectureRulesReview(args: {
  course: Course;
  world: World;
  evidence: ArchitectureShotEvidence[];
  currentGeometryVersion: string;
  strategicHoles: M48StrategicHoleEvaluation[];
}): ArchitectureRulesReview {
  const contexts = new Map<TeeSet, RulesContext | null>();
  const contextFor = (teeSet: TeeSet) => {
    if (!contexts.has(teeSet)) contexts.set(teeSet, rulesContext(args.course, teeSet));
    return contexts.get(teeSet) ?? null;
  };
  const retained = bounded(args.evidence, MAX_RULES_EVIDENCE).map((item) => {
    if (item.geometryVersion !== args.currentGeometryVersion) return emptyEvidence(item, "historical", "historical");
    const shot = retainedShot(args.world, item);
    return shot ? fromRetained(item, shot) : reconstruct(item, contextFor(item.teeSet));
  });
  const current = retained.filter((item) => item.geometry === "current");
  const penalties = current.filter((item) => (item.penalty?.strokes ?? 0) > 0);
  const feedback: ArchitectureRulesFeedback[] = [
    ...strategicFeedback(args.strategicHoles),
  ];
  if (current.length === 0) {
    feedback.push({ id: "rules-no-current-evidence", level: "advice", message: "Play a current routing round before using penalty or recovery feedback to change the design." });
  } else if (current.length < 8) {
    feedback.push({ id: "rules-sparse-evidence", level: "advice", message: "Penalty and recovery feedback is based on a small current sample; collect more rounds before making a broad redesign." });
  }
  const penaltyHoles = new Map<string, number>();
  for (const item of penalties) penaltyHoles.set(item.holeId, (penaltyHoles.get(item.holeId) ?? 0) + 1);
  for (const [holeId, count] of penaltyHoles) {
    if (count < 2 || count / current.filter((item) => item.holeId === holeId).length < .4) continue;
    feedback.push({
      id: `rules-${holeId}-penalty-pattern`,
      level: "warning",
      holeId,
      message: `${count} retained current traces on ${holeId} finish under a penalty ruling; verify that the intended safe line has a playable bailout.`,
    });
  }
  return {
    evidence: retained,
    currentEvidence: current.length,
    historicalEvidence: retained.length - current.length,
    penaltyCount: penalties.length,
    obstacleCollisionCount: current.filter((item) => item.obstacle.collision === "obstacle").length,
    recoveryAttemptCount: current.filter((item) => item.recovery.attempted).length,
    reliefResolvedCount: current.filter((item) => item.relief.status === "resolved").length,
    feedback: bounded(feedback, 24),
  };
}
