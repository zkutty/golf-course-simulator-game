import path from "node:path";

export const DESKTOP_PERSISTENCE_CERTIFICATION_FLAG = "--zk682-desktop-persistence-cert=";
export const DESKTOP_PERSISTENCE_USER_DATA_FLAG = "--zk682-desktop-persistence-user-data=";
export const DESKTOP_PERSISTENCE_CERTIFICATION_PHASES = Object.freeze(["write", "verify", "recover"]);

export function parseDesktopPersistenceCertificationArgs(argv) {
  const values = argv
    .filter((value) => value.startsWith(DESKTOP_PERSISTENCE_CERTIFICATION_FLAG))
    .map((value) => value.slice(DESKTOP_PERSISTENCE_CERTIFICATION_FLAG.length));
  if (values.length === 0) return null;
  if (values.length !== 1 || !DESKTOP_PERSISTENCE_CERTIFICATION_PHASES.includes(values[0])) {
    throw new Error("Invalid ZK-682 desktop persistence certification phase.");
  }
  return values[0];
}

export function parseDesktopPersistenceUserDataArgs(argv, certificationPhase) {
  const values = argv
    .filter((value) => value.startsWith(DESKTOP_PERSISTENCE_USER_DATA_FLAG))
    .map((value) => value.slice(DESKTOP_PERSISTENCE_USER_DATA_FLAG.length));
  if (!certificationPhase && values.length === 0) return null;
  if (!certificationPhase || values.length !== 1 || !path.isAbsolute(values[0])) {
    throw new Error("ZK-682 certification requires exactly one absolute temporary user-data path.");
  }
  return path.resolve(values[0]);
}

export function desktopPersistenceCertificationLoadOptions(phase) {
  if (!DESKTOP_PERSISTENCE_CERTIFICATION_PHASES.includes(phase)) {
    throw new Error("Invalid ZK-682 desktop persistence certification phase.");
  }
  return { query: { fixture: "zk682-desktop-persistence", phase } };
}

export function desktopPersistenceSecurityEvidence(webPreferences, configuredPreload, expectedPreload) {
  const evidence = {
    contextIsolation: webPreferences.contextIsolation === true,
    sandbox: webPreferences.sandbox === true,
    nodeIntegrationDisabled: webPreferences.nodeIntegration === false,
    webSecurity: webPreferences.webSecurity === true,
    // Electron 43 deliberately omits `preload` from getLastWebPreferences().
    // Validate the exact constructor value instead; the renderer's native
    // PlatformServices evidence separately proves that this preload executed.
    preload: typeof configuredPreload === "string"
      && path.resolve(configuredPreload) === path.resolve(expectedPreload),
  };
  if (Object.values(evidence).some((value) => value !== true)) {
    throw new Error(`Packaged persistence certification requires production Electron security defaults: ${JSON.stringify(evidence)}`);
  }
  return evidence;
}
