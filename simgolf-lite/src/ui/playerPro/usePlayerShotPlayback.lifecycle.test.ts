import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerPlayableRound, PlayerShotTrace } from "../../game/models/playerProTypes";
import { createRetainedShotMotion } from "../../game/rules/shotMotion";

// Small effect/ref host: tests the real hook and its browser callbacks without adding a DOM package.
const host = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], refIndex: 0, effectIndex: 0,
  effects: [] as { deps: readonly unknown[] | undefined; cleanup: (() => void) | void }[],
  pending: [] as { index: number; deps: readonly unknown[] | undefined; setup: () => (() => void) | void }[],
}));
vi.mock("react", () => ({
  useRef: <T,>(initial: T) => { const index = host.refIndex++; host.refs[index] ??= { current: initial }; return host.refs[index] as { current: T }; },
  useCallback: <T,>(callback: T) => callback,
  useEffect: (setup: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = host.effectIndex++, previous = host.effects[index]?.deps;
    if (!deps || !previous || deps.length !== previous.length || deps.some((value, i) => value !== previous[i])) host.pending.push({ index, deps, setup });
  },
}));
import { usePlayerShotPlayback } from "./usePlayerShotPlayback";

function round(): PlayerPlayableRound {
  const at = (x: number) => ({ point: { x, y: 1 }, heightYards: 2 });
  const motion = createRetainedShotMotion({ identity: { shotId: "shot:1", holeId: "hole:1", shotNumber: 1, seed: 42, club: "Putter", style: "putt", modelVersion: "club_styles_v1" },
    yardsPerTile: 10, from: at(1), landing: at(1), physicalRest: at(3), flight: null, rollPath: [at(1), at(3)], reliefPosition: null, holed: true })!;
  const shot = { id: "shot:1", club: "Putter", carryYards: 0, rollYards: 20, sharedOutcome: { motion } } as PlayerShotTrace;
  return { id: "round:1", phase: "flight", pendingShot: shot, handedness: "right" } as PlayerPlayableRound;
}
type Options = Parameters<typeof usePlayerShotPlayback>[0];
let rafs: Map<number, FrameRequestCallback>, nextRaf: number, documentTarget: EventTarget & { hidden: boolean };
function Hook(options: Options) { return usePlayerShotPlayback(options); }
function render(options: Options) {
  host.refIndex = 0; host.effectIndex = 0; host.pending = [];
  const result = Hook(options);
  for (const effect of host.pending) {
    host.effects[effect.index]?.cleanup?.();
    host.effects[effect.index] = { deps: effect.deps, cleanup: effect.setup() };
  }
  return result;
}
function pump(time: number) {
  const pending = [...rafs.values()]; rafs.clear();
  for (const callback of pending) callback(time);
}
function options(source = round()): Options {
  return { round: source, actorId: "participant:7", paused: false, immediate: false, onCheckpoint: vi.fn(), onComplete: vi.fn(), onEvent: vi.fn() };
}
function unmount() { for (const effect of [...host.effects].reverse()) effect.cleanup?.(); host.effects = []; }

beforeEach(() => {
  host.refs = []; host.effects = []; host.pending = []; host.refIndex = 0; host.effectIndex = 0;
  rafs = new Map(); nextRaf = 0; documentTarget = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", documentTarget); vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextRaf; rafs.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { rafs.delete(id); });
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe("controlled activity sample lifecycle", () => {
  it("publishes frame/sample synchronously from one cursor and clears on cleanup without another completion", () => {
    const input = options(), output = render(input);
    expect(output.activitySampleRef.current).toMatchObject({ roundId: "round:1", actorId: "participant:7", handedness: "right" });
    pump(0);
    for (let time = 100; time <= 4000; time += 100) {
      pump(time);
      expect(output.activitySampleRef.current?.frame.progress).toBe(output.frameRef.current?.progress);
      expect(output.activitySampleRef.current?.frame.motionProgress).toBe(output.frameRef.current?.motionProgress);
    }
    expect(input.onComplete).toHaveBeenCalledTimes(1);
    const events = vi.mocked(input.onEvent).mock.calls.map((call) => call[2].kind);
    expect(events).toEqual(["contact", "first_contact", "hole_out"]);
    const checkpoints = vi.mocked(input.onCheckpoint).mock.calls;
    expect(checkpoints.at(-1)?.[1].progress).toBe(1);
    expect(checkpoints.every((call, index) => !index || call[1].progress >= checkpoints[index - 1][1].progress)).toBe(true);
    const before = checkpoints.length;
    for (let i = 0; i < 100; i++) expect(output.activitySampleRef.current?.frame.complete).toBe(true);
    expect(input.onCheckpoint).toHaveBeenCalledTimes(before);
    unmount(); expect(output.activitySampleRef.current).toBeNull(); expect(rafs.size).toBe(0);
    expect(input.onComplete).toHaveBeenCalledTimes(1);
  });

  it("holds pause/hidden, honors visible explicit skip, and retains existing visibility checkpoint semantics", () => {
    const initial = options(), output = render(initial); pump(0); pump(100);
    const before = output.activitySampleRef.current;
    render({ ...initial, paused: true, immediate: true }); pump(200);
    expect(output.activitySampleRef.current).toEqual(before);
    documentTarget.hidden = true; documentTarget.dispatchEvent(new Event("visibilitychange"));
    const checkpoints = vi.mocked(initial.onCheckpoint).mock.calls.length;
    output.skip(); pump(300); expect(output.activitySampleRef.current).toEqual(before);
    expect(initial.onComplete).not.toHaveBeenCalled(); expect(initial.onEvent).not.toHaveBeenCalled();
    documentTarget.hidden = false; documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(initial.onCheckpoint).toHaveBeenCalledTimes(checkpoints + 1);
    output.skip(); output.skip();
    expect(output.activitySampleRef.current?.frame.complete).toBe(true);
    expect(initial.onComplete).toHaveBeenCalledTimes(1); expect(initial.onEvent).not.toHaveBeenCalled();
  });

  it("clears invalid or changed authority despite unchanged round/shot ids, then supports the actual next participant", () => {
    const initial = options(), output = render(initial); pump(0); pump(100);
    const changed = structuredClone(initial.round!);
    changed.pendingShot!.sharedOutcome!.motion!.identity.seed++;
    render({ ...initial, round: changed });
    expect(output.activitySampleRef.current?.owner.shot.seed).toBe(43);
    expect(output.activitySampleRef.current?.cursor.elapsedMs).toBe(0);
    render({ ...initial, round: changed, actorId: "participant:8" });
    expect(output.activitySampleRef.current?.actorId).toBe("participant:8");
    const invalid = { ...changed, pendingShot: { ...changed.pendingShot!, sharedOutcome: undefined } };
    render({ ...initial, round: invalid }); expect(output.activitySampleRef.current).toBeNull();
    expect(output.frameRef.current).toBeNull();
    render({ ...initial, round: null }); expect(output.activitySampleRef.current).toBeNull(); expect(rafs.size).toBe(0);
    expect(initial.onComplete).not.toHaveBeenCalled(); expect(initial.onEvent).not.toHaveBeenCalled();
  });

  it("clears same-object hand or retained-identity changes without resetting the existing clock", () => {
    const initial = options(), output = render(initial); pump(0); pump(100);
    initial.round!.handedness = "left";
    render(initial); expect(output.activitySampleRef.current).toBeNull(); pump(200); expect(output.activitySampleRef.current).toBeNull();
    expect(output.frameRef.current!.progress).toBeGreaterThan(0);
    initial.round!.handedness = "right";
    initial.round!.pendingShot!.sharedOutcome!.motion!.identity.modelVersion = "changed-model";
    render(initial); pump(300); expect(output.activitySampleRef.current).toBeNull();
    expect(initial.onEvent).not.toHaveBeenCalled(); expect(initial.onComplete).not.toHaveBeenCalled();
  });

  it("clears a replaced retained source under unchanged round, shot and full identity without inventing a new driver", () => {
    const initial = options(), output = render(initial); pump(0); pump(100);
    const progress = output.frameRef.current!.progress;
    initial.round!.pendingShot!.sharedOutcome!.motion = structuredClone(initial.round!.pendingShot!.sharedOutcome!.motion!);
    render(initial);
    expect(output.activitySampleRef.current).toBeNull();
    pump(200); expect(output.activitySampleRef.current).toBeNull();
    expect(output.frameRef.current!.progress).toBeGreaterThan(progress);
    expect(initial.onComplete).not.toHaveBeenCalled(); expect(initial.onEvent).not.toHaveBeenCalled();
  });

  it("restores a complete shared cursor with one existing completion and no historical source event replay", () => {
    const source = round(); source.shotPresentation = { version: 1, shotId: source.pendingShot!.id, progress: 1 };
    const input = options(source), output = render(input);
    expect(output.activitySampleRef.current?.frame.complete).toBe(true);
    pump(0); pump(100);
    expect(input.onComplete).toHaveBeenCalledTimes(1); expect(input.onEvent).not.toHaveBeenCalled();
    expect(input.onCheckpoint).toHaveBeenCalledTimes(1);
    unmount(); expect(output.activitySampleRef.current).toBeNull();
  });
});
