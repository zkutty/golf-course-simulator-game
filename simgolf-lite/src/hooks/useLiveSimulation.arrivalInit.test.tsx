import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, World } from "../game/models/types";
import { DEFAULT_STATE } from "../game/gameState";
import { useLiveSimulation } from "./useLiveSimulation";

const mobilityProbe = vi.hoisted(() => ({ calls: [] as Array<{ course: Course; world: World; week: number; dayIndex: number }> }));
const arrivalProbe = vi.hoisted(() => ({ calls: [] as Array<[unknown, unknown]> }));
vi.mock("../game/live/simulation", async (importOriginal) => ({
  ...await importOriginal<typeof import("../game/live/simulation")>(),
  courseCanReceiveLiveArrivals: (course: unknown, policy: unknown) => {
    arrivalProbe.calls.push([course, policy]);
    return true;
  },
}));

vi.mock("../game/m51/operationsReport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/m51/operationsReport")>();
  return {
    ...actual,
    buildMobilityOperationsReports: (args: Parameters<typeof actual.buildMobilityOperationsReports>[0]) => {
      mobilityProbe.calls.push(args);
      return actual.buildMobilityOperationsReports(args);
    },
  };
});

function Probe({ first, second }: { first: Course; second: Course }) {
  const [render, setRender] = useState(0);
  const live = useLiveSimulation({
    enabled: false,
    course: render === 0 ? first : second,
    world: DEFAULT_STATE.world,
    setWorld: () => undefined,
    setCourse: () => undefined,
  });
  if (render < 2) setRender(render + 1);
  return createElement("span", null, live.status.clockLabel);
}

describe("live arrival availability initialization", () => {
  beforeEach(() => { arrivalProbe.calls.length = 0; mobilityProbe.calls.length = 0; });

  it("scores once per mount despite render-phase rerenders and changed course props", () => {
    const first = DEFAULT_STATE.course;
    const second = { ...first, condition: first.condition - 1 };
    expect(renderToStaticMarkup(createElement(Probe, { first, second }))).toContain("<span>");
    expect(arrivalProbe.calls).toHaveLength(1);
    expect(arrivalProbe.calls[0][0]).toBe(first);
    expect(arrivalProbe.calls[0][1]).toEqual({ tutorialThreeHolePreview: false });
    renderToStaticMarkup(createElement(Probe, { first: second, second: first }));
    expect(arrivalProbe.calls).toHaveLength(2);
    expect(arrivalProbe.calls[1][0]).toBe(second);
    expect(arrivalProbe.calls[1][1]).toEqual({ tutorialThreeHolePreview: false });
  });
});


type InitialInput = { course: Course; world: World };
type InitialStatus = ReturnType<typeof useLiveSimulation>["status"];
function StatusProbe({ first, second, statuses }: { first: InitialInput; second: InitialInput; statuses: InitialStatus[] }) {
  const [render, setRender] = useState(0);
  const input = render === 0 ? first : second;
  const live = useLiveSimulation({ enabled: false, ...input, setWorld: () => undefined, setCourse: () => undefined });
  statuses.push(live.status);
  if (render < 2) setRender(render + 1);
  return createElement("span", null, live.status.clockLabel);
}

describe("live status initialization", () => {
  beforeEach(() => { mobilityProbe.calls.length = 0; });
  it("preserves initial report content, skips ignored reports across rerenders, and rebuilds on remount", async () => {
    const { buildMobilityOperationsReports } = await vi.importActual<typeof import("../game/m51/operationsReport")>("../game/m51/operationsReport");
    const first: InitialInput = { course: { ...DEFAULT_STATE.course, buildings: [], m51: undefined }, world: DEFAULT_STATE.world };
    const second: InitialInput = {
      course: {
        ...first.course,
        buildings: [{ id: "status-rental", type: "cart_rental", x: 2, y: 2, tier: 2 }],
        m51: { version: 3, cartRentals: {}, fleet: {
          cart: { id: "cart", courseId: "course-primary", buildingId: "status-rental", productId: "status-rental:riding_cart", mode: "riding_cart", seats: 2, state: "available", condition: 1, uses: 0, wear: 0 },
        }, settledAssignmentIds: [] },
      },
      world: { ...first.world, week: first.world.week + 1 },
    };
    const mobilityFor = (input: InitialInput) => buildMobilityOperationsReports({ ...input, week: input.world.week, dayIndex: 0 });
    const firstMobility = mobilityFor(first), secondMobility = mobilityFor(second);
    expect(firstMobility.current.fleet.owned).toBe(0);
    expect(secondMobility.current.fleet.owned).toBe(1);
    const statuses: InitialStatus[] = [];
    expect(renderToStaticMarkup(createElement(StatusProbe, { first, second, statuses }))).toContain("<span>");
    expect(statuses).toHaveLength(3);
    expect(statuses[1]).toBe(statuses[0]);
    expect(statuses[2]).toBe(statuses[0]);
    expect(statuses[0]).toMatchObject({ speed: "paused", clockLabel: "6:00 AM" });
    expect(statuses[0].mobility).toEqual(firstMobility);
    expect(mobilityProbe.calls).toHaveLength(1);
    expect(mobilityProbe.calls[0]).toEqual({ ...first, week: first.world.week, dayIndex: 0 });
    expect(mobilityProbe.calls[0].course).toBe(first.course);
    expect(mobilityProbe.calls[0].world).toBe(first.world);
    const remounted: InitialStatus[] = [];
    renderToStaticMarkup(createElement(StatusProbe, { first: second, second: first, statuses: remounted }));
    expect(remounted).toHaveLength(3);
    expect(remounted[1]).toBe(remounted[0]);
    expect(remounted[2]).toBe(remounted[0]);
    expect(remounted[0]).toEqual({ ...statuses[0], mobility: secondMobility });
    expect(mobilityProbe.calls).toHaveLength(2);
    expect(mobilityProbe.calls[1].course).toBe(second.course);
    expect(mobilityProbe.calls[1].world).toBe(second.world);
    expect(mobilityProbe.calls[1].week).toBe(second.world.week);
  });
});
