import type { PropertyShotTrace } from "../property/types";
import type { Course, World } from "../models/types";
import type { DailyWeather, WaterPolicy } from "../seasons/types";
import { normalizedStaff } from "../live/pace";
import {
  normalizeGreenLocalState,
  normalizeGreenProgram,
  type GreenHoleConditionV1,
  type GreenProgram,
  type GreenZoneConditionV1,
  type GreenZoneKind,
} from "./greenSurface";

export interface GreenKeepingHoleReport {
  holeId: string;
  health: number;
  moisture: number;
  compaction: number;
  wear: number;
  landingTraffic: number;
  pinTraffic: number;
  realizedSpeedFeet: number;
  realizedFirmness: number;
}

export interface GreenKeepingReport {
  absoluteDay: number;
  preset: GreenProgram["preset"];
  requiredDailyBudget: number;
  allocatedDailyBudget: number;
  groundskeepers: number;
  staffCoverage: number;
  averageHealth: number;
  averageMoisture: number;
  averageCompaction: number;
  averageWear: number;
  realizedSpeedFeet: number;
  realizedFirmness: number;
  paceMinutesDelta: number;
  satisfactionDelta: number;
  stress: number;
  recovery: number;
  holes: GreenKeepingHoleReport[];
}

export interface GreenKeepingOverview extends Omit<GreenKeepingReport, "absoluteDay" | "stress" | "recovery"> {
  requiredWeeklyBudget: number;
  explicitAdvancedControls: boolean;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function zonesFor(hole: GreenHoleConditionV1): [GreenZoneConditionV1, GreenZoneConditionV1] {
  const fallback = (zone: GreenZoneKind): GreenZoneConditionV1 => ({
    zone,
    health: hole.health,
    moisture: hole.moisture,
    compaction: hole.compaction,
    wear: hole.wear,
    traffic: 0,
  });
  const landing = hole.zones?.find((zone) => zone.zone === "landing") ?? fallback("landing");
  const pin = hole.zones?.find((zone) => zone.zone === "pin") ?? fallback("pin");
  return [{ ...landing }, { ...pin }];
}

function greenCount(course: Course): number {
  return Math.max(1, course.holes.filter((hole) => hole.green).length || course.holes.length);
}

function programIntensity(program: GreenProgram): number {
  const speed = clamp((program.targetSpeedFeet - 8) / 5, 0, 1.4);
  const lowMow = clamp((4.5 - program.mowingHeightMillimeters) / 2.2, 0, 1.25);
  return 0.82 + speed * 0.22 + program.targetFirmness * 0.18 + lowMow * 0.2 + program.rollingPasses * 0.11;
}

export function requiredGreenKeepingBudget(course: Course, programValue: unknown = course.greenProgram): number {
  const program = normalizeGreenProgram(programValue);
  return Math.round((105 + greenCount(course) * 31) * programIntensity(program));
}

function groundskeeperCoverage(world: World, course: Course): { count: number; coverage: number } {
  const staff = normalizedStaff(world, course).filter((member) => member.role === "groundskeeper");
  const proficiency = staff.reduce((sum, member) => sum + clamp(member.proficiency ?? 0.58), 0);
  const equivalent = staff.length ? proficiency / 0.58 : 0;
  const needed = Math.max(1, Math.ceil(greenCount(course) / 9));
  return { count: staff.length, coverage: clamp(equivalent / needed, 0, 1.2) };
}

function budgetCoverage(course: Course, world: World, program: GreenProgram): { requiredDaily: number; allocatedDaily: number; coverage: number } {
  const requiredDaily = requiredGreenKeepingBudget(course, program) / 7;
  // The maintenance budget also serves every other cultivated surface. This
  // fixed share is a capacity allocation, not a second cash charge.
  const allocatedDaily = Math.max(0, world.maintenanceBudget) * 0.44 / 7;
  return { requiredDaily, allocatedDaily, coverage: clamp(allocatedDaily / Math.max(1, requiredDaily), 0, 1.25) };
}

function weatherMoisture(weather: DailyWeather): { rain: number; evaporation: number; recovery: number; stress: number } {
  const rain = clamp(weather.rainInches * 0.42, 0, 0.28);
  const hot = clamp((weather.temperatureF - 76) / 34, 0, 1);
  const wind = clamp((weather.windMph - 9) / 24, 0, 1);
  const evaporation = 0.025 + hot * 0.055 + wind * 0.025 + (weather.kind === "drought" ? 0.055 : 0);
  const severe = weather.kind === "storm" || weather.kind === "heavy_rain" ? weather.severity * 0.035 : 0;
  const recovery = weather.temperatureF >= 50 && weather.temperatureF <= 82 ? 0.014 : 0.006;
  return { rain, evaporation, recovery, stress: severe + hot * 0.012 };
}

function trafficForHole(
  course: Course,
  holeId: string,
  rounds: number,
  traces: readonly PropertyShotTrace[],
): { landing: number; pin: number } {
  const hole = course.holes.find((candidate) => candidate.id === holeId);
  const relevant = traces.filter((trace) => trace.holeId === holeId);
  const landing = relevant.filter((trace) => {
    const x = Math.floor(trace.to.x);
    const y = Math.floor(trace.to.y);
    return x >= 0 && y >= 0 && x < course.width && y < course.height
      && course.tiles[y * course.width + x] === "green";
  }).length;
  const observedGolfers = new Set(relevant.map((trace) => trace.golferId)).size;
  const modeledRounds = relevant.length ? observedGolfers : rounds;
  const pin = hole?.green ? Math.max(modeledRounds, Math.round(modeledRounds * 1.65)) : 0;
  return { landing: landing || modeledRounds, pin };
}

function realized(program: GreenProgram, zone: GreenZoneConditionV1, delivery: number): { speed: number; firmness: number } {
  const healthPenalty = (1 - zone.health) * 2.2;
  const wearPenalty = zone.wear * 1.25;
  const moistureSpeed = (0.56 - zone.moisture) * 1.8;
  const mowGain = (3.5 - program.mowingHeightMillimeters) * 0.18;
  const rollGain = (program.rollingPasses - 1) * 0.12;
  const deliveryLoss = (1 - clamp(delivery)) * Math.max(0, program.targetSpeedFeet - 7.5) * 0.28;
  const speed = clamp(
    program.targetSpeedFeet + mowGain + rollGain + moistureSpeed - healthPenalty - wearPenalty - deliveryLoss,
    5.5,
    15.5,
  );
  const firmness = clamp(
    program.targetFirmness
      + (0.55 - zone.moisture) * 0.48
      + zone.compaction * 0.16
      - (1 - zone.health) * 0.22,
  );
  return { speed: round(speed, 2), firmness: round(firmness) };
}

function summarize(
  course: Course,
  world: World,
  program: GreenProgram,
  holes: readonly GreenHoleConditionV1[],
  absoluteDay: number,
  traffic: ReadonlyMap<string, { landing: number; pin: number }>,
  stress: number,
  recovery: number,
): GreenKeepingReport {
  const staffing = groundskeeperCoverage(world, course);
  const budget = budgetCoverage(course, world, program);
  const delivery = Math.min(staffing.coverage, budget.coverage);
  const rows: GreenKeepingHoleReport[] = holes.map((hole) => {
    const [landing, pin] = zonesFor(hole);
    const landingRealized = realized(program, landing, delivery);
    const pinRealized = realized(program, pin, delivery);
    const observed = traffic.get(hole.holeId) ?? { landing: 0, pin: 0 };
    return {
      holeId: hole.holeId,
      health: hole.health,
      moisture: hole.moisture,
      compaction: hole.compaction,
      wear: hole.wear,
      landingTraffic: observed.landing,
      pinTraffic: observed.pin,
      realizedSpeedFeet: round((landingRealized.speed + pinRealized.speed) / 2, 2),
      realizedFirmness: round((landingRealized.firmness + pinRealized.firmness) / 2),
    };
  });
  const average = (select: (row: GreenKeepingHoleReport) => number, fallback: number) => rows.length
    ? rows.reduce((sum, row) => sum + select(row), 0) / rows.length
    : fallback;
  const health = average((row) => row.health, 1);
  const moisture = average((row) => row.moisture, program.irrigationTarget);
  const compaction = average((row) => row.compaction, 0);
  const wear = average((row) => row.wear, 0);
  const speed = average((row) => row.realizedSpeedFeet, program.targetSpeedFeet);
  const firmness = average((row) => row.realizedFirmness, program.targetFirmness);
  const targetError = Math.abs(speed - program.targetSpeedFeet) / 3 + Math.abs(firmness - program.targetFirmness);
  const conditioning = health - wear * 0.7 - targetError * 0.24;
  const championshipChallenge = clamp((speed - 9.5) / 3, -0.3, 0.75);
  const rawSatisfactionDelta = (conditioning - 0.94) * 8 + championshipChallenge * 0.4;
  return {
    absoluteDay,
    preset: program.preset,
    requiredDailyBudget: round(budget.requiredDaily, 2),
    allocatedDailyBudget: round(budget.allocatedDaily, 2),
    groundskeepers: staffing.count,
    staffCoverage: round(staffing.coverage),
    averageHealth: round(health),
    averageMoisture: round(moisture),
    averageCompaction: round(compaction),
    averageWear: round(wear),
    realizedSpeedFeet: round(speed, 2),
    realizedFirmness: round(firmness),
    paceMinutesDelta: round(clamp((speed - 9.5) * 1.35 + compaction * 2.5, -4, 8), 1),
    satisfactionDelta: Math.abs(rawSatisfactionDelta) < 0.5
      ? 0
      : round(clamp(rawSatisfactionDelta, -8, 4), 1),
    stress: round(stress),
    recovery: round(recovery),
    holes: rows,
  };
}

export function greenKeepingOverview(course: Course, world: World): GreenKeepingOverview {
  const program = normalizeGreenProgram(course.greenProgram);
  const local = normalizeGreenLocalState(course.greenLocalState, course);
  const report = summarize(course, world, program, local.holes, local.lastAdvancedAbsoluteDay ?? -1, new Map(), 0, 0);
  const { absoluteDay: _absoluteDay, stress: _stress, recovery: _recovery, ...overview } = report;
  return {
    ...overview,
    requiredWeeklyBudget: requiredGreenKeepingBudget(course, program),
    explicitAdvancedControls: program.preset === "custom",
  };
}

export function advanceGreenKeepingDay(input: {
  course: Course;
  world: World;
  absoluteDay: number;
  weather: DailyWeather;
  drainageLevel: number;
  waterPolicy: WaterPolicy;
  rounds: number;
  shotTraces?: readonly PropertyShotTrace[];
  closedHoleIds?: readonly string[];
}): { course: Course; report: GreenKeepingReport } {
  const program = normalizeGreenProgram(input.course.greenProgram);
  const local = normalizeGreenLocalState(input.course.greenLocalState, input.course);
  const traffic = new Map(local.holes.map((hole) => [
    hole.holeId,
    trafficForHole(input.course, hole.holeId, Math.max(0, input.rounds), input.shotTraces ?? []),
  ]));
  if ((local.lastAdvancedAbsoluteDay ?? -1) >= input.absoluteDay) {
    return { course: input.course, report: summarize(input.course, input.world, program, local.holes, input.absoluteDay, traffic, 0, 0) };
  }

  const staffing = groundskeeperCoverage(input.world, input.course);
  const budget = budgetCoverage(input.course, input.world, program);
  const capacity = clamp(Math.min(staffing.coverage, budget.coverage), 0, 1.15);
  const weather = weatherMoisture(input.weather);
  const waterSupply = input.waterPolicy === "conserve" ? 0.78 : input.waterPolicy === "irrigate" ? 1.08 : 1;
  const drainage = clamp(input.drainageLevel / 3);
  const closed = new Set(input.closedHoleIds ?? []);
  let totalStress = 0;
  let totalRecovery = 0;

  const holes = local.holes.map((hole) => {
    const observed = traffic.get(hole.holeId) ?? { landing: 0, pin: 0 };
    const resting = closed.has(hole.holeId);
    const nextZones = zonesFor(hole).map((previous): GreenZoneConditionV1 => {
      const dailyTraffic = resting ? 0 : previous.zone === "landing" ? observed.landing : observed.pin;
      // A busy 18-hole day remains below the cap so pin concentration is
      // still distinguishable from approach landing traffic in saved state.
      const trafficPressure = clamp(dailyTraffic / 240, 0, 0.5);
      const irrigationNeed = Math.max(0, program.irrigationTarget - previous.moisture);
      const irrigation = irrigationNeed * (0.18 + capacity * 0.32) * waterSupply;
      const saturationDrain = Math.max(0, previous.moisture + weather.rain - 0.76) * (0.1 + drainage * 0.34);
      const moisture = clamp(previous.moisture + weather.rain + irrigation - weather.evaporation - saturationDrain);
      const mowStress = clamp((3.5 - program.mowingHeightMillimeters) / 1.5, 0, 1) * 0.012;
      const rollingStress = program.rollingPasses * 0.005;
      const droughtStress = Math.max(0, 0.38 - moisture) * 0.08;
      const saturationStress = Math.max(0, moisture - 0.82) * (0.05 - drainage * 0.025);
      const stress = trafficPressure * (previous.zone === "pin" ? 0.055 : 0.04)
        + mowStress + rollingStress + droughtStress + saturationStress + weather.stress;
      const restBonus = resting || dailyTraffic === 0 ? 0.018 : 0;
      const recovery = (0.006 + capacity * 0.02 + weather.recovery + restBonus)
        * (0.55 + previous.health * 0.45);
      totalStress += stress;
      totalRecovery += recovery;
      return {
        zone: previous.zone,
        health: round(clamp(previous.health + recovery - stress)),
        moisture: round(moisture),
        compaction: round(clamp(previous.compaction + trafficPressure * 0.07 + program.rollingPasses * 0.004 - recovery * (0.55 + drainage * 0.3))),
        wear: round(clamp(previous.wear + trafficPressure * 0.09 + mowStress * 0.5 - recovery * 0.75)),
        traffic: round(clamp(previous.traffic * 0.72 + trafficPressure)),
      };
    });
    return {
      holeId: hole.holeId,
      health: round((nextZones[0].health + nextZones[1].health) / 2),
      moisture: round((nextZones[0].moisture + nextZones[1].moisture) / 2),
      compaction: round((nextZones[0].compaction + nextZones[1].compaction) / 2),
      wear: round((nextZones[0].wear + nextZones[1].wear) / 2),
      zones: nextZones,
    };
  });
  const nextLocal = normalizeGreenLocalState({
    version: 1,
    lastAdvancedAbsoluteDay: input.absoluteDay,
    holes,
  }, input.course);
  const course = { ...input.course, greenProgram: program, greenLocalState: nextLocal };
  return {
    course,
    report: summarize(
      course,
      input.world,
      program,
      nextLocal.holes,
      input.absoluteDay,
      traffic,
      totalStress / Math.max(1, holes.length * 2),
      totalRecovery / Math.max(1, holes.length * 2),
    ),
  };
}
