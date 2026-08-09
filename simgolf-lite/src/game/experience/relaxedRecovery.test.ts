import { describe, expect, it } from "vitest";
import { advisorMessages } from "../advisor/advisor";
import { createObjectiveState } from "../models/objectives";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { EconomicPressure, World } from "../models/types";
import { commitDay } from "../live/commitDay";
import { applyRelaxedRecoverySettlement } from "../operations/commands";
import { tickWeek } from "../sim/tickWeek";
import { advanceSeasonalDay } from "../seasons/seasons";
import { createNewGame } from "../gen/newGame";
import { createM26MultiCourseReferenceCourse } from "../testing/referenceCourse";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText, payloadForPersistence } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";
import {
  applySystemControlCommand,
  createSystemControlState,
  reconcileSystemControlWorld,
  systemControlEnvelope,
} from "./systemControl";

function relaxedWorld(overrides: Partial<World> = {}): World {
  return reconcileSystemControlWorld({
    ...structuredClone(DEFAULT_WORLD),
    experienceProfile: "relaxed",
    economicPressure: "balanced",
    systemControl: createSystemControlState("relaxed"),
    ...overrides,
  });
}

function recovery(previous: World, settledCash: number, day?: number) {
  const settled = {
    ...previous,
    week: day == null ? previous.week + 1 : previous.week,
    cash: settledCash,
    isBankrupt: settledCash < 0,
    distressWeeks: settledCash < 0 ? 2 : 0,
  };
  return applyRelaxedRecoverySettlement(DEFAULT_COURSE, previous, settled, day == null
    ? { source: "weekly", weatherSeverity: 0.7, condition: 0.5 }
    : { source: "live-day", day, weatherSeverity: 0.7, condition: 0.5 });
}

describe("ZK-687 Relaxed recovery authority", () => {
  it.each(["friendly", "balanced", "tight"] as EconomicPressure[])("keeps %s pressure independent while advancing only enough cash to settle", (economicPressure) => {
    const before = relaxedWorld({ cash: 62.75, economicPressure, lastWeekProfit: -900 });
    const tournamentBefore = structuredClone(before.tournaments);
    const proBefore = structuredClone(before.playerPro);
    const campaignBefore = structuredClone(before.campaign);
    const result = recovery(before, -437.25);
    expect(result.ok).toBe(true);
    expect(result.world.cash).toBe(0);
    expect(result.world.isBankrupt).toBe(false);
    expect(result.world.lastWeekProfit).toBe(-900);
    expect(result.world.systemControl?.recovery).toMatchObject({
      version: 1,
      outstandingAdvance: 437.25,
      totalRelief: 437.25,
      totalRepaid: 0,
    });
    expect(result.world.systemControl?.recovery?.receipts[0]).toMatchObject({
      economicPressure,
      cashAfterSettlement: -437.25,
      relief: 437.25,
      cashAfter: 0,
      reasons: ["cash-deficit", "poor-turf", "severe-weather"],
    });
    expect(result.world.tournaments).toEqual(tournamentBefore);
    expect(result.world.playerPro).toEqual(proBefore);
    expect(result.world.campaign).toEqual(campaignBefore);
  });

  it("is exact-once, bounded, non-profitable, and repays the advance before leaving positive cash", () => {
    const previous = relaxedWorld({ cash: 250, lastWeekProfit: -800 });
    const first = recovery(previous, -250);
    const duplicate = recovery(previous, -250);
    expect(duplicate.world).toEqual(first.world);
    expect(duplicate.world.systemControl?.recovery?.receipts).toHaveLength(1);

    const repaid = recovery({ ...first.world, lastWeekProfit: 100 }, 100);
    expect(repaid.world.cash).toBe(0);
    expect(repaid.world.lastWeekProfit).toBe(100);
    expect(repaid.world.systemControl?.recovery).toMatchObject({ outstandingAdvance: 150, totalRelief: 250, totalRepaid: 100 });
    expect(repaid.world.systemControl?.recovery?.receipts[1]).toMatchObject({ relief: 0, repayment: 100 });

    let current = repaid.world;
    for (let week = 3; week < 50; week++) {
      current = recovery(current, -1).world;
    }
    expect(current.systemControl?.recovery?.receipts).toHaveLength(32);
    expect(current.isBankrupt).toBe(false);
    expect(current.cash).toBe(0);
    const stalePrevious = { ...current, week: 1 };
    const stale = recovery(stalePrevious, -999);
    expect(stale.world).toEqual(stalePrevious);
    expect(stale.world.systemControl?.recovery?.receipts).toHaveLength(32);
  });

  it("absorbs fractional-cent settlement residue without leaving cash or liability drift", () => {
    const advanced = recovery(relaxedWorld({ cash: 1 }), -0.004);
    expect(advanced.world.cash).toBe(0);
    expect(advanced.world.systemControl?.recovery).toMatchObject({ outstandingAdvance: 0.01, totalRelief: 0.01 });
    const repaid = recovery(advanced.world, 0.004);
    expect(repaid.world.cash).toBe(0);
    expect(repaid.world.systemControl?.recovery).toMatchObject({ outstandingAdvance: 0, totalRepaid: 0.01 });
  });

  it("never revives terminal runs and never protects Classic or Simulation profiles", () => {
    const objectives = createObjectiveState([]);
    objectives.outcome = "LOST";
    objectives.lostReason = "BANKRUPT";
    const terminal = relaxedWorld({ cash: -500, isBankrupt: true, objectives });
    const preserved = recovery(terminal, -1_000);
    expect(preserved.world).toMatchObject({
      week: terminal.week + 1,
      isBankrupt: true,
      objectives: terminal.objectives,
      systemControl: terminal.systemControl,
    });
    const liar = applyRelaxedRecoverySettlement(DEFAULT_COURSE, terminal, { ...terminal, week: terminal.week + 1, cash: -1_000, isBankrupt: false }, { source: "weekly", weatherSeverity: 1, condition: 0 });
    expect(liar.world).toMatchObject({
      week: terminal.week + 1,
      isBankrupt: true,
      objectives: terminal.objectives,
      systemControl: terminal.systemControl,
    });
    const stale = applyRelaxedRecoverySettlement(DEFAULT_COURSE, relaxedWorld(), { ...relaxedWorld(), week: 99, cash: -500 }, { source: "weekly", weatherSeverity: 1, condition: 0 });
    expect(stale).toMatchObject({ ok: false, message: "relaxed-recovery|stale-settlement" });
    const hostilePrevious = relaxedWorld();
    const hostileSource = applyRelaxedRecoverySettlement(
      DEFAULT_COURSE,
      hostilePrevious,
      { ...hostilePrevious, week: hostilePrevious.week + 1, cash: -500 },
      { source: "monthly", weatherSeverity: 1, condition: 0 } as never,
    );
    expect(hostileSource).toMatchObject({ ok: false, disposition: "rejected" });
    expect(hostileSource.world).toEqual(hostilePrevious);
    expect(hostileSource.world.systemControl?.recovery).toBeUndefined();
    for (const profile of ["classic", "simulation"] as const) {
      const world = reconcileSystemControlWorld({
        ...structuredClone(DEFAULT_WORLD),
        experienceProfile: profile,
        systemControl: createSystemControlState(profile),
        cash: -500,
      });
      const result = recovery(world, -500);
      expect(result.world.cash).toBe(-500);
      expect(result.world.systemControl?.recovery).toBeUndefined();
    }
  });
});

describe("ZK-687 settlement integration and automation", () => {
  const reactions = { rounds: 0, avgSatisfaction: 0, promoters: 0, detractors: 0, willReturnRate: 0.5 };

  it("prevents same-commit terminal loss in both live and weekly settlement without changing recorded profit", () => {
    const objectives = createObjectiveState([]);
    const live = commitDay({
      course: DEFAULT_COURSE,
      world: relaxedWorld({ cash: -9_900, distressWeeks: 1, objectives: structuredClone(objectives) }),
      revenue: 0,
      reactions,
      dayIndex: 6,
    });
    expect(live.world).toMatchObject({ cash: 0, distressWeeks: 0, isBankrupt: false });
    expect(live.world.objectives?.outcome).not.toBe("LOST");
    expect(live.world.systemControl?.recovery?.receipts.at(-1)?.source).toBe("live-day");
    expect(live.result.profit).toBeLessThan(0);

    const weekly = tickWeek(
      DEFAULT_COURSE,
      relaxedWorld({ cash: -9_900, distressWeeks: 1, objectives: structuredClone(objectives) }),
      687,
    );
    expect(weekly.world).toMatchObject({ cash: 0, distressWeeks: 0, isBankrupt: false });
    expect(weekly.world.objectives?.outcome).not.toBe("LOST");
    expect(weekly.world.systemControl?.recovery?.receipts.at(-1)?.source).toBe("weekly");
    expect(weekly.world.lastWeekProfit).toBe(weekly.result.profit);
    expect(weekly.result.profit).toBeLessThan(0);
  });

  it("rejects repeated live and live-to-weekly overlap as whole commits", () => {
    const objectives = createObjectiveState([]);
    const initial = relaxedWorld({ cash: -9_900, distressWeeks: 1, objectives });
    const live = commitDay({
      course: DEFAULT_COURSE,
      world: initial,
      revenue: 0,
      reactions,
      dayIndex: 0,
    });
    expect(live.recoveryDisposition).toBe("applied");

    const repeatedLive = commitDay({
      course: live.course,
      world: live.world,
      revenue: 0,
      reactions,
      dayIndex: 0,
    });
    expect(repeatedLive.recoveryDisposition).toBe("duplicate");
    expect(repeatedLive.course).toEqual(live.course);
    expect(repeatedLive.world).toEqual(live.world);
    expect(repeatedLive.result).toEqual({
      dayIndex: 0,
      rounds: 0,
      revenue: 0,
      revenueBreakdown: { greenFees: 0, concessions: 0, byConcession: {}, transactions: [] },
      costs: 0,
      profit: 0,
      avgSatisfaction: 0,
      reputationDelta: 0,
      conditionDelta: 0,
      promoters: 0,
      detractors: 0,
      willReturnRate: 0,
    });

    const overlappingWeek = tickWeek(live.course, live.world, 1687);
    expect(overlappingWeek.recoveryDisposition).toBe("duplicate");
    expect(overlappingWeek.course).toEqual(live.course);
    expect(overlappingWeek.world).toEqual(live.world);
    expect(overlappingWeek.result).toEqual({
      visitors: 0,
      revenue: 0,
      costs: 0,
      profit: 0,
      avgSatisfaction: 0,
      reputationDelta: 0,
      visitorNoise: 0,
    });
  });

  it("commits no-relief Relaxed periods and accepts the next authoritative live day", () => {
    const initial = relaxedWorld({ cash: 100_000, maintenanceBudget: 1_000 });
    const first = commitDay({ course: DEFAULT_COURSE, world: initial, revenue: 0, reactions, dayIndex: 0 });
    expect(first.recoveryDisposition).toBe("noop");
    expect(first.world.systemControl?.recovery?.lastSettled.liveAbsoluteDay).toBe(initial.week * 7);
    const second = commitDay({ course: first.course, world: first.world, revenue: 0, reactions, dayIndex: 1 });
    expect(second.recoveryDisposition).not.toBe("duplicate");
    expect(second.recoveryDisposition).not.toBe("rejected");
    expect(second.world.systemControl?.recovery?.lastSettled.liveAbsoluteDay).toBe(initial.week * 7 + 1);
    expect(second.world).not.toEqual(first.world);
  });

  it("uses authoritative turf/water commands only while those Relaxed domains remain automated", () => {
    const stressed = relaxedWorld({ cash: 100, maintenanceBudget: 900 });
    const course = { ...structuredClone(DEFAULT_COURSE), condition: 0.5 };
    const automatic = advanceSeasonalDay(course, stressed, 0);
    expect(automatic.world.seasonal?.operations.turfPriority).toBe("recovery");
    expect(automatic.world.seasonal?.automation.decisions.some((decision) => decision.startsWith("system-control|recovery-policy|"))).toBe(true);
    expect(automatic.world.seasonal?.automation.decisions).toContain("system-control|noop|8");

    const manual = applySystemControlCommand(stressed, { type: "TAKE_SYSTEM_CONTROL", system: "localized-turf" }).world;
    const preserved = advanceSeasonalDay(course, {
      ...manual,
      seasonal: { ...manual.seasonal!, operations: { ...manual.seasonal!.operations, turfPriority: "presentation" } },
    }, 0);
    expect(preserved.world.seasonal?.operations.turfPriority).toBe("presentation");
  });

  it("settles multi-course weekly recovery once against aggregate accounting", () => {
    const course = createM26MultiCourseReferenceCourse();
    const previous = relaxedWorld({ cash: -9_900, distressWeeks: 1, maintenanceBudget: 100_000 });
    const result = tickWeek(course, previous, 2687);
    expect(result.result.perCourse?.length).toBeGreaterThan(1);
    expect(result.world).toMatchObject({ cash: 0, isBankrupt: false, distressWeeks: 0 });
    expect(result.world.lastWeekProfit).toBe(result.result.profit);
    expect(result.world.systemControl?.recovery?.receipts).toHaveLength(1);
    expect(result.world.systemControl?.recovery?.receipts[0]).toMatchObject({ source: "weekly", week: previous.week });
    expect(result.world.systemControl?.recovery?.lastSettled.weeklyWeek).toBe(previous.week);
  });
});

describe("ZK-687 save/hash/advisor evidence", () => {
  it("migrates v30, reloads canonical receipts, preserves takeover, and hashes identically", () => {
    const run = createNewGame({ mode: "sandbox", courseName: "Recovery Hash", seed: 687, theme: "parkland", experienceProfile: "relaxed", economicPressure: "balanced" });
    const recovered = applyRelaxedRecoverySettlement(run.course, run.world, { ...run.world, week: run.world.week + 1, cash: -300, isBankrupt: true }, { source: "weekly", weatherSeverity: 0.7, condition: 0.5 }).world;
    const taken = applySystemControlCommand(recovered, { type: "TAKE_SYSTEM_CONTROL", system: "maintenance" }).world;
    const payload = payloadForPersistence({ course: run.course, world: taken });
    const loaded = parseSaveText(JSON.stringify({ schemaVersion: 30, savedAt: 687, ...payload }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migratedFrom).toBe(30);
    expect(loaded.payload.world.systemControl?.overrides).toEqual({ maintenance: "manual" });
    expect(loaded.payload.world.systemControl?.recovery).toEqual(taken.systemControl?.recovery);
    const canonical = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 687, ...payload }));
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    expect(hashGameState(loaded.payload)).toBe(hashGameState(canonical.payload));

    const current = parseSaveText(JSON.stringify({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 688, ...loaded.payload }));
    expect(current.ok).toBe(true);
    if (current.ok) expect(hashGameState(current.payload)).toBe(hashGameState(canonical.payload));
  });

  it("rejects hostile or internally inconsistent liability evidence without erasing debt", () => {
    const world = relaxedWorld();
    const loaded = parseSaveText(JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 689,
      course: DEFAULT_COURSE,
      world: {
        ...world,
        systemControl: {
          ...world.systemControl!,
          recovery: {
            version: 1,
            outstandingAdvance: 999,
            totalRelief: 100,
            totalRepaid: 0,
            lastSettled: { liveAbsoluteDay: 13, weeklyWeek: 1 },
            receipts: [{
              id: "forged",
              source: "weekly",
              week: 1,
              economicPressure: "balanced",
              cashBefore: 0,
              cashAfterSettlement: -100,
              relief: 100,
              repayment: 0,
              cashAfter: 100,
              outstandingAdvance: 999,
              reasons: ["cash-deficit"],
              automatedDomains: ["maintenance"],
            }],
          },
        },
      },
    }));
    expect(loaded).toMatchObject({ ok: false, error: { code: "INVALID_WORLD" } });
    expect(() => payloadForPersistence({ course: DEFAULT_COURSE, world: JSON.parse(JSON.stringify({ ...world, systemControl: { ...world.systemControl!, recovery: {
      version: 1, outstandingAdvance: 999, totalRelief: 100, totalRepaid: 0, receipts: [], lastSettled: { liveAbsoluteDay: 13, weeklyWeek: 1 },
    } } })) })).toThrow(/liability ledger is malformed/);
  });

  it("offers takeover only from a real receipt and removes the offer once that domain is manual", () => {
    expect(advisorMessages(DEFAULT_COURSE, relaxedWorld(), undefined, undefined).some((message) => message.takeControlSystem)).toBe(false);
    const recovered = recovery(relaxedWorld({ cash: 200 }), -300).world;
    const message = advisorMessages(DEFAULT_COURSE, recovered, undefined, undefined)
      .find((candidate) => candidate.id.startsWith("relaxed-recovery-"));
    expect(message).toMatchObject({ takeControlSystem: "maintenance" });
    const manual = applySystemControlCommand(recovered, { type: "TAKE_SYSTEM_CONTROL", system: "maintenance" }).world;
    const inspected = advisorMessages(DEFAULT_COURSE, manual, undefined, undefined)
      .find((candidate) => candidate.id.startsWith("relaxed-recovery-"));
    expect(inspected?.takeControlSystem).toBeUndefined();
    expect(systemControlEnvelope(manual).recovery?.actions).toBe(1);
  });
});
