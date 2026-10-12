import type { World } from "../game/models/types";
import type { PlayerProCareer } from "../game/models/playerProTypes";
import type { TournamentEvent } from "../game/tournaments/types";
import { tournamentCalendar } from "../game/tournaments/tournaments";
import { playerProTournamentEntryEligibility } from "../game/playerPro/playerProPanelAuthority";
import type { MessageKey } from "../i18n/catalog";
import type { Translator } from "../i18n/context";
import { formatCurrency } from "../i18n/format";
import { useI18n } from "../i18n/useI18n";
import { presentPlayerTournamentEvent, type PlayerTournamentPresentation } from "./playerTournamentPresentation";
import "./playerTournamentEvents.css";

export interface PlayerTournamentEventsProps {
  world: World;
  career: PlayerProCareer;
  day: number;
  entryEvents: readonly TournamentEvent[];
  onEnter: (event: TournamentEvent) => void;
}

type FrozenSetup = Extract<PlayerTournamentPresentation["setup"], { phase: "frozen" }>;
type CanonicalCompetition = Extract<PlayerTournamentPresentation["competition"], { state: "canonical" }>;

const key = (suffix: string): MessageKey => `playerPro.tournament.detail.${suffix}` as MessageKey;
const label = (t: Translator, group: string, value: string | null | undefined) => value == null ? t(key("notRecorded")) : t(key(`${group}.${value}`));
const recorded = (t: Translator, value: string | number | null | undefined) => value == null ? t(key("notRecorded")) : String(value);
const date = (t: Translator, week: number, day: number) => t(key("date"), { week, day: day + 1 });

function competitorName(model: PlayerTournamentPresentation, id: string): string {
  if (model.setup.phase !== "frozen") return id;
  const snapshot = model.setup.snapshot;
  const entrant = snapshot.entrants.find((candidate) => candidate.entrantId === id);
  if (entrant) return entrant.name;
  const team = snapshot.teams.find((candidate) => candidate.id === id);
  return team ? `${team.id} · ${team.entrantIds.map((entrantId) => snapshot.entrants.find((candidate) => candidate.entrantId === entrantId)?.name ?? entrantId).join(" + ")}` : id;
}

function Setup({ model, t }: { model: PlayerTournamentPresentation; t: Translator }) {
  const setup = model.setup;
  if (setup.phase === "unavailable") return <p>{t(key("unavailable"))}</p>;
  if (setup.phase === "legacy") return <p>{t(key("legacySetup"))}</p>;
  const frozen = setup.phase === "frozen" ? setup.snapshot : null;
  const planned = setup.phase === "planned" ? setup : null;
  const courseName = frozen?.courseName ?? planned?.courseName;
  const mode = frozen?.scoringMode ?? planned?.scoringMode;
  const format = frozen?.teamFormat ?? planned?.teamFormat;
  return <details data-testid={frozen ? "player-tournament-frozen-setup" : "player-tournament-planned-setup"}>
    <summary>{t(key(frozen ? "frozenSetup" : "plannedSetup"))} · {recorded(t, courseName)}</summary>
    <dl className="player-tournament-facts">
      <dt>{t(key("course"))}</dt><dd>{recorded(t, courseName)} · {recorded(t, frozen?.courseId ?? planned?.courseId)}</dd>
      <dt>{t(key("format"))}</dt><dd>{label(t, "format", format)}</dd>
      <dt>{t(key("scoring"))}</dt><dd>{label(t, "scoring", mode)}</dd>
      <dt>{t(key("tee"))}</dt><dd>{label(t, "tee", frozen?.teeSet ?? planned?.teeSet)}</dd>
      <dt>{t(key("pin"))}</dt><dd>{recorded(t, frozen?.pinRotation ?? planned?.pinRotation)}</dd>
      <dt>{t(key("rating"))}</dt><dd>{recorded(t, frozen?.rating ?? planned?.qualification?.rating)}</dd>
      <dt>{t(key("slope"))}</dt><dd>{recorded(t, frozen?.slope ?? planned?.qualification?.slope)}</dd>
      <dt>{t(key("par"))}</dt><dd>{recorded(t, frozen?.par)}</dd>
    </dl>
    {frozen && <FrozenRoster setup={setup as FrozenSetup} t={t} />}
    {planned && <details><summary>{t(key("rosterCount"), { count: planned.roster.length })}</summary>
      <table><caption>{t(key("plannedRoster"))}</caption><thead><tr><th scope="col">{t(key("player"))}</th><th scope="col">{t(key("role"))}</th></tr></thead>
        <tbody>{planned.roster.map((entrant) => <tr key={entrant.id}><th scope="row">{entrant.name}<span>{recorded(t, entrant.teamId)}</span></th><td>{label(t, "role", entrant.teamRole)}</td></tr>)}</tbody>
      </table><p>{t(key("plannedAllowances"))}</p>
    </details>}
    {planned && <details><summary>{t(key("plannedHoles"))}</summary>{planned.holeIds === null ? <p>{t(key("notRecorded"))}</p>
      : <ol>{planned.holeIds.map((id) => <li key={id}>{id}</li>)}</ol>}
    </details>}
    {frozen?.formatRules && <details><summary>{t(key("formatRules"))}</summary><dl className="player-tournament-facts">
      <dt>{t(key("teamSize"))}</dt><dd>{frozen.formatRules.teamSize}</dd>
      <dt>{t(key("teamCount"))}</dt><dd>{frozen.formatRules.teamCount === "field" ? t(key("fieldTeams")) : frozen.formatRules.teamCount}</dd>
      <dt>{t(key("handicapRule"))}</dt><dd>{label(t, "handicapRule", frozen.formatRules.handicapFormula)}</dd>
      <dt>{t(key("orderRule"))}</dt><dd>{label(t, "orderRule", frozen.formatRules.orderRule)}</dd>
      <dt>{t(key("ballRule"))}</dt><dd>{label(t, "ballRule", frozen.formatRules.ballSelectionRule)}</dd>
      <dt>{t(key("holeRule"))}</dt><dd>{label(t, "holeRule", frozen.formatRules.teamHoleRule)}</dd>
      <dt>{t(key("captainRule"))}</dt><dd>{t(key("firstCaptain"))}</dd>
    </dl></details>}
    {frozen && <details><summary>{t(key("holeSetup"))}</summary><ol>
      {frozen.holes.map((hole) => <li key={hole.id}>{t(key("holeSetupValue"), { hole: hole.id, par: hole.par, index: hole.strokeIndex,
        tee: `${hole.tee.x}, ${hole.tee.y}`, pin: `${hole.pin.x}, ${hole.pin.y}` })}</li>)}
    </ol></details>}
  </details>;
}

function FrozenRoster({ setup, t }: { setup: FrozenSetup; t: Translator }) {
  return <details><summary>{t(key("rosterCount"), { count: setup.snapshot.entrants.length })}</summary>
    <table><caption>{t(key("frozenRoster"))}</caption><thead><tr><th scope="col">{t(key("player"))}</th><th scope="col">{t(key("allowance"))}</th></tr></thead>
      <tbody>{setup.snapshot.entrants.map((entrant) => <tr key={entrant.entrantId}>
        <th scope="row">{entrant.name}<span>{entrant.teamId}</span><span>{label(t, "role", entrant.teamRole)}{entrant.teamCaptain ? ` · ${t(key("captain"))}` : ""}</span></th>
        <td>{new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 }).format(entrant.allowance)}
          <span>{t(key("handicapIndex"))}: {entrant.handicapIndex}</span><span>{t(key("courseHandicap"))}: {entrant.courseHandicapUnrounded}</span>
          <span>{t(key("playingHandicap"))}: {entrant.playingHandicap}</span>
          <details><summary>{t(key("allocatedStrokes"))}</summary><ol>{entrant.strokesByHole.map((strokes, index) => <li key={index}>{t(key("holeStrokes"), { hole: setup.snapshot.holes[index].id, strokes })}</li>)}</ol></details>
        </td>
      </tr>)}</tbody>
    </table>
  </details>;
}

function Standings({ model, competition, t }: { model: PlayerTournamentPresentation; competition: CanonicalCompetition; t: Translator }) {
  const snapshot = model.setup.phase === "frozen" ? model.setup.snapshot : null;
  const individual = snapshot?.teamFormat === "individual";
  const stableford = snapshot?.scoringMode === "stableford";
  const renderTable = (rows: CanonicalCompetition["standings"], caption: string) => <table><caption>{caption}</caption>
    <thead><tr><th scope="col">{t(key("place"))}</th><th scope="col">{t(key("competitor"))}</th><th scope="col">{t(key("score"))}</th></tr></thead>
    <tbody>{rows.map((standing) => <tr key={standing.competitorId} data-competitor-id={standing.competitorId}>
      <td>{standing.place === null ? t(key("unranked")) : standing.tied ? t(key("tiedPlace"), { place: standing.place }) : standing.place}
        {standing.occupiedPlaces.length > 0 && <span>{t(key("occupiedPlaces"), { places: standing.occupiedPlaces.join(", ") })}</span>}</td>
      <th scope="row">{competitorName(model, standing.competitorId)}<span>{label(t, "status", standing.status)}</span>
        <span>{t(key("progress"), { rounds: standing.completedRounds, holes: standing.holesCompleted })}</span></th>
      <td>{standing.scoreTotal === null ? t(key("noScore")) : <>
        <span>{t(key(individual ? "gross" : "teamNet"))}: {standing.scoreTotal}</span>
        {/* Stableford authority ranks negative points; negation here is display formatting only. */}
        <span>{t(key(stableford ? "points" : snapshot?.scoringMode === "gross-stroke" ? "grossRanking" : "netRanking"))}: {stableford && standing.rankingTotal !== null ? -standing.rankingTotal : standing.rankingTotal}</span>
        {!stableford && <span>{t(key("toPar"))}: {standing.scoreToPar}</span>}
      </>}</td>
    </tr>)}</tbody>
  </table>;
  const overviewRows = competition.standings.slice(0, 5);
  return <>
    {competition.winnerIds.length > 0 && <div data-testid="player-tournament-winners"><strong>{t(key("winners"))}</strong><ul>{competition.winnerIds.map((id) => <li key={id}>{competitorName(model, id)}</li>)}</ul></div>}
    <section data-testid="player-tournament-standings-overview">
      {renderTable(overviewRows, t(key("standingsOverview")))}
      <p>{t(key("standingsRemaining"), { count: competition.standings.length - overviewRows.length })}</p>
    </section>
    <details data-testid="player-tournament-standings"><summary>{t(key("standings"))}</summary>
      {renderTable(competition.standings, t(key("cumulativeCaption"), { count: model.schedule.completedRoundCount }))}
    </details>
    <details><summary>{t(key("participantCards"))}</summary>
      {competition.participantRounds.map((round) => <details key={round.roundNumber}><summary>{t(key("roundNumber"), { round: round.roundNumber })} · {label(t, "status", round.status)}</summary>
        {round.scorecards.length === 0 ? <p>{t(key("noCards"))}</p> : <table><caption>{t(key("roundCards"), { round: round.roundNumber })}</caption>
          <thead><tr><th scope="col">{t(key("player"))}</th><th scope="col">{t(key("scorecard"))}</th></tr></thead><tbody>
            {round.scorecards.map((card) => <tr key={card.entrantId}><th scope="row">{competitorName(model, card.entrantId)}</th><td>{label(t, "status", card.status)}
              {card.status === "completed" && <><span>{t(key("gross"))}: {card.grossTotal}</span><span>{t(key("penalties"))}: {card.penalties}</span>
                <ol>{card.grossByHole.map((gross, index) => <li key={index}>{t(key("holeGross"), { hole: snapshot?.holes[index]?.id ?? index + 1, gross })}</li>)}</ol></>}
            </td></tr>)}
          </tbody></table>}
      </details>)}
    </details>
    {competition.proAmRounds.length > 0 && <details><summary>{t(key("proAmCounting"))}</summary><p>{t(key("amateurRequirement"))}</p>
      {competition.proAmRounds.map((round) => <details key={round.roundNumber}><summary>{t(key("roundNumber"), { round: round.roundNumber })}</summary>
        {round.teams.map((team) => <details key={team.teamId}><summary>{competitorName(model, team.teamId)} · {label(t, "status", team.status)}</summary>
          <ol>{team.holes.map((hole) => <li key={hole.holeId}>
            <strong>{t(key("holePar"), { hole: hole.holeId, par: hole.par })}</strong><span>{label(t, "status", hole.status)}</span>
            {hole.status === "scored" ? <><p>{t(key("countedPlayers"), { players: hole.countedEntrantIds.map((id) => competitorName(model, id)).join(" + ") })}</p>
              <p>{t(key("teamNet"))}: {hole.net}</p></> : <p>{t(key("noCountingBalls"))}</p>}
            <table><caption>{t(key("memberBalls"))}</caption><thead><tr><th scope="col">{t(key("player"))}</th><th scope="col">{t(key("ball"))}</th></tr></thead><tbody>
              {hole.members.map((member) => <tr key={member.entrantId}><th scope="row">{competitorName(model, member.entrantId)}<span>{label(t, "role", member.role)}</span></th>
                <td>{label(t, "status", member.status)}{hole.countedEntrantIds.includes(member.entrantId) && <span>{t(key("counted"))}</span>}
                  <span>{t(key("allocatedStrokes"))}: {member.handicapStrokes}</span>
                  {member.status === "played" && <><span>{t(key("gross"))}: {member.gross}</span><span>{t(key("net"))}: {member.net}</span></>}
                </td></tr>)}
            </tbody></table>
          </li>)}</ol>
        </details>)}
      </details>)}
    </details>}
  </>;
}

function Competition({ model, t }: { model: PlayerTournamentPresentation; t: Translator }) {
  const competition = model.competition;
  if (competition.state === "canonical") return <Standings model={model} competition={competition} t={t} />;
  if (competition.state === "pending") return <p>{t(key("pending"))}</p>;
  if (competition.state === "unavailable") return <p>{t(key("unavailable"))}</p>;
  return <details><summary>{t(key("recordedResults"))}</summary><p>{t(key("legacyResults"))}</p>
    <table><caption>{t(key("recordedResults"))}</caption><thead><tr><th scope="col">{t(key("player"))}</th><th scope="col">{t(key("score"))}</th></tr></thead>
      <tbody>{competition.results.map((result) => <tr key={result.entrantId}><th scope="row">{result.name}</th><td>
        <span>{t(key("recordedScore"))}: {result.score}</span><span>{t(key("recordedToPar"))}: {result.scoreToPar}</span>
        <span>{t(key("holesCompleted"))}: {result.holesCompleted}</span><span>{t(key(result.finished ? "recordedFinished" : "recordedUnfinished"))}</span>
      </td></tr>)}</tbody>
    </table>
  </details>;
}

/** Display the supplied calendar through R; save/load normalization remains a domain responsibility. */
export function PlayerTournamentEvents(props: PlayerTournamentEventsProps) {
  const { t } = useI18n();
  const entryById = new Map(props.entryEvents.map((event) => [event.id, event]));
  const events = tournamentCalendar(props.world).events;
  return <section className="player-tournament-events" data-testid="player-tournament-events">
    <h3>{t(key("title"))}</h3><p>{t(key("help"))}</p>
    {events.length === 0 ? <p>{t("playerPro.tournament.none")}</p> : events.map((event) => {
      const model = presentPlayerTournamentEvent(event);
      const entryEvent = entryById.get(event.id);
      const eligibility = entryEvent && model.setup.phase !== "unavailable" && model.competition.state !== "unavailable"
        ? playerProTournamentEntryEligibility(props.career, entryEvent, props.world, props.day) : null;
      return <article key={event.id} data-event-id={event.id} className="player-tournament-event">
        <header><h4>{model.name}</h4><span className="player-tournament-status">{label(t, "status", model.status)}</span></header>
        <p>{label(t, "tier", model.tier)} · {date(t, model.schedule.scheduledWeek, model.schedule.scheduledDay)}</p>
        <p>{t(key("roundProgress"), { current: recorded(t, model.schedule.currentRound), count: recorded(t, model.schedule.roundCount), completed: model.schedule.completedRoundCount })}</p>
        <Setup model={model} t={t} />
        <details><summary>{t(key("roundSchedule"))}</summary>
          {model.schedule.rounds.length === 0 ? <p>{t(key("notRecorded"))}</p> : <table><caption>{t(key("roundSchedule"))}</caption>
            <thead><tr><th scope="col">{t(key("round"))}</th><th scope="col">{t(key("dateLabel"))}</th><th scope="col">{t(key("statusLabel"))}</th></tr></thead>
            <tbody>{model.schedule.rounds.map((round) => <tr key={round.roundNumber}><th scope="row">{round.roundNumber}</th><td>{date(t, round.scheduledWeek, round.scheduledDay)}</td><td>{label(t, "status", round.status)}</td></tr>)}</tbody>
          </table>}
        </details>
        {model.setup.phase !== "unavailable" && <Competition model={model} t={t} />}
        <details><summary>{t(key("hosting"))}</summary><p>{t(key("hostingHelp"))}</p><dl className="player-tournament-facts">
          <dt>{t(key("bookingCost"))}</dt><dd>{formatCurrency(model.hosting.bookingCost)}</dd>
          <dt>{t(key("revenueAward"))}</dt><dd>{formatCurrency(model.hosting.revenueAward)}</dd>
          <dt>{t(key("reputationAward"))}</dt><dd>{model.hosting.reputationAward}</dd>
        </dl></details>
        {entryEvent && eligibility && (event.status === "scheduled" || event.status === "active") && <div className="player-tournament-entry">
          {!eligibility.eligible && <p>{t("playerPro.tournament.blocked", { reason: eligibility.reason ?? "" })}</p>}
          <button disabled={!eligibility.eligible} onClick={() => props.onEnter(entryEvent)}>{t("playerPro.tournament.enter")}</button>
        </div>}
      </article>;
    })}
  </section>;
}
