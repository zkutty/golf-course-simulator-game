import { createElement, lazy, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createLiveSimulationBridge, type LiveSimulationArgs } from "./liveSimulationBridge";

export type { CourseOperationsPatch, LiveDayAdvanceGoal, LiveAdvanceDisabledReason, SelectedGolferDetail, LiveStatus } from "./liveSimulationRuntime";

// Creating a lazy component does not request its code. The title never mounts
// this controller; game activation or a validated queued save does.
const LiveSimulationController = lazy(() => import("./LiveSimulationController"));

export function useLiveSimulation(args: LiveSimulationArgs) {
  const [bridge] = useState(() => createLiveSimulationBridge(args));
  const view = useSyncExternalStore(bridge.subscribe, bridge.getView, bridge.getView);
  useLayoutEffect(() => { bridge.updateArgs(args); });
  useEffect(() => { if (args.enabled) bridge.request(); }, [args.enabled, bridge]);
  return { ...view, ...bridge.methods, prepare: bridge.prepare, golfersRef: bridge.golfersRef,
    loading: (args.enabled || view.requested) && !view.ready,
    controller: args.enabled || view.requested ? createElement(LiveSimulationController, { args, bridge }) : null };
}
