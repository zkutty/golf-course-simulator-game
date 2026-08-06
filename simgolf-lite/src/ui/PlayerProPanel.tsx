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

type ProTab = "career" | "play" | "training" | "matches" | "tournaments";

const panelStyle = {
  position: "absolute",
  top: 54,
  left: 10,
  zIndex: 205,
  width: "min(470px,calc(100% - 20px))",
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

export function PlayerProPanel(props: {
  career: PlayerProCareer;
  course: Course;
  world: World;
  day: number;
  onUpdateIdentity: (identity: PlayerProCareer["identity"]) => void;
  onStartRound: (layoutId: string, teeSet: TeeSet, pinRotation: PinRotation) => Promise<string | null>;
  onTrain: (option: PlayerTrainingOption) => Promise<string | null>;
  onChallenge: (opponent: PlayerOpponent, kind: "friendly" | "wager", wager: number) => Promise<string | null>;
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
  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="player-pro-title" data-testid="player-pro-panel" style={panelStyle}>
      <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#314d36", color: "#fff8dc", borderBottom: "2px solid #c89c43" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", background: "#f3d990", color: "#30452f", fontSize: 22 }} aria-hidden="true">🏌️</div>
        <div style={{ minWidth: 0, flex: 1 }}><small>{t("playerPro.title")}</small><h2 id="player-pro-title" style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{props.career.identity.name}</h2></div>
        <button aria-label={t("playerPro.close")} onClick={props.onClose}>✕</button>
      </header>

      <nav aria-label={t("playerPro.title")} style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, padding: 8, borderBottom: "1px solid rgba(62,48,24,.16)" }}>
        {tabs.map((candidate) => <button key={candidate} aria-pressed={tab === candidate} onClick={() => setTab(candidate)} style={{ padding: "7px 3px", borderRadius: 7, border: tab === candidate ? "2px solid #466243" : "1px solid rgba(52,43,25,.15)", background: tab === candidate ? "#d9ebcf" : "rgba(255,255,255,.55)", fontSize: 10, fontWeight: 800 }}>{t(`playerPro.tab.${candidate}` as MessageKey)}</button>)}
      </nav>

      <div style={{ padding: 14, display: "grid", gap: 14 }}>
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
          {opponents.length === 0 ? <p>{t("playerPro.match.none")}</p> : <div style={{ display: "grid", gap: 7 }}>{opponents.map((opponent) => {
            const mentor = mentorTechniqueEligibility(props.world, opponent.id);
            return <div key={opponent.id} style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,.55)" }}><strong>{opponent.name}</strong><small style={{ display: "block" }}>{t("playerPro.match.opponentMeta", { skill: Math.round(opponent.skill * 100), relationship: opponent.relationship })}</small>{mentor.techniqueId && <small data-testid={`mentor-status-${opponent.id}`} style={{ display: "block" }}>{t("playerPro.equipmentMentor.mentorStatus", { name: mentorTechniqueDefinition(mentor.techniqueId).name, matches: mentor.completedMatches, relationship: mentor.relationship, reveals: mentor.revealCount })}</small>}<div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}><button onClick={() => { void props.onChallenge(opponent, "friendly", 0).then((message) => setNotice(message ?? `✓ ${t("playerPro.play.resume")}`)); }}>{t("playerPro.match.friendly")}</button><button disabled={props.world.cash < 100} onClick={() => { void props.onChallenge(opponent, "wager", 100).then((message) => setNotice(message ?? `✓ ${t("playerPro.play.resume")}`)); }}>{t("playerPro.match.wager", { amount: formatCurrency(100) })}</button>{mentor.techniqueId && !props.career.learnedTechniques.includes(mentor.techniqueId) && <button data-testid={`start-mentor-${opponent.id}`} disabled={!mentor.eligible} title={mentor.blockers.join(" ")} onClick={() => { void props.onMentorChallenge(opponent).then((message) => setNotice(message ?? `✓ ${t("playerPro.play.resume")}`)); }}>{t("playerPro.equipmentMentor.startObjective")}</button>}</div></div>;
          })}</div>}
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
