import { describe, expect, it, vi } from "vitest";
import {
  RenderRevisionTracker,
  type RenderRevisionDependencies,
  type RenderSnapshot,
} from "./RenderSnapshot";
import { RenderRevisionTracker as CanonicalRenderRevisionTracker } from "../../game/render/renderSnapshot";
import {
  SceneSystemHost,
  type RenderSceneSystem,
} from "./SceneSystemHost";

function dependencies(
  atmosphere: readonly unknown[],
  surfaceCare: readonly unknown[],
  structuresProps: readonly unknown[] = [],
  naturalProps: readonly unknown[] = [],
  overlaysDiagnostics: readonly unknown[] = [],
  estateSurvey: readonly unknown[] = [],
): RenderRevisionDependencies {
  return { atmosphere, surfaceCare, structuresProps, naturalProps, overlaysDiagnostics, estateSurvey };
}

function snapshot(
  atmosphere: number,
  surfaceCare: number,
): RenderSnapshot {
  return {
    revisions: { atmosphere, surfaceCare, structuresProps: 0, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 },
  } as RenderSnapshot;
}

describe("RenderRevisionTracker", () => {
  it("advances only the scene whose explicit inputs changed", () => {
    const tracker = new RenderRevisionTracker();
    const course = {};
    const season = {};

    const first = tracker.update(dependencies([course, season], [course, "high"]));
    expect(first).toEqual({ atmosphere: 1, surfaceCare: 1, structuresProps: 1, naturalProps: 1, overlaysDiagnostics: 1, estateSurvey: 1 });

    const unchanged = tracker.update(dependencies([course, season], [course, "high"]));
    expect(unchanged).toBe(first);

    const winter = {};
    const seasonalChange = tracker.update(dependencies([course, winter], [course, "high"]));
    expect(seasonalChange).toEqual({ atmosphere: 2, surfaceCare: 1, structuresProps: 1, naturalProps: 1, overlaysDiagnostics: 1, estateSurvey: 1 });

    const careChange = tracker.update(dependencies([course, winter], [course, "medium"]));
    expect(careChange).toEqual({ atmosphere: 2, surfaceCare: 2, structuresProps: 1, naturalProps: 1, overlaysDiagnostics: 1, estateSurvey: 1 });
  });

  it("invalidates natural props only for their declared scene inputs", () => {
    const tracker = new RenderRevisionTracker();
    const obstacles = [{ x: 2, y: 3, type: "tree" }];
    const base = tracker.update(dependencies([], [], [], [obstacles, "spring", 1]));

    const unrelatedUi = tracker.update(dependencies(
      ["cash-change"],
      ["mobile-entities-change"],
      ["building-scene-unchanged-for-props"],
      [obstacles, "spring", 1],
      ["panel-open"],
      ["survey-selection"],
    ));
    expect(unrelatedUi.naturalProps).toBe(base.naturalProps);

    const nextSeason = tracker.update(dependencies(
      ["cash-change"],
      ["mobile-entities-change"],
      ["building-scene-unchanged-for-props"],
      [obstacles, "winter", 1],
      ["panel-open"],
      ["survey-selection"],
    ));
    expect(nextSeason.naturalProps).toBe(base.naturalProps + 1);
  });

  it("copies dependency lists so caller mutation is observed", () => {
    const tracker = new RenderRevisionTracker();
    const seasonalInputs: unknown[] = ["spring"];
    tracker.update(dependencies(seasonalInputs, []));

    seasonalInputs[0] = "winter";

    expect(tracker.update(dependencies(seasonalInputs, [])).atmosphere).toBe(2);
  });

  it("keeps the prior UI import path on the canonical tracker authority", () => {
    expect(RenderRevisionTracker).toBe(CanonicalRenderRevisionTracker);
  });
});

describe("SceneSystemHost", () => {
  it("syncs systems independently and supports targeted invalidation", () => {
    const seasonalRender = vi.fn();
    const careRender = vi.fn();
    const host = new SceneSystemHost([
      { id: "atmosphere", render: seasonalRender },
      { id: "surfaceCare", render: careRender },
    ]);

    expect(host.sync(snapshot(1, 1))).toEqual(["atmosphere", "surfaceCare"]);
    expect(host.sync(snapshot(1, 1))).toEqual([]);
    expect(seasonalRender).toHaveBeenCalledTimes(1);
    expect(careRender).toHaveBeenCalledTimes(1);

    expect(host.sync(snapshot(2, 1))).toEqual(["atmosphere"]);
    expect(seasonalRender).toHaveBeenCalledTimes(2);
    expect(careRender).toHaveBeenCalledTimes(1);

    host.invalidate("surfaceCare");
    expect(host.sync(snapshot(2, 1))).toEqual(["surfaceCare"]);
    expect(seasonalRender).toHaveBeenCalledTimes(2);
    expect(careRender).toHaveBeenCalledTimes(2);
  });

  it("does not consume a revision when a scene render fails", () => {
    const render = vi.fn()
      .mockImplementationOnce(() => { throw new Error("renderer unavailable"); })
      .mockImplementationOnce(() => undefined);
    const host = new SceneSystemHost([
      { id: "atmosphere", render },
    ]);

    expect(() => host.sync(snapshot(1, 1))).toThrow("renderer unavailable");
    expect(() => host.sync(snapshot(1, 1))).not.toThrow();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("owns explicit create, update, and destroy exactly once", () => {
    const create = vi.fn();
    const update = vi.fn();
    const destroy = vi.fn();
    const host = new SceneSystemHost([{ id: "atmosphere", create, update, destroy }]);

    expect(host.sync(snapshot(1, 0))).toEqual(["atmosphere"]);
    expect(host.sync(snapshot(1, 1))).toEqual([]);
    expect(host.sync(snapshot(2, 1))).toEqual(["atmosphere"]);
    host.invalidate("atmosphere");
    expect(host.sync(snapshot(2, 1))).toEqual(["atmosphere"]);
    host.dispose();
    host.dispose();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate system ownership", () => {
    const systems: RenderSceneSystem[] = [
      { id: "surfaceCare", render: vi.fn() },
      { id: "surfaceCare", render: vi.fn() },
    ];

    expect(() => new SceneSystemHost(systems)).toThrow("Duplicate render scene system");
  });
});
