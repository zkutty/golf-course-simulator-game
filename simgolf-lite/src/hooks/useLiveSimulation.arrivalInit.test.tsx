import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "../game/models/types";
import { DEFAULT_STATE } from "../game/gameState";
import { useLiveSimulation } from "./useLiveSimulation";

const arrivalProbe = vi.hoisted(() => ({ calls: [] as Array<[unknown, unknown]> }));
vi.mock("../game/live/simulation", async (importOriginal) => ({
  ...await importOriginal<typeof import("../game/live/simulation")>(),
  courseCanReceiveLiveArrivals: (course: unknown, policy: unknown) => {
    arrivalProbe.calls.push([course, policy]);
    return true;
  },
}));

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
  beforeEach(() => { arrivalProbe.calls.length = 0; });

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
