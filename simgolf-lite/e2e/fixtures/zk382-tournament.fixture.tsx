import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TournamentPanel } from "../../src/ui/TournamentPanel";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createTournamentStandardsCourse } from "../../src/game/testing/referenceCourse";
import { evaluateTournamentEligibility } from "../../src/game/tournaments/eligibility";
import { TOURNAMENT_TIERS } from "../../src/game/tournaments/tournaments";
import type { TournamentEvent, TournamentStanding, TournamentTier } from "../../src/game/tournaments/types";
import type { World } from "../../src/game/models/types";
import { I18nContext } from "../../src/i18n/context";
import { loadLocale, setActiveLocale, translate } from "../../src/i18n/core";
import "../../src/index.css";
const locale = loadLocale(); setActiveLocale(locale); document.documentElement.dataset.locale = locale;
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "history";
const baseCourse = createTournamentStandardsCourse();
// Extend only the first championship tee two tiles so the actual helper qualifies every tier.
const course = { ...baseCourse, holes: baseCourse.holes.map((hole, index) => {
  if (index !== 0) return hole;
  const tee = hole.teeBoxes!.championship!;
  const direction = hole.green!.x > hole.tee!.x ? 1 : -1;
  return { ...hole, teeBoxes: { ...hole.teeBoxes, championship: { ...tee, x: tee.x - direction * 2 } } };
}) };
const rows: TournamentStanding[] = [
  { entrantId: "winner", golferId: null, name: "Alexandra Isabella Montgomery-Wellington of the Riverside Golf Club", archetype: "casual", holesCompleted: 18, score: 68, scoreToPar: -4, finished: true },
  { entrantId: "even", golferId: null, name: "Christopher Jonathan Beaumont with a complete authored entrant name", archetype: "casual", holesCompleted: 8, score: 32, scoreToPar: 0, finished: false },
  { entrantId: "over", golferId: null, name: "María Elena Rodríguez-Sánchez", archetype: "casual", holesCompleted: 11, score: 47, scoreToPar: 3, finished: false },
];
const event = (id: string, status: TournamentEvent["status"], day = 0): TournamentEvent => ({ id, name: `${id} tournament with a complete descriptive event name`, tier: "local", scheduledWeek: 12, scheduledDay: day, status, bookingCost: 1500, revenueAward: 6000, reputationAward: 2, field: [], teeSet: "member", pinRotation: "B", results: rows, winnerName: rows[0].name, warning: status === "scheduled" ? "A prescribed setup warning" : undefined, cancellationReason: "The prescribed setup was invalidated", depositForfeited: status === "cancelled" });
const events: TournamentEvent[] = scenario === "history" || scenario === "live" ? [event("upcoming-later", "scheduled", 5), event("upcoming-earlier", "scheduled", 3), ...Array.from({ length: 6 }, (_, n) => event(`completed-${n}`, "completed")), ...Array.from({ length: 5 }, (_, n) => event(`cancelled-${n}`, "cancelled"))] : [];
const world: World = { ...DEFAULT_WORLD, week: 12, cash: scenario === "ineligible" ? 0 : 100000, reputation: scenario === "ineligible" ? 0 : 80, experienceProfile: (params.get("profile") ?? "classic") as World["experienceProfile"], tournaments: { version: 2, events } };
const eligibility = (tier: TournamentTier, daysAhead: number) => evaluateTournamentEligibility({ course, world, tier, currentDay: 0, daysAhead, minReputation: TOURNAMENT_TIERS[tier].minReputation, bookingCost: TOURNAMENT_TIERS[tier].bookingCost });
const qualification = eligibility("local", 1);
for (const item of events) item.currentQualification = { ...qualification, requirements: qualification.requirements.map((r) => r.id === "route" ? { ...r, passed: false, current: "member / Pin B is invalid" } : r) };
Object.assign(window, { tournamentFixture: { course, world, rows }, tournamentEligibility: eligibility, tournamentCalls: [] });
export function Fixture() {
  const [open, setOpen] = useState(true); const [closeCount, setCloseCount] = useState(0); const [operationsFocus, setOperationsFocus] = useState<{ system: "tournaments"; nonce: number }>();
  return <I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, args) => translate(locale, key, args) }}>
    <button data-testid="outside-before" onClick={() => setOpen(true)}>Open tournaments</button>
    <button data-testid="operations-focus" onClick={() => setOperationsFocus({ system: "tournaments", nonce: Date.now() })}>Focus operations</button>
    <output data-testid="close-count">{closeCount}</output>
    {open && <TournamentPanel course={course} world={world} currentDay={0} operationsFocus={operationsFocus} liveTournament={scenario === "live" ? { eventId: "live", name: "Live club tournament", tier: "local", teeSet: "member", pinRotation: "B", standings: rows } : null} onSchedule={async (tier, daysAhead) => {
      (window as unknown as { tournamentCalls: unknown[] }).tournamentCalls.push({ tier, daysAhead });
      await new Promise((resolve) => setTimeout(resolve, 30)); return params.get("failure") ? "Returned booking failure" : null;
    }} onClose={() => { setOpen(false); setCloseCount((n) => n + 1); }} />}
    <button data-testid="outside-after">Outside focus destination</button>
  </I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
