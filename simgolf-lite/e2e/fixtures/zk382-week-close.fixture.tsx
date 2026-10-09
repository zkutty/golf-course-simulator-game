import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WeekCloseReport } from "../../src/ui/WeekCloseReport";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createSystemControlState } from "../../src/game/experience/systemControl";
import { recordM49Observations } from "../../src/game/m49/history";
import { buildM49CourseReport } from "../../src/game/m49/report";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { biomeUiTheme } from "../../src/ui/biomeUiTheme";
import type { ExperienceProfile, WeekResult } from "../../src/game/models/types";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
if (params.has("theme")) await import("../../src/ui/cozyLayout.css");
const biomeContext = params.has("theme") ? biomeUiTheme(params.get("theme"), { season: "spring", weather: "rain" }) : undefined;
const state = params.get("state") ?? "observed";
const profile = (params.get("profile") ?? "simulation") as ExperienceProfile;
const course = structuredClone(DEFAULT_COURSE);
course.condition = state === "empty" ? 0 : .34;
course.baseGreenFee = state === "empty" ? 999999 : 65;
course.layouts![0].greenFee = course.baseGreenFee;
let world = structuredClone(DEFAULT_WORLD);
world.experienceProfile = profile;
world.systemControl = createSystemControlState(profile);
if (params.has("override")) world.systemControl.overrides.drainage = "manual";
const longCause = "Authored course evidence with complete descriptive words that remain available when the report is enlarged";
if (state === "observed" || state === "review" || state === "one") world = recordM49Observations(world, (state === "one" ? [1] : [1, 2]).map(index => ({
  version: 1, id: `weekly-observation-${index}`, courseId: "course-primary", segment: "casual", completed: true,
  holesPlayed: 9, holesTotal: 9, expectedScore: 36, actualScore: 45, satisfaction: 38, condition: .34,
  greenFee: 65, strategicFit: .78, valueReceived: .28, willingnessToPay: 74, priceElasticity: 1.1,
  returnIntent: false, recommend: false, churnRisk: .8, paceDelayMinutes: 20, hospitalityDelayMinutes: 0,
  holeEvidence: [{ holeId: "hole-1", expectedScore: 4, actualScore: 8, satisfaction: 38, outcome: "frustrated", causes: [longCause, "pace:delay"] }], causes: [longCause, "pace:delay"],
})), 17);
const result: WeekResult = {
  visitors: state === "empty" ? 0 : 1234, revenue: 123456, costs: 65432, profit: state === "review" ? -58024 : 58024,
  avgSatisfaction: 78.6, reputationDelta: -2, visitorNoise: 0,
  ...(state === "basic" || state === "empty" ? {} : {
    revenueBreakdown: { greenFees: state === "review" ? 99999 : 100000, concessions: 21000, property: 2456, propertyVisitors: 37, byConcession: {}, transactions: [] },
    biomeEconomy: { biome: "parkland", maintainedAreaUnits: 100, plantingWaterUnits: 2, seasonalDemandMultiplier: 1, weatherDemandMultiplier: 1, policyMultiplier: 1, waterCost: 123, plantCareCost: 234, drainageCareCost: 345, total: 702, days: 7 },
    weatherSummary: { playableDays: 4, rainDays: 2, severeDays: 1, averageDemandMultiplier: 1, averageTurfWearMultiplier: 1, kinds: [] },
  }),
  maintenance: { required: 4200, budget: 1200, shortfall: 3000 },
};
const initial = JSON.stringify({ course, world, result });
export function Fixture() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<unknown[]>([]);
  return <I18nProvider><main className="cc-main" inert={params.has("inert")} aria-hidden={params.has("hidden") ? "false" : undefined}>
    <button data-testid="opener" onClick={() => setOpen(true)}>Open weekly report</button><button data-testid="outside">Outside control</button><button disabled>Disabled control</button>
  </main><output hidden data-testid="log">{JSON.stringify(log)}</output><output hidden data-testid="immutable">{String(initial === JSON.stringify({ course, world, result }))}</output>
    <output hidden data-testid="management">{JSON.stringify(buildM49CourseReport({ course, world, result, generatedAtWeek: 17 }))}</output>
    {open && <WeekCloseReport week={17} result={result} resumeSpeed="4x" biomeContext={biomeContext} {...(state === "basic" ? {} : { course, world })} onContinue={() => { setLog(items => [...items, { type: "continue", resumeSpeed: "4x" }]); setOpen(false); }} />}
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
