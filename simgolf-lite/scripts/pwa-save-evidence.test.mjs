import assert from "node:assert/strict";
import test from "node:test";
import { certifyOfflineIndexedDbSave } from "./pwa-save-evidence.mjs";

const snapshot = {
  courseHash: "deadbeef",
  week: 3,
  cash: 42_000,
  terrainVersion: 7,
  economyVersion: 4,
  terrainCounts: { rough: 8, fairway: 3 },
  golferPositions: [[1, 12.5, 7.25]],
};

const stored = {
  driver: "indexeddb",
  database: "coursecraft-saves",
  objectStore: "kv",
  slotId: "quick-save",
  storageKey: "coursecraft_save_quick-save@m123-1",
  saveSchemaVersion: 31,
  payloadBytes: 2048,
  payloadSha256: "a".repeat(64),
  localStorageFallbackKeys: [],
};

test("certifies an exact offline IndexedDB game-save round trip", () => {
  const after = {
    ...structuredClone(snapshot),
    // Fresh-page selector invalidation counters are session-local, not save
    // identity, and may restart before LOAD_GAME advances them.
    terrainVersion: 1,
    economyVersion: 1,
  };
  assert.deepEqual(certifyOfflineIndexedDbSave({ before: snapshot, storedBefore: stored, storedAfter: structuredClone(stored), after }), {
    evidenceVersion: 1,
    driver: "indexeddb",
    database: "coursecraft-saves",
    objectStore: "kv",
    slotId: "quick-save",
    storageKey: "coursecraft_save_quick-save@m123-1",
    saveSchemaVersion: 31,
    payloadBytes: 2048,
    payloadSha256: "a".repeat(64),
    courseHash: "deadbeef",
    projectionsEqual: true,
    payloadBytesSurvivedOfflineReload: true,
    sessionInvalidationCounters: {
      before: { terrain: 7, economy: 4 },
      after: { terrain: 1, economy: 1 },
    },
    passed: true,
  });
});

test("rejects localStorage fallback evidence", () => {
  assert.throws(
    () => certifyOfflineIndexedDbSave({
      before: snapshot,
      storedBefore: stored,
      storedAfter: { ...stored, localStorageFallbackKeys: ["coursecraft_saves_manifest_v1"] },
      after: { ...snapshot, terrainVersion: 8, economyVersion: 5 },
    }),
    /localStorage fallback/,
  );
});

test("rejects state drift after the offline load", () => {
  assert.throws(
    () => certifyOfflineIndexedDbSave({
      before: snapshot,
      storedBefore: stored,
      storedAfter: stored,
      after: { ...snapshot, cash: snapshot.cash - 1, terrainVersion: 8, economyVersion: 5 },
    }),
    /changed canonical game identity/,
  );
});

test("rejects IndexedDB payload drift across the offline reload", () => {
  assert.throws(
    () => certifyOfflineIndexedDbSave({
      before: snapshot,
      storedBefore: stored,
      storedAfter: { ...stored, payloadSha256: "b".repeat(64) },
      after: { ...snapshot, terrainVersion: 8, economyVersion: 5 },
    }),
    /changed the stored payload bytes/,
  );
});
