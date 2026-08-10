import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADVANCED_SYSTEM_IDS } from "../experience/systemControl";
import {
  ZK813_CERTIFICATION_ID,
  runZK813ProfileCertification,
} from "./zk813ProfileCertification";

const RELAXED_HIDDEN = new Set(["localized-turf", "irrigation", "drainage", "resort", "mobility"]);
const CLASSIC_HIDDEN = new Set(["localized-turf", "irrigation", "drainage", "pace", "mobility", "community"]);

function expectedPolicy(profile: "relaxed" | "classic" | "simulation") {
  return ADVANCED_SYSTEM_IDS.map((id) => [
    id,
    profile === "simulation"
      ? "full"
      : (profile === "relaxed" ? RELAXED_HIDDEN : CLASSIC_HIDDEN).has(id)
        ? "hidden"
        : "summary",
    profile === "simulation" ? "manual" : "automated",
  ]);
}

const EXPECTED_RECEIPTS = [
  { chapterId: "back-nine", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "back-nine-discover", sceneId: "back-nine-discover-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "muni-rescue", profile: "relaxed", pressure: "friendly", receiptCount: 1, phaseId: "muni-stabilize", sceneId: "muni-stabilize-intro", choiceId: "open", baselineKind: "player-pro-round" },
  { chapterId: "swamp-deal", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "swamp-survey", sceneId: "swamp-survey-intro", choiceId: "invest", baselineKind: "architecture-evidence" },
  { chapterId: "links-by-the-sea", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "links-read", sceneId: "links-read-intro", choiceId: "listen", baselineKind: "architecture-evidence" },
  { chapterId: "members-club", profile: "classic", pressure: "balanced", receiptCount: 1, phaseId: "members-listen", sceneId: "members-listen-intro", choiceId: "listen", baselineKind: "player-pro-round" },
  { chapterId: "championship-dream", profile: "simulation", pressure: "balanced", receiptCount: 1, phaseId: "championship-qualify", sceneId: "championship-qualify-intro", choiceId: "open", baselineKind: "player-pro-round" },
];

describe("ZK-813 headless profile certification", () => {
  it("certifies the nine fresh-start axes, normalization carriers, authority, campaign receipts, and replay", { timeout: 120_000 }, () => {
    const report = runZK813ProfileCertification();
    expect(report.certificationId).toBe(ZK813_CERTIFICATION_ID);
    expect(report.checks.filter((entry) => !entry.passed), JSON.stringify(report.checks)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.rows).toHaveLength(9);
    expect(report.rows.map((row) => `${row.profile}:${row.pressure}`)).toEqual([
      "relaxed:friendly", "relaxed:balanced", "relaxed:tight",
      "classic:friendly", "classic:balanced", "classic:tight",
      "simulation:friendly", "simulation:balanced", "simulation:tight",
    ]);
    for (const row of report.rows) {
      expect(row.legacyProfile).toBe(row.profile);
      expect(row.legacyPressure).toBe(row.pressure);
      expect(row.currentPolicy).toEqual(expectedPolicy(row.profile));
      expect(row.legacyPolicy).toEqual(expectedPolicy(row.profile));
      expect(row.graduationTransitions).toEqual(row.profile === "relaxed"
        ? [
            { from: "relaxed", to: "classic", week: 1 },
            { from: "classic", to: "simulation", week: 1 },
          ]
        : row.profile === "classic"
          ? [{ from: "classic", to: "simulation", week: 1 }]
          : []);
    }
    expect(report.campaign).toMatchObject({ chapterCount: 6, phaseEvidenceCount: 18, serializedReceipts: 6 });
    expect(report.campaign.receipts).toEqual(EXPECTED_RECEIPTS);
    expect(report.longSession).toMatchObject({ days: 8, courses: expect.any(Number), weatherKinds: expect.any(Number) });
    expect(report.determinismHash).toBe("c8da3467");
    expect(report.rows.every((row) => row.graduationHash.match(/^[0-9a-f]{8}$/))).toBe(true);
    expect(report.headlessGaps).toHaveLength(2);
    expect(report.headlessGaps.join(" ")).toContain("real Player Pro");
    if (process.env.M65_HEADLESS_RESULT_PATH) {
      writeFileSync(process.env.M65_HEADLESS_RESULT_PATH, `${JSON.stringify(report)}\n`);
    }
  });
});
