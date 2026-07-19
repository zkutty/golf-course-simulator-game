import { describe, expect, it } from "vitest";
import { loadLocale, translate } from "./core";
import { formatCurrency, formatDayLabel, formatNumber, formatWeekLabel } from "./format";

describe("i18n", () => {
  it("interpolates typed parameters and ICU-style plurals", () => {
    expect(translate("en", "common.golfers", { n: 1 })).toBe("1 golfer");
    expect(translate("en", "common.golfers", { n: 4 })).toBe("4 golfers");
    expect(translate("en", "common.reset", { section: "Audio" })).toBe("Reset Audio");
  });

  it("brackets and expands the pseudo locale", () => {
    expect(translate("pseudo", "common.done")).toMatch(/^⟦Dôñë .+⟧$/);
  });

  it("loads only supported persisted locale values", () => {
    expect(loadLocale({ getItem: () => "pseudo" })).toBe("pseudo");
    expect(loadLocale({ getItem: () => "fr" })).toBe("en");
  });

  it("centralizes stable number, currency, week, and day formatting", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatCurrency(1234.4)).toBe("$1,234");
    expect(formatCurrency(-1234.4)).toBe("-$1,234");
    expect(formatWeekLabel(12)).toBe("Week 12");
    expect(formatDayLabel(3)).toBe("Day 3 / 7");
  });
});
