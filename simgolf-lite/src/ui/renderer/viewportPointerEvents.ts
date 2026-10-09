/** The gameplay fields consumed by the viewport's three pointer subscriptions. */
export interface ViewportGameplayPointerEvent {
  readonly type: ViewportPointerEventType;
  readonly global: { readonly x: number; readonly y: number };
  readonly nativeEvent: PointerEvent;
  readonly button: number;
  readonly buttons: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly width: number;
  readonly height: number;
  readonly isPrimary: boolean;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly isTrusted: boolean;
  /** Stops gameplay subscribers, preserving the original federated-only suppression. */
  stopImmediatePropagation(): void;
}

export type ViewportPointerEventType = "pointerdown" | "pointermove" | "pointercancel";
export type ViewportPointerListener = (event: ViewportGameplayPointerEvent) => void;

export interface ViewportPointerEventSource {
  on(type: ViewportPointerEventType, listener: ViewportPointerListener): void;
  off(type: ViewportPointerEventType, listener: ViewportPointerListener): void;
  suspend(): void;
  destroy(): void;
}

export interface ViewportPointerMappingPort {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: {
    readonly events: {
      mapPositionToPoint(point: { x: number; y: number }, clientX: number, clientY: number): void;
    };
  };
  readonly stage: {
    readonly visible: boolean;
    hitArea?: unknown;
  };
}

function hasContains(hitArea: unknown): hitArea is { contains(x: number, y: number): boolean } {
  return typeof hitArea === "object" && hitArea !== null
    && "contains" in hitArea && typeof hitArea.contains === "function";
}

/** Owns only gameplay dispatch and live capture IDs; the controller keeps DOM editor/pan handlers. */
export class DomViewportPointerEventSource implements ViewportPointerEventSource {
  private readonly app: ViewportPointerMappingPort;
  private readonly element: HTMLElement;
  private readonly listeners = new Map<ViewportPointerEventType, Set<ViewportPointerListener>>();
  private readonly activePointerIds = new Set<number>();
  private suspended = false;
  private destroyed = false;

  constructor(app: ViewportPointerMappingPort, element: HTMLElement) {
    this.app = app;
    this.element = element;
    // This observes ownership before ancestor editor capture can suppress the child canvas.
    document.addEventListener("pointerdown", this.trackPointerDown, true);
    window.addEventListener("pointerup", this.trackPointerUp, true);
    document.addEventListener("pointercancel", this.trackPointerCancel, true);
    element.addEventListener("lostpointercapture", this.trackLostCapture, true);
    app.canvas.addEventListener("pointerdown", this.handlePointerDown, true);
    document.addEventListener("pointermove", this.handlePointerMove, true);
    // Locked native EventSystem has no ordinary DOM pointercancel mapping.
  }

  on(type: ViewportPointerEventType, listener: ViewportPointerListener): void {
    if (this.destroyed) return;
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  off(type: ViewportPointerEventType, listener: ViewportPointerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  suspend(): void {
    if (this.destroyed) return;
    this.suspended = true;
    for (const pointerId of this.activePointerIds) {
      if (this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
    }
    this.activePointerIds.clear();
    this.element.style.cursor = "crosshair";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.suspend();
    this.destroyed = true;
    document.removeEventListener("pointerdown", this.trackPointerDown, true);
    window.removeEventListener("pointerup", this.trackPointerUp, true);
    document.removeEventListener("pointercancel", this.trackPointerCancel, true);
    this.element.removeEventListener("lostpointercapture", this.trackLostCapture, true);
    this.app.canvas.removeEventListener("pointerdown", this.handlePointerDown, true);
    document.removeEventListener("pointermove", this.handlePointerMove, true);
    this.listeners.clear();
  }

  private trackPointerDown = (event: PointerEvent): void => {
    if (!this.suspended && !this.destroyed && event.target instanceof Node && this.element.contains(event.target)) {
      this.activePointerIds.add(event.pointerId);
    }
  };

  private trackPointerUp = (event: PointerEvent): void => {
    this.activePointerIds.delete(event.pointerId);
  };

  private trackPointerCancel = (event: PointerEvent): void => {
    // A trusted cancel releases capture through the browser. A dispatched cancel may
    // leave capture held; keep that live ownership until lost capture or disposal.
    if (!this.element.hasPointerCapture(event.pointerId)) this.activePointerIds.delete(event.pointerId);
  };

  private trackLostCapture = (event: PointerEvent): void => {
    this.activePointerIds.delete(event.pointerId);
  };

  private handlePointerDown = (event: PointerEvent): void => this.dispatch("pointerdown", event);
  private handlePointerMove = (event: PointerEvent): void => this.dispatch("pointermove", event);

  private dispatch(type: ViewportPointerEventType, nativeEvent: PointerEvent): void {
    if (this.suspended || this.destroyed) return;
    const global = { x: 0, y: 0 };
    this.app.renderer.events.mapPositionToPoint(global, nativeEvent.clientX, nativeEvent.clientY);
    const hitArea = this.app.stage.hitArea;
    if (!this.app.stage.visible || !hasContains(hitArea) || !hitArea.contains(global.x, global.y)) return;
    let stopped = false;
    const event: ViewportGameplayPointerEvent = {
      type,
      global,
      nativeEvent,
      button: nativeEvent.button,
      buttons: nativeEvent.buttons,
      pointerId: nativeEvent.pointerId,
      pointerType: nativeEvent.pointerType,
      width: nativeEvent.width,
      height: nativeEvent.height,
      isPrimary: nativeEvent.isPrimary,
      pressure: nativeEvent.pressure,
      tangentialPressure: nativeEvent.tangentialPressure,
      tiltX: nativeEvent.tiltX,
      tiltY: nativeEvent.tiltY,
      twist: nativeEvent.twist,
      altKey: nativeEvent.altKey,
      ctrlKey: nativeEvent.ctrlKey,
      shiftKey: nativeEvent.shiftKey,
      metaKey: nativeEvent.metaKey,
      isTrusted: nativeEvent.isTrusted,
      stopImmediatePropagation: () => { stopped = true; },
    };
    for (const listener of this.listeners.get(type) ?? []) {
      if (this.suspended || this.destroyed) break;
      listener(event);
      if (stopped) break;
    }
  }
}
