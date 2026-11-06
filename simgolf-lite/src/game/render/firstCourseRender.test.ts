import { Application, Container, SystemRunner } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { observeFirstCourseRender } from "./firstCourseRender";

function fixture() {
  const app = new Application(); app.stage.enableRenderGroup();
  const prerender = new SystemRunner("prerender"), postrender = new SystemRunner("postrender");
  const target = {}, renderer = { view: { renderTarget: target }, runners: { prerender, postrender } };
  Reflect.set(app, "renderer", renderer);
  let current: object = {};
  const presented = vi.fn();
  const observer = observeFirstCourseRender(app, () => current, presented);
  const options = () => ({ container: app.stage, target });
  const root = () => { prerender.emit(options()); postrender.emit(); };
  const populate = () => app.stage.renderGroup!.instructionSet.add({ renderPipeId: "batch" } as never);
  return { app, renderer, prerender, postrender, observer, presented, root, options, populate,
    prepare: () => observer.prepare(current), replace: () => { current = {}; } };
}

describe("first current populated course root", () => {
  it("waits for scene preparation and root completion, then completes only once", async () => {
    const f = fixture(); f.populate(); f.root(); expect(f.presented).not.toHaveBeenCalled();
    f.prepare(); f.prerender.emit(f.options()); expect(f.presented).not.toHaveBeenCalled();
    f.postrender.emit(); expect(f.presented).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(f.prerender.items).toEqual([]); expect(f.postrender.items).toEqual([]);
    f.prepare(); f.root(); expect(f.presented).toHaveBeenCalledOnce();
  });

  it("does not confuse initialized but empty layers with a populated render", async () => {
    const f = fixture(); f.app.stage.addChild(new Container()); f.prepare(); f.root();
    expect(f.presented).not.toHaveBeenCalled();
    f.populate(); f.root(); await Promise.resolve(); expect(f.presented).toHaveBeenCalledOnce();
  });

  it("ignores offscreen and other-container renders", async () => {
    const f = fixture(); f.populate(); f.prepare();
    f.prerender.emit({ container: f.app.stage, target: {} }); f.postrender.emit();
    f.prerender.emit({ container: new Container(), target: f.renderer.view.renderTarget }); f.postrender.emit();
    expect(f.presented).not.toHaveBeenCalled();
    f.root(); await Promise.resolve(); expect(f.presented).toHaveBeenCalledOnce();
  });

  it("does not complete an enclosing root containing a nested offscreen render", async () => {
    const f = fixture(); f.populate(); f.prepare(); f.prerender.emit(f.options());
    f.prerender.emit({ container: new Container(), target: {} }); f.postrender.emit(); f.postrender.emit();
    expect(f.presented).not.toHaveBeenCalled();
    f.root(); await Promise.resolve(); expect(f.presented).toHaveBeenCalledOnce();
  });

  it("rejects a stale snapshot before or during a root", async () => {
    const f = fixture(); f.populate(); f.prepare(); f.replace(); f.root();
    expect(f.presented).not.toHaveBeenCalled();
    f.prepare(); f.prerender.emit(f.options()); f.replace(); f.postrender.emit();
    expect(f.presented).not.toHaveBeenCalled();
    f.prepare(); f.root(); await Promise.resolve(); expect(f.presented).toHaveBeenCalledOnce();
  });

  it("an invalidated/failed scene preparation cannot reuse the previous success", () => {
    const f = fixture(); f.populate(); f.prepare(); f.prerender.emit(f.options());
    f.observer.prepare(null); f.postrender.emit(); f.root();
    expect(f.presented).not.toHaveBeenCalled(); f.observer.dispose();
  });

  it("an open failed render never counts as a completed root", () => {
    const f = fixture(); f.populate(); f.prepare(); f.prerender.emit(f.options());
    f.root(); expect(f.presented).not.toHaveBeenCalled();
    f.observer.dispose(); expect(f.prerender.items).toEqual([]); expect(f.postrender.items).toEqual([]);
  });

  it("repeated failed renders without postrender never complete and still dispose", () => {
    const f = fixture(); f.populate(); f.prepare();
    for (let i = 0; i < 1000; i += 1) f.prerender.emit(f.options());
    f.root(); expect(f.presented).not.toHaveBeenCalled();
    f.observer.dispose();
    expect(f.prerender.items).toEqual([]); expect(f.postrender.items).toEqual([]);
  });

  it("cancellation and StrictMode replacement cannot publish from the old app", async () => {
    const old = fixture(); old.populate(); old.prepare(); old.prerender.emit(old.options()); old.observer.dispose();
    const next = fixture(); next.populate(); next.prepare();
    old.postrender.emit(); old.root(); expect(old.presented).not.toHaveBeenCalled();
    next.root(); await Promise.resolve(); expect(next.presented).toHaveBeenCalledOnce();
  });

  it("preserves foreign live-runner dispatch and removes only owned listeners", async () => {
    const f = fixture(), foreign = { prerender: vi.fn(), postrender: vi.fn() };
    f.prerender.add(foreign); f.postrender.add(foreign); f.populate(); f.prepare();
    expect(() => f.root()).not.toThrow(); expect(foreign.postrender).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(f.prerender.items).toEqual([foreign]); expect(f.postrender.items).toEqual([foreign]);
    f.root(); expect(foreign.postrender).toHaveBeenCalledTimes(2); expect(f.presented).toHaveBeenCalledOnce();
  });

  it("does not accept a replaced root target or stage", () => {
    const target = fixture(); target.populate(); target.prepare(); target.prerender.emit(target.options());
    target.renderer.view.renderTarget = {}; target.postrender.emit();
    expect(target.presented).not.toHaveBeenCalled(); target.observer.dispose();
    const stage = fixture(); stage.populate(); stage.prepare(); stage.prerender.emit(stage.options());
    Reflect.set(stage.app, "stage", new Container()); stage.postrender.emit();
    expect(stage.presented).not.toHaveBeenCalled(); stage.observer.dispose();
  });
});
