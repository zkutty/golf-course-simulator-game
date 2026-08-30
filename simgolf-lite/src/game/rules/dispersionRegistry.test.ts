import { describe, expect, it } from "vitest";
import {
  DISPERSION_CLUBS,
  DISPERSION_REGISTRY_VERSION,
  dispersionClub,
  dispersionClubIdForLabel,
} from "./dispersionRegistry";

describe("ZK-772 canonical dispersion registry", () => {
  it("keeps version, IDs, labels, aliases, and order stable", () => {
    expect(DISPERSION_REGISTRY_VERSION).toBe(1);
    expect(DISPERSION_CLUBS.map((club) => [club.id, club.label])).toEqual([
      ["driver", "Driver"], ["three_wood", "3 Wood"], ["five_iron", "5 Iron"], ["seven_iron", "7 Iron"],
      ["pitching_wedge", "Pitching Wedge"], ["sand_wedge", "Sand Wedge"], ["chip", "Chip"], ["putter", "Putter"],
    ]);
    for (const club of DISPERSION_CLUBS) {
      expect(dispersionClub(club.id)).toBe(club);
      expect(dispersionClubIdForLabel(club.label)).toBe(club.id);
    }
  });

  it("retains the current monotonic base carry and dispersion ordering", () => {
    for (let index = 1; index < DISPERSION_CLUBS.length; index++) {
      expect(DISPERSION_CLUBS[index - 1].carryYards).toBeGreaterThan(DISPERSION_CLUBS[index].carryYards);
      expect(DISPERSION_CLUBS[index - 1].dispersionTiles).toBeGreaterThan(DISPERSION_CLUBS[index].dispersionTiles);
    }
  });

  it("preserves exact internal CourseCraft carry and dispersion assumptions", () => {
    expect(DISPERSION_CLUBS.map(({ carryYards, dispersionTiles }) => [carryYards, dispersionTiles])).toEqual([
      [270, 3.7], [235, 3.2], [185, 2.55], [155, 2.1], [115, 1.55], [78, 1.35], [38, .82], [28, .38],
    ]);
  });

  it("rejects unknown and prototype-owned IDs and labels without a fallback", () => {
    for (const id of ["nine_iron", "toString", "__proto__"]) {
      expect(dispersionClub(id)).toBeNull();
    }
    for (const label of ["Nine Iron", "toString", "__proto__"]) {
      expect(dispersionClubIdForLabel(label)).toBeNull();
    }
  });
});
