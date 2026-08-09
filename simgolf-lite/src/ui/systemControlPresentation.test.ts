import { afterEach, describe, expect, it } from "vitest";
import { ADVANCED_SYSTEM_IDS, createSystemControlState, resolveSystemControlPolicy } from "../game/experience/systemControl";
import { setActiveLocale } from "../i18n/core";
import {
  systemControlCommandMessage,
  systemControlDecisionLabel,
  groupSystemControlSurfaces,
  operationsEvidenceLabel,
  operationsSurfaceLabel,
  SYSTEM_OPERATIONS_PRESENTATION,
  systemControlProfileLabel,
  systemControlStatusLabel,
  systemOperationsEffect,
} from "./systemControlPresentation";

afterEach(() => setActiveLocale("en"));

describe("system-control presentation", () => {
  it("maps every stable core id, mode, source, and profile through typed messages", () => {
    const labels = ADVANCED_SYSTEM_IDS.map((id) => systemControlStatusLabel({
      id,
      mode: "manual",
      source: "save-override",
    }));
    expect(labels).toHaveLength(13);
    expect(labels[0]).toBe("Maintenance · manual (save override)");
    expect(labels[1]).toBe("Localized turf · manual (save override)");
    expect(systemControlProfileLabel("simulation")).toBe("Simulation");
  });

  it("partitions Classic strategic summaries from opt-in back-office systems", () => {
    const policy = resolveSystemControlPolicy({
      experienceProfile: "classic",
      systemControl: createSystemControlState("classic"),
    });
    const grouped = groupSystemControlSurfaces(policy.systems);
    expect(grouped.defaultSystems.map((system) => system.id)).toEqual([
      "maintenance", "staffing", "financing", "memberships", "tournaments", "property", "resort",
    ]);
    expect(grouped.backOfficeSystems.map((system) => system.id)).toEqual([
      "localized-turf", "irrigation", "drainage", "pace", "mobility", "community",
    ]);
  });

  it("maps all thirteen domains to one existing specialist surface and truthful evidence classes", () => {
    expect(Object.keys(SYSTEM_OPERATIONS_PRESENTATION)).toEqual([...ADVANCED_SYSTEM_IDS]);
    expect(Object.values(SYSTEM_OPERATIONS_PRESENTATION).every((entry) => entry.evidence.length > 0)).toBe(true);
    expect(SYSTEM_OPERATIONS_PRESENTATION.staffing).toMatchObject({ surface: "staff", evidence: ["forecast", "current"] });
    expect(SYSTEM_OPERATIONS_PRESENTATION.mobility).toMatchObject({ surface: "live", evidence: ["forecast", "current", "settled"] });
    expect(systemOperationsEffect("financing")).toContain("cash");
    expect(operationsEvidenceLabel("forecast")).toBe("Forecast");
    expect(operationsSurfaceLabel("property")).toBe("Property management");
  });

  it("localizes command statuses and compact automation decision evidence", () => {
    expect(systemControlCommandMessage("system-control|take|resort"))
      .toBe("Resort is under direct control.");
    expect(systemControlCommandMessage("system-control|return|maintenance|classic|automated"))
      .toBe("Maintenance returned to the Classic profile (automated).");
    expect(systemControlCommandMessage("system-control|graduate|simulation"))
      .toContain("Simulation");
    expect(systemControlDecisionLabel("system-control|commands|balanced|maintenance,property,resort"))
      .toBe("Balanced profile commands: Maintenance, Property, Resort");
    expect(systemControlDecisionLabel("system-control|operations|7|20|standard|5"))
      .toBe("Hours 7:00–20:00 · standard upkeep · reserve 5%");
    expect(systemControlDecisionLabel("system-control|noop|10"))
      .toBe("10 authoritative systems retained deterministic state (no automatic command).");
  });

  it("participates in pseudo-localization without changing the eager core carrier", () => {
    setActiveLocale("pseudo");
    expect(systemControlStatusLabel({ id: "pace", mode: "automated", source: "profile-default" }))
      .toMatch(/^⟦/);
  });
});
