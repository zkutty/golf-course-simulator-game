import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency, formatDayLabel } from "../i18n/format";
import { useI18n } from "../i18n/useI18n";
import { absoluteGameDay, TOURNAMENT_TIERS, tournamentCalendar } from "../game/tournaments/tournaments";
import { evaluateTournamentEligibility } from "../game/tournaments/eligibility";
import type { TournamentEvent, TournamentRequirementId, TournamentStanding, TournamentTier } from "../game/tournaments/types";
import type { Course, World } from "../game/models/types";
import type { LiveStatus } from "../hooks/useLiveSimulation";
import type { MessageKey } from "../i18n/catalog";
import { IconUi } from "../assets/icons/IconUi";
import "./TournamentPanel.css";

function score(value: number, evenLabel: string): string {
  return value > 0 ? `+${value}` : value === 0 ? evenLabel : `${value}`;
}

function Leaderboard(props: { rows: TournamentStanding[] }) {
  const { t } = useI18n();
  return <ol data-testid="tournament-leaderboard" className="cc-tournament__leaderboard">
    {props.rows.map((row, index) => <li key={row.entrantId} className="cc-tournament__standing" data-finished={row.finished}>
      <strong className="cc-tournament__place">{index + 1}</strong>
      <span className="cc-tournament__entrant">{row.name}</span>
      <small className="cc-tournament__progress">{row.finished ? t("tournament.finished") : t("tournament.through", { count: row.holesCompleted })}</small>
      <strong className="cc-tournament__score" data-score={Math.sign(row.scoreToPar)}>{score(row.scoreToPar, t("tournament.evenScore"))}</strong>
    </li>)}
  </ol>;
}

export function TournamentPanel(props: {
  course: Course;
  world: World;
  currentDay: number;
  liveTournament: LiveStatus["tournament"];
  operationsFocus?: { system: "tournaments"; nonce: number };
  onSchedule: (tier: TournamentTier, daysAhead: number) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [tier, setTier] = useState<TournamentTier>("local");
  const [daysAhead, setDaysAhead] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const events = tournamentCalendar(props.world).events;
  const now = absoluteGameDay(props.world.week, props.currentDay);
  const upcoming = useMemo(() => events.filter((event) => event.status === "scheduled" && event.id !== props.liveTournament?.eventId).sort((a, b) => absoluteGameDay(a.scheduledWeek, a.scheduledDay) - absoluteGameDay(b.scheduledWeek, b.scheduledDay)), [events, props.liveTournament?.eventId]);
  const completed = useMemo(() => events.filter((event) => event.status === "completed").slice(-4).reverse(), [events]);
  const cancelled = useMemo(() => events.filter((event) => event.status === "cancelled").slice(-3).reverse(), [events]);
  const spec = TOURNAMENT_TIERS[tier];
  const eligibility = useMemo(() => evaluateTournamentEligibility({ course: props.course, world: props.world, tier, currentDay: props.currentDay, daysAhead, minReputation: spec.minReputation, bookingCost: spec.bookingCost }), [daysAhead, props.course, props.currentDay, props.world, spec.bookingCost, spec.minReputation, tier]);
  const requirementKey = (id: TournamentRequirementId): MessageKey => `tournament.requirement.${id}` as MessageKey;
  const tierKey = (value: TournamentTier): MessageKey => `tournament.tier.${value}` as MessageKey;
  const guidanceKey = (id: TournamentRequirementId): MessageKey => `tournament.guidance.${id}` as MessageKey;
  const localizedIssue = (event: TournamentEvent): string => {
    const unmet = event.currentQualification?.requirements.find((item) => !item.passed);
    return unmet ? `${t(requirementKey(unmet.id))}: ${t("tournament.currentRequired", { current: unmet.current, required: unmet.required })}` : event.warning ?? event.cancellationReason ?? "";
  };
  const scheduleSelectedTournament = async () => {
    if (!eligibility.eligible) {
      setNotice(t("tournament.notEligible", { reason: eligibility.blockingReasons[0] ?? t("tournament.requirements") }));
      return;
    }
    const failed = eligibility.requirements.filter((requirement) => !requirement.passed).length;
    const confirmed = props.world.experienceProfile !== "simulation" || window.confirm(t("tournament.confirm", {
      deposit: formatCurrency(spec.bookingCost),
      failed,
      revenue: formatCurrency(spec.revenueAward),
      reputation: spec.reputationAward,
    }));
    if (confirmed) setNotice(await props.onSchedule(tier, daysAhead) ?? t("tournament.booked"));
  };
  useEffect(() => {
    if (cancelled[0]) panelRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [cancelled]);
  useEffect(() => {
    if (!props.operationsFocus) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [props.operationsFocus]);

  return (
    <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="tournament-title" data-testid="tournament-panel" data-operation-system="tournaments" className="cc-tournament">
      <header className="cc-tournament__header">
        <div><small>{t("tournament.eyebrow")}</small><h2 id="tournament-title">{t("tournament.title")}</h2></div>
        <button aria-label={t("tournament.close")} onClick={props.onClose} className="cc-tournament__close"><IconUi name="close" /></button>
      </header>

      <div className="cc-tournament__body">
        {props.liveTournament && (
          <section data-testid="active-tournament">
            <div className="cc-tournament__live-heading"><div><small className="cc-tournament__live-label">{t("tournament.live")}</small><h3>{props.liveTournament.name}</h3></div><span>{props.liveTournament.standings.filter((row) => row.finished).length}/{props.liveTournament.standings.length}</span></div>
            <Leaderboard rows={props.liveTournament.standings} />
          </section>
        )}

        {cancelled[0] && <section role="status" data-testid="tournament-cancellation" className="cc-tournament__cancellation"><strong>{t("tournament.cancelled")}: {cancelled[0].name}</strong><div className="cc-tournament__detail">{localizedIssue(cancelled[0])}</div><small>{t("tournament.depositForfeited")}</small></section>}

        {!props.liveTournament && (
          <section className="cc-tournament__schedule">
            <h3>{t("tournament.schedule")}</h3>
            <label className="cc-tournament__field">{t("tournament.tier")}
              <select data-testid="tournament-tier" value={tier} onChange={(event) => setTier(event.target.value as TournamentTier)}>
                {(Object.keys(TOURNAMENT_TIERS) as TournamentTier[]).map((key) => <option key={key} value={key}>{t(tierKey(key))}</option>)}
              </select>
              <small className="cc-tournament__selected-tier" aria-hidden="true">{t(tierKey(tier))}</small>
            </label>
            <label className="cc-tournament__field">{t("tournament.date")}
              <select data-testid="tournament-date" value={daysAhead} onChange={(event) => setDaysAhead(Number(event.target.value))}>
                <option value={1}>{t("tournament.tomorrow")}</option><option value={3}>{t("tournament.threeDays")}</option><option value={7}>{t("tournament.nextWeek")}</option>
              </select>
            </label>
            <div className="cc-tournament__stats"><span><strong>{spec.fieldSize}</strong><br />{t("tournament.players")}</span><span><strong>{formatCurrency(spec.bookingCost)}</strong><br />{t("tournament.deposit")}</span><span><strong>+{spec.reputationAward}</strong><br />{t("tournament.reputation")}</span></div>
            <small>{t("tournament.payout", { amount: formatCurrency(spec.revenueAward), reputation: spec.minReputation })}</small>
            <section data-testid="tournament-readiness" aria-label={t("tournament.readiness")} className="cc-tournament__readiness">
              <div><strong>{t("tournament.standard")}</strong><div>{t("tournament.setupSummary", { tee: eligibility.teeSet[0].toUpperCase() + eligibility.teeSet.slice(1), pin: eligibility.pinRotation, rating: eligibility.rating.toFixed(1), slope: eligibility.slope })}</div><small>{t("tournament.yardageRotations", { yards: eligibility.effectiveYardage.toLocaleString(), rotations: t("tournament.completeRotations", { count: eligibility.completeRotations.length }) })}</small></div>
              <ul className="cc-tournament__requirements">
                {eligibility.requirements.map((item) => <li key={item.id} data-requirement={item.id} data-passed={item.passed} className="cc-tournament__requirement"><div className="cc-tournament__requirement-heading"><IconUi name={item.passed ? "completed" : "close"} /><span className="cc-tournament__state">{t(item.passed ? "tournament.requirementMet" : "tournament.requirementUnmet")}</span><strong>{t(requirementKey(item.id))}</strong></div><small>{t("tournament.currentRequired", { current: item.current, required: item.required })}</small>{!item.passed && <div className="cc-tournament__warning">{t("tournament.fix", { guidance: t(guidanceKey(item.id)) })}</div>}</li>)}
              </ul>
            </section>
            <button data-testid="schedule-tournament" onClick={scheduleSelectedTournament} className="cc-tournament__book">{t("tournament.book")}</button>
            {notice && <div role="status" className="cc-tournament__notice" data-success={notice === t("tournament.booked")}>{notice}</div>}
          </section>
        )}

        {upcoming.length > 0 && <section><h3>{t("tournament.upcoming")}</h3>{upcoming.map((event) => { const days = absoluteGameDay(event.scheduledWeek, event.scheduledDay) - now; return <div key={event.id} data-event-id={event.id} className="cc-tournament__event"><strong>{event.name}</strong><div><small>{formatDayLabel(event.scheduledDay + 1)}, {t("tournament.week", { week: event.scheduledWeek })} · {days === 1 ? t("tournament.inOneDay") : t("tournament.inDays", { days })}</small></div>{event.teeSet && event.pinRotation && <small>{t("tournament.eventSetup", { tee: event.teeSet, pin: event.pinRotation })}</small>}{event.warning && <div role="alert" className="cc-tournament__warning"><strong>{t("tournament.warning")}:</strong> {localizedIssue(event)}</div>}</div>; })}</section>}

        {completed.length > 0 && <section><h3>{t("tournament.results")}</h3>{completed.map((event) => <details key={event.id} data-event-id={event.id} className="cc-tournament__event"><summary><strong>{event.name}</strong><br /><small>{t("tournament.wonBy", { winner: event.winnerName ?? "—" })} · +{formatCurrency(event.revenueAward)} · +{event.reputationAward} {t("tournament.repShort")}</small></summary>{event.results && <div className="cc-tournament__results"><Leaderboard rows={event.results} /></div>}</details>)}</section>}
        {cancelled.length > 0 && <section><h3>{t("tournament.cancelled")}</h3>{cancelled.map((event) => <div key={event.id} data-event-id={event.id} className="cc-tournament__event"><strong>{event.name}</strong><div className="cc-tournament__warning">{localizedIssue(event)} · {t("tournament.depositForfeited")}</div></div>)}</section>}
      </div>
    </section>
  );
}
