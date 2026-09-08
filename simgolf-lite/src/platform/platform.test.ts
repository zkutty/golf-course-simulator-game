import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPlatform } from "./browserPlatform";
import { createDesktopPlatform } from "./desktopPlatform";
import type { CourseCraftDesktopBridge } from "./types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  normalizeLoadedSaveResult,
  payloadForPersistence,
} from "../utils/save";

afterEach(() => vi.unstubAllGlobals());

describe("M42 PlatformServices", () => {
  it("keeps the browser build offline-capable with safe fallbacks", async () => {
    expect(browserPlatform.capabilities).toMatchObject({
      kind: "browser",
      nativeFiles: false,
      steam: false,
      workshop: false,
      cloud: false,
    });
    await browserPlatform.files.writeTextAtomic("slot", "payload");
    expect(await browserPlatform.files.readText("slot")).toBe("payload");
    expect(await browserPlatform.cloud.status()).toBe("unavailable");
    expect(await browserPlatform.workshop.list()).toEqual([]);
    await expect(browserPlatform.workshop.publish({
      contentId: "x",
      title: "x",
      description: "x",
      tags: [],
      visibility: "private",
      packageText: "{}",
    })).rejects.toThrow("unavailable");
  });

  it("downloads SVG with its exact MIME and revokes the object URL", async () => {
    const click = vi.fn(), revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe("image/svg+xml");
      return "blob:coursecraft-svg";
    });
    vi.stubGlobal("document", { createElement: () => ({ click, download: "", href: "" }) });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
    await expect(browserPlatform.files.chooseExport("hole.svg", "<svg/>", "image/svg+xml")).resolves.toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:coursecraft-svg");
  });

  it("maps renderer calls only onto the allowlisted typed desktop bridge", async () => {
    const calls: Array<{ channel: string; payload: unknown }> = [];
    const bridge: CourseCraftDesktopBridge = {
      version: 1,
      capabilities: {
        kind: "desktop",
        nativeFiles: true,
        steam: false,
        workshop: false,
        cloud: false,
        overlay: false,
        screenshots: true,
      },
      async invoke<T>(channel: string, payload?: unknown) {
        calls.push({ channel, payload });
        if (channel === "files:read") return "value" as T;
        if (channel === "app:requestQuit") return "cancel" as T;
        return undefined as T;
      },
      onQuitRequested: () => () => undefined,
    };
    const platform = createDesktopPlatform(bridge);
    expect(await platform.files.readText("slot")).toBe("value");
    expect(await platform.files.recovery?.("slot")).toBeUndefined();
    await platform.files.chooseExport("hole.svg", "<svg/>", "image/svg+xml");
    expect(await platform.app.requestQuit({ dirty: true, resumableBoundary: false })).toBe("cancel");
    expect(calls).toEqual([
      { channel: "files:read", payload: { key: "slot" } },
      { channel: "files:recovery", payload: { key: "slot" } },
      { channel: "dialogs:export", payload: { name: "hole.svg", text: "<svg/>", mimeType: "image/svg+xml" } },
      { channel: "app:requestQuit", payload: { dirty: true, resumableBoundary: false } },
    ]);
  });

  it("round-trips canonical biome and experience axes through the desktop atomic-file boundary", async () => {
    const files = new Map<string, string>();
    const bridge: CourseCraftDesktopBridge = {
      version: 1,
      capabilities: {
        kind: "desktop",
        nativeFiles: true,
        steam: false,
        workshop: false,
        cloud: false,
        overlay: false,
        screenshots: true,
      },
      async invoke<T>(channel: string, payload?: unknown) {
        const args = payload as { key?: string; value?: string } | undefined;
        if (channel === "files:write" && args?.key && typeof args.value === "string") {
          files.set(args.key, args.value);
          return undefined as T;
        }
        if (channel === "files:read" && args?.key) return (files.get(args.key) ?? null) as T;
        return undefined as T;
      },
      onQuitRequested: () => () => undefined,
    };
    const platform = createDesktopPlatform(bridge);
    const payload = payloadForPersistence({
      course: { ...DEFAULT_COURSE, theme: "desert", biomeCompatibility: undefined },
      world: { ...DEFAULT_WORLD, experienceProfile: "simulation", economicPressure: "friendly" },
    });
    const text = JSON.stringify({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 1,
      ...payload,
    });
    await platform.files.writeTextAtomic("desert.coursecraft", text);
    const restored = normalizeLoadedSaveResult(
      JSON.parse((await platform.files.readText("desert.coursecraft"))!),
    );
    expect(restored).toMatchObject({
      ok: true,
      payload: {
        course: {
          theme: "desert",
          biomeCompatibility: { version: 1, biome: "desert", contentVersion: 1 },
        },
        world: { experienceProfile: "simulation", economicPressure: "friendly" },
      },
    });
  });
});
