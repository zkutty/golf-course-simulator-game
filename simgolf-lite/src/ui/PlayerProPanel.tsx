import { useMemo, useState } from "react";
import type { Course, PinRotation, TeeSet, World } from "../game/models/types";
import {
  PLAYER_PRO_SKILLS,
  type PlayerPlayableRound,
  type PlayerProAppearance,
  type PlayerProBackground,
  type PlayerProCareer,
  type PlayerProHandedness,
  type PlayerProPoint,
  type PlayerProSkill,
  type PlayerShotTechnique,
} from "../game/models/playerProTypes";
import {
  availablePlayerClubs,
  caddieShotGuidance,
  flightProfileForTechnique,
  playerTournamentEligibility,
  previewPlayableShot,
  type PlayerOpponent,
  type PlayerShotSelection,
  type PlayerTrainingOption,
} from "../game/playerPro/playerPro";
import { eligiblePlayerOpponents, playerTechniqueCatalog, playerTrainingOptions } from "../game/playerPro/playerProPanelAuthority";
import type { ShotClearanceEvidence, ShotCollision, ShotFlightProfile, ShotRuling } from "../game/rules/contracts";
import { normalizeCourseLayouts } from "../game/models/courseLayouts";
import { tournamentCalendar } from "../game/tournaments/tournaments";
import type { TournamentEvent } from "../game/tournaments/types";
import { formatCurrency } from "../i18n/format";
import type { Translator } from "../i18n/context";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/catalog";
import { formatHandicapIndex } from "../game/competition/persistence";
import { courseHandicap, playingHandicapFromUnrounded, strokesByHole } from "../game/competition/handicap";
import { authoredEquipmentModifiers, mentorTechniqueDefinition, mentorTechniqueEligibility, startEquippedPlayableRound } from "../game/competition/equipmentMentor";
import type { EquipmentLoadout } from "../game/competition/types";
import type { ChallengeGroupRound } from "../game/competition/challengeGroupRound";
import {
  applyGroupAction,
  groupView,
  playerChallengeContractRivals,
  previewPlayerChallengeContract,
  type ChallengeGroupAction,
  type PlayerChallengeContractDraft,
  type PlayerChallengeSideBetDraft,
} from "../game/playerPro/challengePlayerProAdapter";
import {
  buildPlayerProSocialPresentation,
  type PlayerProSocialSurface,
  type SocialItemPresentation,
} from "../game/playerPro/socialPresentation";

type ProTab = "career" | "play" | "training" | "matches" | "tournaments" | PlayerProSocialSurface;

const panelStyle = {
  position: "absolute",
  top: 54,
  left: 10,
  zIndex: 205,
  width: "min(640px,calc(100% - 20px))",
  maxHeight: "calc(100% - 126px)",
  overflow: "auto",
  borderRadius: 14,
  border: "2px solid #6f5324",
  background: "linear-gradient(155deg,#fff9e8,#ead39c)",
  color: "#2f2b1e",
  boxShadow: "0 16px 40px rgba(0,0,0,.38)",
} as const;

function labelKey(skill: PlayerProSkill): MessageKey {
  return `playerPro.skill.${skill}` as MessageKey;
}

function techniqueKey(technique: PlayerShotTechnique): MessageKey {
  return `playerPro.technique.${technique}` as MessageKey;
}

const FLIGHT_PROFILES: readonly ShotFlightProfile[] = ["low", "standard", "high"];

function constrainedFlight(technique: PlayerShotTechnique): ShotFlightProfile | null {
  return technique === "punch" ? "low" : technique === "flop" ? "high" : null;
}

function pointLabel(point: PlayerProPoint | null | undefined): string {
  return point ? `(${point.x.toFixed(1)}, ${point.y.toFixed(1)})` : "—";
}

function rulingLabel(ruling: ShotRuling | null | undefined, t: Translator): string {
  if (!ruling) return t("playerPro.shot.ruling.none");
  if (ruling.status === "holed") return t("playerPro.shot.ruling.holed");
  if (ruling.status === "in_play") return t("playerPro.shot.ruling.inPlay");
  return t("playerPro.shot.ruling.penalty", { kind: ruling.penaltyKind.replaceAll("_", " "), strokes: ruling.penaltyStrokes });
}

function collisionLabel(collision: ShotCollision | null | undefined, t: Translator): string {
  if (!collision || collision.kind === "none") return t("playerPro.shot.route.clear");
  if (collision.kind === "terrain") return t("playerPro.shot.route.terrain", { point: pointLabel(collision.point), terrain: collision.terrain });
  return t("playerPro.shot.route.obstacle", { obstacle: collision.obstacleType, point: pointLabel(collision.point), relationship: collision.clearance.relationship ?? "through" });
}

function clearanceLabel(clearance: readonly ShotClearanceEvidence[], t: Translator): string | null {
  if (clearance.length === 0) return null;
  const nearest = clearance.slice().sort((a, b) => {
    const aDistance = a.horizontalClearanceYards ?? Math.abs(a.clearanceYards);
    const bDistance = b.horizontalClearanceYards ?? Math.abs(b.clearanceYards);
    return aDistance - bDistance;
  })[0]!;
  const distance = nearest.horizontalClearanceYards ?? Math.abs(nearest.clearanceYards);
  return t(clearance.length === 1 ? "playerPro.shot.clearance.single" : "playerPro.shot.clearance.plural", {
    count: clearance.length,
    obstacle: nearest.obstacleType ?? "terrain",
    relationship: nearest.relationship ?? "over",
    distance: distance.toFixed(1),
    point: pointLabel(nearest.point),
  });
}

function riskLabel(risk: "low" | "medium" | "high", t: Translator): string {
  return t(`playerPro.shot.risk.${risk}` as MessageKey);
}

function slopeDirection(adjustmentYards: number, t: Translator): string {
  return t(adjustmentYards > 0 ? "playerPro.shot.slope.uphill" : adjustmentYards < 0 ? "playerPro.shot.slope.downhill" : "playerPro.shot.slope.level");
}

function sidehillLabel(sidehill: "flat" | "ball_above_feet" | "ball_below_feet", t: Translator): string {
  return t(`playerPro.shot.sidehill.${sidehill}` as MessageKey);
}

function curveDirection(curveTiles: number, t: Translator): string {
  return t(curveTiles < 0 ? "playerPro.shot.curve.left" : curveTiles > 0 ? "playerPro.shot.curve.right" : "playerPro.shot.curve.straight");
}

function SkillGrid(props: { career: PlayerProCareer }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7 }}>
      {PLAYER_PRO_SKILLS.map((skill) => {
        const value = props.career.skills[skill];
        const xp = props.career.skillXp[skill] % 12;
        return (
          <div key={skill} style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,.58)", border: "1px solid rgba(67,52,25,.14)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 850 }}>
              <span>{t(labelKey(skill))}</span><strong>{Math.round(value)}</strong>
            </div>
            <div role="progressbar" aria-label={t(labelKey(skill))} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} style={{ height: 6, marginTop: 5, borderRadius: 999, background: "rgba(56,49,30,.15)", overflow: "hidden" }}>
              <div style={{ width: `${value}%`, height: "100%", background: "#4f743e" }} />
            </div>
            <small style={{ opacity: .68 }}>{t("playerPro.skillXp", { xp: xp.toFixed(1) })}</small>
          </div>
        );
      })}
    </div>
  );
}

const cardStyle = { display: "grid", gap: 6, padding: 9, borderRadius: 8, background: "rgba(255,255,255,.58)", border: "1px solid rgba(67,52,25,.14)", fontSize: 12 } as const;
const scoreLabel = (value: number | null | undefined) => value == null ? "—" : value.toFixed(1);

function HandicapSummary({ career }: { career: PlayerProCareer }) {
  const { t } = useI18n();
  const profile = career.handicapProfile;
  const records = profile.scoreRecords.slice(-6).reverse();
  const latest = records[0];
  return <section data-testid="player-handicap-summary" aria-label={t("playerPro.handicap.title")} style={cardStyle}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{t("playerPro.handicap.title")}</strong><strong data-testid="player-handicap-index">{formatHandicapIndex(profile.handicapIndex)}</strong></div>
    <div>{t(profile.confidence.status === "established" ? "playerPro.handicap.established" : "playerPro.handicap.provisional", { count: profile.confidence.eligibleRoundCount })}</div>
    {latest?.calculation && <small>{t("playerPro.handicap.movement", { before: formatHandicapIndex(latest.calculation.indexBefore), after: formatHandicapIndex(latest.calculation.indexAfter), candidate: formatHandicapIndex(latest.calculation.candidateIndex), capped: latest.calculation.movementCapped ? t("playerPro.handicap.capped") : t("playerPro.handicap.uncapped") })}</small>}
    <details>
      <summary>{t("playerPro.handicap.history", { count: profile.scoreRecords.length })}</summary>
      {records.length === 0 ? <small>{t("playerPro.handicap.noHistory")}</small> : <ol aria-label={t("playerPro.handicap.history", { count: profile.scoreRecords.length })} style={{ paddingLeft: 20, marginBottom: 0 }}>
        {records.map((record) => <li key={record.id}>{record.snapshot.course.name} · {t("playerPro.handicap.record", { gross: record.evidence.grossScore, adjusted: record.evidence.adjustedGrossScore ?? "—", differential: scoreLabel(record.evidence.differential), state: record.postingState })}</li>)}
      </ol>}
    </details>
  </section>;
}

function SnapshotScorecard({ round }: { round: PlayerPlayableRound }) {
  const { t } = useI18n();
  const snapshot = round.handicapSnapshot;
  const course = snapshot?.course;
  const handicap = course?.courseRating != null && course.slopeRating != null
    ? courseHandicap(snapshot!.handicapIndex, { courseRating: course.courseRating, slopeRating: course.slopeRating, par: course.par }) : null;
  const playing = handicap ? playingHandicapFromUnrounded(handicap.unrounded) : null;
  const owed = playing && course && (course.holes.length === 9 || course.holes.length === 18) && course.holes.every((hole) => hole.strokeIndex != null)
    ? strokesByHole(playing.rounded, course.holes.map((hole) => ({ id: hole.id, par: hole.par, strokeIndex: hole.strokeIndex! }))) : [];
  return <section data-testid="player-round-scorecard" aria-label={t("playerPro.scorecard") } style={cardStyle}>
    <strong>{t("playerPro.scorecard")}</strong>
    {snapshot ? <>
      <div>{t("playerPro.scorecard.setup", { tee: course!.teeSet, rating: course!.courseRating ?? "—", slope: course!.slopeRating ?? "—", par: course!.par, index: formatHandicapIndex(snapshot.handicapIndex), courseHandicap: handicap?.rounded ?? "—", playingHandicap: playing?.rounded ?? "—", allowance: "100%" })}</div>
      <small>{snapshot.eligibility.eligible ? t("playerPro.scorecard.valid") : t("playerPro.scorecard.invalid", { reason: snapshot.eligibility.reasons.join(" ") })}</small>
    </> : <small>{t("playerPro.scorecard.legacy")}</small>}
    <div>{t("playerPro.scorecard.format", { format: round.kind, state: round.phase === "conceded" ? t("playerPro.scorecard.conceded") : t("playerPro.scorecard.active") })}</div>
    <div role="table" aria-label={t("playerPro.scorecard.holes")} style={{ display: "grid", gap: 3 }}>
      {round.scorecard.map((row, index) => <div role="row" key={row.holeId} style={{ display: "grid", gridTemplateColumns: "auto 1fr repeat(5,auto)", gap: 6 }}><span role="cell">{index + 1}</span><span role="cell">{row.name}</span><span role="cell">{t("playerPro.scorecard.par", { par: row.par })}</span><span role="cell">{t("playerPro.scorecard.index", { index: course?.holes[index]?.strokeIndex ?? "—" })}</span><span role="cell">{t("playerPro.scorecard.owed", { strokes: owed[index] ?? 0 })}</span><span role="cell">{t("playerPro.scorecard.gross", { score: row.strokes + row.penalties })}</span><span role="cell">{t("playerPro.scorecard.net", { score: row.strokes + row.penalties - (owed[index] ?? 0) })}</span></div>)}
    </div>
  </section>;
}

function CompetitionScorecard({ career }: { career: PlayerProCareer }) {
  const { t } = useI18n();
  const round = career.activeChallengeGroupRound;
  if (!round) return null;
  return <section data-testid="competition-scorecard" aria-label={t("playerPro.competition.title")} style={cardStyle}>
    <strong>{t("playerPro.competition.title")}</strong>
    <div>{t("playerPro.competition.setup", { tee: round.teeSet, rating: round.course.rating?.courseRating ?? "—", slope: round.course.rating?.slope ?? "—", par: round.course.holes.reduce((total, hole) => total + hole.par, 0), format: round.match.scoringMode })}</div>
    <small>{t("playerPro.competition.status", { phase: round.phase, concessions: round.match.concessions.length, withdrawals: round.match.withdrawals.length })}</small>
    {round.golfers.map((golfer) => <details key={golfer.id}><summary>{t("playerPro.competition.player", { name: golfer.name, index: formatHandicapIndex(golfer.handicap.handicapIndex), course: golfer.handicap.courseHandicap, playing: golfer.handicap.playingHandicap, withdrawn: golfer.withdrawn ? t("playerPro.competition.withdrawn") : t("playerPro.competition.playing") })}</summary>
      <small>{t("playerPro.scorecard.setup", { tee: golfer.setup.teeSet, rating: golfer.setup.rating.courseRating, slope: golfer.setup.rating.slope, par: golfer.scorecard.reduce((sum, score) => sum + score.par, 0), index: formatHandicapIndex(golfer.handicap.handicapIndex), courseHandicap: golfer.handicap.courseHandicap, playingHandicap: golfer.handicap.playingHandicap, allowance: `${Math.round(golfer.handicap.allowance * 100)}%` })} · {t("courseSetup.pin", { rotation: golfer.setup.pinRotation })}</small>
      <div role="table" aria-label={t("playerPro.competition.card", { name: golfer.name })} style={{ display: "grid", gap: 3, marginTop: 5 }}>
        {golfer.scorecard.map((score, index) => <div role="row" key={score.holeId} style={{ display: "grid", gridTemplateColumns: "repeat(6,auto)", justifyContent: "space-between", gap: 5 }}><span role="cell">{index + 1}</span><span role="cell">{t("playerPro.scorecard.par", { par: score.par })}</span><span role="cell">{t("playerPro.scorecard.index", { index: score.strokeIndex })}</span><span role="cell">{t("playerPro.scorecard.owed", { strokes: score.handicapStrokes })}</span><span role="cell">{t("playerPro.scorecard.gross", { score: score.gross ?? "—" })}</span><span role="cell">{t("playerPro.scorecard.net", { score: score.net ?? "—" })}</span></div>)}
      </div>
    </details>)}
  </section>;
}

function ItemCard({ item, onToggle, toggleDisabled = false }: { item: SocialItemPresentation; onToggle?: (itemId: string) => void; toggleDisabled?: boolean }) {
  const { t } = useI18n();
  const warningId = `social-item-${item.id}-warnings`;
  const actionLabel = item.equipped ? t("playerPro.social.unequip") : t("playerPro.social.equip");
  const warnings = item.transferWarnings.map((warning) => warning === "unique-high-prestige"
    ? t("playerPro.social.transfer.unique")
    : t("playerPro.social.transfer.default"));
  return <article data-testid={`social-item-${item.id}`} style={cardStyle}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
      <div><strong>{item.name}</strong><small style={{ display: "block" }}>{item.category} · {formatCurrency(item.value)} · {t("playerPro.social.prestige", { prestige: item.prestige })}</small></div>
      {item.equipped && <span aria-hidden="true">✓</span>}
    </div>
    {item.escrowed && <strong>{t("playerPro.social.escrowed")}</strong>}
    {warnings.length > 0 && <div id={warningId}>{warnings.map((warning, index) => <small key={item.transferWarnings[index]} style={{ display: "block" }}>{warning}</small>)}</div>}
    {onToggle && <button type="button" aria-label={`${actionLabel} · ${item.name}`} aria-describedby={warnings.length > 0 ? warningId : undefined} aria-pressed={item.equipped} disabled={item.escrowed || toggleDisabled} onClick={() => onToggle(item.id)}>{actionLabel}</button>}
  </article>;
}

function EmptySocial({ message }: { message: string }) {
  return <p style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,.48)" }}>{message}</p>;
}

const CHALLENGE_FORMATS = ["individual", "four-ball", "alternate-shot", "scramble"] as const;
const CHALLENGE_SCORING = ["gross-stroke", "net-stroke", "gross-match", "net-match", "net-stableford"] as const;
const CHALLENGE_SIDE_BETS = ["skins", "nassau", "closest-to-pin", "longest-drive"] as const;

function ParticipantChallengeSetup(props: {
  label: string;
  testId: string;
  value: { teeSet: TeeSet; pinRotation: PinRotation };
  onChange: (value: { teeSet: TeeSet; pinRotation: PinRotation }) => void;
}) {
  const { t } = useI18n();
  return <fieldset style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}><legend>{props.label}</legend>
    <label>{t("playerPro.play.tee")}<select data-testid={`${props.testId}-tee`} value={props.value.teeSet} onChange={(event) => props.onChange({ ...props.value, teeSet: event.target.value as TeeSet })} style={{ display: "block", width: "100%" }}>{(["forward", "member", "championship"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>{t("playerPro.play.pin")}<select data-testid={`${props.testId}-pin`} value={props.value.pinRotation} onChange={(event) => props.onChange({ ...props.value, pinRotation: event.target.value as PinRotation })} style={{ display: "block", width: "100%" }}>{(["A", "B", "C"] as const).map((value) => <option key={value}>{value}</option>)}</select></label>
  </fieldset>;
}

function ChallengeContractBuilder(props: {
  career: PlayerProCareer;
  course: Course;
  world: World;
  day: number;
  onChallenge: (draft: PlayerChallengeContractDraft) => Promise<string | null>;
  onCancel: () => Promise<string | null>;
  onNotice: (notice: string) => void;
}) {
  const { t } = useI18n();
  const rivals = useMemo(() => playerChallengeContractRivals(props.world), [props.world]);
  const layouts = normalizeCourseLayouts(props.course).layouts ?? [];
  const playable = layouts.filter((layout) => layout.state === "open" && layout.publishedHoleIds.length >= 3);
  const [opponentId, setOpponentId] = useState(rivals[0]?.id ?? "");
  const [layoutId, setLayoutId] = useState(playable[0]?.id ?? layouts[0]?.id ?? "");
  const [teamFormat, setTeamFormat] = useState<PlayerChallengeContractDraft["teamFormat"]>("individual");
  const [scoring, setScoring] = useState<PlayerChallengeContractDraft["scoring"]>("net-match");
  const defaultSetup = { teeSet: "member" as const, pinRotation: props.course.activePinRotation ?? "A" as PinRotation };
  const [participantSetups, setParticipantSetups] = useState<PlayerChallengeContractDraft["participantSetups"]>({
    player: defaultSetup,
    rival: defaultSetup,
    playerPartner: defaultSetup,
    rivalPartner: defaultSetup,
  });
  const [playerPartnerId, setPlayerPartnerId] = useState("");
  const [rivalPartnerId, setRivalPartnerId] = useState("");
  const [playerCash, setPlayerCash] = useState(100);
  const [rivalCash, setRivalCash] = useState(100);
  const [playerItemIds, setPlayerItemIds] = useState<string[]>([]);
  const [rivalItemIds, setRivalItemIds] = useState<string[]>([]);
  const [ownerTransfersConfirmed, setOwnerTransfersConfirmed] = useState(false);
  const [prestigeTransfersConfirmed, setPrestigeTransfersConfirmed] = useState(false);
  const [rivalTransfersConfirmed, setRivalTransfersConfirmed] = useState(false);
  const [sideBets, setSideBets] = useState<PlayerChallengeSideBetDraft[]>(CHALLENGE_SIDE_BETS.map((kind) => ({ kind, stake: 25, enabled: false })));
  const [rematchChallengeId, setRematchChallengeId] = useState("");
  const rival = rivals.find((candidate) => candidate.id === opponentId) ?? rivals[0];
  const draft: PlayerChallengeContractDraft = {
    ...(rematchChallengeId ? { rematchChallengeId } : {}),
    opponentId: rival?.id ?? opponentId,
    layoutId,
    teamFormat,
    scoring,
    participantSetups,
    ...(playerPartnerId ? { playerPartnerId } : {}),
    ...(rivalPartnerId ? { rivalPartnerId } : {}),
    playerCash,
    rivalCash,
    playerItemIds,
    rivalItemIds,
    sideBets,
    ownerTransfersConfirmed,
    prestigeTransfersConfirmed,
    rivalTransfersConfirmed,
  };
  const preview = (() => {
    try {
      return { value: previewPlayerChallengeContract({ course: props.course, world: props.world, day: props.day, draft }), error: null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "Challenge terms are invalid." };
    }
  })();
  const toggleItem = (id: string, selected: readonly string[], update: (ids: string[]) => void) => update(selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id]);
  const active = props.career.activeChallengeRuntime;
  const history = props.career.challenges.filter((challenge) => challenge.challengeContractId || challenge.challengeSettlement).slice(-8).reverse();
  return <section data-testid="challenge-contract-builder" style={{ ...cardStyle, gap: 9 }}>
    <strong>{t("playerPro.match.title")}</strong>
    {active ? <>
      <div role="status" data-testid="challenge-contract-status">{active.phase} · {active.contract.terms.format.teamFormat} · {active.contract.terms.format.scoring}</div>
      {active.phase === "escrowed" && <button data-testid="cancel-challenge-contract" onClick={() => void props.onCancel().then((message) => props.onNotice(message ?? `✓ ${t("challenge.cancel")}`))}>{t("challenge.cancel")}</button>}
    </> : <>
      {rivals.length === 0 && <div role="alert">{t("playerPro.match.none")}</div>}
      <>
        <label>{t("challenge.rival")}<select data-testid="challenge-rival" value={rival?.id ?? ""} onChange={(event) => { setOpponentId(event.target.value); setRivalItemIds([]); setRematchChallengeId(""); }} style={{ display: "block", width: "100%" }}>{rivals.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        {rematchChallengeId && <div role="status">{t("challenge.rematchReady")}</div>}
        <label>{t("playerPro.play.route")}<select data-testid="challenge-route" value={layoutId} onChange={(event) => setLayoutId(event.target.value)} style={{ display: "block", width: "100%" }}>{layouts.map((layout) => <option key={layout.id} value={layout.id} disabled={layout.state !== "open" || layout.publishedHoleIds.length < 3}>{layout.name}</option>)}</select></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <label>{t("challenge.format")}<select data-testid="challenge-format" value={teamFormat} onChange={(event) => setTeamFormat(event.target.value as typeof teamFormat)} style={{ display: "block", width: "100%" }}>{CHALLENGE_FORMATS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>{t("challenge.scoring")}<select data-testid="challenge-scoring" value={scoring} onChange={(event) => setScoring(event.target.value as typeof scoring)} style={{ display: "block", width: "100%" }}>{CHALLENGE_SCORING.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        <ParticipantChallengeSetup label={t("challenge.setup", { name: props.career.identity.name })} testId="challenge-player" value={participantSetups.player} onChange={(value) => setParticipantSetups({ ...participantSetups, player: value })} />
        <ParticipantChallengeSetup label={t("challenge.setup", { name: rival?.name ?? t("challenge.rival") })} testId="challenge-rival" value={participantSetups.rival} onChange={(value) => setParticipantSetups({ ...participantSetups, rival: value })} />
        {teamFormat !== "individual" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <label>{t("challenge.partner", { name: props.career.identity.name })}<select data-testid="challenge-player-partner" value={playerPartnerId} onChange={(event) => setPlayerPartnerId(event.target.value)} style={{ display: "block", width: "100%" }}><option value="">{t("challenge.select")}</option>{rivals.filter((candidate) => candidate.id !== rival?.id).map((candidate) => <option key={candidate.id}>{candidate.id}</option>)}</select></label>
          <label>{t("challenge.partner", { name: rival?.name ?? t("challenge.rival") })}<select data-testid="challenge-rival-partner" value={rivalPartnerId} onChange={(event) => setRivalPartnerId(event.target.value)} style={{ display: "block", width: "100%" }}><option value="">{t("challenge.select")}</option>{rivals.filter((candidate) => candidate.id !== rival?.id && candidate.id !== playerPartnerId).map((candidate) => <option key={candidate.id}>{candidate.id}</option>)}</select></label>
        </div>}
        {teamFormat !== "individual" && <>
          <ParticipantChallengeSetup label={t("challenge.setup", { name: rivals.find((candidate) => candidate.id === playerPartnerId)?.name ?? t("challenge.select") })} testId="challenge-player-partner" value={participantSetups.playerPartner ?? participantSetups.player} onChange={(value) => setParticipantSetups({ ...participantSetups, playerPartner: value })} />
          <ParticipantChallengeSetup label={t("challenge.setup", { name: rivals.find((candidate) => candidate.id === rivalPartnerId)?.name ?? t("challenge.select") })} testId="challenge-rival-partner" value={participantSetups.rivalPartner ?? participantSetups.rival} onChange={(value) => setParticipantSetups({ ...participantSetups, rivalPartner: value })} />
        </>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><label>{t("challenge.cash", { name: props.career.identity.name })}<input data-testid="challenge-player-cash" type="number" min={0} step={25} value={playerCash} onChange={(event) => setPlayerCash(Math.max(0, Math.floor(Number(event.target.value))))} style={{ width: "100%" }} /></label><label>{t("challenge.cash", { name: rival?.name ?? t("challenge.rival") })}<input data-testid="challenge-rival-cash" type="number" min={0} step={25} value={rivalCash} onChange={(event) => setRivalCash(Math.max(0, Math.floor(Number(event.target.value))))} style={{ width: "100%" }} /></label></div>
        <details><summary>{t("challenge.items", { name: props.career.identity.name, count: playerItemIds.length })}</summary>{props.career.inventory.items.filter((item) => item.transferable && item.ownerId === props.career.identity.id && item.custodianId === props.career.identity.id && !props.career.inventory.escrowItemIds.includes(item.id)).map((item) => <label key={item.id} style={{ display: "block" }}><input data-testid={`challenge-player-item-${item.id}`} type="checkbox" checked={playerItemIds.includes(item.id)} onChange={() => toggleItem(item.id, playerItemIds, setPlayerItemIds)} /> {item.name} · {formatCurrency(item.remainingValue)}</label>)}</details>
        <details><summary>{t("challenge.items", { name: rival?.name ?? t("challenge.rival"), count: rivalItemIds.length })}</summary>{rival?.holdings.map((item) => <label key={item.id} style={{ display: "block" }}><input data-testid={`challenge-rival-item-${item.id}`} type="checkbox" checked={rivalItemIds.includes(item.id)} onChange={() => toggleItem(item.id, rivalItemIds, setRivalItemIds)} /> {item.name} · {formatCurrency(item.remainingValue)}</label>)}</details>
        <details><summary>{t("challenge.sideBets")}</summary>{sideBets.map((sideBet, index) => <div key={sideBet.kind} style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 5 }}><label><input data-testid={`challenge-sidebet-${sideBet.kind}`} type="checkbox" checked={sideBet.enabled} onChange={(event) => setSideBets(sideBets.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, enabled: event.target.checked } : candidate))} /> {sideBet.kind}</label><input aria-label={`${sideBet.kind} ${t("stat.cash")}`} type="number" min={1} step={25} value={sideBet.stake} onChange={(event) => setSideBets(sideBets.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, stake: Math.max(1, Math.floor(Number(event.target.value))) } : candidate))} /></div>)}</details>
        <label><input data-testid="challenge-confirm-owner" type="checkbox" checked={ownerTransfersConfirmed} onChange={(event) => setOwnerTransfersConfirmed(event.target.checked)} /> {t("challenge.confirmOwner")}</label>
        <label><input data-testid="challenge-confirm-prestige" type="checkbox" checked={prestigeTransfersConfirmed} onChange={(event) => setPrestigeTransfersConfirmed(event.target.checked)} /> {t("challenge.confirmPrestige")}</label>
        <label><input data-testid="challenge-confirm-rival" type="checkbox" checked={rivalTransfersConfirmed} onChange={(event) => setRivalTransfersConfirmed(event.target.checked)} /> {t("challenge.confirmRival")}</label>
        <div role="note" data-testid="challenge-stakes-warning" style={{ padding: 8, borderRadius: 7, background: "#f5e5b8" }}>{t("challenge.accept")}. {t("challenge.cancel")}. {t("challenge.warning")} {t("challenge.rematchReady")}</div>
        {preview.value ? <div data-testid="challenge-value-preview">{t("challenge.values", { player: formatCurrency(preview.value.evaluation.valueComparison.playerValue), rival: formatCurrency(preview.value.evaluation.valueComparison.rivalValue), difference: preview.value.evaluation.valueComparison.valueDifferencePercent.toFixed(1), status: preview.value.evaluation.valueComparison.withinTolerance ? t("challenge.withinTolerance") : t("challenge.addCash", { amount: formatCurrency(preview.value.evaluation.valueComparison.cashBalancingAmount) }) })}</div> : <div role="alert">{preview.error}</div>}
        <button data-testid="accept-challenge-contract" disabled={!preview.value?.evaluation.appraisalEligible} onClick={() => void props.onChallenge(draft).then((message) => props.onNotice(message ?? `✓ ${t("challenge.accept")}`))}>{t("challenge.accept")}</button>
      </>
    </>}
    {props.career.rivalCustody.length > 0 && <details open><summary>{t("challenge.custody")}</summary>{props.career.rivalCustody.map((entry) => {
      const rematch = props.career.challenges.find((challenge) => challenge.id === entry.rematchChallengeId && challenge.status === "offered");
      return <div key={entry.id}>{entry.itemSnapshot.name} · {entry.status} · {entry.rivalName}{rematch && <button data-testid={`prepare-rematch-${entry.id}`} onClick={() => {
        setRematchChallengeId(rematch.id);
        setOpponentId(rematch.opponentId);
        setTeamFormat("individual");
        setPlayerCash(0);
        setRivalCash(0);
        setPlayerItemIds([]);
        setRivalItemIds([]);
        setSideBets(CHALLENGE_SIDE_BETS.map((kind) => ({ kind, stake: 25, enabled: false })));
      }}>{t("challenge.prepareRematch")}</button>}</div>;
    })}</details>}
    {history.length > 0 && <details><summary>{t("challenge.history")}</summary>{history.map((entry) => <div key={entry.id}>{entry.opponentName} · {entry.status} · {entry.result ?? entry.challengeSettlement?.evidence.kind ?? "pending"}</div>)}</details>}
  </section>;
}

export function PlayerProPanel(props: {
  career: PlayerProCareer;
  course: Course;
  world: World;
  day: number;
  onUpdateIdentity: (identity: PlayerProCareer["identity"]) => void;
  onStartRound: (layoutId: string, teeSet: TeeSet, pinRotation: PinRotation) => Promise<string | null>;
  onTrain: (option: PlayerTrainingOption) => Promise<string | null>;
  onChallenge: (draft: PlayerChallengeContractDraft | null) => Promise<string | null>;
  onMentorChallenge: (opponent: PlayerOpponent) => Promise<string | null>;
  onLoadout: (loadout: EquipmentLoadout) => Promise<string | null>;
  onTournament: (event: TournamentEvent) => Promise<string | null>;
  onResume: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ProTab>(props.career.activeRound ? "play" : "career");
  const layouts = normalizeCourseLayouts(props.course).layouts ?? [];
  const playable = layouts.filter((layout) => layout.state === "open" && layout.publishedHoleIds.length >= 3);
  const [layoutId, setLayoutId] = useState(playable[0]?.id ?? layouts[0]?.id ?? "");
  const [teeSet, setTeeSet] = useState<TeeSet>("member");
  const [pinRotation, setPinRotation] = useState<PinRotation>(props.course.activePinRotation ?? "A");
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(props.career.identity.name);
  const [appearance, setAppearance] = useState<PlayerProAppearance>(props.career.identity.appearance);
  const [handedness, setHandedness] = useState<PlayerProHandedness>(props.career.identity.handedness);
  const [background, setBackground] = useState<PlayerProBackground>(props.career.identity.background);
  const options = useMemo(() => playerTrainingOptions(props.course, props.world, props.day), [props.course, props.day, props.world]);
  const opponents = useMemo(() => eligiblePlayerOpponents(props.world), [props.world]);
  const events = tournamentCalendar(props.world).events.filter((event) => event.status === "scheduled");
  const social = useMemo(() => buildPlayerProSocialPresentation(props.world, props.career), [props.career, props.world]);
  const functionalItems = props.career.inventory.items.filter((item) => authoredEquipmentModifiers(item).length > 0);
  const equippedItemIds = new Set([...
    props.career.equipmentLoadout.clubItemIds,
    props.career.equipmentLoadout.bagItemId,
    props.career.equipmentLoadout.outfitItemId,
    props.career.equipmentLoadout.watchItemId,
  ].filter((id): id is string => typeof id === "string"));
  const toggleEquipment = (itemId: string) => {
    const item = props.career.inventory.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const current = props.career.equipmentLoadout;
    let next: EquipmentLoadout = current;
    if (item.category === "club") next = { ...current, clubItemIds: equippedItemIds.has(item.id) ? current.clubItemIds.filter((id) => id !== item.id) : [...current.clubItemIds, item.id] };
    else if (item.category === "bag") next = { ...current, bagItemId: equippedItemIds.has(item.id) ? undefined : item.id };
    else if (item.category === "outfit") next = { ...current, outfitItemId: equippedItemIds.has(item.id) ? undefined : item.id };
    else if (item.category === "watch") next = { ...current, watchItemId: equippedItemIds.has(item.id) ? undefined : item.id };
    void props.onLoadout(next).then((message) => setNotice(message ?? `✓ ${t("playerPro.equipmentMentor.updated")}`));
  };
  const roundPreview = useMemo(() => {
    const selectedLayoutPlayable = (normalizeCourseLayouts(props.course).layouts ?? [])
      .some((layout) => layout.id === layoutId && layout.state === "open" && layout.publishedHoleIds.length >= 3);
    if (!selectedLayoutPlayable) return null;
    const started = startEquippedPlayableRound({ course: props.course, world: props.world, layoutId, teeSet, pinRotation, day: props.day });
    return started.ok ? started.round : null;
  }, [layoutId, pinRotation, props.course, props.day, props.world, teeSet]);

  const tabs: ProTab[] = ["career", "play", "training", "matches", "tournaments"];
  const socialTabs: PlayerProSocialSurface[] = ["people", "challenges", "teamBuilder", "equipment", "wardrobe", "collection", "custody"];
  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="player-pro-title" data-testid="player-pro-panel" style={panelStyle}>
      <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#314d36", color: "#fff8dc", borderBottom: "2px solid #c89c43" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", background: "#f3d990", color: "#30452f", fontSize: 22 }} aria-hidden="true">🏌️</div>
        <div style={{ minWidth: 0, flex: 1 }}><small>{t("playerPro.title")}</small><h2 id="player-pro-title" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{props.career.identity.name}</h2></div>
        <button aria-label={t("playerPro.close")} onClick={props.onClose}>✕</button>
      </header>

      <nav aria-label={t("playerPro.title")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(76px,1fr))", gap: 4, padding: 8, borderBottom: "1px solid rgba(62,48,24,.16)" }}>
        {tabs.map((candidate) => <button key={candidate} data-testid={`player-pro-tab-${candidate}`} aria-pressed={tab === candidate} onClick={() => setTab(candidate)} style={{ padding: "7px 3px", borderRadius: 7, border: tab === candidate ? "2px solid #466243" : "1px solid rgba(52,43,25,.15)", background: tab === candidate ? "#d9ebcf" : "rgba(255,255,255,.55)", fontSize: 10, fontWeight: 800 }}>{t(`playerPro.tab.${candidate}` as MessageKey)}</button>)}
      </nav>
      <nav aria-label={t("playerPro.social.nav")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(78px,1fr))", gap: 4, padding: "0 8px 8px", borderBottom: "1px solid rgba(62,48,24,.16)" }}>
        {socialTabs.map((candidate) => <button key={candidate} data-testid={`player-pro-tab-${candidate}`} aria-pressed={tab === candidate} onClick={() => setTab(candidate)} style={{ padding: "7px 3px", borderRadius: 7, border: tab === candidate ? "2px solid #466243" : "1px solid rgba(52,43,25,.15)", background: tab === candidate ? "#d9ebcf" : "rgba(255,255,255,.55)", fontSize: 10, fontWeight: 800 }}>{t(`playerPro.tab.${candidate}` as MessageKey)}</button>)}
      </nav>

      <div id={`player-pro-surface-${tab}`} role="region" aria-label={t(`playerPro.tab.${tab}` as MessageKey)} style={{ padding: 14, display: "grid", gap: 14 }}>
        {notice && <div role="status" style={{ padding: 8, borderRadius: 8, background: notice.startsWith("✓") ? "#dfeeda" : "#f7dfd7", color: "#492b20" }}>{notice}</div>}

        {tab === "career" && <>
          <section style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              <input aria-label={t("playerPro.creation.name")} value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
              <select aria-label={t("playerPro.creation.appearance")} value={appearance} onChange={(event) => setAppearance(event.target.value as PlayerProAppearance)}>
                {(["classic", "sport", "heritage"] as const).map((value) => <option key={value} value={value}>{t(`playerPro.appearance.${value}` as MessageKey)}</option>)}
              </select>
              <select aria-label={t("playerPro.creation.handedness")} value={handedness} onChange={(event) => setHandedness(event.target.value as PlayerProHandedness)}>
                {(["right", "left"] as const).map((value) => <option key={value} value={value}>{t(`playerPro.handedness.${value}` as MessageKey)}</option>)}
              </select>
              <select aria-label={t("playerPro.creation.background")} value={background} onChange={(event) => setBackground(event.target.value as PlayerProBackground)}>
                {(["architect", "operator", "host"] as const).map((value) => <option key={value} value={value}>{t(`playerPro.background.${value}` as MessageKey)}</option>)}
              </select>
            </div>
            <small>{t(`playerPro.background.${background}.benefit` as MessageKey)}</small>
            <button onClick={() => props.onUpdateIdentity({ ...props.career.identity, name: name.trim() || props.career.identity.name, appearance, handedness, background })}>{t("playerPro.profile.save")}</button>
          </section>
          <section><h3 style={{ margin: "0 0 8px" }}>{t("playerPro.skills")}</h3><SkillGrid career={props.career} /></section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <strong>{t("playerPro.careerPoints", { points: props.career.careerPoints })}</strong>
            <strong>{t("playerPro.earnings", { amount: formatCurrency(props.career.earnings) })}</strong>
          </div>
          <HandicapSummary career={props.career} />
          <CompetitionScorecard career={props.career} />
          <section data-testid="player-equipment-mentor" style={cardStyle}>
            <strong>{t("playerPro.equipmentMentor.title")}</strong>
            <div>{t("playerPro.equipmentMentor.loadout", { count: props.career.equipmentLoadout.clubItemIds.length + Number(Boolean(props.career.equipmentLoadout.bagItemId)) + Number(Boolean(props.career.equipmentLoadout.outfitItemId)) + Number(Boolean(props.career.equipmentLoadout.watchItemId)) })}</div>
            <small>{props.career.equipmentLoadout.techniqueId
              ? t("playerPro.equipmentMentor.selected", { name: mentorTechniqueDefinition(props.career.equipmentLoadout.techniqueId).name })
              : t("playerPro.equipmentMentor.noTechnique")}</small>
            <div>{props.career.learnedTechniques.length
              ? props.career.learnedTechniques.map((id) => mentorTechniqueDefinition(id).name).join(" · ")
              : t("playerPro.equipmentMentor.noneLearned")}</div>
            {functionalItems.map((item) => <button key={item.id} type="button" aria-pressed={equippedItemIds.has(item.id)} disabled={Boolean(props.career.activeRound || props.career.activeChallengeGroupRound)} onClick={() => toggleEquipment(item.id)}>{equippedItemIds.has(item.id) ? "✓ " : ""}{item.name}</button>)}
            <label>{t("playerPro.equipmentMentor.techniqueLabel")}<select disabled={Boolean(props.career.activeRound || props.career.activeChallengeGroupRound)} value={props.career.equipmentLoadout.techniqueId ?? ""} onChange={(event) => { void props.onLoadout({ ...props.career.equipmentLoadout, techniqueId: event.target.value ? event.target.value as EquipmentLoadout["techniqueId"] : undefined }).then((message) => setNotice(message ?? `✓ ${t("playerPro.equipmentMentor.updated")}`)); }} style={{ display: "block", width: "100%", padding: 7 }}><option value="">{t("playerPro.equipmentMentor.noTechnique")}</option>{props.career.learnedTechniques.map((id) => <option key={id} value={id}>{mentorTechniqueDefinition(id).name}</option>)}</select></label>
            {props.career.activeMentorTechniqueChallenge && <div role="status"><strong>{t("playerPro.equipmentMentor.objective", { name: mentorTechniqueDefinition(props.career.activeMentorTechniqueChallenge.techniqueId).name })}</strong><br /><small>{props.career.activeMentorTechniqueChallenge.objective}</small></div>}
            {props.career.activeRound?.performanceLoadout && <small>{t("playerPro.equipmentMentor.frozen", { count: props.career.activeRound.performanceLoadout.itemIds.length })}</small>}
          </section>
          {props.career.rewardEntitlements.entitlements.length > 0 && <section data-testid="player-reward-entitlements" style={cardStyle}>
            {props.career.rewardEntitlements.entitlements.slice().reverse().map((reward) => <div key={reward.id} style={{ borderTop: "1px solid rgba(60,50,30,.14)", paddingTop: 6 }}>
                <div><strong>{reward.name}</strong> · {reward.status}</div>
                <small>{reward.kind === "service-credit" ? formatCurrency(reward.remainingValue) : reward.remainingQuantity}</small>
              </div>)}
          </section>}
          <section>
            <h3 style={{ margin: "0 0 7px" }}>{t("playerPro.techniques")}</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {playerTechniqueCatalog(props.career.skills).map((item) => <span key={item.technique} style={{ padding: "4px 7px", borderRadius: 999, background: item.unlocked ? "#dbead2" : "rgba(70,65,50,.1)", opacity: item.unlocked ? 1 : .62 }}>{item.unlocked ? "✓" : "🔒"} {t(techniqueKey(item.technique))}</span>)}
            </div>
          </section>
          <section>
            <h3 style={{ margin: "0 0 7px" }}>{t("playerPro.recentRounds")}</h3>
            {props.career.rounds.length === 0 ? <p>{t("playerPro.noRounds")}</p> : props.career.rounds.slice(-6).reverse().map((round) => <div key={round.id} style={{ padding: "7px 0", borderTop: "1px solid rgba(60,50,30,.14)" }}>{t("playerPro.roundLine", { course: round.courseName, score: round.scoreToPar > 0 ? `+${round.scoreToPar}` : round.scoreToPar, result: round.result })}<br /><small>{Object.entries(round.skillGains).map(([skill, gain]) => `+${gain} ${t(labelKey(skill as PlayerProSkill))}`).join(" · ")}</small></div>)}
          </section>
        </>}

        {tab === "play" && <section style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.play.title")}</h3>
          <p style={{ margin: 0, fontSize: 12 }}>{t("playerPro.play.help")}</p>
          {props.career.activeRound ? <>
            <div style={{ padding: 10, borderRadius: 8, background: "#e2eedb" }}><strong>{props.career.activeRound.course.courseName}</strong><div>{t("playerPro.shot.hole", { hole: props.career.activeRound.currentHoleIndex + 1, count: props.career.activeRound.course.holes.length, name: props.career.activeRound.course.holes[props.career.activeRound.currentHoleIndex].name })}</div></div>
            <SnapshotScorecard round={props.career.activeRound} />
            <button data-testid="resume-player-round" onClick={props.onResume}>{t("playerPro.play.resume")}</button>
          </> : <>
            <label>{t("playerPro.play.route")}<select data-testid="player-pro-route" value={layoutId} onChange={(event) => setLayoutId(event.target.value)} style={{ display: "block", width: "100%", padding: 8 }}>{layouts.map((layout) => <option key={layout.id} value={layout.id} disabled={layout.state !== "open" || layout.publishedHoleIds.length < 3}>{layout.name} · {layout.publishedHoleIds.length}</option>)}</select></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label>{t("playerPro.play.tee")}<select value={teeSet} onChange={(event) => setTeeSet(event.target.value as TeeSet)} style={{ display: "block", width: "100%", padding: 8 }}><option value="forward">{t("playerPro.play.tee.forward")}</option><option value="member">{t("playerPro.play.tee.member")}</option><option value="championship">{t("playerPro.play.tee.championship")}</option></select></label>
              <label>{t("playerPro.play.pin")}<select value={pinRotation} onChange={(event) => setPinRotation(event.target.value as PinRotation)} style={{ display: "block", width: "100%", padding: 8 }}><option value="A">{t("playerPro.play.pinOption", { rotation: "A" })}</option><option value="B">{t("playerPro.play.pinOption", { rotation: "B" })}</option><option value="C">{t("playerPro.play.pinOption", { rotation: "C" })}</option></select></label>
            </div>
            {roundPreview && <SnapshotScorecard round={roundPreview} />}
            <button data-testid="start-player-round" disabled={!playable.some((layout) => layout.id === layoutId)} onClick={() => { void props.onStartRound(layoutId, teeSet, pinRotation).then((message) => setNotice(message ?? `✓ ${t("playerPro.play.resume")}`)); }}>{t("playerPro.play.start")}</button>
            {playable.length === 0 && <div role="alert">{t("playerPro.play.blocked")}</div>}
          </>}
        </section>}

        {tab === "training" && <section>
          <h3 style={{ margin: 0 }}>{t("playerPro.training.title")}</h3><p style={{ fontSize: 12 }}>{t("playerPro.training.help")}</p>
          {options.length === 0 ? <p>{t("playerPro.training.none")}</p> : <div style={{ display: "grid", gap: 7 }}>{options.map((option) => <div key={option.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, background: "rgba(255,255,255,.55)" }}><div><strong>{t("playerPro.training.session", { facility: option.facilityName, skill: t(labelKey(option.skill)) })}</strong><br /><small>{t("playerPro.training.meta", { minutes: option.minutes, cost: formatCurrency(option.cost) })}</small>{option.blocker && <div style={{ color: "#873324", fontSize: 11 }}>{t("playerPro.training.blocked", { reason: option.blocker })}</div>}</div><button disabled={!option.available || props.world.cash < option.cost} onClick={() => { void props.onTrain(option).then((message) => setNotice(message ?? `✓ ${t("playerPro.training.start")}`)); }}>{t("playerPro.training.start")}</button></div>)}</div>}
        </section>}

        {tab === "matches" && <section>
          <h3 style={{ margin: 0 }}>{t("playerPro.match.title")}</h3><p style={{ fontSize: 12 }}>{t("playerPro.match.help")}</p>
          <ChallengeContractBuilder career={props.career} course={props.course} world={props.world} day={props.day} onChallenge={props.onChallenge} onCancel={() => props.onChallenge(null)} onNotice={setNotice} />
          {opponents.length > 0 && <details><summary>{t("playerPro.equipmentMentor.title")}</summary><div style={{ display: "grid", gap: 7 }}>{opponents.map((opponent) => {
            const mentor = mentorTechniqueEligibility(props.world, opponent.id);
            return <div key={opponent.id} style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,.55)" }}><strong>{opponent.name}</strong>{mentor.techniqueId && !props.career.learnedTechniques.includes(mentor.techniqueId) && <button data-testid={`start-mentor-${opponent.id}`} disabled={!mentor.eligible} title={mentor.blockers.join(" ")} onClick={() => { void props.onMentorChallenge(opponent).then((message) => setNotice(message ?? `✓ ${t("playerPro.play.resume")}`)); }}>{t("playerPro.equipmentMentor.startObjective")}</button>}</div>;
          })}</div></details>}
        </section>}

        {tab === "people" && social && <section data-testid="player-pro-people" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.people")}</h3>
          {social.people.length === 0 ? <EmptySocial message={t("livingClub.people.empty")} /> : social.people.map((person) => <article key={person.id} data-testid={`player-pro-person-${person.id}`} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{person.name}</strong><span>{person.relationship.tier} · {person.relationship.score}</span></div>
            {person.biography && <p style={{ margin: 0 }}>{person.biography}</p>}
            {person.occupation && <small>{person.occupation} · {person.communityRole}</small>}
            <div>{t("retention.roundCount", { count: person.rounds })} · {t("playerPro.handicap.title")} {person.handicap ?? "—"}</div>
            {person.preferredFormats.length > 0 && <div>{t("challenge.format")}: {person.preferredFormats.join(" · ")}</div>}
            {person.revealedHistory.length > 0 && <details><summary>{t("livingClub.history")} ({person.revealedHistory.length})</summary>{person.revealedHistory.map((fact) => <div key={fact.id}>{fact.text} <small>· {fact.revealedBy}</small></div>)}</details>}
            {person.knownHoldings.length > 0 && <details><summary>{t("playerPro.social.people.holdings", { count: person.knownHoldings.length })}</summary>{person.knownHoldings.map((item) => <ItemCard key={item.id} item={item} />)}</details>}
            {person.pastMatches.length > 0 && <details><summary>{t("playerPro.tab.matches")} ({person.pastMatches.length})</summary>{person.pastMatches.map((match) => <div key={match.id}>{match.kind} · {match.status} · {match.result ?? "—"}</div>)}</details>}
            {person.grantedRewardConnections.length > 0 && <details><summary>{t("playerPro.social.people.rewards", { count: person.grantedRewardConnections.length })}</summary>{person.grantedRewardConnections.map((reward) => <div key={reward.id}>{reward.name} · {reward.kind} · {reward.status}</div>)}</details>}
          </article>)}
        </section>}

        {tab === "challenges" && social && <section data-testid="player-pro-challenges" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.challenges")}</h3>
          {social.challenge.runtime ? <article data-testid="social-challenge-runtime" style={cardStyle}>
            <strong>{social.challenge.runtime.phase} · {social.challenge.runtime.format.teamFormat} · {social.challenge.runtime.format.scoring}</strong>
            {social.challenge.runtime.escrow && <div data-testid="social-challenge-escrow">{t("playerPro.social.challenges.escrow", { status: social.challenge.runtime.escrow.status, cash: formatCurrency(social.challenge.runtime.escrow.player?.reservedCash ?? 0), items: social.challenge.runtime.escrow.player?.itemIds.length ?? 0 })}</div>}
            <div>{social.challenge.runtime.firstShot ? t("playerPro.social.locked", { shot: social.challenge.runtime.firstShot.shotId }) : t("challenge.cancel")}</div>
          </article> : <EmptySocial message={t("playerPro.social.noContract")} />}
          {social.challenge.history.length > 0 && <details><summary>{t("challenge.history")} ({social.challenge.history.length})</summary>{social.challenge.history.slice().reverse().map((entry) => <div key={entry.id} style={{ padding: "6px 0", borderTop: "1px solid rgba(60,50,30,.14)" }}>{entry.opponentName} · {entry.status} · {entry.result ?? "—"}{entry.settlement && <small style={{ display: "block" }}>{entry.settlement.kind} · {entry.settlement.transferredItemIds.length}</small>}</div>)}</details>}
          <ChallengeContractBuilder career={props.career} course={props.course} world={props.world} day={props.day} onChallenge={props.onChallenge} onCancel={() => props.onChallenge(null)} onNotice={setNotice} />
        </section>}

        {tab === "teamBuilder" && social && <section data-testid="player-pro-team-builder" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.teamBuilder")}</h3>
          {social.teamBuilder.activeGroup && <article data-testid="social-active-group" style={cardStyle}>
            <strong>{social.teamBuilder.activeGroup.golfers.length} · {social.teamBuilder.activeGroup.match.scoringMode} · {social.teamBuilder.activeGroup.phase}</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 7 }}>
              {social.teamBuilder.activeGroup.golfers.map((golfer) => <div key={golfer.id} style={{ padding: 7, borderRadius: 7, background: "rgba(255,255,255,.62)" }}><strong>{golfer.name}</strong><small style={{ display: "block" }}>{golfer.teamId || t("golfer.none")} · {t("playerPro.handicap.title")} {formatHandicapIndex(golfer.handicap.handicapIndex)}</small><small>{golfer.setup.teeSet} / {golfer.setup.pinRotation} · {golfer.controller}</small></div>)}
            </div>
          </article>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 7 }}>
            {social.teamBuilder.candidates.map((candidate) => <article key={candidate.id} style={cardStyle}><strong>{candidate.name}</strong><small>{candidate.relationship.tier} · {t("playerPro.handicap.title")} {candidate.handicap == null ? "—" : formatHandicapIndex(candidate.handicap)}</small><small>{candidate.preferredFormats.join(" · ") || t("golfer.none")}</small></article>)}
          </div>
        </section>}

        {tab === "equipment" && social && <section data-testid="player-pro-equipment" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.equipment")}</h3>
          {social.equipment.items.length === 0 ? <EmptySocial message={t("playerPro.social.items.empty")} /> : social.equipment.items.map((item) => <ItemCard key={item.id} item={item} onToggle={toggleEquipment} toggleDisabled={Boolean(props.career.activeRound || props.career.activeChallengeGroupRound)} />)}
          <label>{t("playerPro.equipmentMentor.techniqueLabel")}<select disabled={Boolean(props.career.activeRound || props.career.activeChallengeGroupRound)} value={props.career.equipmentLoadout.techniqueId ?? ""} onChange={(event) => { void props.onLoadout({ ...props.career.equipmentLoadout, techniqueId: event.target.value ? event.target.value as EquipmentLoadout["techniqueId"] : undefined }).then((message) => setNotice(message ?? `✓ ${t("playerPro.equipmentMentor.updated")}`)); }} style={{ display: "block", width: "100%", padding: 7 }}><option value="">{t("playerPro.equipmentMentor.noTechnique")}</option>{props.career.learnedTechniques.map((id) => <option key={id} value={id}>{mentorTechniqueDefinition(id).name}</option>)}</select></label>
        </section>}

        {tab === "wardrobe" && social && <section data-testid="player-pro-wardrobe" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.wardrobe")}</h3>
          {social.wardrobe.items.length === 0 ? <EmptySocial message={t("playerPro.social.items.empty")} /> : social.wardrobe.items.map((item) => <ItemCard key={item.id} item={item} onToggle={toggleEquipment} toggleDisabled={Boolean(props.career.activeRound || props.career.activeChallengeGroupRound)} />)}
        </section>}

        {tab === "collection" && social && <section data-testid="player-pro-collection" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.collection")}</h3>
          {social.collection.items.map((item) => <ItemCard key={item.id} item={item} />)}
          {social.collection.careerTrophies.map((trophy) => <article key={trophy.id} style={cardStyle}><strong>{trophy.name}</strong><small>{t("playerPro.social.collection.trophyMeta", { course: trophy.courseName, week: trophy.week })}</small></article>)}
          {social.collection.rewards.map((reward) => <article key={reward.id} style={cardStyle}><strong>{reward.name}</strong><small>{reward.kind} · {reward.status} · {reward.grantingPersonName}</small><small>{reward.remainingQuantity} · {formatCurrency(reward.remainingValue)}</small></article>)}
          {social.collection.items.length + social.collection.careerTrophies.length + social.collection.rewards.length === 0 && <EmptySocial message={t("retention.emptyHall")} />}
        </section>}

        {tab === "custody" && social && <section data-testid="player-pro-custody" style={{ display: "grid", gap: 9 }}>
          <h3 style={{ margin: 0 }}>{t("playerPro.tab.custody")}</h3>
          {social.custody.length === 0 ? <EmptySocial message={t("playerPro.social.noCustody")} /> : social.custody.map((entry) => <article key={entry.id} style={cardStyle}><strong>{entry.item.name} · {entry.status}</strong><div>{entry.rivalName} · {t("property.ledger.when", { week: entry.acquiredWeek, day: entry.acquiredDay + 1 })}</div>{entry.rematchChallengeId && <small>{t("challenge.rematchReady")}</small>}</article>)}
        </section>}

        {tab === "tournaments" && <section>
          <h3 style={{ margin: 0 }}>{t("playerPro.tournament.title")}</h3><p style={{ fontSize: 12 }}>{t("playerPro.tournament.help")}</p>
          {events.length === 0 ? <p>{t("playerPro.tournament.none")}</p> : <div style={{ display: "grid", gap: 7 }}>{events.map((event) => {
            const eligibility = playerTournamentEligibility(props.career, event);
            return <div key={event.id} style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,.55)" }}><strong>{event.name}</strong><small style={{ display: "block" }}>{t("playerPro.tournament.meta", { tier: event.tier, week: event.scheduledWeek, day: event.scheduledDay + 1 })}</small>{!eligibility.eligible && <div style={{ color: "#873324", fontSize: 11 }}>{t("playerPro.tournament.blocked", { reason: eligibility.reason ?? "" })}</div>}<button disabled={!eligibility.eligible} onClick={() => { void props.onTournament(event).then((message) => setNotice(message ?? `✓ ${t("playerPro.play.resume")}`)); }} style={{ marginTop: 6 }}>{t("playerPro.tournament.enter")}</button></div>;
          })}</div>}
        </section>}
      </div>
    </aside>
  );
}

export function PlayerShotHud(props: {
  career: PlayerProCareer;
  round: PlayerPlayableRound;
  aim: PlayerProPoint;
  onAim: (point: PlayerProPoint) => void;
  onCommit: (selection: PlayerShotSelection) => void;
  onAdvance: () => void;
  onAutoFinish: () => void;
  onConcede: () => void;
  onReturnToDesign: () => void;
}) {
  const { t } = useI18n();
  const caddie = useMemo(() => caddieShotGuidance(props.round, props.career.skills), [props.career.skills, props.round]);
  const clubs = availablePlayerClubs(props.round.lie);
  const [club, setClub] = useState(caddie.selection.club);
  const [power, setPower] = useState(caddie.selection.power);
  const [technique, setTechnique] = useState<PlayerShotTechnique>("normal");
  const [flightProfile, setFlightProfile] = useState<ShotFlightProfile>("standard");
  const [flightNotice, setFlightNotice] = useState<string | null>(null);
  const hole = props.round.course.holes[props.round.currentHoleIndex];
  const selectedClub = clubs.some((candidate) => candidate.name === club) ? club : clubs[0]?.name ?? "Pitching Wedge";
  const requiredFlight = constrainedFlight(technique);
  const selectedFlight = requiredFlight ?? flightProfile;
  const selection: PlayerShotSelection = { club: selectedClub, aim: props.aim, power, technique, flightProfile: selectedFlight };
  const preview = previewPlayableShot(props.round, props.career.skills, selection);
  const previewRouteEvidence = preview.sharedOutcome ? clearanceLabel(preview.sharedOutcome.flight.clearance, t) : null;
  const techniques = playerTechniqueCatalog(props.career.skills);
  const yards = Math.round(Math.hypot(hole.pin.x - props.round.ball.x, hole.pin.y - props.round.ball.y) * props.round.course.yardsPerTile);
  const latestShot = props.round.pendingShot ?? props.round.shots.at(-1) ?? null;
  const latestOutcome = latestShot?.sharedOutcome ?? null;
  const latestRuling = latestOutcome?.ruling ?? latestShot?.ruling ?? null;
  const latestRelief = latestOutcome?.relief ?? latestShot?.relief ?? null;
  const latestFinalPosition = latestOutcome?.finalPosition ?? latestShot?.finalPosition ?? latestShot?.rest ?? null;

  const useCaddie = () => {
    const next = caddie.selection;
    setClub(next.club);
    setPower(next.power);
    setTechnique(next.technique);
    setFlightProfile(flightProfileForTechnique(next.technique, next.flightProfile));
    setFlightNotice(null);
    props.onAim(next.aim);
  };

  const chooseTechnique = (next: PlayerShotTechnique) => {
    setTechnique(next);
    const forced = constrainedFlight(next);
    if (forced) {
      setFlightProfile(forced);
      setFlightNotice(t("playerPro.shot.flightLocked", { technique: t(techniqueKey(next)), flight: forced }));
    } else {
      setFlightNotice(null);
    }
  };

  const chooseFlight = (next: ShotFlightProfile) => {
    if (requiredFlight && next !== requiredFlight) {
      setFlightNotice(t("playerPro.shot.flightChoose", { technique: t(techniqueKey(technique)), flight: requiredFlight, next }));
      return;
    }
    setFlightProfile(next);
    setFlightNotice(null);
  };

  return (
    <section role="region" aria-label={t("playerPro.shot.title")} data-testid="player-shot-hud" style={{ position: "absolute", zIndex: 215, right: 14, bottom: 78, width: "min(370px,calc(100% - 28px))", maxHeight: "calc(100% - 150px)", overflow: "auto", border: "2px solid #755824", borderRadius: 13, background: "linear-gradient(150deg,#fff9e7,#e9cd8c)", color: "#302819", boxShadow: "0 16px 38px rgba(0,0,0,.4)", padding: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div><small>{t("playerPro.shot.title")}</small><h2 style={{ margin: 0, fontSize: 18 }}>{t("playerPro.shot.hole", { hole: props.round.currentHoleIndex + 1, count: props.round.course.holes.length, name: hole.name })}</h2><div>{t("playerPro.shot.lie", { lie: props.round.lie, yards })}</div></div>
        <strong>{props.round.strokes + props.round.penalties}</strong>
      </header>

      {props.round.phase === "awaiting_shot" && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <label>{t("playerPro.shot.club")}<select data-testid="player-shot-club" value={selectedClub} onChange={(event) => setClub(event.target.value)} style={{ display: "block", width: "100%", padding: 8 }}>{clubs.map((candidate) => <option key={candidate.name} value={candidate.name}>{t("playerPro.shot.clubOption", { club: candidate.name, yards: candidate.carryYards })}</option>)}</select></label>
        <label>{t("playerPro.shot.power", { power: Math.round(power * 100) })}<input data-testid="player-shot-power" type="range" min={25} max={115} value={Math.round(power * 100)} onChange={(event) => setPower(Number(event.target.value) / 100)} style={{ width: "100%" }} /></label>
        <label>{t("playerPro.shot.technique")}<select value={technique} onChange={(event) => chooseTechnique(event.target.value as PlayerShotTechnique)} style={{ display: "block", width: "100%", padding: 8 }}>{techniques.map((item) => <option key={item.technique} value={item.technique} disabled={!item.unlocked}>{t(techniqueKey(item.technique))}{item.requirement ? ` · ${item.requirement}` : ""}</option>)}</select></label>
        <section data-testid="player-shot-caddie-guidance" role="status" aria-live="polite" aria-label={t("playerPro.shot.caddieGuidance.title")} style={{ display: "grid", gap: 3, padding: 8, borderRadius: 8, border: "1px solid rgba(66,97,67,.35)", background: "#e4efdb", fontSize: 12 }}>
          <strong>{t("playerPro.shot.caddieGuidance.title")}</strong>
          <div>{t("playerPro.shot.caddieGuidance.line", { club: caddie.selection.club, power: Math.round(caddie.selection.power * 100), risk: riskLabel(caddie.preview.risk, t) })}</div>
          {caddie.shotSlope && <>
            <div>{t("playerPro.shot.caddieGuidance.distance", { playsLike: Math.round(caddie.shotSlope.playsLikeDistanceYards), adjustment: Math.abs(Math.round(caddie.shotSlope.playsLikeDistanceYards - caddie.shotSlope.flatDistanceYards)), direction: slopeDirection(caddie.shotSlope.playsLikeDistanceYards - caddie.shotSlope.flatDistanceYards, t) })}</div>
            <div>{t("playerPro.shot.caddieGuidance.sidehill", { sidehill: sidehillLabel(caddie.shotSlope.sidehill, t), curve: Math.abs(caddie.shotSlope.naturalCurveBiasTiles).toFixed(1), direction: curveDirection(caddie.shotSlope.naturalCurveBiasTiles, t) })}</div>
          </>}
          <small>{t("playerPro.shot.caddieGuidance.risk", { penalty: caddie.preview.expectedPenalty.toFixed(2) })}</small>
        </section>
        <fieldset style={{ margin: 0, padding: 8, border: "1px solid rgba(73,55,23,.28)", borderRadius: 8 }}>
          <legend style={{ fontSize: 12, fontWeight: 800 }}>{t("playerPro.shot.flight")}</legend>
          <div role="group" aria-label={t("playerPro.shot.flightProfile")} style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
            {FLIGHT_PROFILES.map((profile) => {
              const blocked = requiredFlight !== null && profile !== requiredFlight;
              return <button key={profile} type="button" data-testid={`player-shot-flight-${profile}`} aria-pressed={selectedFlight === profile} aria-describedby={blocked ? "player-shot-flight-constraint" : undefined} onClick={() => chooseFlight(profile)} style={{ padding: "6px 3px", borderRadius: 6, border: selectedFlight === profile ? "2px solid #426143" : "1px solid rgba(73,55,23,.28)", background: blocked ? "rgba(73,55,23,.08)" : selectedFlight === profile ? "#dcebd5" : "#fff9e7", opacity: blocked ? .64 : 1, textTransform: "capitalize" }}>{profile}</button>;
            })}
          </div>
          <small id="player-shot-flight-constraint" role="status" style={{ display: "block", marginTop: 5 }}>{flightNotice ?? (requiredFlight ? t("playerPro.shot.flightLocked", { technique: t(techniqueKey(technique)), flight: requiredFlight }) : t("playerPro.shot.flightHint"))}</small>
        </fieldset>
        <div data-testid="player-shot-preview" style={{ padding: 8, borderRadius: 8, background: preview.risk === "high" ? "#f4d5c8" : preview.risk === "medium" ? "#f4e4b8" : "#dcebd5" }}>
          <strong>{t("playerPro.shot.aim", { x: Math.round(props.aim.x), y: Math.round(props.aim.y) })}</strong>
          <div>{t("playerPro.shot.preview", { carry: Math.round(preview.carryYards), dispersion: preview.dispersionTiles.toFixed(1), risk: preview.risk })}</div>
          {props.round.course.weather && <div data-testid="player-shot-weather">{t("season.shot.weather", {
            kind: props.round.course.weather.kind.replaceAll("_", " "),
            wind: props.round.course.weather.windMph,
            carry: Math.round((props.round.course.weather.carryMultiplier - 1) * 100),
            dispersion: Math.round((props.round.course.weather.dispersionMultiplier - 1) * 100),
          })}</div>}
          <small>{t("playerPro.shot.target", { yards: Math.round(preview.targetYards), penalty: preview.expectedPenalty.toFixed(2) })}</small>
          {preview.shotEffects && <div data-testid="player-shot-lie-effects" style={{ marginTop: 6, fontSize: 12 }}>{t("playerPro.shot.effectiveLie", { source: preview.shotEffects.lieEffect.sourceLie.replaceAll("_", " "), effective: preview.shotEffects.lieEffect.effectiveLie.replaceAll("_", " "), carry: preview.shotEffects.lieEffect.carryMultiplier.toFixed(2), dispersion: preview.shotEffects.lieEffect.dispersionMultiplier.toFixed(2) })}</div>}
          {preview.automaticPuttingEstimate && <div data-testid="player-shot-auto-putt-preview" style={{ marginTop: 6, fontSize: 12 }}>{t("playerPro.shot.autoPuttingPreview", { expected: preview.automaticPuttingEstimate.expectedPutts.toFixed(1), distance: preview.automaticPuttingEstimate.leaveDistanceYards.toFixed(1), break: preview.automaticPuttingEstimate.breakTiles.toFixed(2), speed: preview.automaticPuttingEstimate.realizedSpeedFeet.toFixed(1) })}</div>}
          {preview.sharedOutcome && <div data-testid="player-shot-rules-preview" style={{ display: "grid", gap: 3, marginTop: 7, paddingTop: 7, borderTop: "1px solid rgba(73,55,23,.2)", fontSize: 12 }}>
            <div>{t("playerPro.shot.flightEvidence", { profile: preview.sharedOutcome.flight.profile, launch: preview.sharedOutcome.flight.launchAngleDegrees.toFixed(0), apex: preview.sharedOutcome.flight.apexHeightYards.toFixed(1) })}</div>
            <div>{t("playerPro.shot.route", { route: collisionLabel(preview.sharedOutcome.collision, t) })}</div>
            {previewRouteEvidence && <div>{t("playerPro.shot.routeEvidence", { evidence: previewRouteEvidence })}</div>}
            <div>{t("playerPro.shot.penaltyRisk", { ruling: rulingLabel(preview.sharedOutcome.ruling, t) })}</div>
            <div>{t("playerPro.shot.reliefPreview", { type: preview.sharedOutcome.relief.type.replaceAll("_", " "), position: pointLabel(preview.sharedOutcome.finalPosition) })}</div>
            {preview.greenRollout && <div data-testid="player-shot-green-rollout-preview">{t("playerPro.shot.greenRollout", { pace: preview.greenRollout.pace, speed: preview.greenRollout.evidence.realizedSpeedFeet.toFixed(1), roll: preview.greenRollout.rollYards.toFixed(1), break: preview.greenRollout.breakTiles.toFixed(2), lie: preview.greenRollout.lieAfter.replaceAll("_", " ") })}</div>}
          </div>}
          {preview.blocker && <div role="alert">{t("playerPro.shot.blocked", { reason: preview.blocker })}</div>}
        </div>
        <div style={{ display: "flex", gap: 6 }}><button onClick={useCaddie}>{t("playerPro.shot.caddie")}</button><button data-testid="commit-player-shot" disabled={!preview.available} onClick={() => props.onCommit(selection)} style={{ flex: 1, background: "#426143", color: "white", fontWeight: 900 }}>{t("playerPro.shot.confirm")}</button></div>
      </div>}
      {props.round.phase === "flight" && <div role="status" style={{ marginTop: 10, padding: 12, borderRadius: 8, background: "#dcebd5" }}>{t("playerPro.shot.animation")}</div>}
      {latestShot && props.round.phase !== "flight" && <section data-testid="player-shot-ruling" aria-label={t("playerPro.shot.latestRuling")} style={{ display: "grid", gap: 3, marginTop: 10, padding: 9, borderRadius: 8, background: "#f5e5b8", border: "1px solid rgba(117,88,36,.35)", fontSize: 12 }}>
        <strong>{t("playerPro.shot.latestRulingShot", { shot: latestShot.shotNumber })}</strong>
        <div>{t("playerPro.shot.ruling", { ruling: rulingLabel(latestRuling, t) })}</div>
        <div>{t("playerPro.shot.collision", { collision: collisionLabel(latestOutcome?.collision, t) })}</div>
        <div>{t("playerPro.shot.relief", { relief: latestRelief ? `${latestRelief.type.replaceAll("_", " ")} (${latestRelief.status})` : t("playerPro.shot.legacyRelief") })}</div>
        <div>{t("playerPro.shot.finalPosition", { position: pointLabel(latestFinalPosition) })}</div>
        {latestShot.greenRollout && <div data-testid="player-shot-green-rollout-result">{t("playerPro.shot.greenRollout", { pace: latestShot.greenRollout.pace, speed: latestShot.greenRollout.evidence.realizedSpeedFeet.toFixed(1), roll: latestShot.greenRollout.rollYards.toFixed(1), break: latestShot.greenRollout.breakTiles.toFixed(2), lie: latestShot.greenRollout.lieAfter.replaceAll("_", " ") })}</div>}
        {latestShot.greenPutting && <div data-testid="player-shot-auto-putt-result">{t("playerPro.shot.autoPuttingResult", { putts: latestShot.greenPutting.putts, distance: latestShot.greenPutting.leaveDistanceYards.toFixed(1), break: latestShot.greenPutting.breakTiles.toFixed(2), speed: latestShot.greenPutting.realizedSpeedFeet.toFixed(1) })}</div>}
      </section>}
      {props.round.phase === "hole_complete" && <button data-testid="next-player-hole" onClick={props.onAdvance} style={{ width: "100%", marginTop: 10 }}>{t("playerPro.shot.next")}</button>}
      {(props.round.phase === "round_complete" || props.round.phase === "conceded") && <div style={{ marginTop: 10, display: "grid", gap: 7 }}><strong>{t("playerPro.round.complete")}</strong><small>{t("playerPro.round.settled")}</small><button data-testid="return-to-design" onClick={props.onReturnToDesign}>{t("playerPro.shot.returnDesign")}</button></div>}
      <SnapshotScorecard round={props.round} />
      <details style={{ marginTop: 10 }}><summary>{t("playerPro.scorecard")}</summary><ol style={{ paddingLeft: 22 }}>{props.round.scorecard.map((row) => <li key={row.holeId}>{row.name}: {row.strokes}+{row.penalties} / {row.par}{row.complete ? " ✓" : ""}</li>)}</ol><strong>{t("playerPro.scorecard.total", { strokes: props.round.strokes, penalties: props.round.penalties })}</strong></details>
      {props.round.phase !== "round_complete" && props.round.phase !== "conceded" && <div style={{ display: "flex", gap: 6, marginTop: 10 }}><button onClick={props.onAutoFinish}>{t("playerPro.shot.auto")}</button><button onClick={props.onConcede}>{t("playerPro.shot.concede")}</button></div>}
    </section>
  );
}

export function ChallengeScrambleChoiceHud(props: { round: ChallengeGroupRound; onChoose: (playerId: string) => void }) {
  const { t } = useI18n();
  const player = props.round.golfers.find((golfer) => golfer.id === props.round.playerGolferId);
  const ball = props.round.teamAuthority?.balls.find((candidate) => candidate.teamId === player?.teamId);
  return <section role="dialog" aria-label={t("challenge.scramble")} data-testid="challenge-scramble-choice" style={{ position: "absolute", zIndex: 215, right: 14, bottom: 78, width: "min(370px,calc(100% - 28px))", border: "2px solid #755824", borderRadius: 13, background: "linear-gradient(150deg,#fff9e7,#e9cd8c)", color: "#302819", boxShadow: "0 16px 38px rgba(0,0,0,.4)", padding: 12 }}>
    <strong>{t("challenge.scramble")}</strong>
    <div style={{ display: "grid", gap: 6 }}>{ball?.candidates.map((candidate) => {
      const golfer = props.round.golfers.find((entry) => entry.id === candidate.playerId);
      return <button key={candidate.shotId} type="button" onClick={() => props.onChoose(candidate.playerId)}>{golfer?.name ?? candidate.playerId} · {candidate.distanceToPin.toFixed(1)}</button>;
    })}</div>
  </section>;
}

export function ChallengeGroupHud(props: {
  career: PlayerProCareer;
  world: World;
  day: number;
  aim: PlayerProPoint;
  onAim: (point: PlayerProPoint) => void;
  onWorld: (source: World, next: World) => void;
}) {
  const group = props.career.activeChallengeGroupRound;
  if (!group) return null;
  const act = (action: ChallengeGroupAction) => props.onWorld(props.world, applyGroupAction(props.world, props.day, action));
  if (group.phase === "awaiting_ball_choice") return <ChallengeScrambleChoiceHud round={group} onChoose={(playerId) => act({ kind: "choose", playerId })} />;
  const view = groupView(props.career);
  if (!view) return null;
  return <PlayerShotHud
    career={{ ...props.career, skills: view.skills }}
    round={view.round}
    aim={props.aim}
    onAim={props.onAim}
    onCommit={(selection) => act({ kind: "shot", selection })}
    onAdvance={() => undefined}
    onAutoFinish={() => act({ kind: "auto" })}
    onConcede={() => act({ kind: "concede" })}
    onReturnToDesign={() => undefined}
  />;
}
