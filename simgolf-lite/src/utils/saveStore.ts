import type { Course, Difficulty, EconomicPressure, ExperienceProfile, LandTheme, WeekResult, World } from "../game/models/types";
import type { LiveSimulationSnapshotV1 } from "../game/live/persistence";
import type { SaveLoadError, SaveLoadResult, SavePayload } from "./save";
import { CURRENT_SAVE_SCHEMA_VERSION, LEGACY_SAVE_KEY } from "./saveFacade";
import type { TutorialProgress } from "../game/onboarding/tutorial";
import { loadAppProfile, type AppProfile } from "../game/onboarding/profile";
import type { CourseRecords } from "../game/retention/types";
import { platformServices } from "../platform";
import { normalizeExperienceAxes } from "../game/balance/experience";
import { systemControlEnvelope } from "../game/experience/systemControl";

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
  experienceProfile?: ExperienceProfile;
  economicPressure?: EconomicPressure;
  /** Concise policy metadata; full sparse overrides remain in the payload. */
  systemControl?: {
    profile: ExperienceProfile;
    automated: number;
    manual: number;
    overrides: number;
  };
  /** @deprecated Pre-v29 manifest compatibility. */
  difficulty?: Difficulty;
  /** Land theme (ZKU-166). Absent on pre-M13 manifests. */
  theme?: LandTheme;
  /** Revisioned payload key. Older manifests omit this and use the legacy id key. */
  storageKey?: string;
}

export interface SaveFile {
  schemaVersion: typeof CURRENT_SAVE_SCHEMA_VERSION;
  savedAt: number;
  course: Course;
  world: World;
  history?: WeekResult[];
  live?: LiveSimulationSnapshotV1;
  tutorial?: TutorialProgress | null;
  records?: CourseRecords;
  /** Diagnostic snapshot only; importing a course never overwrites local options. */
  appProfile?: AppProfile;
}

const MANIFEST_KEY = "coursecraft_saves_manifest_v1";
const SLOT_PREFIX = "coursecraft_save_";
const LEGACY_KEY = LEGACY_SAVE_KEY;
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

function nativePlatformKV(): KV {
  return {
    get: (key) => platformServices.files.readText(key),
    set: (key, value) => platformServices.files.writeTextAtomic(key, value),
    del: (key) => platformServices.files.delete(key),
  };
}

function indexedDbKV(factory: IDBFactory = indexedDB): KV & { ready: Promise<void> } {
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("coursecraft-saves", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open;
    const awaitCommit = mode === "readwrite";
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction("kv", mode);
      let request: IDBRequest<T> | undefined;
      let requestSucceeded = false;
      let result: T;
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      // A successful write request is only an intermediate acknowledgement.
      // Its data is not visible/durable until the transaction completes, and
      // a later abort must still reject the operation. A readonly get has no
      // commit boundary: request success already means it observed a visible
      // value, so returning then avoids making the load UI wait on unrelated
      // transaction cleanup after a completed save.
      t.oncomplete = () => {
        if (settled) return;
        if (!requestSucceeded) {
          fail(new Error("IndexedDB transaction completed without a successful request"));
          return;
        }
        settled = true;
        resolve(result);
      };
      t.onerror = () => fail(t.error ?? request?.error ?? new Error("IndexedDB transaction failed"));
      t.onabort = () => fail(t.error ?? request?.error ?? new Error("IndexedDB transaction aborted"));

      try {
        request = run(t.objectStore("kv"));
        request.onsuccess = () => {
          if (!awaitCommit) {
            settled = true;
            resolve(request!.result);
            return;
          }
          requestSucceeded = true;
          result = request!.result;
        };
        request.onerror = () => fail(request!.error ?? t.error ?? new Error("IndexedDB request failed"));
      } catch (error) {
        fail(error);
      }
    });
  };
  return {
    ready: open.then(() => undefined),
    get: (k) => tx<string | undefined>("readonly", (s) => s.get(k)).then((v) => v ?? null),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)).then(() => undefined),
    del: (k) => tx("readwrite", (s) => s.delete(k)).then(() => undefined),
  };
}

/** Test hook: create the real IndexedDB driver against a controlled factory. */
export function __createIndexedDbKVForTests(factory: IDBFactory): KV & { ready: Promise<void> } {
  return indexedDbKV(factory);
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
  if (platformServices.capabilities.nativeFiles) return nativePlatformKV();
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
let failNextManifestWrite = false;
const manifestListeners = new Set<() => void>();

type SaveModule = typeof import("./save");

let importSaveModule: () => Promise<SaveModule> = () => import("./save");
let saveModulePromise: Promise<SaveModule> | null = null;

/**
 * Start loading the save helpers while the store module initializes, rather
 * than making the first quicksave wait for its whole dependency graph. A
 * rejected import is deliberately discarded so a later save can retry.
 */
function loadSaveModule(): Promise<SaveModule> {
  if (saveModulePromise) return saveModulePromise;
  const pending = importSaveModule();
  saveModulePromise = pending;
  void pending.catch(() => {
    if (saveModulePromise === pending) saveModulePromise = null;
  });
  return pending;
}

// Keep the first quicksave off the import critical path. The rejection
// handler above means an optional transient loader failure cannot become an
// unhandled rejection or poison later save attempts.
void loadSaveModule();
/**
 * A same-runtime snapshot of the last durably committed manifest. The save
 * flow writes the payload, then the manifest; once the manifest transaction
 * completes, listing that save does not need to queue behind another browser
 * IndexedDB read transaction.
 */
interface ManifestCacheHost {
  __coursecraftSaveStoreManifestV1?: SaveSlotMeta[];
}

function copyManifest(manifest: readonly SaveSlotMeta[]): SaveSlotMeta[] {
  return manifest.map((meta) => ({ ...meta }));
}

function manifestCache(): SaveSlotMeta[] | null {
  const cached = (globalThis as ManifestCacheHost).__coursecraftSaveStoreManifestV1;
  return Array.isArray(cached) ? cached : null;
}

function commitManifestCache(manifest: readonly SaveSlotMeta[]): void {
  (globalThis as ManifestCacheHost).__coursecraftSaveStoreManifestV1 = copyManifest(manifest);
  for (const listener of manifestListeners) listener();
}

/** Test hook: swap in a fresh in-memory driver. */
export function __resetSaveStoreForTests(): void {
  kv = memoryKV();
  migrated = false;
  writeSeq = 0;
  failNextManifestWrite = false;
  importSaveModule = () => import("./save");
  saveModulePromise = null;
  delete (globalThis as ManifestCacheHost).__coursecraftSaveStoreManifestV1;
}

/** Test hook: replace the dynamic save import to cover transient loader failures. */
export function __setSaveModuleImporterForTests(importer: () => Promise<SaveModule>): void {
  importSaveModule = importer;
  saveModulePromise = null;
}

/** Test hook: exercise the store against a deliberately slow KV driver. */
export function __setSaveStoreKVForTests(driver: KV): void {
  kv = driver;
  migrated = false;
  writeSeq = 0;
  failNextManifestWrite = false;
  delete (globalThis as ManifestCacheHost).__coursecraftSaveStoreManifestV1;
}

/** Notify an open slot picker after a durable manifest update. */
export function subscribeToSaveSlots(listener: () => void): () => void {
  manifestListeners.add(listener);
  return () => manifestListeners.delete(listener);
}

/** Test hook for proving an interrupted commit preserves the active revision. */
export function __failNextManifestWriteForTests(): void {
  failNextManifestWrite = true;
}

/** E2E-only fixture support for pre-M13 manifests and missing revisions. */
export async function __omitSlotThemeForTests(id: string): Promise<void> {
  const manifest = await readManifest();
  const entry = manifest.find((candidate) => candidate.id === id);
  if (!entry) return;
  delete entry.theme;
  await writeManifest(manifest);
}

export async function __deleteSlotPayloadForTests(id: string): Promise<void> {
  const manifest = await readManifest();
  await kv.del(payloadKey(manifest.find((candidate) => candidate.id === id), id));
}

// ---------------------------------------------------------------------
// Manifest + slots
// ---------------------------------------------------------------------

async function readManifest(): Promise<SaveSlotMeta[]> {
  const cached = manifestCache();
  if (cached) return copyManifest(cached);
  const raw = await kv.get(MANIFEST_KEY);
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

async function writeManifest(manifest: SaveSlotMeta[]): Promise<void> {
  if (failNextManifestWrite) {
    failNextManifestWrite = false;
    throw new Error("Simulated interrupted manifest commit");
  }
  await kv.set(MANIFEST_KEY, JSON.stringify(manifest));
  // Cache only after the write transaction resolves, so a failed manifest
  // update can never advertise a slot that was not durably committed.
  commitManifestCache(manifest);
}

function payloadKey(meta: SaveSlotMeta | undefined, id: string): string {
  return meta?.storageKey ?? SLOT_PREFIX + id;
}

function metaFor(
  id: string,
  kind: SlotKind,
  name: string,
  payload: SavePayload
): SaveSlotMeta {
  const holesOpen = payload.course.holes.filter((h) => h.tee && h.green).length;
  const experience = normalizeExperienceAxes(payload.world);
  const control = systemControlEnvelope(payload.world);
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
    experienceProfile: experience.experienceProfile,
    economicPressure: experience.economicPressure,
    systemControl: {
      profile: control.profile,
      automated: control.systems.filter((system) => system.mode === "automated").length,
      manual: control.systems.filter((system) => system.mode === "manual").length,
      overrides: control.systems.filter((system) => system.override).length,
    },
    theme: payload.course.theme ?? "parkland",
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
    const { normalizeLoadedSave } = await loadSaveModule();
    const normalized = normalizeLoadedSave(JSON.parse(raw));
    if (!normalized) return;
    await kv.set(SLOT_PREFIX + "legacy", JSON.stringify(await payloadToFile(normalized)));
    manifest.push(metaFor("legacy", "manual", "Migrated save", normalized));
    await writeManifest(manifest);
    // Leave the legacy key in place so downgrades still work; new saves go
    // through the store only.
  } catch {
    /* a broken legacy save must never block the new store */
  }
}

async function payloadToFile(p: SavePayload): Promise<SaveFile> {
  const { payloadForPersistence } = await loadSaveModule();
  const persisted = payloadForPersistence(p);
  return {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: Date.now(),
    course: persisted.course,
    world: persisted.world,
    history: persisted.history,
    records: persisted.records,
    live: persisted.live,
    tutorial: persisted.tutorial,
    appProfile: loadAppProfile(),
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
  const manifest = await readManifest();
  const idx = manifest.findIndex((m) => m.id === slotId);
  const previous = idx >= 0 ? manifest[idx] : undefined;
  meta.storageKey = `${SLOT_PREFIX}${slotId}@${meta.savedAt.toString(36)}-${meta.seq.toString(36)}`;
  await kv.set(meta.storageKey, JSON.stringify(await payloadToFile(payload)));
  if (idx >= 0) manifest[idx] = meta;
  else manifest.push(meta);
  try {
    await writeManifest(manifest);
  } catch (error) {
    await kv.del(meta.storageKey).catch(() => undefined);
    throw error;
  }
  const previousKey = payloadKey(previous, slotId);
  if (previous && previousKey !== meta.storageKey) await kv.del(previousKey).catch(() => undefined);
  return meta;
}

export async function loadSlot(id: string): Promise<SavePayload | null> {
  const result = await loadSlotResult(id);
  return result.ok ? result.payload : null;
}

export async function loadSlotResult(id: string): Promise<SaveLoadResult> {
  await migrateLegacyOnce();
  const manifest = await readManifest();
  const raw = await kv.get(payloadKey(manifest.find((meta) => meta.id === id), id));
  if (!raw) {
    return { ok: false, error: { code: "INVALID_SHAPE", message: "That save slot is missing." } };
  }
  const { parseSaveText } = await loadSaveModule();
  return parseSaveText(raw);
}

export async function deleteSlot(id: string): Promise<void> {
  const manifest = await readManifest();
  const meta = manifest.find((entry) => entry.id === id);
  await writeManifest(manifest.filter((m) => m.id !== id));
  await kv.del(payloadKey(meta, id)).catch(() => undefined);
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
  const manifest = await readManifest();
  const raw = await kv.get(payloadKey(manifest.find((meta) => meta.id === id), id));
  return raw ?? null;
}

/**
 * Import a .coursecraft file's text as a new manual slot. Validation goes
 * through normalizeLoadedSave — a hostile file yields null, never a throw.
 */
export async function importSave(text: string, name: string): Promise<SaveSlotMeta | null> {
  const result = await importSaveResult(text, name);
  return result.ok ? result.meta : null;
}

export type SaveImportResult =
  | { ok: true; meta: SaveSlotMeta; migratedFrom?: number }
  | { ok: false; error: SaveLoadError };

export async function importSaveResult(text: string, name: string): Promise<SaveImportResult> {
  const { parseSaveText } = await loadSaveModule();
  const result = parseSaveText(text);
  if (!result.ok) return result;
  const meta = await saveToSlot(null, "manual", name, result.payload);
  return {
    ok: true,
    meta,
    ...(result.migratedFrom == null ? {} : { migratedFrom: result.migratedFrom }),
  };
}
