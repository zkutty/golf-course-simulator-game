import assert from "node:assert/strict";
import test from "node:test";
import { validateZk682DesktopPersistenceSequence } from "./zk682-desktop-persistence-contract.mjs";

const userDataPath = "/tmp/coursecraft-zk682-user-data";
const storageKey = "coursecraft_save_zk682-desktop-persistence@fixture-1";
const phase = (name, recovered = false) => ({
  schemaVersion: 1,
  phase: name,
  packaged: true,
  appVersion: "1.0.0-rc.6",
  userDataPath,
  security: { contextIsolation: true, sandbox: true, nodeIntegrationDisabled: true, webSecurity: true, preload: true },
  renderer: {
    schemaVersion: 1,
    phase: name,
    slotId: "zk682-desktop-persistence",
    storageKey,
    saveSchemaVersion: 31,
    sourceCanonicalHash: "1234abcd",
    loadedCanonicalHash: "1234abcd",
    canonicalEqual: true,
    rawPayloadBytes: 4096,
    nativePlatform: true,
    platformKind: "desktop",
    safeMode: false,
    recovery: recovered
      ? { key: storageKey, selected: `${storageKey}.json.bak1`, recovered: true, invalid: [`${storageKey}.json`] }
      : { key: storageKey, selected: `${storageKey}.json`, recovered: false, invalid: [] },
  },
});

test("accepts exact packaged write, relaunch, and NativeStore backup recovery evidence", () => {
  const result = validateZk682DesktopPersistenceSequence({
    write: phase("write"),
    verify: phase("verify"),
    recover: phase("recover", true),
    userDataPath,
  });
  assert.equal(result.decision, "PASS");
  assert.equal(result.relaunchVerified, true);
  assert.equal(result.nativeRecoveryVerified, true);
  assert.equal(result.saveSchemaVersion, 31);
});

test("rejects non-packaged, weakened, mismatched, stale-schema, or synthetic recovery evidence", () => {
  const base = { write: phase("write"), verify: phase("verify"), recover: phase("recover", true), userDataPath };
  assert.throws(() => validateZk682DesktopPersistenceSequence({ ...base, verify: { ...base.verify, packaged: false } }));
  assert.throws(() => validateZk682DesktopPersistenceSequence({ ...base, verify: { ...base.verify, security: { ...base.verify.security, sandbox: false } } }));
  assert.throws(() => validateZk682DesktopPersistenceSequence({ ...base, verify: { ...base.verify, renderer: { ...base.verify.renderer, loadedCanonicalHash: "ffffffff", canonicalEqual: false } } }));
  assert.throws(() => validateZk682DesktopPersistenceSequence({ ...base, verify: { ...base.verify, renderer: { ...base.verify.renderer, saveSchemaVersion: 30 } } }));
  assert.throws(() => validateZk682DesktopPersistenceSequence({ ...base, recover: phase("recover", false) }));
});
