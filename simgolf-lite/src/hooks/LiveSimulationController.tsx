import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLiveSimulation } from "./liveSimulationRuntime";
import type { LiveSimulationArgs, LiveSimulationBridge } from "./liveSimulationBridge";

/** The existing hook retains one stable owner and its ordinary hook ordering. */
export default function LiveSimulationController({ args, bridge }: { args: LiveSimulationArgs; bridge: LiveSimulationBridge }) {
  const armed = useSyncExternalStore(bridge.subscribe, bridge.isArmed, bridge.isArmed);
  const live = useLiveSimulation({ ...args, enabled: armed && args.enabled });
  useLayoutEffect(() => {
    if (!bridge.attach(live)) throw new Error("The saved live simulation could not be restored before activation.");
    if (!armed) bridge.arm();
    else bridge.publish(live);
  }, [armed, bridge, live]);
  useLayoutEffect(() => () => bridge.detach(), [bridge]);
  return null;
}
