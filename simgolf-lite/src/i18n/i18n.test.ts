import { describe, expect, it } from "vitest";
import { loadLocale, translate } from "./core";
import { formatCurrency, formatDayLabel, formatNumber, formatWeekLabel } from "./format";
import { registerSetupCatalog } from "./setupCatalog";
import { registerVisionIntroCatalog } from "./visionIntroCatalog";
import { registerPlayerProSocialCatalog } from "./playerProSocialCatalog";

describe("i18n", () => {
  it("interpolates typed parameters and ICU-style plurals", () => {
    expect(translate("en", "common.golfers", { n: 1 })).toBe("1 golfer");
    expect(translate("en", "common.golfers", { n: 4 })).toBe("4 golfers");
    expect(translate("en", "common.reset", { section: "Audio" })).toBe("Reset Audio");
  });

  it("brackets and expands the pseudo locale", () => {
    expect(translate("pseudo", "common.done")).toMatch(/^⟦Dôñë .+⟧$/);
  });

  it("fails safely before setup copy registers, then translates it in both locales", () => {
    expect(translate("en", "newGame.step.mode")).toBe("newGame.step.mode");

    const unregister = registerSetupCatalog();
    expect(translate("en", "newGame.step.mode")).toBe("Choose your game");
    expect(translate("pseudo", "newGame.step.mode")).toMatch(/^⟦Çhôôsë ÿôür gámë .+⟧$/);

    unregister();
    expect(translate("en", "newGame.step.mode")).toBe("newGame.step.mode");
  });

  it("registers copy for an independently deferred route", () => {
    expect(translate("en", "vision.hero.title")).toBe("vision.hero.title");
    const unregister = registerVisionIntroCatalog();
    expect(translate("en", "vision.hero.title")).toBe("Build the course. Shape the world.");
    unregister();
  });

  it("localizes the deferred Player Pro panel catalog in both locales", () => {
    expect(translate("en", "playerPro.social.transfer.default")).toBe("playerPro.social.transfer.default");
    const unregister = registerPlayerProSocialCatalog();
    expect(translate("en", "playerPro.social.people.holdings", { count: 2 })).toBe("Known holdings (2)");
    expect(translate("pseudo", "playerPro.social.transfer.default")).toMatch(/^⟦Tráñs/);
    unregister();
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
