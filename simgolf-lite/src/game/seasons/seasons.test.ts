import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, LandTheme, World } from "../models/types";
import { startPlayableRound } from "../playerPro/playerPro";
import {
  DAYS_PER_YEAR,
  WEEKS_PER_YEAR,
  absoluteDayFor,
  activeWeather,
  advanceSeasonalDay,
  applySeasonCommand,
  calendarDate,
  createSeasonalState,
  forecastForDay,
  normalizeSeasonalState,
  previewSeasonCommand,
  seasonalState,
  weatherForDay,
  weatherModifiers,
  weekDayFromAbsoluteDay,
} from "./seasons";
import { CLUB_CHARTERS, type ClubCharter } from "./types";

function fixture(theme: LandTheme = "parkland", charter: ClubCharter = "public-gem") {
  const course: Course = {
    ...DEFAULT_COURSE,
    theme,
    tiles: DEFAULT_COURSE.tiles.slice(),
    elevations: DEFAULT_COURSE.elevations.slice(),
    holes: DEFAULT_COURSE.holes.map((hole, index) => ({
      ...hole,
      tee: { x: 10 + index * 2, y: 20 },
      green: { x: 16 + index * 2, y: 20 },
      teeBoxes: { forward: { x: 11 + index * 2, y: 20 }, member: { x: 10 + index * 2, y: 20 }, championship: { x: 9 + index * 2, y: 20 } },
      pinPositions: { A: { x: 16 + index * 2, y: 20 }, B: { x: 16 + index * 2, y: 21 }, C: { x: 17 + index * 2, y: 20 } },
    })),
    layouts: DEFAULT_COURSE.layouts!.map((layout) => ({ ...layout })),
    obstacles: DEFAULT_COURSE.obstacles.slice(),
    buildings: DEFAULT_COURSE.buildings.slice(),
    decorations: DEFAULT_COURSE.decorations?.slice(),
    property: structuredClone(DEFAULT_COURSE.property),
  };
  const world: World = {
    ...DEFAULT_WORLD,
    runSeed: 390039,
    cash: 300_000,
    tournaments: {
      version: 2,
      events: [{
        id: "weather-open",
        name: "Weather Open",
        tier: "local",
        courseId: "course-primary",
        scheduledWeek: 3,
        scheduledDay: 2,
        status: "scheduled",
        bookingCost: 1_000,
        revenueAward: 2_000,
        reputationAward: 2,
        field: [],
      }],
    },
    enterprise: structuredClone(DEFAULT_WORLD.enterprise),
    playerPro: structuredClone(DEFAULT_WORLD.playerPro),
    livingClub: structuredClone(DEFAULT_WORLD.livingClub),
    seasonal: {
      ...createSeasonalState({ runSeed: 390039, theme }),
      charter,
    },
  };
  return { course, world };
}

describe("M39 32-week annual calendar", () => {
  it("maps every absolute day to four eight-week seasons without timezone input", () => {
    expect(WEEKS_PER_YEAR).toBe(32);
    expect(calendarDate(0)).toMatchObject({ year: 1, weekOfYear: 1, season: "spring", weekInSeason: 1, dayOfWeek: 0 });
    expect(calendarDate(55)).toMatchObject({ year: 1, weekOfYear: 8, season: "spring", weekInSeason: 8, dayOfWeek: 6 });
    expect(calendarDate(56)).toMatchObject({ year: 1, weekOfYear: 9, season: "summer", weekInSeason: 1, dayOfWeek: 0 });
    expect(calendarDate(111).season).toBe("summer");
    expect(calendarDate(112).season).toBe("autumn");
    expect(calendarDate(168).season).toBe("winter");
    expect(calendarDate(223)).toMatchObject({ year: 1, weekOfYear: 32, season: "winter", weekInSeason: 8, dayOfWeek: 6 });
    expect(calendarDate(224)).toMatchObject({ year: 2, weekOfYear: 1, season: "spring", weekInSeason: 1 });
    expect(weekDayFromAbsoluteDay(absoluteDayFor(33, 0))).toEqual({ week: 33, day: 0 });
  });

  it("migrates immediately before the saved date and does not replay a settlement", () => {
    const migrated = normalizeSeasonalState(undefined, { runSeed: 4, theme: "links", week: 18, day: 4, migrated: true });
    expect(migrated.calendar.absoluteDay).toBe(absoluteDayFor(18, 4));
    expect(migrated.lastCommittedAbsoluteDay).toBe(absoluteDayFor(18, 4) - 1);
    expect(migrated.automation.advancedOperations).toBe(true);
    expect(migrated.automation.overrides).toHaveLength(8);
  });
});

describe("M39 deterministic weather and shared golf inputs", () => {
  it("publishes a stable seven-day forecast with bounded severe cooldowns", () => {
    const first = forecastForDay(12345, "links", 80);
    expect(forecastForDay(12345, "links", 80)).toEqual(first);
    expect(first).toHaveLength(7);
    expect(first.map((day) => day.absoluteDay)).toEqual([80, 81, 82, 83, 84, 85, 86]);
    for (const theme of ["parkland", "links", "desert"] as LandTheme[]) {
      const decade = Array.from({ length: DAYS_PER_YEAR * 10 }, (_, day) => weatherForDay(9191, theme, day));
      expect(decade.every((day) => day.severity >= 0 && day.severity <= 1 && day.windMph <= 34)).toBe(true);
      for (let day = 1; day < decade.length; day++) {
        expect(decade[day].kind === "storm" && decade[day - 1].kind === "storm").toBe(false);
      }
    }
  });

  it("makes biomes distinct without chronically closing play", () => {
    const samples = (theme: LandTheme) => Array.from({ length: DAYS_PER_YEAR * 4 }, (_, day) => weatherForDay(222, theme, day));
    const links = samples("links");
    const desert = samples("desert");
    expect(links.reduce((sum, day) => sum + day.windMph, 0) / links.length)
      .toBeGreaterThan(desert.reduce((sum, day) => sum + day.windMph, 0) / desert.length);
    expect(desert.filter((day) => day.kind === "drought" || day.kind === "heat").length)
      .toBeGreaterThan(links.filter((day) => day.kind === "drought" || day.kind === "heat").length);
    expect(links.filter((day) => weatherModifiers(day).demandMultiplier >= .5).length / links.length).toBeGreaterThan(.9);
    expect(desert.filter((day) => weatherModifiers(day).demandMultiplier >= .5).length / desert.length).toBeGreaterThan(.9);
  });

  it("snapshots the same authoritative weather modifiers into Player Pro", () => {
    const { course, world } = fixture("links");
    const day = 3;
    const weather = activeWeather(world, course, day);
    const modifiers = weatherModifiers(weather, seasonalState(world, course, day).operations.drainageLevel);
    const started = startPlayableRound({ course, world, day });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.round.course.weather).toMatchObject({
      kind: weather.kind,
      windMph: weather.windMph,
      carryMultiplier: modifiers.carryMultiplier,
      dispersionMultiplier: modifiers.dispersionMultiplier,
    });
  });
});

describe("M39 charters, automation, responses, and annual legacy", () => {
  it("settles an annual charter change once and discloses bounded effects", () => {
    const { course, world } = fixture();
    const unconfirmed = previewSeasonCommand(course, world, { type: "SELECT_CHARTER", charter: "championship-venue" });
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.blockers.join(" ")).toContain("Confirm");
    const changed = applySeasonCommand(course, world, { type: "SELECT_CHARTER", charter: "championship-venue", confirmed: true });
    expect(changed.ok).toBe(true);
    expect(changed.world.seasonal?.charter).toBe("championship-venue");
    const second = applySeasonCommand(changed.course, changed.world, { type: "SELECT_CHARTER", charter: "destination-retreat", confirmed: true });
    expect(second.ok).toBe(false);
    expect(CLUB_CHARTERS.every((charter) => {
      const preview = previewSeasonCommand(course, world, { type: "SELECT_CHARTER", charter, confirmed: true });
      return preview.summary.length > 20;
    })).toBe(true);
  });

  it("keeps automatic prices stable, preserves manual overrides, and reacts to weather", () => {
    let { course, world } = fixture("desert", "destination-retreat");
    const originalFee = course.layouts![0].greenFee;
    for (let day = 0; day < 14; day++) {
      world = { ...world, week: Math.floor(day / 7) + 1 };
      const advanced = advanceSeasonalDay(course, world, day % 7);
      course = advanced.course;
      world = advanced.world;
    }
    expect(course.layouts![0].greenFee).toBeLessThan(originalFee * 1.25);
    const manual = applySeasonCommand(course, world, { type: "SET_ADVANCED_OPERATIONS", enabled: true });
    const fee = manual.course.layouts![0].greenFee;
    const next = advanceSeasonalDay(manual.course, { ...manual.world, week: manual.world.week + 1 }, 0);
    expect(next.course.layouts![0].greenFee).toBe(fee);
  });

  it("previews drainage and cascades a course closure through schedules exactly once", () => {
    const { course, world } = fixture();
    const drainage = previewSeasonCommand(course, world, { type: "IMPROVE_DRAINAGE" });
    expect(drainage).toMatchObject({ ok: true, days: 7, riskReduction: .11 });
    const improved = applySeasonCommand(course, world, { type: "IMPROVE_DRAINAGE" });
    expect(improved.world.cash).toBe(world.cash - drainage.cost);
    const closed = applySeasonCommand(improved.course, improved.world, { type: "SET_COURSE_CLOSED", courseId: "course-primary", closed: true, currentDay: 0 });
    expect(closed.ok).toBe(true);
    expect(closed.course.layouts![0].state).toBe("closed");
    expect(closed.world.tournaments?.events[0]).toMatchObject({ scheduledWeek: 4, scheduledDay: 2 });
    expect(closed.world.seasonal?.operations.responses.filter((entry) => entry.action.includes("Closed"))).toHaveLength(1);
  });

  it("closes a year atomically, settles one reward, and keeps immutable history bounded", () => {
    const { course, world: initialWorld } = fixture("parkland", "member-institution");
    let world = initialWorld;
    world = {
      ...world,
      week: 32,
      reputation: 82,
      seasonal: { ...world.seasonal!, lastCommittedAbsoluteDay: absoluteDayFor(32, 5) },
    };
    const before = world.cash;
    const closed = advanceSeasonalDay(course, world, 6);
    expect(closed.world.seasonal?.yearbooks).toHaveLength(1);
    expect(closed.world.seasonal?.yearbooks[0]).toMatchObject({ id: "yearbook-1", year: 1, charter: "member-institution", rewardSettled: true });
    expect(closed.world.seasonal?.pendingYearbookId).toBe("yearbook-1");
    expect(closed.world.cash).toBeGreaterThan(before);
    const duplicate = advanceSeasonalDay(closed.course, closed.world, 6);
    expect(duplicate.world.cash).toBe(closed.world.cash);
    expect(duplicate.world.seasonal?.yearbooks).toEqual(closed.world.seasonal?.yearbooks);
  });

  it("runs ten deterministic years for every biome and charter within save budgets", () => {
    for (const theme of ["parkland", "links", "desert"] as LandTheme[]) {
      for (const charter of CLUB_CHARTERS) {
        const run = () => {
          let { course, world } = fixture(theme, charter);
          for (let absoluteDay = 0; absoluteDay < DAYS_PER_YEAR * 10; absoluteDay++) {
            const date = weekDayFromAbsoluteDay(absoluteDay);
            world = { ...world, week: date.week };
            const next = advanceSeasonalDay(course, world, date.day);
            course = next.course;
            world = next.world;
          }
          return { course, world };
        };
        const first = run();
        const second = run();
        expect(first.world.seasonal).toEqual(second.world.seasonal);
        expect(first.world.seasonal?.yearbooks).toHaveLength(10);
        expect(first.world.seasonal?.timeline.length).toBeLessThanOrEqual(320);
        expect(JSON.stringify(first.world.seasonal).length).toBeLessThan(180_000);
        expect(first.course.condition).toBeGreaterThanOrEqual(0);
        expect(first.world.cash).toBeGreaterThan(0);
      }
    }
  });
});
