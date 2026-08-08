import { describe, expect, it, vi } from "vitest";
import {
  RenderRevisionTracker,
  type RenderRevisionDependencies,
  type RenderSnapshot,
} from "./RenderSnapshot";
import {
  SceneSystemHost,
  type RenderSceneSystem,
} from "./SceneSystemHost";

function dependencies(
  seasonalTerrain: readonly unknown[],
  surfaceCare: readonly unknown[],
  structuresProps: readonly unknown[] = [],
  overlaysDiagnostics: readonly unknown[] = [],
  estateSurvey: readonly unknown[] = [],
): RenderRevisionDependencies {
  return { seasonalTerrain, surfaceCare, structuresProps, overlaysDiagnostics, estateSurvey };
}

function snapshot(
  seasonalTerrain: number,
  surfaceCare: number,
): RenderSnapshot {
  return {
    revisions: { seasonalTerrain, surfaceCare, structuresProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 },
  } as RenderSnapshot;
}

describe("RenderRevisionTracker", () => {
  it("advances only the scene whose explicit inputs changed", () => {
    const tracker = new RenderRevisionTracker();
    const course = {};
    const season = {};

    const first = tracker.update(dependencies([course, season], [course, "high"]));
    expect(first).toEqual({ seasonalTerrain: 1, surfaceCare: 1, structuresProps: 1, overlaysDiagnostics: 1, estateSurvey: 1 });

    const unchanged = tracker.update(dependencies([course, season], [course, "high"]));
    expect(unchanged).toBe(first);

    const winter = {};
    const seasonalChange = tracker.update(dependencies([course, winter], [course, "high"]));
    expect(seasonalChange).toEqual({ seasonalTerrain: 2, surfaceCare: 1, structuresProps: 1, overlaysDiagnostics: 1, estateSurvey: 1 });

    const careChange = tracker.update(dependencies([course, winter], [course, "medium"]));
    expect(careChange).toEqual({ seasonalTerrain: 2, surfaceCare: 2, structuresProps: 1, overlaysDiagnostics: 1, estateSurvey: 1 });
  });

  it("copies dependency lists so caller mutation is observed", () => {
    const tracker = new RenderRevisionTracker();
    const seasonalInputs: unknown[] = ["spring"];
    tracker.update(dependencies(seasonalInputs, []));

    seasonalInputs[0] = "winter";

    expect(tracker.update(dependencies(seasonalInputs, [])).seasonalTerrain).toBe(2);
  });
});

describe("SceneSystemHost", () => {
  it("syncs systems independently and supports targeted invalidation", () => {
    const seasonalRender = vi.fn();
    const careRender = vi.fn();
    const host = new SceneSystemHost([
      { id: "seasonalTerrain", render: seasonalRender },
      { id: "surfaceCare", render: careRender },
    ]);

    expect(host.sync(snapshot(1, 1))).toEqual(["seasonalTerrain", "surfaceCare"]);
    expect(host.sync(snapshot(1, 1))).toEqual([]);
    expect(seasonalRender).toHaveBeenCalledTimes(1);
    expect(careRender).toHaveBeenCalledTimes(1);

    expect(host.sync(snapshot(2, 1))).toEqual(["seasonalTerrain"]);
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
      { id: "seasonalTerrain", render },
    ]);

    expect(() => host.sync(snapshot(1, 1))).toThrow("renderer unavailable");
    expect(() => host.sync(snapshot(1, 1))).not.toThrow();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate system ownership", () => {
    const systems: RenderSceneSystem[] = [
      { id: "surfaceCare", render: vi.fn() },
      { id: "surfaceCare", render: vi.fn() },
    ];

    expect(() => new SceneSystemHost(systems)).toThrow("Duplicate render scene system");
  });
});
