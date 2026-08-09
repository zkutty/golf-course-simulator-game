import { describe, expect, it } from "vitest";
import { formatStaffShiftMinute, liveOverviewTabs, staffShiftInputMinute, staffShiftInputValue } from "./liveOverviewPresentation";

describe("Classic management live overview access", () => {
  it("keeps Relaxed summary pace reachable without exposing mobility", () => {
    expect(liveOverviewTabs({ pace: "summary", mobility: "hidden" })).toEqual([
      "golfers",
      "leaderboard",
      "staff",
      "pace",
    ]);
  });

  it("keeps Classic default detail hidden and decouples pace and mobility claims", () => {
    expect(liveOverviewTabs({ pace: "hidden", mobility: "hidden" })).toEqual([
      "golfers",
      "leaderboard",
      "staff",
    ]);
    expect(liveOverviewTabs({ pace: "full", mobility: "hidden" })).toContain("pace");
    expect(liveOverviewTabs({ pace: "full", mobility: "hidden" })).not.toContain("mobility");
    expect(liveOverviewTabs({ pace: "hidden", mobility: "full" })).toContain("mobility");
    expect(liveOverviewTabs({ pace: "hidden", mobility: "full" })).not.toContain("pace");
  });

  it("formats the authoritative roster minute fields for read-only shift evidence", () => {
    expect(formatStaffShiftMinute(0)).toBe("6:00 AM");
    expect(formatStaffShiftMinute(150)).toBe("8:30 AM");
    expect(formatStaffShiftMinute(840)).toBe("8:00 PM");
  });

  it("round-trips bounded staff shift form values without inventing overnight semantics", () => {
    expect(staffShiftInputValue(150)).toBe("08:30");
    expect(staffShiftInputMinute("08:30")).toBe(150);
    expect(staffShiftInputMinute("05:45")).toBeNull();
    expect(staffShiftInputMinute("24:00")).toBeNull();
    expect(staffShiftInputMinute("bad")).toBeNull();
  });
});
