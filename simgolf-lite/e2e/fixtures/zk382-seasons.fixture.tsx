import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SeasonsLegacyPanel } from "../../src/ui/SeasonsLegacyPanel";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createSystemControlState } from "../../src/game/experience/systemControl";
import { seasonalState, previewSeasonCommand, activeWeather, biomeClimatePhenologyForDay } from "../../src/game/seasons/seasons";
import { advanceSurfaceCareDay } from "../../src/game/conditions/surfaceCare";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import type { ExperienceProfile } from "../../src/game/models/types";
import "../../src/index.css";
const params = new URLSearchParams(location.search);
const profile = (params.get("profile") ?? "simulation") as ExperienceProfile;
const variant = params.get("state");
let course = structuredClone(DEFAULT_COURSE);
const world = structuredClone(DEFAULT_WORLD);
world.cash = variant === "poor" ? 0 : 500000;
world.week = 35;
world.experienceProfile = profile;
world.systemControl = createSystemControlState(profile);
if (variant === "override") world.systemControl.overrides.drainage = "manual";
if (profile === "relaxed") world.systemControl.recovery = {
  version: 1, outstandingAdvance: 1200, totalRelief: 1200, totalRepaid: 0,
  lastSettled: { liveAbsoluteDay: 251, weeklyWeek: 35 },
  receipts: Array.from({ length: 12 }, (_, i) => ({ id: `receipt-${i}`, source: "live-day", week: 35, day: i % 7, economicPressure: "balanced", cashBefore: -100, cashAfterSettlement: -100, relief: 100, repayment: 0, cashAfter: 0, outstandingAdvance: (i + 1) * 100, reasons: ["poor-turf"], automatedDomains: ["localized-turf"] })),
};
course.layouts![0].name = "An authored course with a long descriptive name that remains readable";
course.layouts!.push({ ...structuredClone(course.layouts![0]), id: "course-closed", name: "Closed authored course", state: "closed" });
for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) course.tiles[y * course.width + x] = "green";
for (let y = 8; y < 11; y++) for (let x = 8; x < 11; x++) course.tiles[y * course.width + x] = "fairway";
course = advanceSurfaceCareDay({ course, world, absoluteDay: 0, weather: activeWeather(world, course, 3), climate: biomeClimatePhenologyForDay("parkland", 0), turfPriority: "playability", waterPolicy: "balanced", drainageLevel: 0, rounds: 0 }).course;
course = { ...course, surfaceCare: { ...course.surfaceCare!, records: Object.fromEntries(Object.entries(course.surfaceCare!.records).map(([key, record], index) => [key, {
  ...record, turfHealth: .1, repairRequired: true, failureDurationDays: 8,
  ...(index === 0 && variant === "repair" ? { repair: { kind: "resod" as const, cost: 1000, requiredDays: 8, progressDays: 1.5, startedAbsoluteDay: 230, elevatedWaterDaysRemaining: 7 } } : {}),
}])) } };
world.seasonal = seasonalState(world, course, 3);
if (variant !== "empty") {
  world.seasonal.yearbooks = [1, 2].map(year => ({ id: `yearbook-authored-${year}`, year, charter: "public-gem", generatedAbsoluteDay: year * 224, cash: 123456, reputation: 45.6, courseCondition: .8, completedRounds: 1234, playerProRounds: 0, tournamentChampions: [], notablePeople: [], constructionCount: 0, incidentCount: 0, storyCount: 0, awards: [{ id: `award-${year}`, title: "An authored annual award", recipient: "Authored recipient", fact: "Authored award fact remains fully readable" }], rankings: [{ rank: 1, clubId: "club-authored", clubName: "Authored club name", score: 1234, player: true }], dismissed: year === 1, rewardSettled: true }));
  world.seasonal.timeline = Array.from({ length: 35 }, (_, i) => ({ id: `entry-${i}`, absoluteDay: i, year: 1, kind: "course", title: `Authored timeline title ${i}`, detail: "Authored detail " + "word ".repeat(12) }));
}
const initial = JSON.stringify({ course, world });
export function Fixture() {
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<unknown[]>([]);
  const [focus, setFocus] = useState<{ system: "drainage"; nonce: number } | undefined>(params.has("focus") ? { system: "drainage", nonce: 73 } : undefined);
  const record = (value: unknown) => setLog(items => [...items, value]);
  return <I18nProvider><button data-testid="opener" onClick={() => setOpen(true)}>Open seasons</button><button data-testid="outside">Outside control</button>
    <output hidden data-testid="log">{JSON.stringify(log)}</output><output hidden data-testid="immutable">{String(initial === JSON.stringify({ course, world }))}</output>
    <output hidden data-testid="absolute-day">{world.seasonal!.calendar.absoluteDay}</output><output hidden data-testid="repair-key">{Object.keys(course.surfaceCare!.records)[0]}</output>
    {open && <SeasonsLegacyPanel course={course} world={world} day={3} operationsFocus={focus} onOperationsFocusHandled={nonce => { record({ type: "handled", nonce }); setFocus(undefined); }} onCommand={command => { record(command); return { ok: true, course, world, message: "Recorded fixture command", preview: previewSeasonCommand(course, world, command) }; }} onSurfaceRepair={(key, kind, absoluteDay) => record({ type: "repair", key, kind, absoluteDay })} onNavigateSystem={system => record({ type: "navigate", system })} onClose={() => { record({ type: "close" }); setOpen(false); }} />}
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
