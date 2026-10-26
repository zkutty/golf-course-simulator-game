// Real React regression for paused status publication and mutable-store boundaries.
import { act, createElement, Profiler, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveSimulation, type LiveStatus } from "../../src/hooks/useLiveSimulation";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createPlayerProReferenceCourse } from "../../src/game/testing/referenceCourse";
import { activeCourseLayout, normalizeCourseLayouts, updateLayout } from "../../src/game/models/courseLayouts";
import { courseCanReceiveLiveArrivals, createLiveState, stepLive } from "../../src/game/live/simulation";
import { snapshotLiveSimulation } from "../../src/game/live/persistence";
import { emptyPaceDayMetrics, ensureCoursePaceMetrics } from "../../src/game/live/pace";
import { recordPaceDay } from "../../src/game/live/paceHistory";
import type { Course, World } from "../../src/game/models/types";

type LiveApi = ReturnType<typeof useLiveSimulation>;
type Observation = { phase: string; timestamp: number; statusIdentity: number };
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const clone = <T,>(value: T): T => structuredClone(value);

// LiveStatus is records/arrays/primitives, including optional undefined values.
// Compare complete cloned values, without JSON omission of optional members.
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  check((Array.isArray(a) || Object.getPrototypeOf(a) === Object.prototype)
    && (Array.isArray(b) || Object.getPrototypeOf(b) === Object.prototype), "Unexpected LiveStatus object shape; stop rather than drop fields");
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Reflect.ownKeys(a), bk = Reflect.ownKeys(b);
  check(ak.every(k => typeof k === "string") && bk.every(k => typeof k === "string"), "Unexpected symbol status key");
  return ak.length === bk.length && ak.every(key => bk.includes(key)
    && equal((a as Record<PropertyKey, unknown>)[key], (b as Record<PropertyKey, unknown>)[key]));
}

export async function runLiveStatusPublicationRegression() {
  const originalRaf = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  let timestamp = 0, nextRaf = 1, callbacksExecuted = 0, cancels = 0;
  const queue = new Map<number, FrameRequestCallback>();
  const pendingCount = (): number => queue.size;
  let phase = "initialization", commits = 0, nextIdentity = 1;
  const identities = new WeakMap<object, number>();
  const observations: Observation[] = [];
  let latestValue: LiveStatus | null = null, comparisonBaseline: LiveStatus | null = null, phaseValuesEqual = true;
  const dayEvents: Array<{ dayIndex: number; completedWeek: boolean }> = [];
  const phases: Record<string, unknown>[] = [];
  let current: { live: LiveApi; course: Course; world: World; setEnabled: (value: boolean) => void;
    setPolicy: (value: boolean) => void; setCourse: (updater: (course: Course) => Course) => void; setWorld: (updater: (world: World) => World) => void } | null = null;
  const initialCourse = normalizeCourseLayouts(createPlayerProReferenceCourse());
  const initialWorld = clone(DEFAULT_WORLD);
  check(courseCanReceiveLiveArrivals(initialCourse), "Existing real reference course cannot receive arrivals");
  const seed = createLiveState(initialCourse, initialWorld, 0);
  let fixtureSteps = 0;
  while (seed.golfers.length === 0 && fixtureSteps < 300 && !seed.dayOver) {
    stepLive(seed, initialCourse, 1, initialWorld); fixtureSteps++;
  }
  check(seed.golfers.length > 0, "Real simulation failed to create a golfer within300 one-minute fixture steps");
  const restored = snapshotLiveSimulation({ state: seed, pendingCash: 0, speed: "paused", selectedGolferId: null });
  const api = () => { check(current, "React hook consumer has not committed"); return current; };
  const latest = () => { check(latestValue, "No status commit observed"); return latestValue; };
  function Consumer({ status }: { status: LiveStatus }) {
    useLayoutEffect(() => {
      let identity = identities.get(status);
      if (identity == null) { identity = nextIdentity++; identities.set(status, identity); }
      const value = clone(status);
      if (comparisonBaseline && !equal(value, comparisonBaseline)) phaseValuesEqual = false;
      latestValue = value;
      observations.push({ phase, timestamp, statusIdentity: identity });
      check(observations.length <= 512, "Observation bound512 exceeded");
    });
    return createElement("output", { "data-testid": "status" }, `${status.speed}:${status.clockLabel}:${status.onCourse}`);
  }
  function Producer() {
    const [enabled, setEnabled] = useState(true);
    const [policy, setPolicy] = useState(false);
    const [course, setCourse] = useState(initialCourse);
    const [world, setWorld] = useState(initialWorld);
    const live = useLiveSimulation({ enabled, course, world, setCourse, setWorld, publicThreeHoleOperation: policy,
      onDayCommitted: (result, _snapshot, completedWeek) => { dayEvents.push({ dayIndex: result.dayIndex ?? -1, completedWeek: !!completedWeek }); } });
    useLayoutEffect(() => { current = { live, course, world, setEnabled, setPolicy, setCourse, setWorld }; });
    return createElement(Profiler, { id: "real-status-consumer", onRender: () => { commits++; } },
      createElement(Consumer, { status: live.status }));
  }
  const root = createRoot(document.getElementById("root")!);
  let unmounted = false;
  async function frames(count: number) {
    check(count <= 60, "Single phase frame limit60 exceeded");
    for (let frame = 0; frame < count; frame++) {
      timestamp += 50;
      const pending = [...queue.entries()]; queue.clear();
      check(pending.length <= 1, "Unexpected second RAF owner; actual hook fixture no longer isolated");
      await act(async () => { for (const [, callback] of pending) { callbacksExecuted++; callback(timestamp); } });
    }
  }
  async function command(name: string, update: () => void) {
    phase = name;
    const before = clone(latest()), beforeCommits = commits, beforeObservations = observations.length;
    await act(async () => { update(); });
    await frames(3); // Three50ms frames preserve the unchanged150ms publication cadence.
    const after = clone(latest());
    check(!equal(before, after), `${name}: meaningful positive control did not change complete status`);
    phases.push({ name, commitDelta: commits - beforeCommits, observationDelta: observations.length - beforeObservations,
      changed: true, pendingRaf: queue.size });
    return after;
  }
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.requestAnimationFrame = callback => { const id = nextRaf++; queue.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { if (queue.delete(id)) cancels++; };
  try {
    await act(async () => { root.render(createElement(Producer)); });
    check(pendingCount() === 1, "Enabled hook must own exactly one scheduled RAF");
    await act(async () => {
      // A loaded live snapshot belongs to the course restored by the app in
      // the same update. Let that matching geometry consume the restore skip.
      api().setCourse(course => ({ ...course, holes: course.holes.map(hole => ({ ...hole })) }));
      check(api().live.restoreSnapshot(restored), "Actual restoreSnapshot rejected actual-source snapshot");
    });
    await frames(6); // Settle restore-only optional-field differences and initialization.
    check(latest().speed === "paused" && latest().golfers.length > 0, "Initialized paused full status missing actual golfer");

    async function stablePhase(name: string) {
      phase = name;
      comparisonBaseline = clone(latest()); phaseValuesEqual = true;
      const beforeCommits = commits, beforeObservations = observations.length, beforeCallbacks = callbacksExecuted;
      await frames(2);
      check(commits === beforeCommits, `${name}: publication before150ms boundary`);
      await frames(58);
      const rows = observations.slice(beforeObservations);
      const result = { name, frameCount: 60, elapsedControlledMs: 3000,
        callbacksExecuted: callbacksExecuted - beforeCallbacks, commitDelta: commits - beforeCommits,
        statusIdentityCount: new Set(rows.map(row => row.statusIdentity)).size, fullValueEqual: phaseValuesEqual };
      comparisonBaseline = null;
      check(result.callbacksExecuted === 60 && result.fullValueEqual, `${name}: loop/value semantics changed`);
      phases.push(result);
      return result;
    }
    const stable = await stablePhase("stable-paused-unselected");
    const golferId = latest().golfers[0].id;
    let changed = await command("paused-select", () => api().live.selectGolfer(golferId));
    check(changed.selected?.id === golferId, "Paused selection did not reach real consumer");
    const selectedHeartbeat = await stablePhase("selected-heartbeat");
    check(selectedHeartbeat.commitDelta === 20, "Selected inspector lost original150ms heartbeat");
    changed = await command("paused-clear-selection", () => api().live.selectGolfer(null));
    check(changed.selected === null, "Paused clear selection did not reach real consumer");
    const cleared = await stablePhase("cleared-paused-unselected");
    const layoutId = activeCourseLayout(api().course).id;
    changed = await command("paused-course", () => api().setCourse(course => updateLayout(course, layoutId, { name: "Paused diagnostic renamed course" })));
    check(changed.pace.reports7.some(row => row.courseName === "Paused diagnostic renamed course"), "Paused course input did not reach pace reports");
    const interval = latest().pace.teeIntervalMinutes + 1;
    changed = await command("paused-operations", () => api().live.updatePaceOperations({ teeIntervalMinutes: interval }));
    check(changed.pace.teeIntervalMinutes === interval, "Paused operations did not reach status at existing cadence");
    const previousHistory = latest().pace.identity.samples;
    changed = await command("paused-world", () => api().setWorld(world => {
      const pace = emptyPaceDayMetrics([layoutId]);
      const metrics = ensureCoursePaceMetrics(pace, layoutId);
      metrics.groupsStarted = 1; metrics.groupsFinished = 1; metrics.roundsCompleted = 1;
      metrics.roundDurations = [120]; metrics.occupiedTeeMinutes = 120; metrics.satisfaction = 80;
      return recordPaceDay(world, api().course, 0, pace);
    }));
    check(changed.pace.identity.samples > previousHistory && changed.pace.reports7.some(row => row.operatingDays > 0), "Paused world history not observable");

    phase = "paused-geometry";
    const epochBefore = api().live.getSnapshot()!.state.reconcileEpoch;
    await act(async () => { api().setCourse(course => ({ ...course, holes: course.holes.map((hole, index) => index === 0 ? { ...hole, name: "Reconciled hole" } : hole) })); });
    const afterInputCommits = commits;
    await frames(3);
    check(api().live.getSnapshot()!.state.reconcileEpoch > epochBefore && commits > afterInputCommits, "Paused geometry reconciliation did not publish");
    phases.push({ name: phase, reconcileEpochBefore: epochBefore, reconcileEpochAfter: api().live.getSnapshot()!.state.reconcileEpoch });

    phase = "pending-progress-pause";
    await act(async () => { api().live.setSpeed("1x"); });
    const beforeProgress = latest().dayMinute;
    await frames(1);
    const progressedMinute = api().live.getSnapshot()!.state.dayMinute;
    check(progressedMinute > beforeProgress, "No unpublished running progress fixture");
    await act(async () => { api().live.setSpeed("paused"); });
    await frames(2);
    check(latest().speed === "paused" && latest().dayMinute >= progressedMinute, "Pause lost unpublished progress");
    phases.push({ name: phase, beforeProgress, progressedMinute, publishedMinute: latest().dayMinute });

    phase = "explicit-advance";
    const pausedMinute = latest().dayMinute, explicitCommits = commits;
    await act(async () => { api().live.advanceTime(200); });
    check(commits > explicitCommits && latest().dayMinute === pausedMinute, "Paused explicit advanceTime publication changed");
    await act(async () => { api().live.setSpeed("1x"); api().live.advanceTime(200); });
    check(latest().dayMinute > pausedMinute, "Running explicit advanceTime did not publish progress");
    await act(async () => { api().live.setSpeed("paused"); });
    await frames(3);
    phases.push({ name: phase, pausedMinute, advancedMinute: latest().dayMinute });

    phase = "running";
    const minuteBefore = latest().dayMinute, runningCommits = commits;
    await act(async () => { api().live.setSpeed("1x"); });
    await frames(60);
    const running = clone(latest());
    check(running.speed === "1x" && running.dayMinute > minuteBefore, "Running actual simulation did not advance");
    phases.push({ name: phase, frames: 60, elapsedControlledMs: 3000, minuteBefore, minuteAfter: running.dayMinute,
      commitDelta: commits - runningCommits, pendingRaf: queue.size });
    await act(async () => { api().live.setSpeed("paused"); });

    phase = "restore";
    const saved = api().live.getSnapshot()!;
    const invalidCommits = commits;
    await act(async () => { check(!api().live.restoreSnapshot({ version: 99 } as unknown as typeof saved), "Invalid restore accepted"); });
    check(commits === invalidCommits, "Invalid restore mutated React status");
    saved.state.dayIndex = 2; saved.speed = "paused";
    await act(async () => { check(api().live.restoreSnapshot(saved), "Valid restore rejected"); });
    await frames(6);
    check(latest().dayIndex === 2 && latest().speed === "paused", "Valid restore status stale");
    phases.push({ name: phase, dayIndex: latest().dayIndex });

    for (const dayIndex of [2, 6]) {
      phase = `finish-day-${dayIndex}`;
      const end = createLiveState(api().course, api().world, dayIndex);
      end.arrivals = []; end.nextArrivalIdx = 0; end.dayMinute = 840;
      stepLive(end, api().course, .05, api().world);
      check(end.dayOver, "Bounded real late-day fixture did not finish");
      const endSnapshot = snapshotLiveSimulation({ state: end, pendingCash: 0, speed: dayIndex === 6 ? "1x" : "paused", selectedGolferId: null });
      const beforeEvents = dayEvents.length, weekBefore = api().world.week;
      await act(async () => { check(api().live.restoreSnapshot(endSnapshot), "Late-day restore rejected"); });
      await frames(6);
      check(dayEvents.length === beforeEvents + 1 && latest().lastDay?.dayIndex === dayIndex, "Day completion/lastDay not published exactly once");
      check(latest().dayIndex === (dayIndex + 1) % 7, "Next live day stale");
      if (dayIndex === 6) check(api().world.week === weekBefore + 1 && latest().speed === "paused" && dayEvents[dayEvents.length - 1].completedWeek, "Week-end rollover/pause stale");
      phases.push({ name: phase, lastDay: latest().lastDay?.dayIndex, nextDay: latest().dayIndex, weekBefore, weekAfter: api().world.week, eventDelta: dayEvents.length - beforeEvents });
    }

    phase = "reset-policy";
    await act(async () => { api().setEnabled(false); });
    await act(async () => {
      api().live.restoreSnapshot(undefined);
      api().setPolicy(false);
      api().setCourse(course => ({ ...course, layouts: course.layouts!.map(layout => ({ ...layout, legacyPartial: undefined })) }));
    });
    await act(async () => { api().setEnabled(true); });
    await frames(6);
    check(latest().dayIndex === 0 && latest().arrivalsRemaining === 0, "Reset/non-public opening fixture invalid");
    await act(async () => { api().setPolicy(true); });
    await frames(3);
    check(latest().arrivalsRemaining > 0, "Paused public-operation policy change did not admit arrivals");
    phases.push({ name: phase, dayIndex: latest().dayIndex, arrivalsRemaining: latest().arrivalsRemaining });

    phase = "disabled";
    await act(async () => { api().setEnabled(false); });
    check(pendingCount() === 0, "Disable did not cancel owned RAF");
    const disabledBefore = clone(latest()), disabledCommits = commits, disabledCallbacks = callbacksExecuted;
    await frames(6);
    check(commits === disabledCommits && callbacksExecuted === disabledCallbacks && equal(latest(), disabledBefore), "Disabled hook published/advanced after cleanup");
    phases.push({ name: phase, frameCount: 6, commitDelta: commits - disabledCommits, callbacksExecuted: callbacksExecuted - disabledCallbacks, pendingRaf: queue.size });
    phase = "reenabled";
    await act(async () => { api().setEnabled(true); });
    check(pendingCount() === 1, "Reenabled hook did not reacquire one RAF");
    await frames(3);
    phase = "unmounted";
    await act(async () => { root.unmount(); }); unmounted = true; current = null;
    const unmountedCommits = commits, unmountedCallbacks = callbacksExecuted;
    check(pendingCount() === 0, "Unmount did not cancel owned RAF");
    await frames(6);
    check(commits === unmountedCommits && callbacksExecuted === unmountedCallbacks, "Unmounted hook kept publishing");
    phases.push({ name: phase, frameCount: 6, commitDelta: commits - unmountedCommits, callbacksExecuted: callbacksExecuted - unmountedCallbacks, pendingRaf: queue.size });
    return { kind: "actual-hook-status-publication-regression", cadenceMs: 150, frameMs: 50,
      stable, cleared, selectedHeartbeat, commits, callbacksExecuted, cancels, phases, dayEvents,
      fixtureSteps, seededGolfers: seed.golfers.length };
  } catch (error) {
    (window as unknown as { liveStatusPublicationPartial: unknown }).liveStatusPublicationPartial = { phase, timestamp, commits, callbacksExecuted, pendingRaf: queue.size, phases };
    throw error;
  } finally {
    if (!unmounted) await act(async () => { root.unmount(); });
    current = null;
    window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
    global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
}
(window as unknown as { runLiveStatusPublicationRegression: typeof runLiveStatusPublicationRegression }).runLiveStatusPublicationRegression = runLiveStatusPublicationRegression;
