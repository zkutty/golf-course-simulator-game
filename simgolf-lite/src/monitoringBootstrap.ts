type Schedule = (callback: () => void) => void;

export interface MonitoringBootstrapOptions {
  loaded?: boolean;
  schedule?: Schedule;
  target?: EventTarget;
}

function scheduleIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(callback, { timeout: 2000 });
  else globalThis.setTimeout(callback, 0);
}

/** Initialize after startup, or immediately after an early global failure. */
export function installMonitoringBootstrap(
  load: () => Promise<void>,
  options: MonitoringBootstrapOptions = {},
): void {
  const target = options.target ?? window;
  const schedule = options.schedule ?? scheduleIdle;
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    void load();
  };
  target.addEventListener('error', start, { once: true });
  target.addEventListener('unhandledrejection', start, { once: true });
  const afterLoad = (): void => schedule(start);
  if (options.loaded ?? document.readyState === 'complete') afterLoad();
  else target.addEventListener('load', afterLoad, { once: true });
}
