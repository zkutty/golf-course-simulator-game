/** New-round shot authority. An absent carrier always means the historical model. */
export interface ShotModelSnapshotV1 {
  version: 1;
  mode: "club_styles_v1";
  calibrationVersion: 1;
}

export function createShotModelSnapshotV1(): ShotModelSnapshotV1 {
  return { version: 1, mode: "club_styles_v1", calibrationVersion: 1 };
}

export function isValidShotModelSnapshot(value: unknown): value is ShotModelSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && v.version === 1
    && v.mode === "club_styles_v1" && v.calibrationVersion === 1;
}

export function usesClubShotModel(value: unknown): value is ShotModelSnapshotV1 {
  return isValidShotModelSnapshot(value);
}
