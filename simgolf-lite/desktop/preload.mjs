import { contextBridge, ipcRenderer } from "electron";

const CHANNELS = new Set([
  "files:read", "files:recovery", "files:write", "files:delete", "files:list",
  "dialogs:import", "dialogs:export", "support:export",
  "app:version", "app:safeMode", "app:markCleanExit", "app:requestQuit",
  "window:setMode", "screenshots:save",
  "steam:capabilities", "steam:achievements", "steam:cloudStatus", "steam:cloudGenerations", "steam:cloudPreserveBoth",
  "steam:workshopList", "steam:workshopPublish", "steam:workshopCancel", "steam:workshopCopyLocal",
  "steam:presence", "steam:overlay",
]);

const capabilities = Object.freeze({
  kind: process.env.COURSECRAFT_STEAM === "1" ? "steam" : "desktop",
  nativeFiles: true,
  steam: process.env.COURSECRAFT_STEAM === "1",
  workshop: process.env.COURSECRAFT_STEAM === "1",
  cloud: process.env.COURSECRAFT_STEAM === "1",
  overlay: process.env.COURSECRAFT_STEAM === "1",
  screenshots: true,
});

contextBridge.exposeInMainWorld("coursecraftDesktop", Object.freeze({
  version: 1,
  capabilities,
  invoke(channel, payload) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error("Desktop channel is not allowed."));
    return ipcRenderer.invoke(channel, payload);
  },
  onQuitRequested(callback) {
    if (typeof callback !== "function") return () => undefined;
    const listener = () => callback();
    ipcRenderer.on("app:quitRequested", listener);
    return () => ipcRenderer.removeListener("app:quitRequested", listener);
  },
}));
