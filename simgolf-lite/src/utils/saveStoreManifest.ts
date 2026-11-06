import type { SaveSlotMeta } from "./saveStore";
import { normalizeExperienceAxes } from "../game/balance/experience";

export const MANIFEST_KEY = "coursecraft_saves_manifest_v1";
export const SLOT_PREFIX = "coursecraft_save_";

export interface SaveKV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  manifestAccess?<T>(run: () => Promise<T>): Promise<T>;
  dispose?(): void;
  assertActive?(): void;
  commitSlot?(meta: SaveSlotMeta, serializePayload: () => Promise<string>): Promise<SaveSlotMeta[] | null>;
}


export function parseManifest(raw: string | null): SaveSlotMeta[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SaveSlotMeta[];
    return Array.isArray(parsed) ? parsed.map((meta) => {
      const axes = normalizeExperienceAxes(meta);
      const { difficulty: _legacyDifficulty, ...current } = meta;
      void _legacyDifficulty;
      return { ...current, ...axes };
    }) : [];
  } catch {
    return [];
  }
}

export function payloadKey(meta: SaveSlotMeta | undefined, id: string): string {
  return meta?.storageKey ?? SLOT_PREFIX + id;
}
