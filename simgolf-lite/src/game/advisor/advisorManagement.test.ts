import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { WeekResult } from "../models/types";
import { advisorMessages } from "./advisor";

describe("ZK-688 advisor management routing", () => {
  it("connects financial and condition warnings to authoritative course-management controls", () => {
    const messages = advisorMessages(
      { ...DEFAULT_COURSE, condition: 0.4 },
      { ...DEFAULT_WORLD, cash: 0, maintenanceBudget: 2_000 },
      undefined,
      undefined,
    );
    expect(messages.find((message) => message.id.startsWith("cash-runway-"))?.managementTarget).toBe("pricing");
    expect(messages.find((message) => message.id.startsWith("condition-"))?.managementTarget).toBe("maintenance");
  });

  it("connects observed turnaways to strategic property and amenity planning", () => {
    const last = { costs: 1_000, turnaways: 14, profit: 100 } as WeekResult;
    const messages = advisorMessages(
      DEFAULT_COURSE,
      { ...DEFAULT_WORLD, cash: 100_000 },
      last,
      { profit: 100 } as WeekResult,
    );
    expect(messages.find((message) => message.id.startsWith("turnaways-"))?.managementTarget).toBe("property");
  });
});
