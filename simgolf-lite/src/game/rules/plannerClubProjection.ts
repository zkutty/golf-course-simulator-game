import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import type { ShotClubId } from "./dispersionRegistry";
import { isProfileCalibrationV1, type ProfileCalibrationV1 } from "./profileCalibration";
import { usesClubShotModel } from "./shotModelSnapshot";

const CLUB_IDS: Readonly<Record<string, ShotClubId>> = Object.freeze({
  Driver: "driver", "3W": "three_wood", "3 Wood": "three_wood", "5I": "five_iron", "5 Iron": "five_iron",
  "7I": "seven_iron", "7 Iron": "seven_iron", PW: "pitching_wedge", "Pitching Wedge": "pitching_wedge",
  SW: "sand_wedge", "Sand Wedge": "sand_wedge", Chip: "chip", Putter: "putter",
});

/** Absent model retains historical planning; present modern facts must validate. */
export function plannerDistanceProfile(snapshot?: Pick<PlayerRoundCourseSnapshot, "shotModel" | "distanceProfile">): ProfileCalibrationV1 | null {
  if (snapshot?.shotModel === undefined) return null;
  if (!usesClubShotModel(snapshot.shotModel) || !isProfileCalibrationV1(snapshot.distanceProfile)) {
    throw new RangeError("Modern planning requires a valid frozen distance profile.");
  }
  return snapshot.distanceProfile;
}

/** Project carry only. Preserve names, dispersion, policy and putting stroke budget. */
export function projectPlannerClubCarries<T extends { name: string; carryYards: number }>(
  distanceProfile: ProfileCalibrationV1,
  clubs: readonly T[],
): T[] {
  if (!isProfileCalibrationV1(distanceProfile)) throw new RangeError("Invalid planner distance profile.");
  return clubs.map((club) => {
    if (!Object.hasOwn(CLUB_IDS, club.name)) throw new RangeError(`Unknown planner club: ${club.name}.`);
    const clubId = CLUB_IDS[club.name];
    return { ...club, carryYards: clubId === "putter" ? club.carryYards : distanceProfile.clubCarryYards[clubId] };
  });
}
