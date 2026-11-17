type Phase = "appInitStart" | "appInitEnd" | "deferredStart" | "deferredEnd"
  | "atlasStart" | "atlasEnd" | "canvasAttached" | "firstRootPresented";

interface M27PhaseObservation {
  stamp(phase: Phase): void;
  startSync(): number | undefined;
  finishSync(start: number | undefined): void;
  attach(canvas: HTMLCanvasElement): void;
  dispose(): void;
}

export function startM27PhaseObservation(app: object, target?: Window): M27PhaseObservation | null;
export function currentM27PhaseObservation(app: object): M27PhaseObservation | null;
