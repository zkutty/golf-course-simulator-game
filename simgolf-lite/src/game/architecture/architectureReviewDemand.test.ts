import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { DEFAULT_STATE } from "../gameState";
import { GameSession } from "../session";
import type { PlatformServices } from "../../platform/types";
import type { Course, World } from "../models/types";
import { normalizeCourseLayouts, courseForLayout } from "../models/courseLayouts";
import { buildArchitectureReview, defaultArchitectureFilters, withGreenStrategyHeatmap } from "./review";
import type { ArchitectureReviewData, ArchitectureReviewFilters } from "./review";
import type { GreenStrategyHeatmap } from "./greenStrategyHeatmap";
import { ArchitectureReviewDemandOwner, type ArchitectureReviewCapture } from "./architectureReviewDemand";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const filters = defaultArchitectureFilters(DEFAULT_STATE.course);
const baseline = () => buildArchitectureReview(DEFAULT_STATE.course, DEFAULT_STATE.world, filters);
const state = () => new GameSession({ initialState: DEFAULT_STATE, platform: {} as PlatformServices });
const slice = (text: string, start: string, end: string) => {
  expect(text.split(start)).toHaveLength(2);
  expect(text.split(end)).toHaveLength(2);
  return text.slice(text.indexOf(start), text.indexOf(end));
};
const projection = slice(app, "      architectureReview: {", "      livingClub: (() => {");
const project = new Function("architectureReview", "showArchitectureReview", `return ({${projection}}).architectureReview;`) as (review: ArchitectureReviewData, open: boolean) => unknown;

interface AppDemand {
  architectureReviewDemand: ArchitectureReviewDemandOwner;
  getArchitectureReviewBase: ArchitectureReviewCapture;
  getArchitectureReview(): ArchitectureReviewData;
  architectureReviewBase: ArchitectureReviewData | null;
  architectureReview: ArchitectureReviewData | null;
  setShowArchitectureReview(value: boolean): void;
  setArchitectureFilters(value: ArchitectureReviewFilters): void;
}
type LoadModule = (path: string) => Promise<unknown>;
type Cleanup = void | (() => void);

// Execute the actual narrow App hooks, replacing only transport of its two
// dynamic imports. GameSession, demand owner and merge function remain real.
function appHarness(builder = buildArchitectureReview, loadModule: LoadModule = () => Promise.reject(new Error("unexpected enrichment")), options: { strictReplay?: boolean; sourceRoot?: string } = {}) {
  const session = state();
  const selectedApp = options.sourceRoot ? readFileSync(`${options.sourceRoot}/App.tsx`, "utf8") : app;
  let Owner = ArchitectureReviewDemandOwner;
  if (options.sourceRoot) {
    const source = readFileSync(`${options.sourceRoot}/architectureReviewDemand.ts`, "utf8");
    const code = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
    expect(code.split("export class ArchitectureReviewDemandOwner")).toHaveLength(2);
    Owner = new Function(code.replace("export class ArchitectureReviewDemandOwner", "class ArchitectureReviewDemandOwner") + "\nreturn ArchitectureReviewDemandOwner;")() as typeof ArchitectureReviewDemandOwner;
  }
  const lifetime = slice(selectedApp, "  const [architectureReviewDemand] = useState", "  const gameState = useGameSessionSelector");
  let wiring = slice(selectedApp, "  const [showArchitectureReview, setShowArchitectureReview]", "  const [showLivingClub, setShowLivingClub]");
  for (const path of ["./game/architecture/greenStrategyHeatmap", "./game/architecture/referencePlan"]) {
    expect(wiring.split(`import("${path}")`)).toHaveLength(2);
    wiring = wiring.replace(`import("${path}")`, `loadModule("${path}")`);
  }
  const compiled = transpileModule(`function wire() {\n${lifetime}${wiring}\nreturn { architectureReviewDemand, getArchitectureReviewBase, getArchitectureReview, architectureReviewBase, architectureReview, setShowArchitectureReview, setArchitectureFilters };\n}`, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
  const names = ["ArchitectureReviewDemandOwner", "buildArchitectureReview", "defaultArchitectureFilters", "withGreenStrategyHeatmap", "normalizeCourseLayouts", "courseForLayout", "gameSession", "course", "world", "flow", "loadModule", "useState", "useMemo", "useCallback", "useEffect"];
  const wire = new Function(...names, compiled + "\nreturn wire();") as (...args: unknown[]) => AppDemand;
  let cursor = 0;
  const states = new Map<number, unknown>();
  const memos = new Map<number, { deps: unknown[]; value: unknown }>();
  const effects = new Map<number, { deps: unknown[]; cleanup: Cleanup; setup: () => Cleanup }>();
  const pending: Array<() => void> = [];
  const changed = (before: unknown[] | undefined, after: unknown[]) => !before || before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]));
  const useState = (initial: unknown) => {
    const index = cursor++;
    if (!states.has(index)) states.set(index, typeof initial === "function" ? initial() : initial);
    return [states.get(index), (next: unknown) => states.set(index, typeof next === "function" ? next(states.get(index)) : next)];
  };
  const useMemo = (build: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    if (changed(memos.get(index)?.deps, deps)) {
      const retained = build();
      // React19.2.3 mountMemo/updateMemo discard the second calculator return.
      if (options.strictReplay) build();
      memos.set(index, { deps, value: retained });
    }
    return memos.get(index)!.value;
  };
  const useCallback = (fn: unknown, deps: unknown[]) => useMemo(() => fn, deps);
  const useEffect = (effect: () => Cleanup, deps: unknown[]) => {
    const index = cursor++;
    if (changed(effects.get(index)?.deps, deps)) {
      pending.push(() => {
        effects.get(index)?.cleanup?.();
        effects.set(index, { deps, cleanup: effect(), setup: effect });
      });
    }
  };
  return {
    session,
    render: (base = "in-game") => {
      cursor = 0;
      const { course, world } = session.getState();
      return wire(Owner, builder, defaultArchitectureFilters, withGreenStrategyHeatmap, normalizeCourseLayouts, courseForLayout, session, course, world, { base }, loadModule, useState, useMemo, useCallback, useEffect);
    },
    flush: () => { while (pending.length) pending.shift()!(); },
    replayPassive: () => {
      // React disconnects all passive effects, then reconnects with retained memo values.
      for (const effect of effects.values()) effect.cleanup?.();
      for (const effect of effects.values()) effect.cleanup = effect.setup();
    },
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); },
  };
}
function actualText(getArchitectureReview: () => ArchitectureReviewData) {
  const prefix = slice(app, "    const renderText = () => {", "      return JSON.stringify({");
  expect(prefix.match(/getArchitectureReview\(\)/g)).toHaveLength(1);
  return new Function("getArchitectureReview", "showArchitectureReview", `${prefix}\nreturn JSON.stringify({${projection}});\n};\nreturn renderText;`)(getArchitectureReview, false) as () => string;
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function sentinel(course: Course, world: World, scope: ArchitectureReviewFilters, original: ArchitectureReviewData) {
  return { ...original, filters: scope, currentGeometryVersion: `${course.name}:${world.week}:${scope.kind}` };
}
function green(kind: ArchitectureReviewFilters["kind"]): GreenStrategyHeatmap {
  return {
    overlay: { kind, traces: [], cells: [], points: [] }, evidenceSource: "captured", forecastGeometryVersion: "geometry",
    maintenanceProgram: "fixture", selectedPins: [], selectedCohorts: [], predictiveSamples: 0, observedCurrent: 0,
    observedHistorical: 0, observedGeometryVersions: [], report: {}, recommendations: [], legend: [], textSummary: "complete",
    reducedMotionSafe: true,
  } as unknown as GreenStrategyHeatmap;
}

describe("architecture review demand owner and actual App integration", () => {
  it("StrictMode retained memo and passive replay keep one current default text build", () => {
    let builds = 0;
    const h = appHarness((...args) => { builds++; return buildArchitectureReview(...args); }, undefined, {
      strictReplay: true,
      // Root runs only this behavioral control against complete frozen source1.
      sourceRoot: process.env.STARTUP_DEMAND_REPLAY_SOURCE_ROOT,
    });
    let view = h.render(); h.flush(); h.replayPassive();
    expect(builds).toBe(0);
    const text = actualText(view.getArchitectureReview);
    expect(text()).toBe(text());
    expect(builds, "retained first getter must cache after memo double invoke and passive replay").toBe(1);
    const oldText = text;
    const oldProjection = text();
    const changedFilters = { ...filters, recency: "historical" as const };
    view.setArchitectureFilters(changedFilters);
    view = h.render(); h.flush(); h.replayPassive();
    expect(builds).toBe(1);
    const current = actualText(view.getArchitectureReview);
    expect(current()).toBe(current());
    expect(builds, "updated memo retains its first current getter too").toBe(2);
    expect(JSON.parse(current()).architectureReview.filters.recency).toBe("historical");
    expect(oldText()).toBe(oldProjection);
    expect(JSON.parse(current()).architectureReview.filters.recency).toBe("historical");
    h.session.replaceState({ ...DEFAULT_STATE, course: { ...DEFAULT_STATE.course, name: "strict replacement" }, world: { ...DEFAULT_STATE.world } });
    expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
    view = h.render(); h.flush(); h.replayPassive();
    expect(view.getArchitectureReview().filters).toBe(changedFilters);
    const beforeTitle = view.getArchitectureReview();
    view = h.render("title"); h.flush(); h.replayPassive();
    expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
    expect(view.getArchitectureReview()).not.toBe(beforeTitle);
    const retained = view.getArchitectureReviewBase;
    h.session.dispose();
    retained.resume(beforeTitle);
    expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
    expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
    expect(() => view.architectureReviewDemand.capture(h.session.getState().course, h.session.getState().world, changedFilters)).toThrow(/session has retired/);
    h.unmount();
  });

  it("StrictMode replay preserves eager green and reference base publication and replacement rejection", async () => {
    for (const kind of ["green-rollout", "reference"] as const) {
      const imports: Array<ReturnType<typeof deferred<unknown>>> = [];
      let builds = 0;
      const h = appHarness((...args) => { builds++; return buildArchitectureReview(...args); }, () => {
        const pending = deferred<unknown>(); imports.push(pending); return pending.promise;
      }, { strictReplay: true });
      let view = h.render(); h.flush();
      view.setArchitectureFilters({ ...filters, kind });
      view = h.render();
      const base = view.architectureReviewBase!;
      expect(builds).toBe(1);
      h.flush(); h.replayPassive();
      expect(imports).toHaveLength(2);
      expect(builds).toBe(1);
      expect(view.architectureReviewDemand.isCurrent(DEFAULT_STATE.course, DEFAULT_STATE.world, view.getArchitectureReviewBase().filters, base)).toBe(true);
      const heatmap = green(kind);
      const module = (capturedBase: ArchitectureReviewData, stale = false) => kind === "reference" ? {
        architectureReferenceReview: () => [],
        withArchitectureReferencePlans: (actualBase: ArchitectureReviewData) => {
          expect(actualBase).toBe(capturedBase);
          return stale ? { ...capturedBase, explanation: "obsolete strict result" } : { ...capturedBase, explanation: "strict current reference" };
        },
      } : {
        buildGreenStrategyHeatmapForReview: (input: { evidence: unknown; currentGeometryVersion: string }) => {
          expect(input.evidence).toBe(capturedBase.evidence);
          expect(input.currentGeometryVersion).toBe(capturedBase.currentGeometryVersion);
          return stale ? { ...heatmap, textSummary: "obsolete strict result" } : heatmap;
        },
      };
      imports[0].resolve(module(base, true)); await tick();
      view = h.render(); h.flush();
      expect(view.getArchitectureReview().explanation).not.toBe("obsolete strict result");
      expect(view.getArchitectureReview().greenStrategy?.textSummary).not.toBe("obsolete strict result");
      imports[1].resolve(module(base)); await tick();
      view = h.render(); h.flush();
      if (kind === "reference") expect(view.getArchitectureReview().explanation).toBe("strict current reference");
      else expect(view.getArchitectureReview().greenStrategy).toBe(heatmap);
      const merged = view.getArchitectureReview();
      expect(view.getArchitectureReview()).toBe(merged);
      h.session.updateWorld(world => ({ ...world, week: world.week + 1 }));
      view = h.render(); const replacementBase = view.architectureReviewBase!;
      h.flush(); h.replayPassive();
      expect(imports).toHaveLength(4);
      h.session.updateCourse(course => ({ ...course, name: "replacement before publication" }));
      expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
      imports[3].resolve(module(replacementBase, true)); imports[2].resolve(module(replacementBase, true)); await tick();
      view = h.render(); const currentBase = view.architectureReviewBase!; h.flush();
      view = h.render(); h.flush();
      expect(view.getArchitectureReview().explanation).not.toBe("obsolete strict result");
      expect(view.getArchitectureReview().greenStrategy?.textSummary).not.toBe("obsolete strict result");
      expect(imports).toHaveLength(5);
      imports[4].resolve(module(currentBase)); await tick();
      view = h.render(); h.flush();
      if (kind === "reference") expect(view.getArchitectureReview().explanation).toBe("strict current reference");
      else expect(view.getArchitectureReview().greenStrategy).toBe(heatmap);
      expect(view.architectureReviewDemand.isCurrent(h.session.getState().course, h.session.getState().world, view.getArchitectureReviewBase().filters, currentBase)).toBe(true);
      h.unmount();
      expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
      expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
    }
  });

  it("closed default render and dependency evaluation build zero times; first complete text equals eager baseline and second reuses", () => {
    let builds = 0;
    const h = appHarness((...args) => { builds++; return buildArchitectureReview(...args); });
    const view = h.render(); h.flush();
    expect(builds).toBe(0);
    expect(view.architectureReviewBase).toBeNull();
    expect(view.architectureReview).toBeNull();
    const text = actualText(view.getArchitectureReview);
    const eager = buildArchitectureReview(DEFAULT_STATE.course, DEFAULT_STATE.world, filters);
    expect(JSON.parse(text())).toEqual({ architectureReview: project(eager, false) });
    expect(JSON.parse(text())).toEqual({ architectureReview: project(eager, false) });
    expect(builds).toBe(1);
    h.unmount();
  });

  it("actual open panel and overlay share the current base/merged result already demanded by text", () => {
    let builds = 0;
    const h = appHarness((...args) => { builds++; return buildArchitectureReview(...args); });
    let view = h.render(); h.flush();
    const first = view.getArchitectureReview();
    view.setShowArchitectureReview(true);
    view = h.render(); h.flush();
    expect(view.architectureReviewBase).toBe(first);
    expect(view.getArchitectureReview()).toBe(view.architectureReview);
    expect(view.getArchitectureReview().overlay).toBe(view.architectureReview!.overlay);
    expect(builds).toBe(1);
    expect(app).toContain("architectureOverlay={showArchitectureReview ? getArchitectureReview().overlay : null}");
    expect(app).toContain("review={getArchitectureReview()}");
    h.unmount();
  });

  it("closed green stays eager before import, passes original evidence identity, merges, and cancels obsolete publication", async () => {
    const calls: string[] = [];
    const imports: Array<ReturnType<typeof deferred<unknown>>> = [];
    let captured: { evidence: unknown; currentGeometryVersion: string } | undefined;
    const h = appHarness((...args) => { calls.push("base"); return buildArchitectureReview(...args); }, path => {
      calls.push(path); const pending = deferred<unknown>(); imports.push(pending); return pending.promise;
    });
    let view = h.render(); h.flush();
    view.setArchitectureFilters({ ...filters, kind: "green-rollout" });
    view = h.render();
    expect(calls).toEqual(["base"]);
    const firstBase = view.architectureReviewBase!;
    h.flush();
    expect(calls).toEqual(["base", "./game/architecture/greenStrategyHeatmap"]);
    const heatmap = green("green-rollout");
    imports[0].resolve({ buildGreenStrategyHeatmapForReview: (input: typeof captured) => { captured = input; return heatmap; } });
    await tick();
    expect(captured!.evidence).toBe(firstBase.evidence);
    expect(captured!.currentGeometryVersion).toBe(firstBase.currentGeometryVersion);
    view = h.render(); h.flush();
    expect(view.getArchitectureReview()).toBe(view.architectureReview);
    expect(view.getArchitectureReview().greenStrategy).toBe(heatmap);
    expect(JSON.parse(actualText(view.getArchitectureReview)()).architectureReview.greenStrategy).toEqual((project(view.architectureReview!, false) as { greenStrategy: unknown }).greenStrategy);
    // Replacement invalidates the previous base even before effect cleanup runs.
    h.session.replaceState({ ...h.session.getState(), world: { ...h.session.getState().world, week: 2 } });
    view = h.render(); h.flush();
    const pending = imports[1];
    h.session.replaceState({ ...h.session.getState(), course: { ...h.session.getState().course, name: "replacement" } });
    pending.resolve({ buildGreenStrategyHeatmapForReview: () => green("green-rollout") });
    await tick();
    view = h.render(); h.flush();
    expect(view.architectureReview!.greenStrategy).toBeNull();
    view.setArchitectureFilters(filters); view = h.render(); h.flush();
    imports[2].resolve({ buildGreenStrategyHeatmapForReview: () => heatmap }); await tick();
    view = h.render(); h.flush();
    expect(view.getArchitectureReview().greenStrategy).toBeNull();
    h.unmount();
  });

  it("closed reference preserves import/start/merge base identity and canceled or replaced results never publish", async () => {
    const calls: string[] = [];
    const imports: Array<ReturnType<typeof deferred<unknown>>> = [];
    const h = appHarness((...args) => { calls.push("base"); return buildArchitectureReview(...args); }, path => {
      calls.push(path); const pending = deferred<unknown>(); imports.push(pending); return pending.promise;
    });
    let view = h.render(); h.flush();
    view.setArchitectureFilters({ ...filters, kind: "reference" }); view = h.render();
    const firstBase = view.architectureReviewBase!;
    expect(calls).toEqual(["base"]); h.flush();
    const enriched = { ...firstBase, explanation: "reference completed" };
    imports[0].resolve({
      architectureReferenceReview: (course: Course, tee: string, pin: string) => { expect(course).toEqual(courseForLayout(DEFAULT_STATE.course, filters.courseId)); expect([tee, pin]).toEqual(["member", "A"]); calls.push("plans"); return []; },
      withArchitectureReferencePlans: (base: ArchitectureReviewData) => { expect(base).toBe(firstBase); calls.push("merge"); return enriched; },
    });
    await tick(); view = h.render(); h.flush();
    expect(calls).toEqual(["base", "./game/architecture/referencePlan", "plans", "merge"]);
    expect(view.getArchitectureReview()).toBe(enriched);
    h.session.replaceState({ ...h.session.getState(), world: { ...h.session.getState().world, week: 3 } });
    view = h.render(); h.flush();
    expect(view.getArchitectureReview()).not.toBe(enriched);
    const secondBase = view.architectureReviewBase!;
    h.session.replaceState({ ...h.session.getState(), course: { ...h.session.getState().course, name: "new reference" } });
    imports[1].resolve({ architectureReferenceReview: () => [], withArchitectureReferencePlans: () => ({ ...secondBase, explanation: "obsolete" }) });
    await tick(); view = h.render(); h.flush();
    expect(view.getArchitectureReview().explanation).not.toBe("obsolete");
    view.setArchitectureFilters(filters); view = h.render(); h.flush();
    imports[2].resolve({ architectureReferenceReview: () => [], withArchitectureReferencePlans: () => enriched });
    await tick(); view = h.render(); h.flush();
    expect(view.getArchitectureReview()).not.toBe(enriched);
    h.unmount();
  });

  it("course world and filter replacement invalidate the current result without a stale text closure mixing tuples", () => {
    const original = baseline();
    const seen: Array<[Course, World, ArchitectureReviewFilters]> = [];
    const h = appHarness((course, world, scope) => { seen.push([course, world, scope]); return sentinel(course, world, scope, original); });
    let view = h.render(); h.flush();
    const oldText = actualText(view.getArchitectureReview);
    const expectedOld = oldText();
    const oldCourse = h.session.getState().course;
    h.session.updateCourse(course => ({ ...course, name: "edited" }));
    expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
    view = h.render(); h.flush(); view.getArchitectureReview();
    expect(seen.at(-1)![0].name).toBe("edited");
    expect(oldText()).toBe(expectedOld);
    h.session.updateWorld(world => ({ ...world, week: 9 }));
    view = h.render(); h.flush(); view.getArchitectureReview();
    expect(seen.at(-1)![1].week).toBe(9);
    const nextFilters = { ...filters, recency: "historical" as const };
    view.setArchitectureFilters(nextFilters); view = h.render(); h.flush();
    expect(view.getArchitectureReview().filters).toBe(nextFilters);
    expect(oldText()).toBe(expectedOld);
    expect(view.getArchitectureReview().filters).toBe(nextFilters);
    // Actual replaceState covers undo/load and new-game replacement separately.
    for (const name of ["undo", "loaded", "new-game"]) {
      h.session.replaceState({ ...DEFAULT_STATE, course: { ...oldCourse, name }, world: { ...DEFAULT_STATE.world } });
      expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
      view = h.render(); h.flush(); expect(view.getArchitectureReview().currentGeometryVersion).toContain(name);
    }
    const beforeTitle = view.getArchitectureReview();
    view = h.render("title"); h.flush();
    expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
    expect(view.getArchitectureReview()).not.toBe(beforeTitle);
    h.unmount();
  });

  it("actual session teardown and effect cleanup release owned tuple/result and permit a fresh mounted demand", () => {
    const h = appHarness(); let view = h.render(); h.flush(); view.getArchitectureReview();
    h.session.dispose();
    expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
    expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
    h.unmount();
    const next = appHarness(); view = next.render(); next.flush(); view.getArchitectureReview();
    next.unmount();
    expect(Reflect.get(view.architectureReviewDemand, "current")).toBeUndefined();
    expect(Reflect.get(view.architectureReviewDemand, "result")).toBeUndefined();
  });

  it("falsy throws survive unchanged, failed builders never cache, and next valid demand retries", () => {
    const original = baseline();
    for (const primary of [false, null, 0, "", undefined]) {
      let attempts = 0;
      const owner = new ArchitectureReviewDemandOwner(() => { if (++attempts === 1) throw primary; return original; });
      const get = owner.capture(DEFAULT_STATE.course, DEFAULT_STATE.world, filters);
      let failed = false, caught: unknown;
      try { get(); } catch (error) { failed = true; caught = error; }
      expect(failed).toBe(true); expect(caught).toBe(primary);
      expect(Reflect.get(owner, "result")).toBeUndefined();
      expect(get()).toBe(original); expect(get()).toBe(original); expect(attempts).toBe(2);
    }
  });

  it("caught same-tuple reentry cannot publish a partial outer result and later demand can retry", () => {
    const original = baseline(); let reenter = true;
    const owner = new ArchitectureReviewDemandOwner(() => {
      if (reenter) { try { get(); } catch { /* A builder swallowing inner failure still cannot publish. */ } }
      return original;
    });
    const get: () => ArchitectureReviewData = owner.capture(DEFAULT_STATE.course, DEFAULT_STATE.world, filters);
    expect(get).toThrow(/cannot reenter/);
    expect(Reflect.get(owner, "result")).toBeUndefined();
    reenter = false; expect(get()).toBe(original);
  });

  it("tuple change or retirement during a successful build cannot install its stale result", () => {
    const original = baseline(); const nextCourse = { ...DEFAULT_STATE.course, name: "next" };
    let nextGet!: () => ArchitectureReviewData;
    let change = true;
    const owner: ArchitectureReviewDemandOwner = new ArchitectureReviewDemandOwner((course, world, scope) => {
      if (change) { change = false; nextGet = owner.capture(nextCourse, world, scope); }
      return sentinel(course, world, scope, original);
    });
    const oldGet = owner.capture(DEFAULT_STATE.course, DEFAULT_STATE.world, filters);
    expect(oldGet().currentGeometryVersion).not.toContain("next:");
    expect(Reflect.get(owner, "result")).toBeUndefined();
    expect(nextGet().currentGeometryVersion).toContain("next:");
    expect(oldGet().currentGeometryVersion).not.toContain("next:");
    expect(nextGet().currentGeometryVersion).toContain("next:");
    owner.clear();
    expect(Reflect.get(owner, "current")).toBeUndefined();
    const retiring: ArchitectureReviewDemandOwner = new ArchitectureReviewDemandOwner(() => { retiring.clear(); return original; });
    expect(retiring.capture(DEFAULT_STATE.course, DEFAULT_STATE.world, filters)()).toBe(original);
    expect(Reflect.get(retiring, "current")).toBeUndefined();
    expect(Reflect.get(retiring, "result")).toBeUndefined();
  });

  it("complete App projection/order/dependencies and inverse retain every field and unrelated byte", () => {
    expect(hash(projection)).toBe("91026ca0855959b308e65dd1f5ef1f77d1c3544d7bcce517141228a40852e426");
    for (const field of ["greenStrategy:", "returnToDesign:", "revisions:", "currentEvidence:", "historicalEvidence:", "strategic:", "selectedTraceId:", "overlay:"]) expect(projection).toContain(field);
    const textEffect = slice(app, "    const textReportTransaction = courseTextReportOwner.prepareRatingPart", "    type Zk470ActionClass");
    expect(textEffect.indexOf("finishCarePart()")).toBeLessThan(textEffect.indexOf("const renderText"));
    expect(textEffect.indexOf("const architectureReview = getArchitectureReview()")).toBeGreaterThan(textEffect.indexOf("const renderText"));
    expect(textEffect).toContain("architectureReport, getArchitectureReview, appProfile");
    expect(app).toContain("architectureReviewBase?.currentGeometryVersion, architectureReviewBase?.evidence");
    expect(app).not.toContain("architectureReviewBase.currentGeometryVersion, architectureReviewBase.evidence, course]");
    let inverse = app;
    for (const [before, after] of [...appInverseEdits].reverse()) {
      expect(inverse.split(after)).toHaveLength(2);
      inverse = inverse.replace(after, before);
    }
    expect(hash(inverse)).toBe("6ba5256282315022e45e1fba5f3b1377c27e95f152fbb3ea0c3414bb5ddc88b0");
  });
});

// Exact registered demand wiring only; reconstructs the entire frozen eebb App.
const appInverseEdits: readonly (readonly [string, string])[] = [
  [
    "import { buildArchitectureReview, defaultArchitectureFilters, withGreenStrategyHeatmap, type ArchitectureReviewData } from \"./game/architecture/review\";",
    "import { buildArchitectureReview, defaultArchitectureFilters, withGreenStrategyHeatmap, type ArchitectureReviewData } from \"./game/architecture/review\";\nimport { ArchitectureReviewDemandOwner } from \"./game/architecture/architectureReviewDemand\";"
  ],
  [
    "  const gameState = useGameSessionSelector(gameSession, (state) => state);",
    "  const [architectureReviewDemand] = useState(() => new ArchitectureReviewDemandOwner(buildArchitectureReview));\n  const gameState = useGameSessionSelector(gameSession, (state) => state);"
  ],
  [
    "  const architectureReviewBase = useMemo(\n    () => buildArchitectureReview(course, world, architectureFilters),\n    [architectureFilters, course, world],\n  );",
    "  const getArchitectureReviewBase = useMemo(\n    () => architectureReviewDemand.capture(course, world, architectureFilters, flow.base),\n    [architectureReviewDemand, architectureFilters, course, flow.base, world],\n  );\n  const architectureReviewBase = useMemo(\n    () => showArchitectureReview || architectureFilters.kind.startsWith(\"green-\") || architectureFilters.kind === \"reference\"\n      ? getArchitectureReviewBase() : null,\n    [architectureFilters.kind, getArchitectureReviewBase, showArchitectureReview],\n  );"
  ],
  [
    "  const architectureReview = useMemo(\n    () => withGreenStrategyHeatmap(architectureReferenceReview?.base === architectureReviewBase ? architectureReferenceReview.review : architectureReviewBase, architectureGreenStrategy),\n    [architectureGreenStrategy, architectureReferenceReview, architectureReviewBase],\n  );",
    "  const architectureReview = useMemo(\n    () => architectureReviewBase\n      ? withGreenStrategyHeatmap(architectureReferenceReview?.base === architectureReviewBase ? architectureReferenceReview.review : architectureReviewBase, architectureGreenStrategy)\n      : null,\n    [architectureGreenStrategy, architectureReferenceReview, architectureReviewBase],\n  );\n  const getArchitectureReview = useCallback(() => {\n    if (architectureReview) return architectureReview;\n    const base = getArchitectureReviewBase();\n    return withGreenStrategyHeatmap(architectureReferenceReview?.base === base ? architectureReferenceReview.review : base, architectureGreenStrategy);\n  }, [architectureGreenStrategy, architectureReferenceReview, architectureReview, getArchitectureReviewBase]);\n  useEffect(() => {\n    const unregister = gameSession.registerTeardown(architectureReviewDemand.retire);\n    const unsubscribe = gameSession.subscribe(() => {\n      const current = gameSession.getState();\n      architectureReviewDemand.invalidateState(current.course, current.world);\n    });\n    const current = gameSession.getState();\n    if (current.course === course && current.world === world) getArchitectureReviewBase.resume(architectureReviewBase ?? undefined);\n    return () => {\n      unsubscribe();\n      unregister();\n      architectureReviewDemand.clear();\n    };\n  }, [architectureReviewBase, architectureReviewDemand, course, gameSession, getArchitectureReviewBase, world]);"
  ],
  [
    "    if (!architectureFilters.kind.startsWith(\"green-\")) {",
    "    if (!architectureFilters.kind.startsWith(\"green-\") || !architectureReviewBase) {"
  ],
  [
    "      if (!canceled) setArchitectureGreenStrategy(result);",
    "      if (!canceled && architectureReviewDemand.isCurrent(course, world, architectureFilters, architectureReviewBase)) setArchitectureGreenStrategy(result);"
  ],
  [
    "  }, [architectureFilters, architectureReviewBase.currentGeometryVersion, architectureReviewBase.evidence, course]);",
    "  }, [architectureFilters, architectureReviewBase, architectureReviewBase?.currentGeometryVersion, architectureReviewBase?.evidence, architectureReviewDemand, course, world]);"
  ],
  [
    "    if (architectureFilters.kind !== \"reference\") {",
    "    if (architectureFilters.kind !== \"reference\" || !architectureReviewBase) {"
  ],
  [
    "      if (!canceled) setArchitectureReferenceReview({ base: architectureReviewBase, review });",
    "      if (!canceled && architectureReviewDemand.isCurrent(course, world, architectureFilters, architectureReviewBase)) setArchitectureReferenceReview({ base: architectureReviewBase, review });"
  ],
  [
    "  }, [architectureFilters, architectureReviewBase, course]);",
    "  }, [architectureFilters, architectureReviewBase, architectureReviewDemand, course, world]);"
  ],
  [
    "    const renderText = () => JSON.stringify({",
    "    const renderText = () => {\n      const architectureReview = getArchitectureReview();\n      return JSON.stringify({"
  ],
  [
    "    });\n    window.render_game_to_text = renderText;",
    "    });\n    };\n    window.render_game_to_text = renderText;"
  ],
  [
    "activeTutorial, architectureReport, architectureReview, appProfile.accessibility.colorVision",
    "activeTutorial, architectureReport, getArchitectureReview, appProfile.accessibility.colorVision"
  ],
  [
    "architectureOverlay={showArchitectureReview ? architectureReview.overlay : null}",
    "architectureOverlay={showArchitectureReview ? getArchitectureReview().overlay : null}"
  ],
  [
    "              review={architectureReview}",
    "              review={getArchitectureReview()}"
  ]
];
