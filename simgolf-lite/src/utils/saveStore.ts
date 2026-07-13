import type { Course, WeekResult, World } from "../game/models/types";
import { normalizeLoadedSave, type SavePayload } from "./save";

/**
 * Save repository (ZKU-174): named slots + rotating autosaves + quicksave.
 *
 * - Payloads live in IndexedDB (localStorage's ~5MB ceiling is too tight for
 *   elevation arrays + growing history); a lightweight KV driver falls back
 *   to localStorage, then to in-memory (unit tests / exotic browsers).
 * - A manifest entry per slot carries the metadata the slot UI shows, so
 *   listing slots never parses full payloads.
 * - The legacy single-slot save (simgolf_lite_save_v1) is migrated into a
 *   manual slot the first time the store is opened.
 * - Every payload passes through normalizeLoadedSave on the way OUT, so a
 *   hostile/ancient import can never crash the game.
 */

export type SlotKind = "manual" | "auto" | "quick";

export interface SaveSlotMeta {
  id: string;
  kind: SlotKind;
  name: string;
  savedAt: number;
  /** Monotonic write counter — tie-breaker when two saves share a
   * millisecond (burst autosaves would otherwise rotate unfairly). */
  seq: number;
  courseName: string;
  week: number;
  cash: number;
  holesOpen: number;
}

export interface SaveFile {
  schemaVersion: 1;
  savedAt: number;
  course: Course;
  world: World;
  history?: WeekResult[];
}

const MANIFEST_KEY = "coursecraft_saves_manifest_v1";
const SLOT_PREFIX = "coursecraft_save_";
const LEGACY_KEY = "simgolf_lite_save_v1";
const AUTOSAVE_SLOTS = 3;
export const MAX_MANUAL_SLOTS = 8;

// ---------------------------------------------------------------------
// KV driver: IndexedDB → localStorage → memory
// ---------------------------------------------------------------------

interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
  };
}

function localStorageKV(): KV {
  return {
    get: async (k) => localStorage.getItem(k),
    set: async (k, v) => localStorage.setItem(k, v),
    del: async (k) => localStorage.removeItem(k),
  };
}

function indexedDbKV(): KV & { ready: Promise<void> } {
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("coursecraft-saves", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open;
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction("kv", mode);
      const r = run(t.objectStore("kv"));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    ready: open.then(() => undefined),
    get: (k) => tx<string | undefined>("readonly", (s) => s.get(k)).then((v) => v ?? null),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)).then(() => undefined),
    del: (k) => tx("readwrite", (s) => s.delete(k)).then(() => undefined),
  };
}

function fallbackKV(): KV {
  try {
    if (typeof localStorage !== "undefined") return localStorageKV();
  } catch {
    /* fall through */
  }
  return memoryKV();
}

function pickKV(): KV {
  try {
    if (typeof indexedDB === "undefined") return fallbackKV();
    const idb = indexedDbKV();
    // indexedDB.open can also fail ASYNCHRONOUSLY (private browsing,
    // blocked storage). Route every op through a driver promise that
    // swaps to the fallback if the database never opens.
    const driver = idb.ready.then(
      () => idb as KV,
      () => fallbackKV()
    );
    return {
      get: (k) => driver.then((d) => d.get(k)),
      set: (k, v) => driver.then((d) => d.set(k, v)),
      del: (k) => driver.then((d) => d.del(k)),
    };
  } catch {
    return fallbackKV();
  }
}

let kv: KV = pickKV();
let migrated = false;
let writeSeq = 0;

/** Test hook: swap in a fresh in-memory driver. */
export function __resetSaveStoreForTests(): void {
  kv = memoryKV();
  migrated = false;
  writeSeq = 0;
}

// ---------------------------------------------------------------------
// Manifest + slots
// ---------------------------------------------------------------------

async function readManifest(): Promise<SaveSlotMeta[]> {
  const raw = await kv.get(MANIFEST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SaveSlotMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(manifest: SaveSlotMeta[]): Promise<void> {
  await kv.set(MANIFEST_KEY, JSON.stringify(manifest));
}

function metaFor(
  id: string,
  kind: SlotKind,
  name: string,
  payload: SavePayload
): SaveSlotMeta {
  const holesOpen = payload.course.holes.filter((h) => h.tee && h.green).length;
  return {
    id,
    kind,
    name,
    savedAt: Date.now(),
    seq: ++writeSeq,
    courseName: payload.course.name,
    week: payload.world.week,
    cash: Math.round(payload.world.cash),
    holesOpen,
  };
}

/** One-time migration of the legacy single-slot localStorage save. */
async function migrateLegacyOnce(): Promise<void> {
  if (migrated) return;
  migrated = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const manifest = await readManifest();
    if (manifest.some((m) => m.id === "legacy")) return;
    const normalized = normalizeLoadedSave(JSON.parse(raw));
    if (!normalized) return;
    await kv.set(SLOT_PREFIX + "legacy", JSON.stringify(payloadToFile(normalized)));
    manifest.push(metaFor("legacy", "manual", "Migrated save", normalized));
    await writeManifest(manifest);
    // Leave the legacy key in place so downgrades still work; new saves go
    // through the store only.
  } catch {
    /* a broken legacy save must never block the new store */
  }
}

function payloadToFile(p: SavePayload): SaveFile {
  return {
    schemaVersion: 1,
    savedAt: Date.now(),
    course: p.course,
    world: p.world,
    history: p.history?.slice(-20),
  };
}

export async function listSlots(): Promise<SaveSlotMeta[]> {
  await migrateLegacyOnce();
  const manifest = await readManifest();
  return manifest.sort((a, b) => b.savedAt - a.savedAt || (b.seq ?? 0) - (a.seq ?? 0));
}

export async function saveToSlot(
  id: string | null,
  kind: SlotKind,
  name: string,
  payload: SavePayload
): Promise<SaveSlotMeta> {
  await migrateLegacyOnce();
  const slotId = id ?? `${kind}-${Date.now().toString(36)}`;
  const meta = metaFor(slotId, kind, name, payload);
  await kv.set(SLOT_PREFIX + slotId, JSON.stringify(payloadToFile(payload)));
  const manifest = await readManifest();
  const idx = manifest.findIndex((m) => m.id === slotId);
  if (idx >= 0) manifest[idx] = meta;
  else manifest.push(meta);
  await writeManifest(manifest);
  return meta;
}

export async function loadSlot(id: string): Promise<SavePayload | null> {
  await migrateLegacyOnce();
  const raw = await kv.get(SLOT_PREFIX + id);
  if (!raw) return null;
  try {
    return normalizeLoadedSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function deleteSlot(id: string): Promise<void> {
  await kv.del(SLOT_PREFIX + id);
  const manifest = await readManifest();
  await writeManifest(manifest.filter((m) => m.id !== id));
}

export async function renameSlot(id: string, name: string): Promise<void> {
  const manifest = await readManifest();
  const meta = manifest.find((m) => m.id === id);
  if (!meta) return;
  meta.name = name;
  await writeManifest(manifest);
}

/** Rotating autosave: auto-0..auto-N cycle by oldest-first replacement. */
export async function autosave(payload: SavePayload): Promise<SaveSlotMeta> {
  const manifest = await readManifest();
  const autos = manifest
    .filter((m) => m.kind === "auto")
    .sort((a, b) => a.savedAt - b.savedAt || (a.seq ?? 0) - (b.seq ?? 0));
  const id =
    autos.length < AUTOSAVE_SLOTS
      ? `auto-${autos.length}`
      : autos[0].id; // replace the oldest
  return saveToSlot(id, "auto", "Autosave", payload);
}

export async function quicksave(payload: SavePayload): Promise<SaveSlotMeta> {
  return saveToSlot("quick", "quick", "Quicksave", payload);
}

/** Most recent slot of any kind (for a one-click Continue). */
export async function mostRecentSlot(): Promise<SaveSlotMeta | null> {
  const slots = await listSlots();
  return slots[0] ?? null;
}

// ---------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------

export async function exportSlot(id: string): Promise<string | null> {
  const raw = await kv.get(SLOT_PREFIX + id);
  return raw ?? null;
}

/**
 * Import a .coursecraft file's text as a new manual slot. Validation goes
 * through normalizeLoadedSave — a hostile file yields null, never a throw.
 */
export async function importSave(text: string, name: string): Promise<SaveSlotMeta | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const normalized = normalizeLoadedSave(parsed);
  if (!normalized) return null;
  return saveToSlot(null, "manual", name, normalized);
}
