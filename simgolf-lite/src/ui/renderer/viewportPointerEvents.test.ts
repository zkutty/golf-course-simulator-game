import { afterEach, describe, expect, it, vi } from "vitest";
import { DomViewportPointerEventSource, type ViewportPointerMappingPort } from "./viewportPointerEvents";

class Surface extends EventTarget {
  readonly style = { cursor: "grabbing" };
  readonly captures = new Set<number>();
  readonly release = vi.fn((id: number) => this.captures.delete(id));
  child: Surface | null = null;
  contains(node: Node | null): boolean { return node === this as unknown as Node || node === this.child as unknown as Node; }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  releasePointerCapture(id: number): void { this.release(id); }
}

function pointer(type: string, id = 17, target?: Surface): PointerEvent {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    pointerId: id, pointerType: "pen", button: 0, buttons: 1, clientX: 150, clientY: 90,
    width: 2, height: 3, isPrimary: true, pressure: .75, tangentialPressure: .2,
    tiltX: 13, tiltY: -9, twist: 21, altKey: false, ctrlKey: true, shiftKey: false, metaKey: false,
  });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event as unknown as PointerEvent;
}

function harness() {
  const documentTarget = new EventTarget();
  const windowTarget = new EventTarget();
  const element = new Surface();
  const canvas = new Surface();
  element.child = canvas;
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("Node", Surface);
  const mapPositionToPoint = vi.fn((point: { x: number; y: number }, x: number, y: number) => {
    point.x = (x - 50) * 2;
    point.y = (y - 40) * 2;
  });
  const stage = { visible: true, hitArea: { contains: (x: number, y: number) => x >= 0 && y >= 0 && x < 800 && y < 600 } };
  const source = new DomViewportPointerEventSource({ canvas, renderer: { events: { mapPositionToPoint } }, stage } as unknown as ViewportPointerMappingPort, element as unknown as HTMLElement);
  return { source, element, canvas, documentTarget, windowTarget, mapPositionToPoint, stage };
}

afterEach(() => vi.unstubAllGlobals());

describe("DomViewportPointerEventSource", () => {
  it("uses the public mapper and preserves identity, pen data and native DOM propagation", () => {
    const { source, canvas, mapPositionToPoint } = harness();
    const first = vi.fn();
    const second = vi.fn();
    const downstreamDom = vi.fn();
    source.on("pointerdown", (event) => { first(event); event.stopImmediatePropagation(); });
    source.on("pointerdown", second);
    canvas.addEventListener("pointerdown", downstreamDom);
    const nativeEvent = pointer("pointerdown");
    canvas.dispatchEvent(nativeEvent);
    expect(mapPositionToPoint).toHaveBeenCalledWith({ x: 200, y: 100 }, 150, 90);
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ nativeEvent, global: { x: 200, y: 100 }, pointerId: 17, pointerType: "pen", pressure: .75, tiltX: 13, tiltY: -9, twist: 21 }));
    expect(second).not.toHaveBeenCalled();
    expect(downstreamDom).toHaveBeenCalledOnce();
    expect(nativeEvent.defaultPrevented).toBe(false);
    source.destroy();
  });

  it("routes document moves only through the visible stage screen hit area and invents no cancel callback", () => {
    const { source, documentTarget, canvas, stage } = harness();
    const move = vi.fn();
    const cancel = vi.fn();
    source.on("pointermove", move);
    source.on("pointercancel", cancel);
    documentTarget.dispatchEvent(pointer("pointermove"));
    documentTarget.dispatchEvent(Object.assign(pointer("pointermove"), { clientX: 450 }));
    stage.visible = false;
    documentTarget.dispatchEvent(pointer("pointermove"));
    canvas.dispatchEvent(pointer("pointercancel"));
    documentTarget.dispatchEvent(pointer("pointercancel"));
    expect(move).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    source.destroy();
  });

  it("releases only live internally tracked captures, preserves blur, and forgets completed identities", () => {
    const { source, documentTarget, windowTarget, element, canvas } = harness();
    for (let id = 100; id < 400; id++) {
      documentTarget.dispatchEvent(pointer("pointerdown", id, canvas));
      windowTarget.dispatchEvent(pointer("pointerup", id));
    }
    element.captures.add(100); // A completed ID is not retained as controller ownership.
    documentTarget.dispatchEvent(pointer("pointerdown", 71, canvas));
    documentTarget.dispatchEvent(pointer("pointerdown", 73, canvas));
    element.captures.add(71);
    element.captures.add(73);
    windowTarget.dispatchEvent(new Event("blur"));
    expect(element.captures.has(71)).toBe(true);
    element.dispatchEvent(pointer("lostpointercapture", 73));
    source.suspend();
    expect(element.release.mock.calls).toEqual([[71]]);
    expect(element.captures.has(100)).toBe(true);
    expect(element.style.cursor).toBe("crosshair");
    source.destroy();
    source.destroy();
    expect(element.release).toHaveBeenCalledOnce();
  });

  it("keeps ownership of capture left by a dispatched cancel until disposal", () => {
    const { source, documentTarget, element, canvas } = harness();
    documentTarget.dispatchEvent(pointer("pointerdown", 91, canvas));
    element.captures.add(91);
    documentTarget.dispatchEvent(pointer("pointercancel", 91));
    source.destroy();
    expect(element.release).toHaveBeenCalledWith(91);
  });

  it("invalidates remaining subscribers during disposal and detaches native DOM listeners", () => {
    const { source, canvas, documentTarget, mapPositionToPoint } = harness();
    const stale = vi.fn();
    source.on("pointerdown", () => source.destroy());
    source.on("pointerdown", stale);
    canvas.dispatchEvent(pointer("pointerdown"));
    expect(stale).not.toHaveBeenCalled();
    mapPositionToPoint.mockClear();
    canvas.dispatchEvent(pointer("pointerdown"));
    documentTarget.dispatchEvent(pointer("pointermove"));
    source.on("pointerdown", stale);
    expect(mapPositionToPoint).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
  });
});
