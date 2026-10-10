import type { SelectedGolferDetail } from "../hooks/useLiveSimulation";
import { formatCurrency } from "../i18n/format";
import { ARCHETYPES } from "../game/live/archetypes";
import type { GolferArchetypeName } from "../game/live/types";
import { recentEmotes } from "../game/render/emoteFeed";
import type { EmoteKind } from "../game/render/emotes";
import { translateCurrent } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import { currentShotEvidenceCues } from "../game/render/shotTruthCues";
import "./GolferInspector.css";

// Decorative counterparts of the on-course bubbles; feed labels carry meaning.
const EMOTE_GLYPH: Record<EmoteKind, { char: string; color: string }> = {
  star: { char: "★", color: "#e8c15a" },
  happy: { char: "☺", color: "#ffd75e" },
  angry: { char: "☹", color: "#ef8354" },
  storm: { char: "☁", color: "#9ca3af" },
  zzz: { char: "Zz", color: "#94a3b8" },
  cashGood: { char: "$", color: "#86efac" },
  cashBad: { char: "$", color: "#fca5a5" },
  alert: { char: "!", color: "#fca5a5" },
};

function toPar(n: number): string {
  if (n === 0) return translateCurrent("golfer.score.even");
  return n > 0 ? `+${n}` : `${n}`;
}

function moodLabel(m: number): string {
  if (m >= 0.8) return translateCurrent("golfer.mood.delighted");
  if (m >= 0.6) return translateCurrent("golfer.mood.happy");
  if (m >= 0.4) return translateCurrent("golfer.mood.okay");
  if (m >= 0.2) return translateCurrent("golfer.mood.frustrated");
  return translateCurrent("golfer.mood.fedUp");
}

// Reads the throttled detail from useLiveSimulation; no per-frame work here.
export function GolferInspector(props: {
  selected: SelectedGolferDetail | null;
  onClose: () => void;
  following?: boolean;
  onToggleFollow?: () => void;
  setupDifficulty?: number;
}) {
  const { selected, onClose } = props;
  const { locale } = useI18n();
  if (!selected) return null;

  const arch = ARCHETYPES[selected.archetype as GolferArchetypeName];
  const moodHue = Math.round(120 * Math.max(0, Math.min(1, selected.mood)));
  const mood = moodLabel(selected.mood);
  const moodValue = Math.round(selected.mood * 100);
  const holeText = selected.currentHole >= 0
    ? translateCurrent("live.hole", { hole: selected.currentHole + 1 }) : translateCurrent("live.clubhouse");
  const played = selected.scoredHoles;
  const capabilities = selected.capabilities;
  const evidence = selected.currentShotEvidence ?? { phase: "unavailable" as const, reason: "missing" as const };
  const emotes = recentEmotes(selected.id);
  const mobilityLabel = selected.mobilityMode === "riding_cart"
    ? translateCurrent("architecture.review.mobility.ridingCart")
    : selected.mobilityMode === "pushcart" ? translateCurrent("architecture.review.mobility.pushcart")
      : translateCurrent("architecture.review.mobility.walk");

  return (
    <section className="cc-golfer-inspector" role="region" tabIndex={0}
      aria-label={translateCurrent("golfer.inspector", { name: selected.name })}>
      <header className="cc-golfer-header">
        <span className="cc-golfer-swatch" style={{ background: selected.color }} aria-hidden="true" />
        <div className="cc-golfer-identity">
          <h2>{selected.name}</h2>
          <div className="cc-golfer-secondary">{arch ? translateCurrent(`livingClub.archetype.${arch.name}`) : selected.archetype}</div>
        </div>
        <button type="button" className="cc-golfer-close" onClick={onClose}
          aria-label={translateCurrent("auto.ui.golferinspector.close")} title={translateCurrent("auto.ui.golferinspector.close")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <dl className="cc-golfer-stats">
        <Stat name="position" value={holeText} />
        <Stat name="score" value={toPar(selected.scoreToPar)} accent />
        <Stat name="thru" value={`${played}`} />
        <Stat name="spent" value={formatCurrency(selected.spent)} accent />
        <Stat name="wallet" value={formatCurrency(selected.wallet)} />
      </dl>
      <div className="cc-golfer-section cc-golfer-secondary">
        {translateCurrent("courseSetup.golfer", { tee: translateCurrent(`playerPro.play.tee.${selected.teeSet}`), pin: selected.pinRotation })}
        {props.setupDifficulty != null ? ` · ${translateCurrent("courseSetup.difficultyDelta", { delta: props.setupDifficulty.toFixed(1) })}` : ""}
      </div>

      {selected.mobilityMode && <div data-testid="golfer-mobility-inspector" className="cc-golfer-section cc-golfer-mobility">
        <b>{translateCurrent("golfer.mobility.mode", { mode: mobilityLabel })}</b>
        <div>{translateCurrent("golfer.mobility.predictedWalking", { minutes: selected.mobilityPredictedWalkingMinutes?.toFixed(0) ?? "—" })}</div>
        <div>{translateCurrent("golfer.mobility.observedTravel", { minutes: selected.mobilityActualTravelMinutes?.toFixed(0) ?? translateCurrent("golfer.mobility.pending"), fallback: selected.mobilityWalkingFallbackMinutes?.toFixed(0) ?? "0" })}</div>
        <div>{translateCurrent("golfer.mobility.offPath", { tiles: selected.mobilityOffPathTiles ?? 0 })}</div>
      </div>}

      {props.onToggleFollow && <button type="button" className="cc-golfer-follow cc-golfer-section"
        aria-pressed={props.following} aria-label={translateCurrent(props.following ? "live.stopFollowing" : "live.followGolfer")}
        onClick={props.onToggleFollow}>
        <span aria-hidden="true">{props.following ? "◎" : "◉"}</span> {translateCurrent(props.following ? "live.following" : "live.follow")}
      </button>}

      <div className="cc-golfer-section">
        <div className="cc-golfer-mood-label">
          <span>{translateCurrent("auto.ui.golferinspector.mood")}</span>
          <span>{moodValue}% · {mood}</span>
        </div>
        <div className="cc-golfer-mood-meter" role="meter" aria-label={translateCurrent("auto.ui.golferinspector.mood")}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={moodValue}
          aria-valuetext={translateCurrent("golfer.mood.value", { value: moodValue, mood })}>
          <div style={{ width: `${moodValue}%`, background: `hsl(${moodHue}, 75%, 50%)` }} />
        </div>
      </div>

      {emotes.length > 0 && <section className="cc-golfer-section">
        <h3>{translateCurrent("auto.ui.golferinspector.recent.thoughts")}</h3>
        <ul className="cc-golfer-thoughts">
          {[...emotes].reverse().map((e, i) => <li key={`${e.atMs}-${i}`} data-emote-kind={e.kind}>
            <span className="cc-golfer-emote" style={{ color: EMOTE_GLYPH[e.kind].color }} aria-hidden="true">{EMOTE_GLYPH[e.kind].char}</span>
            <span className="cc-golfer-thought-label">{e.label}</span>
          </li>)}
        </ul>
      </section>}

      {capabilities && <section className="cc-golfer-section cc-golfer-capabilities">
        <h3>{translateCurrent("golfer.identityApproach")}</h3>
        <div><strong>{translateCurrent("golfer.riskStyle", { style: capabilities.riskStyle, power: Math.round(capabilities.power), accuracy: Math.round(capabilities.accuracy) })}</strong></div>
        <div>{translateCurrent("golfer.skillLine", { irons: Math.round(capabilities.irons), shortGame: Math.round(capabilities.shortGame), recovery: Math.round(capabilities.recovery) })}</div>
        <div className="cc-golfer-secondary">{translateCurrent("golfer.strengths", { values: capabilities.strengths.join(", ") || translateCurrent("golfer.balanced") })}</div>
      </section>}

      <div className="cc-golfer-section" data-testid="golfer-shot-evidence" data-phase={evidence.phase} role="status" aria-live="polite" aria-atomic="true" aria-label={translateCurrent("shotTruth.channel")}>
        <strong>{translateCurrent(`shotTruth.phase.${evidence.phase}`)}</strong>
        {currentShotEvidenceCues(evidence, locale).map((cue, index) => <div key={index}>{cue}</div>)}
      </div>

      {played > 0 && <section className="cc-golfer-section">
        <h3>{translateCurrent("auto.ui.golferinspector.scorecard")}</h3>
        <ol className="cc-golfer-scorecard">
          {selected.holeStrokes.slice(0, played).map((strokes, i) => {
            const d = strokes - selected.holePar[i];
            const score = toPar(d);
            return <li key={i} className="cc-golfer-scorecard-entry" data-score={d < 0 ? "under" : d > 1 ? "over" : "neutral"}
              title={translateCurrent("golfer.holeScoreTitle", { hole: i + 1, par: selected.holePar[i], score })}>
              {translateCurrent("golfer.scorecard.entry", { hole: i + 1, par: selected.holePar[i], strokes, score })}
            </li>;
          })}
        </ol>
      </section>}
    </section>
  );
}

function Stat(props: { name: "position" | "score" | "thru" | "spent" | "wallet"; value: string; accent?: boolean }) {
  return <div className="cc-golfer-stat" data-tooltip={translateCurrent(`golfer.help.${props.name}`)}>
    <dt>{translateCurrent(`golfer.${props.name}`)}</dt>
    <dd className={props.accent ? "cc-golfer-accent" : undefined}>{props.value}</dd>
  </div>;
}
