import { describe, expect, it, vi } from "vitest";
import { observeServiceWorkerUpdates } from "./usePwa";

type Listener = (event: unknown) => void;

/** Minimal stand-in for the parts of ServiceWorkerRegistration this hook reads. */
function registration(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Listener>();
  return {
    value: {
      waiting: null,
      installing: null,
      addEventListener: (type: string, listener: Listener) => { listeners.set(type, listener); },
      ...overrides,
    } as unknown as ServiceWorkerRegistration,
    listeners,
  };
}

describe("observeServiceWorkerUpdates", () => {
  it("ignores a browser that resolves register() without a registration", () => {
    const onUpdateReady = vi.fn();

    expect(() => observeServiceWorkerUpdates(undefined, onUpdateReady)).not.toThrow();
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it("reports a worker that is already waiting to activate", () => {
    const worker = { postMessage: () => {} } as unknown as ServiceWorker;
    const { value } = registration({ waiting: worker });
    const onUpdateReady = vi.fn();

    observeServiceWorkerUpdates(value, onUpdateReady);

    expect(onUpdateReady).toHaveBeenCalledWith(worker);
  });

  it("subscribes to later updates when nothing is waiting yet", () => {
    const { value, listeners } = registration();
    const onUpdateReady = vi.fn();

    observeServiceWorkerUpdates(value, onUpdateReady);

    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(listeners.has("updatefound")).toBe(true);
  });

  it("tolerates an updatefound event with no installing worker", () => {
    const { value, listeners } = registration();
    observeServiceWorkerUpdates(value, vi.fn());

    expect(() => listeners.get("updatefound")?.(new Event("updatefound"))).not.toThrow();
  });
});
