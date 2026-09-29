import assert from "node:assert/strict";

export const PWA_SAVE_EVIDENCE_VERSION = 1;

function gameStateProjection(snapshot) {
  return {
    courseHash: snapshot.courseHash,
    week: snapshot.week,
    cash: snapshot.cash,
    terrainCounts: snapshot.terrainCounts,
    golferPositions: snapshot.golferPositions,
  };
}

function assertIndexedDbRecord(stored, label) {
  assert.equal(stored.driver, "indexeddb", `${label} game save evidence must come from IndexedDB`);
  assert.equal(stored.database, "coursecraft-saves", `${label} game-save database was unexpected`);
  assert.equal(stored.objectStore, "kv", `${label} game-save object store was unexpected`);
  assert.equal(stored.slotId, "quick-save", `${label} production quick-save slot was not inspected`);
  assert.match(
    stored.storageKey,
    /^coursecraft_save_quick-save@/,
    `${label} IndexedDB manifest did not point at a revisioned quick-save payload`,
  );
  assert.ok(Number.isInteger(stored.saveSchemaVersion) && stored.saveSchemaVersion > 0, `${label} saved payload has no schema version`);
  assert.ok(stored.payloadBytes > 0, `${label} saved payload is empty`);
  assert.match(stored.payloadSha256, /^[a-f0-9]{64}$/, `${label} saved payload has no SHA-256 identity`);
  assert.deepEqual(stored.localStorageFallbackKeys, [], `${label} game save unexpectedly used the localStorage fallback`);
}

/**
 * Fail-closed contract for the PWA's production save repository. A matching
 * localStorage sentinel is useful shell evidence, but it cannot satisfy this
 * contract: the actual game slot must be present in IndexedDB and restore the
 * same canonical game identity after an offline reload.
 */
export function certifyOfflineIndexedDbSave({ before, storedBefore, storedAfter, after }) {
  assertIndexedDbRecord(storedBefore, "online");
  assertIndexedDbRecord(storedAfter, "offline");
  assert.equal(storedAfter.storageKey, storedBefore.storageKey, "offline reload resolved a different quick-save revision");
  assert.equal(storedAfter.saveSchemaVersion, storedBefore.saveSchemaVersion, "offline reload changed the save schema version");
  assert.equal(storedAfter.payloadBytes, storedBefore.payloadBytes, "offline reload changed the stored payload length");
  assert.equal(storedAfter.payloadSha256, storedBefore.payloadSha256, "offline reload changed the stored payload bytes");

  const beforeProjection = gameStateProjection(before);
  const afterProjection = gameStateProjection(after);
  assert.deepEqual(afterProjection, beforeProjection, "offline IndexedDB load changed canonical game identity");

  return {
    evidenceVersion: PWA_SAVE_EVIDENCE_VERSION,
    driver: storedAfter.driver,
    database: storedAfter.database,
    objectStore: storedAfter.objectStore,
    slotId: storedAfter.slotId,
    storageKey: storedAfter.storageKey,
    saveSchemaVersion: storedAfter.saveSchemaVersion,
    payloadBytes: storedAfter.payloadBytes,
    payloadSha256: storedAfter.payloadSha256,
    courseHash: before.courseHash,
    projectionsEqual: true,
    payloadBytesSurvivedOfflineReload: true,
    // Reducer invalidation counters are intentionally session-local and are
    // not part of the serialized gameplay contract. Preserve both values in
    // evidence so the exclusion is explicit rather than silently discarded.
    sessionInvalidationCounters: {
      before: { terrain: before.terrainVersion, economy: before.economyVersion },
      after: { terrain: after.terrainVersion, economy: after.economyVersion },
    },
    passed: true,
  };
}
