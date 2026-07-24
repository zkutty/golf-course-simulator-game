import type { CourseCraftDesktopBridge, PlatformServices } from "./types";

const invoke = <T>(bridge: CourseCraftDesktopBridge, channel: string, payload?: unknown) =>
  bridge.invoke<T>(channel, payload);

export function createDesktopPlatform(bridge: CourseCraftDesktopBridge): PlatformServices {
  return {
    version: 1,
    capabilities: bridge.capabilities,
    files: {
      readText: (key) => invoke(bridge, "files:read", { key }),
      writeTextAtomic: (key, value) => invoke(bridge, "files:write", { key, value }),
      delete: (key) => invoke(bridge, "files:delete", { key }),
      list: (prefix) => invoke(bridge, "files:list", { prefix }),
      chooseImport: (extensions) => invoke(bridge, "dialogs:import", { extensions }),
      chooseExport: (name, text) => invoke(bridge, "dialogs:export", { name, text }),
      exportSupportBundle: () => invoke(bridge, "support:export"),
    },
    app: {
      version: () => invoke(bridge, "app:version"),
      safeMode: () => invoke(bridge, "app:safeMode"),
      markCleanExit: () => invoke(bridge, "app:markCleanExit"),
      requestQuit: (input) => invoke(bridge, "app:requestQuit", input),
      setWindowMode: (mode) => invoke(bridge, "window:setMode", { mode }),
    },
    achievements: { unlock: (ids) => invoke(bridge, "steam:achievements", { ids }) },
    cloud: {
      status: () => invoke(bridge, "steam:cloudStatus"),
      generations: () => invoke(bridge, "steam:cloudGenerations"),
      preserveBoth: (localGeneration, cloudGeneration) =>
        invoke(bridge, "steam:cloudPreserveBoth", { localGeneration, cloudGeneration }),
    },
    workshop: {
      legalAgreementUrl: "https://steamcommunity.com/sharedfiles/workshoplegalagreement",
      list: () => invoke(bridge, "steam:workshopList"),
      publish: (input) => invoke(bridge, "steam:workshopPublish", input),
      cancel: (operationId) => invoke(bridge, "steam:workshopCancel", { operationId }),
      copyLocal: (itemId) => invoke(bridge, "steam:workshopCopyLocal", { itemId }),
    },
    presence: { set: (value) => invoke(bridge, "steam:presence", { value }) },
    overlay: { open: (url) => invoke(bridge, "steam:overlay", { url }) },
    screenshots: { save: (dataUrl, suggestedName) => invoke(bridge, "screenshots:save", { dataUrl, suggestedName }) },
  };
}
