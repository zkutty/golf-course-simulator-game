import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

export function usePwa() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null);
  useEffect(() => {
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", install);
    if ("storage" in navigator && navigator.storage.persist) void navigator.storage.persist().then(setStoragePersistent).catch(() => setStoragePersistent(false));
    if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
      if (registration.waiting) setUpdateWorker(registration.waiting);
      registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => { if (registration.waiting && navigator.serviceWorker.controller) setUpdateWorker(registration.waiting); }));
    });
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
