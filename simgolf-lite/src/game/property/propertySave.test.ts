import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { emptyPropertyEnterprise, normalizePropertyEnterprise } from "./property";
import type { PropertyCustomer } from "./types";

describe("property save migration and bounds", () => {
  it("migrates pre-M31 buildings to stable IDs and supplies equivalent starter access", () => {
    const { property: _property, ...legacyCourse } = DEFAULT_COURSE;
    const result = normalizeLoadedSaveResult({
      schemaVersion: 11,
      savedAt: 1,
      course: { ...legacyCourse, buildings: [{ type: "snack_bar", x: 20, y: 20, tier: 1, price: 9 }] },
      world: { ...DEFAULT_WORLD, enterprise: undefined },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(11);
    expect(result.payload.course.buildings[0].id).toBe("building-snack_bar-20-20");
    expect(result.payload.course.property?.assets.map((asset) => asset.kind)).toEqual(["road", "parking"]);
    expect(result.payload.world.cash).toBe(DEFAULT_WORLD.cash);
  });

  it("keeps members first while deterministically bounding and sanitizing customer profiles", () => {
    const customers: PropertyCustomer[] = Array.from({ length: 320 }, (_, index) => ({
      id: `oversized-${index}`,
      name: `Customer ${index}`,
      segment: "local",
      skill: index === 0 ? 900 : index % 100,
      loyalty: index === 1 ? -40 : index % 100,
      visits: index,
      totalSpend: index * 10,
      member: index >= 300,
      lastVisitWeek: index,
    }));
    const normalized = normalizePropertyEnterprise({ ...emptyPropertyEnterprise(), customers });
    expect(normalized.customers).toHaveLength(256);
    expect(normalized.customers.slice(0, 20).every((customer) => customer.member)).toBe(true);
    expect(normalized.customers.every((customer) => customer.skill >= 0 && customer.skill <= 100 && customer.loyalty >= 0 && customer.loyalty <= 100)).toBe(true);
    expect(normalized.customers.map((customer) => customer.id)).toEqual(normalizePropertyEnterprise({ ...emptyPropertyEnterprise(), customers }).customers.map((customer) => customer.id));
  });
});
