import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

/**
 * Watch a service worker registration for an update that is ready to activate.
 *
 * `navigator.serviceWorker.register()` is specified to resolve with a
 * registration, but privacy browsers and service-worker-blocking extensions
 * resolve it with `undefined` instead of rejecting. Reading `.waiting` off that
 * value threw a TypeError that escaped as an unhandled rejection (ZK-502 /
 * Sentry COURSECRAFT-1). Extracted from the hook so that null case stays
 * covered by a regression test without needing a DOM harness.
 */
export function observeServiceWorkerUpdates(
  registration: ServiceWorkerRegistration | undefined,
  onUpdateReady: (worker: ServiceWorker) => void,
): void {
  if (!registration) return;
  if (registration.waiting) onUpdateReady(registration.waiting);
  registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => { if (registration.waiting && navigator.serviceWorker.controller) onUpdateReady(registration.waiting); }));
}

export function usePwa() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null);
  useEffect(() => {
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", install);
    if ("storage" in navigator && navigator.storage.persist) void navigator.storage.persist().then(setStoragePersistent).catch(() => setStoragePersistent(false));
    if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => observeServiceWorkerUpdates(registration, setUpdateWorker)).catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", install);
  }, []);
  return {
    canInstall: installPrompt != null,
    install: async () => { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); },
    updateAvailable: updateWorker != null,
    applyUpdate: () => { if (!updateWorker) return; navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true }); updateWorker.postMessage({ type: "SKIP_WAITING" }); },
    storagePersistent,
  };
}
