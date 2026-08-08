import { describe, expect, it, vi } from "vitest";
import { applyAction } from "../../core/reducer";
import type { PlatformServices } from "../../platform/types";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSave } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";
import { DEFAULT_STATE } from "../gameState";
import { GameSession } from "./GameSession";
import { GameSessionRenderInstrumentation } from "./renderInstrumentation";
import { shallowEqual } from "./react";

function platform(
  onQuitRequested: PlatformServices["app"]["onQuitRequested"] = vi.fn(() => () => undefined),
): PlatformServices {
  return {
    version: 1,
    capabilities: { kind: "browser", nativeFiles: false, steam: false, workshop: false, cloud: false, overlay: false, screenshots: false },
    files: { readText: vi.fn(), writeTextAtomic: vi.fn(), delete: vi.fn(), list: vi.fn(), chooseImport: vi.fn(), chooseExport: vi.fn(), exportSupportBundle: vi.fn() },
    app: { version: vi.fn(), safeMode: vi.fn(), markCleanExit: vi.fn(), requestQuit: vi.fn(), onQuitRequested, setWindowMode: vi.fn() },
    achievements: { unlock: vi.fn() },
    cloud: { status: vi.fn(), generations: vi.fn(), preserveBoth: vi.fn() },
    workshop: { legalAgreementUrl: null, list: vi.fn(), publish: vi.fn(), cancel: vi.fn(), copyLocal: vi.fn() },
    presence: { set: vi.fn() }, overlay: { open: vi.fn() }, screenshots: { save: vi.fn() },
  };
}

describe("GameSession application boundary", () => {
  it("delegates commands to the unchanged reducer and preserves deterministic hashes", () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const action = { type: "TAKE_LOAN", kind: "BRIDGE" } as const;
    const expected = applyAction(DEFAULT_STATE, action);

    expect(session.dispatch(action)).toEqual(expected);
    expect(hashGameState(session.createSavePayload())).toBe(hashGameState({ course: expected.course, world: expected.world }));
  });

  it("notifies narrow selectors only when their projection changes", () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const courseRenders = vi.fn();
    const economyRenders = vi.fn();
    session.subscribeSelector((state) => ({ course: state.course }), courseRenders, shallowEqual);
    session.subscribeSelector((state) => ({ cash: state.world.cash, version: state.economyVersion }), economyRenders, shallowEqual);

    session.updateWorld((world) => ({ ...world, cash: world.cash + 1 }));

    expect(courseRenders).not.toHaveBeenCalled();
    expect(economyRenders).toHaveBeenCalledOnce();
  });

  it("measures narrow invalidation scopes for live, editor, and management panels", () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const instrumentation = new GameSessionRenderInstrumentation(session);

    session.updateWorld((world) => ({ ...world, cash: world.cash + 1 }));
    expect(instrumentation.snapshot()).toEqual({
      "live-hud": 1,
      "editor-inspector": 0,
      "management-report": 1,
    });

    session.replaceState({ ...session.getState(), selectedTerrain: "rough" });
    expect(instrumentation.snapshot()).toEqual({
      "live-hud": 1,
      "editor-inspector": 1,
      "management-report": 1,
    });

    session.updateCourse((course) => ({ ...course, name: `${course.name} reviewed` }));
    expect(instrumentation.snapshot()).toEqual({
      "live-hud": 1,
      "editor-inspector": 2,
      "management-report": 1,
    });

    instrumentation.dispose();
    session.updateWorld((world) => ({ ...world, reputation: world.reputation + 1 }));
    expect(instrumentation.snapshot()).toEqual({
      "live-hud": 1,
      "editor-inspector": 2,
      "management-report": 1,
    });
  });

  it("composes saves and restores historical payloads without changing schema migration", async () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const historical = {
      schemaVersion: 24,
      savedAt: 1,
      course: DEFAULT_STATE.course,
      world: DEFAULT_STATE.world,
    };
    const loaded = normalizeLoadedSave(historical);
    expect(loaded).not.toBeNull();
    session.updateWorld((world) => ({ ...world, cash: 1 }));

    const captured = await session.save(async (payload) => payload, { history: [] });
    expect(captured).toMatchObject({ course: session.getState().course, world: session.getState().world, history: [] });
    expect(session.isDirty).toBe(false);

    session.restore(loaded!);
    expect(session.getState().course).toBe(loaded!.course);
    expect(session.createSavePayload()).toMatchObject({ course: loaded!.course, world: loaded!.world });
    expect(CURRENT_SAVE_SCHEMA_VERSION).toBe(30);
  });

  it("does not mark changes made during an asynchronous save as clean", async () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    let finishSave: (() => void) | undefined;
    const saving = session.save(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    session.updateWorld((world) => ({ ...world, cash: world.cash + 1 }));
    finishSave?.();
    await saving;

    expect(session.isDirty).toBe(true);
  });

  it("owns the platform quit/save lifecycle and retains a recoverable failure boundary", async () => {
    let quitHandler: (() => void | Promise<void>) | undefined;
    const services = platform(vi.fn((handler: () => void | Promise<void>) => {
      quitHandler = handler;
      return () => { quitHandler = undefined; };
    }));
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: services });
    const persist = vi.fn(async () => undefined);
    session.bindPlatformQuitBoundary({ shouldSave: () => true, attachments: () => ({ history: [] }), persist });

    await quitHandler?.();

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ course: DEFAULT_STATE.course, world: DEFAULT_STATE.world, history: [] }));
    expect(services.app.requestQuit).toHaveBeenCalledWith({ dirty: false, resumableBoundary: true });
  });
});
