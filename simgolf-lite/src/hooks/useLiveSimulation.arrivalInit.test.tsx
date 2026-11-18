import { createElement, useState, type EffectCallback, type DependencyList } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "../game/gameState";
import type { Course, Terrain } from "../game/models/types";
import { useLiveSimulation } from "./useLiveSimulation";

const probe = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  eligibility: [] as Array<{ course: Course; preview: boolean | undefined; result: boolean }>,
  openingHolds: [] as Array<{ eligible: boolean; held: boolean }>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (setup: EffectCallback, inputs?: DependencyList) => {
      probe.effects.push(setup);
      actual.useEffect(setup, inputs);
    },
  };
});

vi.mock("../game/live/simulation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/live/simulation")>();
  return {
    ...actual,
    courseCanReceiveLiveArrivals: (...args: Parameters<typeof actual.courseCanReceiveLiveArrivals>) => {
      const result = actual.courseCanReceiveLiveArrivals(...args);
      probe.eligibility.push({ course: args[0], preview: args[1]?.tutorialThreeHolePreview, result });
      return result;
    },
    shouldHoldUnopenedLiveDay: (...args: Parameters<typeof actual.shouldHoldUnopenedLiveDay>) => {
      const held = actual.shouldHoldUnopenedLiveDay(...args);
      probe.openingHolds.push({ eligible: args[1], held });
      return held;
    },
  };
});

function threeHolePreview(): Course {
  const width = 60;
  const height = 24;
  const tiles = Array<Terrain>(width * height).fill("fairway");
  const tee = { x: 4, y: 12 };
  const green = { x: 50, y: 12 };
  tiles[tee.y * width + tee.x] = "tee";
  tiles[green.y * width + green.x] = "green";
  const holes = Array.from({ length: 3 }, (_, index) => ({
    id: `hole-${index + 1}`, tee, green, parMode: "AUTO" as const, name: `Hole ${index + 1}`,
  }));
  const holeIds = holes.map(({ id }) => id);
  return {
    width, height, tiles, elevations: Array<number>(tiles.length).fill(0),
    holes, buildings: [], obstacles: [], yardsPerTile: 10, baseGreenFee: 65,
    condition: 0.8, name: "Preview", activeCourseId: "preview",
    layouts: [{
      id: "preview", name: "Preview", draftHoleIds: holeIds, publishedHoleIds: holeIds,
      roundLength: 9, state: "open", greenFee: 65,
    }],
  };
}

type Input = { course: Course; publicThreeHoleOperation: boolean };
type Render = { live: ReturnType<typeof useLiveSimulation>; effects: EffectCallback[] };

function renderInputs(inputs: readonly Input[]) {
  const renders: Render[] = [];
  function Probe() {
    const [index, setIndex] = useState(0);
    const effectStart = probe.effects.length;
    const live = useLiveSimulation({
      enabled: true, ...inputs[index], world: DEFAULT_STATE.world,
      setWorld: () => undefined, setCourse: () => undefined,
    });
    renders.push({ live, effects: probe.effects.splice(effectStart) });
    if (index + 1 < inputs.length) setIndex(index + 1);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return renders;
}

it("retains initial eligibility across rerenders and updates it from the current course and policy effects", () => {
  const first: Input = { course: threeHolePreview(), publicThreeHoleOperation: false };
  const updatedTiles = first.course.tiles.slice();
  updatedTiles[0] = "rough";
  const latest: Input = { course: { ...first.course, tiles: updatedTiles }, publicThreeHoleOperation: true };
  const renders = renderInputs([first, first, latest]);

  expect(renders).toHaveLength(3);
  expect(probe.eligibility).toHaveLength(1);
  expect(probe.eligibility[0].course).toBe(first.course);
  expect(probe.eligibility[0]).toMatchObject({ preview: false, result: false });

  const { live, effects } = renders[2];
  live.advanceTime(1);
  expect(probe.openingHolds).toEqual([{ eligible: false, held: true }]);

  // Run the real ref-sync and course/reconciliation effects from the final
  // render. The separate rAF effect stays outside this server-rendered test.
  const [syncInputs, updateEligibility] = effects;
  syncInputs();
  updateEligibility();
  live.advanceTime(1);
  expect(probe.openingHolds[1]).toEqual({ eligible: true, held: false });
  expect(probe.eligibility).toHaveLength(2);
  expect(probe.eligibility[1].course).toBe(latest.course);
  expect(probe.eligibility[1]).toMatchObject({ preview: true, result: true });

  const [remounted] = renderInputs([latest, first]);
  remounted.live.advanceTime(1);
  expect(probe.eligibility).toHaveLength(3);
  expect(probe.eligibility[2].course).toBe(latest.course);
  expect(probe.eligibility[2]).toMatchObject({ preview: true, result: true });
  expect(probe.openingHolds[2]).toEqual({ eligible: true, held: false });
});
