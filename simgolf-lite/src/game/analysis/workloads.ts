import { analyzeArchitecture } from "../architecture/architecture";
import { analyzeShotSlope } from "../models/shotSlope";
import type { Course, Obstacle, Point } from "../models/types";
import { deriveTreeHabitat } from "../render/treeHabitat";
import type { NaturalPropFrame } from "../render/naturalProps";

export const ANALYSIS_WORKLOAD_KINDS = [
  "architecture-routing",
  "surface-habitat",
] as const;

export type AnalysisWorkloadKind = typeof ANALYSIS_WORKLOAD_KINDS[number];

export interface ArchitectureRoutingPayload {
  workload: "architecture-routing";
  course: Course;
}

export interface SurfaceHabitatSample {
  from: Point;
  to: Point;
  handedness: "left" | "right";
}

export interface SurfaceHabitatInput {
  frame: NaturalPropFrame;
  obstacle: Obstacle;
  scale: number;
}

export interface SurfaceHabitatPayload {
  workload: "surface-habitat";
  width: number;
  height: number;
  yardsPerTile: number;
  worldSeed: number;
  elevations: Float64Array;
  samples: SurfaceHabitatSample[];
  habitats: SurfaceHabitatInput[];
  repetitions: number;
}

export type AnalysisWorkloadPayload = ArchitectureRoutingPayload | SurfaceHabitatPayload;

export interface ArchitectureRoutingOutput {
  workload: "architecture-routing";
  total: number;
  warningCount: number;
  warningIds: string[];
  componentScores: Record<string, number>;
  strategicTotal: number | null;
  analyzedHoles: number;
}

export interface SurfaceHabitatOutput {
  workload: "surface-habitat";
  slopeSamples: number;
  habitatSamples: number;
  playsLikeYards: number;
  elevationDelta: number;
  crossSlope: number;
  curveBias: number;
  habitatLobes: number;
  habitatDetails: number;
  habitatRoots: number;
  habitatRank: number;
}

export type AnalysisWorkloadOutput = ArchitectureRoutingOutput | SurfaceHabitatOutput;

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Runs existing deterministic analyzers against a serializable snapshot.
 * These results are advisory benchmark output and never mutate a Course or
 * GameSession. The architecture task is the production architecture report;
 * the surface task exercises the production shot-slope and tree-habitat
 * analyzers as honest proxies for fine-green and habitat-map work.
 */
export function runAnalysisWorkload(payload: AnalysisWorkloadPayload): AnalysisWorkloadOutput {
  if (payload.workload === "architecture-routing") {
    const report = analyzeArchitecture(payload.course);
    return {
      workload: payload.workload,
      total: report.total,
      warningCount: report.warnings.length,
      warningIds: report.warnings.map((warning) => warning.id),
      componentScores: Object.fromEntries(
        Object.entries(report.components).map(([key, component]) => [key, component.score]),
      ),
      strategicTotal: report.strategic?.summary.total ?? null,
      analyzedHoles: report.generatedFor.holeIds.length,
    };
  }

  const repetitions = Math.max(1, Math.min(200, Math.floor(payload.repetitions)));
  const course = {
    width: payload.width,
    height: payload.height,
    elevations: payload.elevations,
  };
  let playsLikeYards = 0;
  let elevationDelta = 0;
  let crossSlope = 0;
  let curveBias = 0;
  let habitatLobes = 0;
  let habitatDetails = 0;
  let habitatRoots = 0;
  let habitatRank = 0;

  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const sample of payload.samples) {
      const result = analyzeShotSlope({
        course,
        from: sample.from,
        to: sample.to,
        yardsPerTile: payload.yardsPerTile,
        handedness: sample.handedness,
      });
      playsLikeYards += result.playsLikeDistanceYards;
      elevationDelta += result.targetElevationDelta;
      crossSlope += result.localGradient.crossTargetLine;
      curveBias += result.naturalCurveBiasTiles;
    }
    for (const input of payload.habitats) {
      const patch = deriveTreeHabitat(input.frame, input.obstacle, payload.worldSeed, input.scale);
      if (!patch) continue;
      habitatLobes += patch.lobes.length;
      habitatDetails += patch.details.length;
      habitatRoots += patch.roots.length;
      habitatRank += patch.rank;
    }
  }

  return {
    workload: payload.workload,
    slopeSamples: payload.samples.length * repetitions,
    habitatSamples: payload.habitats.length * repetitions,
    playsLikeYards: rounded(playsLikeYards),
    elevationDelta: rounded(elevationDelta),
    crossSlope: rounded(crossSlope),
    curveBias: rounded(curveBias),
    habitatLobes,
    habitatDetails,
    habitatRoots,
    habitatRank: rounded(habitatRank),
  };
}

export function analysisOutputDigest(output: AnalysisWorkloadOutput): string {
  const text = JSON.stringify(output);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
