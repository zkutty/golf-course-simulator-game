import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { WeekResult } from "../game/models/types";
import { recordM49Observations } from "../game/m49/history";
import { buildM49CourseReport } from "../game/m49/report";
import { formatCurrency } from "../i18n/format";
import { setActiveLocale, translateCurrent } from "../i18n/core";
import { buildWeekCloseManagement } from "./WeekCloseManagement";

const result: WeekResult = {
  visitors: 1234, revenue: 123456, costs: 65432, profit: 58024, avgSatisfaction: 78.6, reputationDelta: -2, visitorNoise: 0,
  revenueBreakdown: { greenFees: 100000, concessions: 21000, property: 2456, propertyVisitors: 37, byConcession: {}, transactions: [] },
  maintenance: { required: 4200, budget: 1200, shortfall: 3000 },
};
afterEach(() => setActiveLocale("en"));
const encoded = (value: string) => renderToStaticMarkup(<>{value}</>);

describe("deferred weekly management evidence", () => {
  it.each([{ locale: "en", rounds: 1 }, { locale: "en", rounds: 2 }, { locale: "pseudo", rounds: 1 }, { locale: "pseudo", rounds: 2 }] as const)("preserves report data, formatting and section order in $locale with $rounds observed rounds", ({ locale, rounds }) => {
    setActiveLocale(locale);
    const course = structuredClone(DEFAULT_COURSE); course.condition = .34; course.baseGreenFee = 65;
    const world = recordM49Observations(structuredClone(DEFAULT_WORLD), Array.from({ length: rounds }, (_, index) => ({
      version: 1 as const, id: `weekly-observation-${index}`, courseId: "course-primary", segment: "casual" as const, completed: true,
      holesPlayed: 9, holesTotal: 9, expectedScore: 36, actualScore: 45, satisfaction: 38, condition: .34,
      greenFee: 65, strategicFit: .78, valueReceived: .28, willingnessToPay: 74, priceElasticity: 1.1,
      returnIntent: false, recommend: false, churnRisk: .8, paceDelayMinutes: 20, hospitalityDelayMinutes: 0,
      holeEvidence: [], causes: ["pace:delay"],
    })), 17);
    const input = { course, world, result, week: 17 }; const immutable = JSON.stringify(input);
    const report = buildM49CourseReport({ course, world, result, generatedAtWeek: 17 });
    const parts = buildWeekCloseManagement(input);
    const html = renderToStaticMarkup(<>{parts.beforeAudience}<div className="cc-week-close-audiences">{parts.audience}</div>{parts.afterAudience}</>);
    expect(report.observedRounds).toBe(rounds);
    expect(html).toContain(encoded(translateCurrent(rounds === 1 ? "weekClose.managementIntroObservedOne" : "weekClose.managementIntroObserved", { headline: report.headline, rounds: report.observedRounds })));
    expect(html.indexOf("cc-week-close-management-intro")).toBeLessThan(html.indexOf("cc-week-close-audiences"));
    expect(html.indexOf("cc-week-close-audiences")).toBeLessThan(html.indexOf("cc-week-close-condition"));
    expect((html.match(/<th scope="row">/g) ?? []).length).toBe(Object.values(report.demand.segments).length);
    for (const segment of Object.values(report.demand.segments)) {
      expect(html).toContain(`${Math.round(segment.bookingAppeal * 100)}%`);
      expect(html).toContain(formatCurrency(segment.willingnessToPay));
      expect(html).toContain(encoded(segment.evidenceLabel));
    }
    expect(html).toContain(encoded(translateCurrent("weekClose.managementLedgerReconciled")));
    expect(JSON.stringify(input)).toBe(immutable);
  });

  it("keeps empty/predicted and unreconciled evidence truthful", () => {
    const course = structuredClone(DEFAULT_COURSE); course.condition = 0; course.baseGreenFee = 999999; course.layouts![0].greenFee = 999999;
    const world = structuredClone(DEFAULT_WORLD); const unbalanced = { ...result, revenue: 123457 };
    const parts = buildWeekCloseManagement({ course, world, result: unbalanced, week: 17 });
    const html = renderToStaticMarkup(<>{parts.beforeAudience}{parts.audience}{parts.afterAudience}</>);
    const report = buildM49CourseReport({ course, world, result: unbalanced, generatedAtWeek: 17 });
    expect(html).toContain(encoded(translateCurrent("weekClose.managementIntroPredicted", { headline: report.headline })));
    expect(html).toContain(encoded(translateCurrent("weekClose.managementLedgerReview")));
    expect(report.demand.supportedSegments).toEqual([]);
    expect(html).toContain(encoded(translateCurrent("weekClose.managementNoFit")));
  });
});
