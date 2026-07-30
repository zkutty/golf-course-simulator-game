import { describe, expect, it } from "vitest";
import { browserPlatform } from "./browserPlatform";
import { createDesktopPlatform } from "./desktopPlatform";
import type { CourseCraftDesktopBridge } from "./types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  normalizeLoadedSaveResult,
  payloadForPersistence,
} from "../utils/save";

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
    expect(await platform.app.requestQuit({ dirty: true, resumableBoundary: false })).toBe("cancel");
    expect(calls).toEqual([
      { channel: "files:read", payload: { key: "slot" } },
      { channel: "files:recovery", payload: { key: "slot" } },
      { channel: "app:requestQuit", payload: { dirty: true, resumableBoundary: false } },
    ]);
  });

  it("round-trips canonical biome evidence through the desktop atomic-file boundary", async () => {
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
      world: DEFAULT_WORLD,
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
      },
    });
  });
});
