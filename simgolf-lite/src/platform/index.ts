import { browserPlatform } from "./browserPlatform";
import { createDesktopPlatform } from "./desktopPlatform";
import type { CourseCraftDesktopBridge, PlatformServices } from "./types";

function validBridge(value: unknown): value is CourseCraftDesktopBridge {
  if (!value || typeof value !== "object") return false;
  const bridge = value as CourseCraftDesktopBridge;
  return bridge.version === 1 && typeof bridge.invoke === "function" &&
    typeof bridge.onQuitRequested === "function" &&
    !!bridge.capabilities && bridge.capabilities.nativeFiles === true;
}

export const platformServices: PlatformServices =
  typeof window !== "undefined" && validBridge(window.coursecraftDesktop)
    ? createDesktopPlatform(window.coursecraftDesktop)
    : browserPlatform;

export type * from "./types";
