import { describe, expect, it } from "vitest";
import { createNewGame } from "../gen/newGame";
import { createObjectiveState } from "../models/objectives";
import { buildPackageTestRun, validateCoursePlayability, validateScenarioAuthoring } from "./authoring";
import { FOUNDER_CHALLENGES, SCENARIO_GOAL_TEMPLATES, supportedGoalTemplate } from "./templates";
import { createCoursePackage } from "../contentPackages/packageFormat";

describe("M43 scenario authoring vocabulary", () => {
  it("covers every charter in every biome with deterministic optional paths", () => {
    expect(SCENARIO_GOAL_TEMPLATES).toHaveLength(12);
    expect(new Set(SCENARIO_GOAL_TEMPLATES.map((template) => template.id)).size).toBe(12);
    expect(new Set(SCENARIO_GOAL_TEMPLATES.map((template) => template.charter)).size).toBe(4);
    expect(new Set(SCENARIO_GOAL_TEMPLATES.map((template) => template.theme)).size).toBe(3);
    for (const template of SCENARIO_GOAL_TEMPLATES) expect(template.goals.every((goal) => goal.conditions.length > 0)).toBe(true);
    expect(FOUNDER_CHALLENGES).toHaveLength(4);
    expect(supportedGoalTemplate("legacy-goals")?.goals.length).toBe(3);
  });

  it("accepts supported goals/events and rejects actions, unknown templates, and invalid constraints", () => {
    const valid = validateScenarioAuthoring({
      difficulty: "normal",
      goals: [SCENARIO_GOAL_TEMPLATES[0].goals[0]],
      goalTemplateIds: [SCENARIO_GOAL_TEMPLATES[0].id],
      allowedEventIds: FOUNDER_CHALLENGES[0].allowedEventIds,
      constraints: { noLoans: true },
    });
    expect(valid).toEqual({ valid: true, blockers: [] });
    const invalid = validateScenarioAuthoring({
      difficulty: "normal",
      goals: [{ id: "unsafe-goal", label: "Bad", conditions: [{ metric: "cash", comparator: ">=", target: 1 }], action: { type: "RESET" } } as never],
      goalTemplateIds: ["not-supported"],
      allowedEventIds: ["not-an-event"],
      constraints: { noLoans: "yes" } as never,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.blockers.join(" ")).toContain("unsupported field action");
    expect(invalid.blockers.join(" ")).toContain("unsupported goal template");
    expect(invalid.blockers.join(" ")).toContain("unsupported event ID");
  });

  it("reports exact routing blockers and builds an isolated challenge world", async () => {
    const base = createNewGame({ mode: "sandbox", courseName: "Authoring", seed: 123, theme: "parkland", difficulty: "normal" });
    const report = validateCoursePlayability({ ...base.course, holes: [{ ...base.course.holes[0] }] });
    expect(report.valid).toBe(false);
    expect(report.blockers.some((blocker) => blocker.includes("exactly 9 or 18"))).toBe(true);
    const packageValue = await createCoursePackage({
      course: base.course,
      title: "Isolated challenge",
      description: "test",
      author: { id: "author-test", displayName: "Author" },
      requiredGameVersion: "1.0.0",
      challenge: { difficulty: "hard", startingCash: 1234, goals: [{ id: "cash-goal", label: "Cash", conditions: [{ metric: "cash", comparator: ">=", target: 1000 }] }], allowedEventIds: [] },
    });
    const run = buildPackageTestRun(packageValue, base.world, "test-instance");
    expect(packageValue.manifest.kind).toBe("challenge");
    expect(packageValue.manifest.biomeCompatibility).toEqual(
      packageValue.payload.course.biomeCompatibility,
    );
    expect(run.course.holes).not.toBe(packageValue.payload.course.holes);
    expect(run.world).not.toBe(base.world);
    expect(run.world.cash).toBe(1234);
    expect(run.world.objectives).toEqual(createObjectiveState(packageValue.payload.challenge!.goals));
    expect(base.world.objectives).toBeNull();
  });
});
