import {
  observedSurfaceCareZones,
  surfaceCarePresentationSignature,
  type EffectiveSurfaceTreatment,
  type ObservedSurfaceCareZone,
} from "../conditions/surfaceCare";
import type {
  Course,
  CultivatedTerrain,
  Point,
  SurfaceRepairKind,
  Terrain,
} from "../models/types";

export type SurfaceCareVisualQuality = "low" | "medium" | "high";

/**
 * Cue names describe only evidence present in the observed care record.
 * In particular, wet-disease and weed cues are explicitly risk/pressure
 * signals rather than diagnoses that the simulation does not own.
 */
export type SurfaceCareVisualCue =
  | "worn-line"
  | "divot"
  | "compaction"
  | "mud-softness"
  | "dry-stress"
  | "wet-disease-risk"
  | "weed-pressure"
  | "overgrowth"
  | "thinning"
  | "bare-failure"
  | "repair-reseed"
  | "repair-resod"
  | "recovery-dressing"
  | "groundskeeper-work";

export const SURFACE_CARE_COMMAND_BUDGET: Readonly<
  Record<SurfaceCareVisualQuality, number>
> = Object.freeze({
  low: 96,
  medium: 240,
  high: 480,
});

export interface SurfaceCareVisualCommand {
  readonly id: string;
  readonly cue: SurfaceCareVisualCue;
  readonly zoneKey: string;
  readonly surfaceId: string;
  readonly holeId: string | null;
  readonly sourceAbsoluteDay: number;
  readonly intendedTerrain: CultivatedTerrain;
  readonly effectiveTerrain: Terrain;
  readonly treatment: EffectiveSurfaceTreatment;
  readonly repairKind: SurfaceRepairKind | null;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly alpha: number;
  readonly color: number;
  readonly severity: number;
  /** Animation is presentation-only and never changes the selected anchor. */
  readonly animated: boolean;
}

export interface SurfaceCarePresentationInput {
  readonly course: Course;
  readonly quality: SurfaceCareVisualQuality;
  readonly seed: number;
  readonly reducedMotion?: boolean;
}

export interface SurfaceCarePresentationSummary {
  readonly signature: string;
  readonly observedZones: number;
  readonly commands: number;
  readonly budget: number;
  readonly cueCounts: Readonly<Partial<Record<SurfaceCareVisualCue, number>>>;
  readonly holeCounts: Readonly<Record<string, number>>;
}

interface CueEvidence {
  cue: SurfaceCareVisualCue;
  severity: number;
}

const CUE_COLOR: Readonly<Record<SurfaceCareVisualCue, number>> = Object.freeze({
  "worn-line": 0x765c3f,
  divot: 0x4e402f,
  compaction: 0x5a5143,
  "mud-softness": 0x59483d,
  "dry-stress": 0xa8864d,
  "wet-disease-risk": 0x51694b,
  "weed-pressure": 0x476d36,
  overgrowth: 0x365f2f,
  thinning: 0x9b8a58,
  "bare-failure": 0x74563c,
  "repair-reseed": 0xc39a57,
  "repair-resod": 0x78a85a,
  "recovery-dressing": 0x6f8750,
  "groundskeeper-work": 0xe0c56a,
});

const CUE_SALT: Readonly<Record<SurfaceCareVisualCue, number>> = Object.freeze({
  "worn-line": 0x101,
  divot: 0x211,
  compaction: 0x307,
  "mud-softness": 0x419,
  "dry-stress": 0x521,
  "wet-disease-risk": 0x631,
  "weed-pressure": 0x743,
  overgrowth: 0x857,
  thinning: 0x967,
  "bare-failure": 0xa79,
  "repair-reseed": 0xb83,
  "repair-resod": 0xc97,
  "recovery-dressing": 0xda3,
  "groundskeeper-work": 0xeb1,
});

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function unitHash(value: string): number {
  return hashText(value) / 0x1_0000_0000;
}

interface HoleAffinity {
  id: string | null;
  heading: number;
}

function nearestHoleAffinity(course: Course, point: Point): HoleAffinity {
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestHeading = 0;
  for (let index = 0; index < course.holes.length; index++) {
    const hole = course.holes[index];
    const route = [hole.tee, ...(hole.waypoints ?? []), hole.green]
      .filter((candidate): candidate is Point => candidate != null);
    if (route.length === 0) continue;
    const id = hole.id ?? `hole-${index + 1}`;
    const segments = route.length > 1
      ? route.slice(1).map((to, routeIndex) => ({ from: route[routeIndex], to }))
      : [{ from: route[0], to: route[0] }];
    for (const segment of segments) {
      const dx = segment.to.x - segment.from.x;
      const dy = segment.to.y - segment.from.y;
      const length2 = dx * dx + dy * dy;
      const t = length2 <= 1e-9
        ? 0
        : clamp(
          ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy)
          / length2,
        );
      const distance = Math.hypot(
        point.x - (segment.from.x + dx * t),
        point.y - (segment.from.y + dy * t),
      );
      if (
        distance < bestDistance
        || (distance === bestDistance && id.localeCompare(bestId ?? "") < 0)
      ) {
        bestDistance = distance;
        bestId = id;
        bestHeading = length2 <= 1e-9 ? 0 : Math.atan2(dy, dx);
      }
    }
  }
  return { id: bestId, heading: bestHeading };
}

function evidenceFor(observed: ObservedSurfaceCareZone): readonly CueEvidence[] {
  const { record, effective } = observed;
  const evidence: CueEvidence[] = [];
  const trafficPressure = clamp(record.lastTraffic / Math.max(3, record.area * 2));
  const repairServiceRatio = clamp(record.lastRepairServiceRatio ?? 0);

  if (record.wear >= 0.2 || trafficPressure >= 0.2) {
    evidence.push({
      cue: "worn-line",
      severity: clamp(Math.max(record.wear, trafficPressure)),
    });
  }
  if (record.wear >= 0.14 && record.lastTraffic > 0) {
    evidence.push({
      cue: "divot",
      severity: clamp(record.wear * 0.8 + trafficPressure * 0.35),
    });
  }
  if (record.wear >= 0.32 && record.lastTraffic > 0) {
    evidence.push({
      cue: "compaction",
      severity: clamp(record.wear * 0.75 + trafficPressure * 0.4),
    });
  }
  if (record.moisture >= 0.78 && record.drainageStress >= 0.18) {
    evidence.push({
      cue: "mud-softness",
      severity: clamp((record.moisture - 0.72) * 2 + record.drainageStress * 0.7),
    });
  }
  if (record.moisture <= 0.38 && record.insufficientWaterDays >= 1) {
    evidence.push({
      cue: "dry-stress",
      severity: clamp((0.45 - record.moisture) * 2 + record.insufficientWaterDays / 14),
    });
  }
  if (
    record.saturatedDays >= 4
    && record.turfHealth < 0.82
    && record.drainageStress > 0.2
  ) {
    evidence.push({
      cue: "wet-disease-risk",
      severity: clamp(
        record.saturatedDays / 18
        + record.drainageStress * 0.5
        + (1 - record.turfHealth) * 0.35,
      ),
    });
  }
  if (
    record.missedMowingDays >= 8
    && record.mowingQuality < 0.55
    && !record.repairRequired
  ) {
    evidence.push({
      cue: "weed-pressure",
      severity: clamp(
        record.missedMowingDays / 24 + (0.58 - record.mowingQuality) * 0.7,
      ),
    });
  }
  if (
    effective.treatment === "overgrown"
    || effective.treatment === "severely-overgrown"
  ) {
    evidence.push({
      cue: "overgrowth",
      severity: clamp(
        (1 - record.mowingQuality)
        * (effective.treatment === "severely-overgrown" ? 1 : 0.78),
      ),
    });
  }
  if (
    (effective.treatment === "thin" || record.turfHealth < 0.7)
    && effective.treatment !== "bare"
    && !record.repair
  ) {
    evidence.push({
      cue: "thinning",
      severity: clamp((0.76 - record.turfHealth) * 1.4),
    });
  }
  if (effective.treatment === "bare" && record.repairRequired) {
    evidence.push({
      cue: "bare-failure",
      severity: clamp(0.65 + (0.2 - record.turfHealth) * 1.5),
    });
  }
  if (record.repair) {
    evidence.push({
      cue: record.repair.kind === "reseed" ? "repair-reseed" : "repair-resod",
      severity: clamp(0.75 + (1 - record.repairProgress) * 0.2),
    });
    if (record.repairProgress > 0) {
      evidence.push({
        cue: "recovery-dressing",
        severity: clamp(0.4 + record.repairProgress * 0.45),
      });
    }
    // Only explicit latest-day task telemetry can animate a worker. Generic
    // mowing allocation may predate the purchase and is never accepted.
    if (
      record.lastRepairProgressed === true
      && repairServiceRatio >= 0.55
    ) {
      evidence.push({
        cue: "groundskeeper-work",
        severity: clamp(0.45 + repairServiceRatio * 0.45),
      });
    }
  }

  return Object.freeze(evidence);
}

function commandsPerCue(
  quality: SurfaceCareVisualQuality,
  severity: number,
  area: number,
): number {
  const tier = quality === "high" ? 5 : quality === "medium" ? 3 : 1;
  const areaScale = Math.max(0.55, Math.min(1.35, Math.sqrt(Math.max(1, area) / 24)));
  return Math.max(1, Math.min(tier, Math.ceil(severity * tier * areaScale)));
}

function commandAt(
  input: SurfaceCarePresentationInput,
  observed: ObservedSurfaceCareZone,
  evidence: CueEvidence,
  sequence: number,
): SurfaceCareVisualCommand {
  const { zone, record, effective } = observed;
  const salt = CUE_SALT[evidence.cue];
  // Observation day changes the cue's intensity/signature, not its anchor.
  // That keeps continuous wear/recovery from visibly hopping day to day.
  const identity = `${input.seed}:${zone.key}:${evidence.cue}:${sequence}`;
  const sortedCells = zone.cells;
  const selectedIndex = hashText(`${identity}:cell:${salt}`) % sortedCells.length;
  const cell = sortedCells[selectedIndex];
  const tileX = cell % input.course.width;
  const tileY = Math.floor(cell / input.course.width);
  const center = {
    x: zone.cells.reduce((sum, index) => sum + index % input.course.width + 0.5, 0)
      / zone.cells.length,
    y: zone.cells.reduce((sum, index) => sum + Math.floor(index / input.course.width) + 0.5, 0)
      / zone.cells.length,
  };
  const affinity = nearestHoleAffinity(input.course, center);
  const routeAligned = evidence.cue === "worn-line"
    || evidence.cue === "compaction";
  const rotation = routeAligned
    ? affinity.heading + (unitHash(`${identity}:r:${salt}`) - 0.5) * 0.18
    : unitHash(`${identity}:r:${salt}`) * Math.PI * 2;
  return Object.freeze({
    id: `${zone.key}:${evidence.cue}:${sequence}`,
    cue: evidence.cue,
    zoneKey: zone.key,
    surfaceId: zone.surfaceId,
    holeId: affinity.id,
    sourceAbsoluteDay: record.lastObservedAbsoluteDay,
    intendedTerrain: zone.intendedTerrain,
    effectiveTerrain: effective.effectiveTerrain,
    treatment: effective.treatment,
    repairKind: record.repair?.kind ?? null,
    x: Number((tileX + 0.18 + unitHash(`${identity}:x:${salt}`) * 0.64).toFixed(4)),
    y: Number((tileY + 0.18 + unitHash(`${identity}:y:${salt}`) * 0.64).toFixed(4)),
    rotation: Number(rotation.toFixed(4)),
    scale: Number((0.72 + unitHash(`${identity}:s:${salt}`) * 0.56).toFixed(4)),
    alpha: Number((0.2 + evidence.severity * 0.46).toFixed(4)),
    color: CUE_COLOR[evidence.cue],
    severity: Number(evidence.severity.toFixed(4)),
    animated: evidence.cue === "groundskeeper-work" && !input.reducedMotion,
  });
}

/**
 * Pure, bounded, world-anchored presentation. Camera rotation transforms the
 * returned coordinates later; it cannot reselect anchors. Every command can
 * be traced back to one observed sparse record and its effective surface.
 */
export function surfaceCareVisualCommands(
  input: SurfaceCarePresentationInput,
): readonly SurfaceCareVisualCommand[] {
  const budget = SURFACE_CARE_COMMAND_BUDGET[input.quality];
  if (budget <= 0 || input.course.width <= 0 || input.course.height <= 0) {
    return Object.freeze([]);
  }
  const candidates: SurfaceCareVisualCommand[] = [];
  for (const observed of observedSurfaceCareZones(input.course)) {
    for (const evidence of evidenceFor(observed)) {
      const count = commandsPerCue(
        input.quality,
        evidence.severity,
        observed.zone.cells.length,
      );
      for (let sequence = 0; sequence < count; sequence++) {
        candidates.push(commandAt(input, observed, evidence, sequence));
      }
    }
  }
  candidates.sort((a, b) =>
    b.severity - a.severity
    || a.zoneKey.localeCompare(b.zoneKey)
    || a.cue.localeCompare(b.cue)
    || a.id.localeCompare(b.id));
  return Object.freeze(candidates.slice(0, budget));
}

export function surfaceCarePresentationSummary(
  input: SurfaceCarePresentationInput,
): SurfaceCarePresentationSummary {
  const observed = observedSurfaceCareZones(input.course);
  const commands = surfaceCareVisualCommands(input);
  const cueCounts: Partial<Record<SurfaceCareVisualCue, number>> = {};
  const holeCounts: Record<string, number> = {};
  for (const command of commands) {
    cueCounts[command.cue] = (cueCounts[command.cue] ?? 0) + 1;
    if (command.holeId) {
      holeCounts[command.holeId] = (holeCounts[command.holeId] ?? 0) + 1;
    }
  }
  return Object.freeze({
    signature: surfaceCarePresentationSignature(input.course),
    observedZones: observed.length,
    commands: commands.length,
    budget: SURFACE_CARE_COMMAND_BUDGET[input.quality],
    cueCounts: Object.freeze(cueCounts),
    holeCounts: Object.freeze(holeCounts),
  });
}
