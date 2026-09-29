import { platformServices } from "../../platform";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  normalizeLoadedSaveResult,
  payloadForPersistence,
} from "../../utils/save";
import { listSlots, loadSlotResult, saveToSlot } from "../../utils/saveStore";
import { hashGameState } from "../../utils/stateHash";

export type Zk682DesktopPersistencePhase = "write" | "verify" | "recover";

export interface Zk682DesktopPersistenceRendererReport {
  schemaVersion: 1;
  phase: Zk682DesktopPersistencePhase;
  slotId: string;
  storageKey: string;
  saveSchemaVersion: number;
  sourceCanonicalHash: string;
  loadedCanonicalHash: string;
  canonicalEqual: boolean;
  rawPayloadBytes: number;
  nativePlatform: boolean;
  platformKind: string;
  safeMode: boolean;
  recovery: { key: string; selected: string | null; recovered: boolean; invalid: string[] } | null;
}

const SLOT_ID = "zk682-desktop-persistence";

function requirePhase(value: string | null): Zk682DesktopPersistencePhase {
  if (value === "write" || value === "verify" || value === "recover") return value;
  throw new Error("Invalid ZK-682 packaged persistence phase.");
}

async function runDesktopPersistenceCertification(
  phase: Zk682DesktopPersistencePhase,
): Promise<Zk682DesktopPersistenceRendererReport> {
  if (!platformServices.capabilities.nativeFiles || platformServices.capabilities.kind === "browser") {
    throw new Error("ZK-682 persistence certification requires the real desktop preload bridge.");
  }
  const seed = payloadForPersistence({
    course: structuredClone(DEFAULT_COURSE),
    world: structuredClone(DEFAULT_WORLD),
    history: [],
  });
  // DEFAULT_* is intentionally lean runtime state. Loading a save materializes
  // current-schema defaults, so certify a current-schema fixed point rather
  // than mistaking that normal enrichment for native persistence loss.
  const normalized = normalizeLoadedSaveResult({
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: 0,
    ...seed,
  });
  if (!normalized.ok) {
    throw new Error(`ZK-682 current-schema certification seed is invalid: ${normalized.error.code}`);
  }
  const source = normalized.payload;
  const sourceCanonicalHash = hashGameState(source);
  if (phase === "write") {
    await saveToSlot(SLOT_ID, "manual", "ZK-682 packaged persistence", source);
  }
  const slot = (await listSlots()).find((entry) => entry.id === SLOT_ID);
  if (!slot?.storageKey) throw new Error("ZK-682 persistence slot or immutable storage key is missing.");
  const raw = await platformServices.files.readText(slot.storageKey);
  if (!raw) throw new Error("ZK-682 persisted payload is missing.");
  const stored = JSON.parse(raw) as { schemaVersion?: unknown };
  if (stored.schemaVersion !== CURRENT_SAVE_SCHEMA_VERSION) {
    throw new Error(`Expected current save schema ${CURRENT_SAVE_SCHEMA_VERSION}, got ${String(stored.schemaVersion)}.`);
  }
  const loaded = await loadSlotResult(SLOT_ID);
  if (!loaded.ok) throw new Error(`ZK-682 persisted slot failed to load: ${loaded.error.code}`);
  const loadedCanonicalHash = hashGameState(loaded.payload);
  if (loadedCanonicalHash !== sourceCanonicalHash) {
    throw new Error(`ZK-682 canonical mismatch: ${sourceCanonicalHash} != ${loadedCanonicalHash}`);
  }
  if (phase === "write") {
    // SaveStore uses immutable revision keys. Rewriting the exact serialized
    // revision through PlatformServices creates NativeStore's normal .bak1 so
    // the later packaged recovery launch can exercise the production fallback.
    await platformServices.files.writeTextAtomic(slot.storageKey, raw);
  }
  const recovery = await platformServices.files.recovery?.(slot.storageKey) ?? null;
  return {
    schemaVersion: 1,
    phase,
    slotId: SLOT_ID,
    storageKey: slot.storageKey,
    saveSchemaVersion: stored.schemaVersion,
    sourceCanonicalHash,
    loadedCanonicalHash,
    canonicalEqual: loadedCanonicalHash === sourceCanonicalHash,
    rawPayloadBytes: new TextEncoder().encode(raw).byteLength,
    nativePlatform: platformServices.capabilities.nativeFiles,
    platformKind: platformServices.capabilities.kind,
    safeMode: await platformServices.app.safeMode(),
    recovery,
  };
}

export function installZk682DesktopPersistenceCertificationFixture(): void {
  const phase = requirePhase(new URLSearchParams(window.location.search).get("phase"));
  window.__coursecraftDesktopPersistenceCertification = runDesktopPersistenceCertification(phase);
}
