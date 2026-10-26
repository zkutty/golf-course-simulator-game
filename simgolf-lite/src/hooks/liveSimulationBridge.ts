import { restoreLiveSimulation, snapshotLiveSimulation, type LiveSimulationSnapshotV1 } from "../game/live/persistence";
import { restoreFocusedShot, snapshotFocusedShot } from "../game/live/focusedShot";
import { shotPacingFrame } from "../game/live/shotPacing";
import { LIVE, type SpeedName } from "../game/live/liveConfig";
import type { GolferRenderData } from "../game/live/types";
import type { LiveStatus, useLiveSimulation } from "./liveSimulationRuntime";

export type LiveSimulationArgs = Parameters<typeof useLiveSimulation>[0];
export type LiveSimulationApi = ReturnType<typeof useLiveSimulation>;
type LiveSimulationView = Pick<LiveSimulationApi, "status" | "speed" | "liveActive" | "selectedId" | "focusedShot" | "advancing" | "advanceDisabledReason" | "controlledTimePendingSteps"> & {
  requested: boolean;
  ready: boolean;
};

/** The driver supplies operating evidence before the game UI opens. */
function dormantMobilityReport(days: 1 | 7 | 28): LiveStatus["mobility"]["current"] {
  return { days, label: "No observed mobility history", sparse: true, evidence: "mixed",
    modeMix: { walk: 0, pushcart: 0, riding_cart: 0 }, fleet: { owned: 0, available: 0, inUse: 0, peakUtilization: 0 },
    completedRentals: 0, stockouts: 0, conversion: { value: 0, evidence: "unavailable" }, observedMinutesSaved: 0,
    productRevenue: 0, operatingCost: 0, netContribution: 0, occupiedTeeHours: 0, netRevenuePerOccupiedTeeHour: 0,
    demand: { stockout: 0, lowDemand: 0, unaffordable: 0, evidence: "unavailable" },
    recommendation: { id: "collect-evidence", state: "sparse", detail: "No completed mobility rentals are available yet; collect observed rounds before expanding fleet." } };
}

function dormantStatus(): LiveStatus {
  return { speed: "paused", dayIndex: 0, dayMinute: 0, clockLabel: `${LIVE.day.displayStartHour}:00 AM`,
    onCourse: 0, roundsToday: 0, greenFeesToday: 0, concessionsToday: 0, arrivalsRemaining: 0,
    nextArrivalMinute: null, lastDay: null, selected: null, golfers: [], tournament: null,
    pace: { courseId: "course-primary", preset: "balanced", teeIntervalMinutes: 10, maxGroupSize: 4,
      groupsOnCourse: 0, blockedGroups: 0, averageWaitMinutes: 0, interventions: 0, pickups: 0,
      beverageRevenue: 0, alcoholicDrinks: 0, incidents: 0, marshalCoverage: 0, beverageCoverage: 0,
      beverageMenu: "refreshments", lastTeeMinute: 600, daylightPolicy: "finish_started", compensationPolicy: "credit",
      identity: { score: 0.5, label: "balanced", samples: 0, cohorts: { skilled_impatient: 0.5, novice_social: 0.5, general: 0.5 } },
      bottlenecks: [], reports7: [], reports28: [], overtimeCost: 0, compensationCost: 0, refunds: 0, credits: 0, goodwillVouchers: 0 },
    mobility: { current: dormantMobilityReport(1), reports7: dormantMobilityReport(7), reports28: dormantMobilityReport(28) } };
}

/**
 * A synchronous save boundary on the title. The controller restores the last
 * queued authority while disabled, then starts its ordinary clock. Missing
 * code cannot consume time or replace a saved focus/debt/acknowledgement.
 */
export function createLiveSimulationBridge(initialArgs: LiveSimulationArgs) {
  let args = initialArgs;
  let driver: LiveSimulationApi | null = null;
  let armed = false;
  let queuedRestore: { snapshot: LiveSimulationSnapshotV1 | undefined } | null = null;
  let queuedSpeed: SpeedName | undefined;
  let queuedSelection: number | null | undefined;
  let view: LiveSimulationView = { status: dormantStatus(), speed: "paused", liveActive: false,
    selectedId: null, focusedShot: null, advancing: null, advanceDisabledReason: "unavailable",
    controlledTimePendingSteps: 0, requested: false, ready: false };
  const subscribers = new Set<() => void>();
  const update = (next: LiveSimulationView) => {
    if ((Object.keys(next) as Array<keyof LiveSimulationView>).every((key) => next[key] === view[key])) return;
    view = next;
    subscribers.forEach((subscriber) => subscriber());
  };
  const request = () => { if (!view.requested) update({ ...view, requested: true }); };
  const emptyGolfers: GolferRenderData[] = [];
  // A stable ref reads the driver's latest render buffer on every frame,
  // including buffer swaps that deliberately publish no React status update.
  const golfersRef = { get current() { return driver?.golfersRef.current ?? emptyGolfers; } };
  const methods: Pick<LiveSimulationApi, "setSpeed" | "selectGolfer" | "getSnapshot" | "restoreSnapshot" | "advanceTime" | "setPacePreset" | "updatePaceOperations" | "getFocusedShotFrame" | "skipFocusedShot" | "startDayAdvance" | "cancelDayAdvance" | "baselineControlledRoundTime" | "observeControlledTimeNow" | "acknowledgeWeekReport"> = {
    setSpeed(next) {
      if (driver) driver.setSpeed(next);
      else {
        queuedSpeed = next;
        if (queuedRestore?.snapshot) queuedRestore.snapshot = { ...queuedRestore.snapshot, speed: next };
      }
      update({ ...view, speed: next, status: { ...view.status, speed: next }, liveActive: next !== "paused" || view.status.onCourse > 0 });
    },
    selectGolfer(id) {
      if (driver) driver.selectGolfer(id);
      else {
        queuedSelection = id;
        if (queuedRestore?.snapshot) queuedRestore.snapshot = { ...queuedRestore.snapshot, selectedGolferId: id,
          ...(id !== view.selectedId ? { focusedShot: undefined } : {}) };
      }
      update({ ...view, selectedId: id, ...(id !== view.selectedId ? { focusedShot: null } : {}) });
    },
    getSnapshot() {
      if (driver) return driver.getSnapshot();
      return queuedRestore?.snapshot ? structuredClone(queuedRestore.snapshot) : undefined;
    },
    restoreSnapshot(snapshot) {
      if (driver) return driver.restoreSnapshot(snapshot);
      const restored = snapshot ? restoreLiveSimulation(snapshot) : null;
      if (snapshot && !restored) return false;
      const world = args.getLatestWorld?.() ?? args.world;
      if (restored?.weekReportPending && (restored.weekReportPending.week + 1 !== world.week || restored.state.dayIndex !== 0)) return false;
      const owner = restored ? restoreFocusedShot(restored.focusedShot, restored.state, world) : null;
      const saved = restored ? snapshotLiveSimulation({ ...restored,
        focusedShot: owner ? snapshotFocusedShot(owner) : undefined }) : undefined;
      queuedRestore = { snapshot: saved };
      queuedSpeed = undefined;
      queuedSelection = undefined;
      const status = dormantStatus();
      if (saved) {
        const minute = Math.max(0, Math.floor(saved.state.dayMinute));
        const hour24 = LIVE.day.displayStartHour + Math.floor(minute / 60);
        Object.assign(status, { speed: saved.speed, dayIndex: saved.state.dayIndex, dayMinute: saved.state.dayMinute,
          clockLabel: `${((hour24 + 11) % 12) + 1}:${(minute % 60).toString().padStart(2, "0")} ${hour24 >= 12 ? "PM" : "AM"}`,
          onCourse: saved.state.golfers.length, roundsToday: saved.state.roundsStarted,
          greenFeesToday: saved.state.greenFeeCollected, concessionsToday: saved.state.concessionCollected,
          arrivalsRemaining: Math.max(0, saved.state.arrivals.length - saved.state.nextArrivalIdx),
          nextArrivalMinute: saved.state.arrivals[saved.state.nextArrivalIdx]?.atMinute ?? null });
      }
      update({ ...view, status, speed: saved?.speed ?? "paused", selectedId: saved?.selectedGolferId ?? null,
        focusedShot: owner ? shotPacingFrame(owner.plan, owner.cursor) : null, advancing: null,
        controlledTimePendingSteps: saved?.controlledTime?.pendingSteps ?? 0,
        liveActive: status.speed !== "paused" || status.onCourse > 0,
        requested: view.requested || !!saved });
      return true;
    },
    advanceTime(ms) { driver?.advanceTime(ms); },
    setPacePreset(preset) { driver?.setPacePreset(preset); },
    updatePaceOperations(patch) { driver?.updatePaceOperations(patch); },
    getFocusedShotFrame() { return driver ? driver.getFocusedShotFrame() : view.focusedShot; },
    skipFocusedShot() { driver?.skipFocusedShot(); },
    startDayAdvance(goal) { driver?.startDayAdvance(goal); },
    cancelDayAdvance() { driver?.cancelDayAdvance(); },
    baselineControlledRoundTime(observation) { return driver?.baselineControlledRoundTime(observation) ?? false; },
    observeControlledTimeNow(observation) { return driver?.observeControlledTimeNow(observation) ?? false; },
    acknowledgeWeekReport() {
      if (driver) driver.acknowledgeWeekReport();
      else if (queuedRestore?.snapshot) {
        const { weekReportPending: _marker, ...snapshot } = queuedRestore.snapshot;
        queuedRestore.snapshot = snapshot;
      }
    },
  };
  return {
    methods, golfersRef, request,
    /** Cancellation abandons this entry request, not another caller's shared code load. */
    prepare(signal?: AbortSignal): Promise<boolean> {
      if (signal?.aborted) return Promise.resolve(false);
      request();
      if (view.ready) return Promise.resolve(true);
      return new Promise((resolve) => {
        const finish = (ready: boolean) => {
          subscribers.delete(onReady);
          signal?.removeEventListener("abort", onAbort);
          resolve(ready);
        };
        const onReady = () => { if (view.ready) finish(true); };
        const onAbort = () => finish(false);
        subscribers.add(onReady);
        signal?.addEventListener("abort", onAbort, { once: true });
        onReady();
      });
    },
    isArmed: () => armed,
    arm() { if (!armed) { armed = true; subscribers.forEach((subscriber) => subscriber()); } },
    updateArgs(next: LiveSimulationArgs) { args = next; },
    subscribe(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
    getView: () => view,
    /** Layout handoff, with the driver's enabled=false on its first render. */
    attach(next: LiveSimulationApi) {
      driver = next;
      if (queuedRestore) {
        const pending = queuedRestore;
        if (!next.restoreSnapshot(pending.snapshot)) { driver = null; return false; }
        queuedRestore = null;
      }
      if (queuedSpeed !== undefined) { next.setSpeed(queuedSpeed); queuedSpeed = undefined; }
      if (queuedSelection !== undefined) { next.selectGolfer(queuedSelection); queuedSelection = undefined; }
      return true;
    },
    publish(next: LiveSimulationApi) {
      driver = next;
      update({ requested: true, ready: true, status: next.status, speed: next.speed, liveActive: next.liveActive,
        selectedId: next.selectedId, focusedShot: next.focusedShot, advancing: next.advancing,
        advanceDisabledReason: next.advanceDisabledReason, controlledTimePendingSteps: next.controlledTimePendingSteps });
    },
    detach() {
      // A deferred-surface error can unmount the controller while the shell's
      // autosave/quit boundary remains alive. Keep its latest authority there.
      if (driver) {
        queuedRestore = { snapshot: driver.getSnapshot() };
        // On a disabled first mount no live state exists yet. StrictMode's
        // cleanup must still retain the user's queued default speed/selection.
        queuedSpeed = queuedRestore.snapshot?.speed ?? view.speed;
        queuedSelection = queuedRestore.snapshot?.selectedGolferId ?? view.selectedId;
      }
      driver = null;
      armed = false;
      update({ ...view, ready: false, advanceDisabledReason: "unavailable", advancing: null });
    },
  };
}

export type LiveSimulationBridge = ReturnType<typeof createLiveSimulationBridge>;
