import { describe, expect, it } from "vitest";
import { createScenarioGame, SCENARIOS } from "../game/scenarios/scenarios";
import { saveAvailableInEdition, scenarioAvailableInEdition } from "./edition";

describe("edition boundaries", () => {
  it("limits demo content to the authored opening chapter", () => {
    expect(SCENARIOS.filter((scenario) => scenarioAvailableInEdition(scenario.id, "demo")).map((scenario) => scenario.id))
      .toEqual(["back-nine"]);
    expect(scenarioAvailableInEdition("championship-dream", "full")).toBe(true);
  });

  it("lets full builds load demo saves while demo builds reject full-only saves", () => {
    const opening = createScenarioGame(SCENARIOS[0]);
    const finale = createScenarioGame(SCENARIOS[5]);
    expect(saveAvailableInEdition(opening, "demo")).toBe(true);
    expect(saveAvailableInEdition(opening, "full")).toBe(true);
    expect(saveAvailableInEdition(finale, "demo")).toBe(false);
    expect(saveAvailableInEdition(finale, "full")).toBe(true);
  });
});
