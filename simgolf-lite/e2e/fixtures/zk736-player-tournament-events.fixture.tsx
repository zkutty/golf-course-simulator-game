import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlayerProPanel } from "../../src/ui/PlayerProPanel";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import type { World } from "../../src/game/models/types";
import type { TournamentEvent, TournamentRoundScorecard, TournamentScoringMode, TournamentTemplateId } from "../../src/game/tournaments/types";
import { createDefaultPlayerPro } from "../../src/game/playerPro/playerPro";
import { createTournamentStandardsCourse } from "../../src/game/testing/referenceCourse";
import { createTournamentEvent } from "../../src/game/tournaments/tournamentScheduling";
import { activateTournament, completeTournamentRoundEvidence, scoreTournamentRoundCard } from "../../src/game/tournaments/tournamentLifecycle";
import { normalizeTournamentCalendar, prepareTournamentDay, tournamentCalendar } from "../../src/game/tournaments/tournaments";
import { reconstructIndividualTournamentStandings, type TournamentRankedStanding } from "../../src/game/tournaments/tournamentStandings";
import { reconstructTournamentTeamEvidence } from "../../src/game/tournaments/tournamentTeamRound";
import { reconstructProAmTournamentEvidence, scoreProAmRoundEvidence, type ProAmRoundEvidence } from "../../src/game/tournaments/proAmField";
import { playerProTournamentEntries, playerProTournamentEntryEligibility } from "../../src/game/playerPro/playerProPanelAuthority";
import { startPlayerProTournamentRound } from "../../src/game/competition/equipmentMentor";
import { activeCourseLayout } from "../../src/game/models/courseLayouts";
import { I18nContext } from "../../src/i18n/context";
import { setActiveLocale, translate } from "../../src/i18n/core";
import "../../src/index.css";

export interface TournamentFixtureEvidence {
  course: ReturnType<typeof createTournamentStandardsCourse>;
  world: World;
  initial: string;
  expected: {
    phase: string;
    event: TournamentEvent;
    canonical: { standings: readonly TournamentRankedStanding[]; winnerIds: readonly string[]; winnerNames: readonly string[]; proAmRounds: readonly ProAmRoundEvidence[] } | null;
    entry: { id: string; event: TournamentEvent; eligibility: { eligible: boolean; reason: string | null } | null }[];
    normalizedCount: number;
    getterSameArray: boolean;
  };
  calls: { name: string; event: TournamentEvent; originalIdentity: boolean }[];
}
declare global { interface Window { tournamentEventFixture: TournamentFixtureEvidence } }

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "pseudo" ? "pseudo" : "en";
setActiveLocale(locale);
document.documentElement.dataset.locale = locale;
document.documentElement.style.fontSize = params.get("scale") === "130" ? "130%" : "100%";
const phase = params.get("phase") ?? "completed";
const template = (params.get("template") ?? "individual") as TournamentTemplateId;
const rounds = Number(params.get("rounds") ?? 2);
const mode = (params.get("mode") ?? (template === "individual" ? "gross-stroke" : "net-stroke")) as TournamentScoringMode;
const day = 4;
const course = createTournamentStandardsCourse();
const defaultCareer = createDefaultPlayerPro({ seed: 1350_001, name: "Alexandra Isabella Montgomery-Wellington" });
const career = params.get("skill") === "low" ? { ...defaultCareer,
  skills: Object.fromEntries(Object.keys(defaultCareer.skills).map((skill) => [skill, 0])) as typeof defaultCareer.skills,
} : defaultCareer;
let world: World = { ...structuredClone(DEFAULT_WORLD), week: 1, cash: 100_000, reputation: 100, runSeed: 1350_001, playerPro: career };
const created = createTournamentEvent({ course, world, tier: "local", currentDay: 0, daysAhead: phase === "future" ? 6 : day,
  ...(params.has("template") ? { templateId: template } : {}) });
if (!created.ok) throw new Error(created.reason);
let event: TournamentEvent = { ...created.event, name: `${phase} Riverside Invitational`, roundCount: rounds, scoringMode: mode,
  field: created.event.field.map((entrant, index) => ({ ...entrant, name: index === 0 ? "Alexandra Isabella Montgomery-Wellington" : index === 1 ? "Christopher Maximilian Worthington-Smythe" : entrant.name })) };
world = { ...world, tournaments: { version: 2, events: [event] } };

function grossCards(actual: TournamentEvent): TournamentRoundScorecard[] {
  const snapshot = actual.activationSnapshot!;
  const shared = ["alternate-shot", "scramble"].includes(snapshot.teamFormat);
  const cards = snapshot.entrants.map((entrant, index) => {
    const handicap = snapshot.teamHandicaps?.find((team) => team.teamId === entrant.teamId);
    const allTiedTeams = snapshot.teamFormat !== "individual";
    const gross = snapshot.holes.map((hole, holeIndex) => Math.max(1, hole.par + (shared ? handicap!.strokesByHole[holeIndex] : entrant.strokesByHole[holeIndex])
      + (allTiedTeams || index < 2 ? 0 : index)));
    const card = scoreTournamentRoundCard(actual, entrant.entrantId, gross);
    if (!card) throw new Error("Canonical fixture card rejected");
    return card;
  });
  if (params.get("dnf") === "1") {
    const ids = snapshot.teamFormat === "pro-am" ? snapshot.teams[0].entrantIds.slice(1) : [snapshot.entrants[0].entrantId];
    return cards.map((card) => ids.includes(card.entrantId) ? { entrantId: card.entrantId, status: "withdrawn", grossByHole: [], penalties: 0, grossTotal: 0 } : card);
  }
  return cards;
}

if (phase === "active-entered" || phase === "malformed") {
  const started = startPlayerProTournamentRound({ course, world, event, layoutId: activeCourseLayout(course).id, day });
  if (!started.ok) throw new Error(started.reason);
  world = started.world;
  event = started.event;
} else if (["active-unentered", "completed", "forged"].includes(phase)) {
  const activated = activateTournament(event, course, world.week, day);
  if (!activated.ok) throw new Error(activated.reason);
  event = activated.event;
  if (phase !== "active-unentered") {
    for (let round = 0; round < rounds; round += 1) {
      const lockedWithdrawals = new Set(event.rounds!.find((candidate) => candidate.roundNumber === event.currentRound)!.scorecards
        .filter((card) => card.status === "withdrawn").map((card) => card.entrantId));
      const completed = completeTournamentRoundEvidence(event, grossCards(event).filter((card) => !lockedWithdrawals.has(card.entrantId)));
      if (!completed.ok) throw new Error(completed.reason);
      event = completed.event;
    }
  }
  world = { ...world, tournaments: { version: 2, events: [event] } };
} else if (phase === "cancelled") {
  const cancelled = prepareTournamentDay({ ...course, holes: [] }, world, day);
  if (!cancelled.cancelled) throw new Error("Canonical fixture cancellation did not occur");
  world = cancelled.world;
  event = cancelled.cancelled;
} else if (phase === "legacy") {
  event = { id: "historical-open", name: "Historical Riverside Open", tier: "local", scheduledWeek: 1, scheduledDay: 2, status: "completed",
    bookingCost: 100, revenueAward: 200, reputationAward: 1, field: [{ id: "recorded-a", name: "Alexandra Isabella Montgomery-Wellington", archetype: "casual", skill: .5 }],
    results: [{ entrantId: "recorded-a", golferId: 1, name: "Alexandra Isabella Montgomery-Wellington", archetype: "casual", holesCompleted: 9, score: 40, scoreToPar: 4, finished: true }], winnerName: "Alexandra Isabella Montgomery-Wellington" };
  world = { ...world, tournaments: { version: 2, events: [event] } };
}
const honestEvent = structuredClone(event);
let canonical: TournamentFixtureEvidence["expected"]["canonical"] = null;
if (event.status === "completed" && event.activationSnapshot) {
  if (event.activationSnapshot.teamFormat === "individual") {
    const result = reconstructIndividualTournamentStandings(event);
    if (!result.ok) throw new Error(result.reason);
    canonical = { standings: result.standings, winnerIds: result.standings.filter((row) => row.place === 1 && row.status === "completed").map((row) => row.competitorId), winnerNames: result.winnerNames, proAmRounds: [] };
  } else {
    const result = event.activationSnapshot.teamFormat === "pro-am" ? reconstructProAmTournamentEvidence(event) : reconstructTournamentTeamEvidence(event);
    if (!result.ok) throw new Error(result.reason);
    const proAmRounds: ProAmRoundEvidence[] = [];
    if (event.activationSnapshot.teamFormat === "pro-am") for (const round of event.rounds!) {
      const scored = scoreProAmRoundEvidence(event.activationSnapshot, round.roundNumber, round.scorecards);
      if (!scored.ok) throw new Error(scored.reason);
      proAmRounds.push(scored.evidence);
    }
    canonical = { standings: result.evidence.standings, winnerIds: result.evidence.winnerTeamIds, winnerNames: [], proAmRounds };
  }
}
if (phase === "forged") {
  event = { ...event, field: event.field.map((entrant) => ({ ...entrant, name: "Forged mutable name" })),
    results: [{ entrantId: "forged", golferId: null, name: "Forged winner", archetype: "pro", holesCompleted: 999, score: -9999, scoreToPar: -9999, finished: true }],
    teamStandings: [{ teamId: "forged-team", status: "completed", completedRounds: 4, dnfRounds: 0, netTotal: -9999, place: 1, tied: false, occupiedPlaces: [1] }], winnerTeamIds: ["forged-team"], winnerNames: ["Forged winner"], winnerName: "Forged winner" };
  world = { ...world, tournaments: { version: 2, events: [event] } };
} else if (phase === "malformed") {
  event = { ...event, rounds: "bad-round-carrier" as never };
  world = { ...world, tournaments: { version: 2, events: [event] } };
}
const actualCareer = world.playerPro!;
const initial = JSON.stringify({ course, world });
const entries = playerProTournamentEntries(world, actualCareer);
const expected: TournamentFixtureEvidence["expected"] = {
  phase, event: honestEvent, canonical,
  entry: entries.map((item) => ({ id: item.id, event: item, eligibility: phase === "malformed" ? null : playerProTournamentEntryEligibility(actualCareer, item, world, day) })),
  normalizedCount: normalizeTournamentCalendar(tournamentCalendar(world)).events.length,
  getterSameArray: tournamentCalendar(world).events === world.tournaments!.events,
};
const calls: TournamentFixtureEvidence["calls"] = [];
window.tournamentEventFixture = { course, world, initial, expected, calls };

export function Fixture() {
  const [open, setOpen] = useState(true);
  return <I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, args) => translate(locale, key, args) }}>
    <button data-testid="outside-before" onClick={() => setOpen(true)}>Open Player Pro</button>
    <output data-testid="callback-log" />
    {open && <PlayerProPanel career={actualCareer} course={course} world={world} day={day}
      onUpdateIdentity={() => {}} onStartRound={async () => null} onTrain={async () => null} onChallenge={async () => null}
      onMentorChallenge={async () => null} onLoadout={async () => null}
      onTournament={async (value) => {
        calls.push({ name: "tournament", event: value, originalIdentity: entries.some((entry) => entry === value) });
        document.querySelector<HTMLOutputElement>("[data-testid=callback-log]")!.value = JSON.stringify(calls);
        return params.get("notice") === "custom" ? "Fixture entry acknowledged." : null;
      }} onResume={() => {}} onClose={() => setOpen(false)} />}
    <button data-testid="outside-after">Outside focus destination</button>
  </I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
