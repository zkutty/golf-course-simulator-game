import assert from "node:assert/strict";

export const ZK682_DESKTOP_PERSISTENCE_SCHEMA_VERSION = 1;
export const ZK682_CURRENT_SAVE_SCHEMA_VERSION = 31;

function assertPhaseReport(report, phase, userDataPath) {
  assert.equal(report.schemaVersion, ZK682_DESKTOP_PERSISTENCE_SCHEMA_VERSION);
  assert.equal(report.phase, phase);
  assert.equal(report.packaged, true);
  assert.equal(report.userDataPath, userDataPath);
  assert.deepEqual(report.security, {
    contextIsolation: true,
    sandbox: true,
    nodeIntegrationDisabled: true,
    webSecurity: true,
    preload: true,
  });
  assert.equal(report.renderer.schemaVersion, ZK682_DESKTOP_PERSISTENCE_SCHEMA_VERSION);
  assert.equal(report.renderer.phase, phase);
  assert.equal(report.renderer.nativePlatform, true);
  assert.equal(report.renderer.platformKind, "desktop");
  assert.equal(report.renderer.safeMode, false);
  assert.equal(report.renderer.saveSchemaVersion, ZK682_CURRENT_SAVE_SCHEMA_VERSION);
  assert.equal(report.renderer.canonicalEqual, true);
  assert.equal(report.renderer.sourceCanonicalHash, report.renderer.loadedCanonicalHash);
  assert.match(report.renderer.sourceCanonicalHash, /^[0-9a-f]{8}$/);
  assert.equal(typeof report.renderer.storageKey, "string");
  assert(report.renderer.storageKey.startsWith("coursecraft_save_zk682-desktop-persistence@"));
  assert(report.renderer.rawPayloadBytes > 0);
}

export function validateZk682DesktopPersistenceSequence({ write, verify, recover, userDataPath }) {
  assertPhaseReport(write, "write", userDataPath);
  assertPhaseReport(verify, "verify", userDataPath);
  assertPhaseReport(recover, "recover", userDataPath);
  const renderers = [write.renderer, verify.renderer, recover.renderer];
  assert.equal(new Set(renderers.map((report) => report.slotId)).size, 1);
  assert.equal(new Set(renderers.map((report) => report.storageKey)).size, 1);
  assert.equal(new Set(renderers.map((report) => report.sourceCanonicalHash)).size, 1);
  assert.equal(new Set(renderers.map((report) => report.loadedCanonicalHash)).size, 1);
  assert.equal(new Set(renderers.map((report) => report.rawPayloadBytes)).size, 1);
  for (const phase of [write, verify]) {
    assert.equal(phase.renderer.recovery?.recovered, false);
    assert.equal(phase.renderer.recovery?.invalid.length, 0);
  }
  assert.equal(recover.renderer.recovery?.recovered, true);
  assert.match(recover.renderer.recovery?.selected ?? "", /\.json\.bak1$/);
  assert(recover.renderer.recovery?.invalid.includes(`${recover.renderer.storageKey}.json`));
  return {
    schemaVersion: ZK682_DESKTOP_PERSISTENCE_SCHEMA_VERSION,
    decision: "PASS",
    saveSchemaVersion: ZK682_CURRENT_SAVE_SCHEMA_VERSION,
    canonicalHash: write.renderer.sourceCanonicalHash,
    slotId: write.renderer.slotId,
    storageKey: write.renderer.storageKey,
    rawPayloadBytes: write.renderer.rawPayloadBytes,
    relaunchVerified: true,
    nativeRecoveryVerified: true,
    security: write.security,
  };
}
