import assert from "node:assert/strict";
import test from "node:test";
import {
  desktopPersistenceCertificationLoadOptions,
  desktopPersistenceSecurityEvidence,
  parseDesktopPersistenceCertificationArgs,
  parseDesktopPersistenceUserDataArgs,
} from "./persistenceCertification.mjs";

test("certification mode is absent during normal launches and accepts only one known phase", () => {
  assert.equal(parseDesktopPersistenceCertificationArgs(["CourseCraft"]), null);
  assert.equal(parseDesktopPersistenceCertificationArgs(["CourseCraft", "--zk682-desktop-persistence-cert=write"]), "write");
  assert.throws(() => parseDesktopPersistenceCertificationArgs(["--zk682-desktop-persistence-cert=unknown"]));
  assert.throws(() => parseDesktopPersistenceCertificationArgs([
    "--zk682-desktop-persistence-cert=write",
    "--zk682-desktop-persistence-cert=verify",
  ]));
  assert.deepEqual(desktopPersistenceCertificationLoadOptions("recover"), {
    query: { fixture: "zk682-desktop-persistence", phase: "recover" },
  });
  assert.equal(parseDesktopPersistenceUserDataArgs([], null), null);
  assert.equal(
    parseDesktopPersistenceUserDataArgs(["--zk682-desktop-persistence-user-data=/tmp/zk682"], "write"),
    "/tmp/zk682",
  );
  assert.throws(() => parseDesktopPersistenceUserDataArgs(["--zk682-desktop-persistence-user-data=relative"], "write"));
  assert.throws(() => parseDesktopPersistenceUserDataArgs(["--zk682-desktop-persistence-user-data=/tmp/zk682"], null));
});

test("certification refuses weakened BrowserWindow security or a substituted preload", () => {
  const preload = "/app/desktop/preload.cjs";
  const secure = { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true };
  assert.deepEqual(desktopPersistenceSecurityEvidence(secure, preload, preload), {
    contextIsolation: true,
    sandbox: true,
    nodeIntegrationDisabled: true,
    webSecurity: true,
    preload: true,
  });
  for (const key of ["contextIsolation", "sandbox", "webSecurity"]) {
    assert.throws(() => desktopPersistenceSecurityEvidence({ ...secure, [key]: false }, preload, preload));
  }
  assert.throws(() => desktopPersistenceSecurityEvidence({ ...secure, nodeIntegration: true }, preload, preload));
  assert.throws(() => desktopPersistenceSecurityEvidence(secure, "/other/preload.cjs", preload));
});
