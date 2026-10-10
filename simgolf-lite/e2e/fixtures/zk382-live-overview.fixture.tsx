import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { useI18n } from "../../src/i18n/useI18n";
import { LiveOverview } from "../../src/ui/LiveOverview";
import type { LiveStatus } from "../../src/hooks/useLiveSimulation";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { buildMobilityOperationsReports } from "../../src/game/m51/operationsReport";
import { paceReports } from "../../src/game/live/paceHistory";
import { applyAction } from "../../src/core/reducer";
import type { GameState } from "../../src/game/gameState";
import { mobilityRentalPreview } from "../../src/game/m51/rentalBusiness";
import type { SystemControlVisibility } from "../../src/game/experience/systemControl";
import "../../src/index.css";
const name = "Alexandria_Championship_Course_With_A_Long_Authored_Name";
const course = structuredClone(DEFAULT_COURSE), world = structuredClone(DEFAULT_WORLD);
if (new URLSearchParams(location.search).has("fleet")) {
  let state: GameState = { course: { ...course, buildings: [{ id: "rental-exact", type: "cart_rental", x: 3, y: 3, tier: 1, price: 22 }] }, world, selectedTerrain: "fairway", terrainVersion: 0, obstaclesVersion: 0, markersVersion: 0, economyVersion: 0 };
  state = applyAction(state, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "rental-exact", mode: "pushcart", quantity: 2 });
  Object.assign(course, state.course);
}
const reports = paceReports(world, course, 7).map(row => ({ ...row, courseName: name, roundsCompleted: 19, roundsIncomplete: 2, averageDurationMinutes: 234.4, p90DurationMinutes: 276.8 }));
const many = new URLSearchParams(location.search).has("many");
const status: LiveStatus = {
  speed: "paused", dayIndex: 2, dayMinute: 150, clockLabel: "8:30 AM", onCourse: 3, roundsToday: 0, greenFeesToday: 123, concessionsToday: 45, arrivalsRemaining: 38, nextArrivalMinute: 160, lastDay: null, selected: null, tournament: null,
  golfers: Array.from({ length: many ? 30 : 3 }, (_, index) => ({ id: index + 41, personId: `person-${index}`, name: `${name}_${index}`, archetype: "casual", currentHole: index === 0 ? -1 : index + 1, scoreToPar: index - 1, mood: [0.75, 0.5, 0.2][index % 3], courseId: "course-primary", currentHoleId: `hole-${index}` })),
  pace: { courseId: "course-primary", preset: "balanced", teeIntervalMinutes: 10, maxGroupSize: 4, groupsOnCourse: 3, blockedGroups: 1, averageWaitMinutes: 4.4, interventions: 2, pickups: 1, beverageRevenue: 123, alcoholicDrinks: 2, incidents: 1, marshalCoverage: 0.7, beverageCoverage: 0.8, beverageMenu: "refreshments", lastTeeMinute: 600, daylightPolicy: "finish_started", compensationPolicy: "credit", identity: { score: 0.5, label: "balanced", samples: 19, cohorts: { skilled_impatient: 0.25, novice_social: 0.4, general: 0.35 } }, bottlenecks: [], reports7: reports, reports28: reports.map(row => ({ ...row, roundsCompleted: 33 })), overtimeCost: 0, compensationCost: 0, refunds: 0, credits: 0, goodwillVouchers: 0 },
  mobility: buildMobilityOperationsReports({ course, world, week: world.week, dayIndex: 0 }),
};
const original = JSON.stringify({ course, world, status });
type Visibility = { pace: SystemControlVisibility; mobility: SystemControlVisibility; staff: SystemControlVisibility };
type Focus = { system: "staffing" | "pace" | "mobility"; nonce: number };
interface FixtureApi { calls: () => unknown[][]; visibility: (value: Visibility) => void; focus: (system: Focus["system"]) => void; immutable: () => boolean; reserveAll: () => void; poor: () => void; preview: () => ReturnType<typeof mobilityRentalPreview>; locale: (value: "en" | "pseudo") => void; }
declare global { interface Window { __liveOverviewFixture: FixtureApi } }
export function Fixture() {
  const { setLocale } = useI18n();
  const [open, setOpen] = useState(true), [focus, setFocus] = useState<Focus>(), [generation, setGeneration] = useState(0);
  const [visibility, setVisibility] = useState<Visibility>({ pace: "full", mobility: "full", staff: "full" });
  const [reserved, setReserved] = useState<string[]>([]), [cash, setCash] = useState(500000);
  const calls = useRef<unknown[][]>([]), nonce = useRef(0);
  useEffect(() => { window.__liveOverviewFixture = { calls: () => structuredClone(calls.current), visibility: setVisibility, focus: system => { setFocus({ system, nonce: ++nonce.current }); setGeneration(value => value + 1); }, immutable: () => JSON.stringify({ course, world, status }) === original, reserveAll: () => setReserved(Object.keys(course.m51?.fleet ?? {})), poor: () => setCash(0), preview: () => mobilityRentalPreview(course, "rental-exact", "pushcart"), locale: setLocale }; }, [setLocale]);
  return <div style={{ position: "relative", height: "100vh", width: "100%", background: "#e8eadf" }}><button data-testid="outside-before" onClick={() => setOpen(true)}>Outside before</button>{open && <LiveOverview key={generation} course={course} cash={cash} reservedMobilityFleetUnitIds={reserved} status={status} reputation={82} staffLevel={3} staffRoster={[{ id: "staff-exact", name, role: "marshal", weeklyWage: 123, courseId: "course-primary", shiftStart: 0, shiftEnd: 600 }]} courses={[{ id: "course-primary", name }, { id: "course-secondary", name: "Second course" }]} paceVisibility={visibility.pace} mobilityVisibility={visibility.mobility} staffingVisibility={visibility.staff} operationsFocus={focus} onOperationsFocusHandled={value => calls.current.push(["focus", value])} onAssignStaff={(...args) => calls.current.push(["assign", ...args])} onScheduleStaff={(...args) => calls.current.push(["schedule", ...args])} onConfigureMobility={(...args) => calls.current.push(["configure", ...args])} onPurchaseMobility={(...args) => calls.current.push(["purchase", ...args])} onSalvageMobility={(...args) => calls.current.push(["salvage", ...args])} onSelectGolfer={value => calls.current.push(["golfer", value])} onFocusHole={value => calls.current.push(["hole", value])} onSetPacePreset={value => calls.current.push(["preset", value])} onUpdatePaceOperations={value => calls.current.push(["pace", value])} onClose={() => { calls.current.push(["close"]); setOpen(false); }} />}<button data-testid="outside-after" style={{ position: "fixed", bottom: 8, left: 8 }}>Outside after</button></div>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
