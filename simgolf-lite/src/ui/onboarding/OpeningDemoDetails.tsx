import type { TutorialProgress } from "../../game/onboarding/tutorial";
import { openingPenaltyTotal, openingShots, type OpeningPlaybackFrame } from "../../game/onboarding/openingDemo";
import { useI18n } from "../../i18n/useI18n";
import { presenterButtonStyle } from "./presenterStyles";

const noteStyle = { margin: 0, color: "#647067" };

export function OpeningDemoDetails({ progress, width, playback, playing, playbackSpeed, following, reducedMotion, onCursor, onRetry, onFocus, onTogglePlaying, onSpeed, onToggleFollow }: {
  progress: TutorialProgress;
  width: number;
  playback: OpeningPlaybackFrame | null;
  playing: boolean;
  playbackSpeed: 0.5 | 1 | 2;
  following: boolean;
  reducedMotion: boolean;
  onCursor: (cursor: number) => void;
  onRetry: () => void;
  onFocus: () => void;
  onTogglePlaying: () => void;
  onSpeed: (speed: 0.5 | 1 | 2) => void;
  onToggleFollow: () => void;
}) {
  const { t } = useI18n();
  const opening = progress.opening;
  const baseline = progress.receipts.preview.evidence;
  if (!opening || !baseline) return null;
  const playbackVisible = progress.stage === "observe-play" || progress.stage === "retest-play";
  const evidence = progress.stage === "retest-play" ? opening.candidate : baseline;
  const shots = openingShots(evidence);
  const marker = shots[Math.min(opening.cursor, shots.length - 1)];
  const evidenceContext = evidence ?? baseline;
  const target = opening.targetCells[0];
  const penaltiesFor = (visit: typeof baseline.group[number]) => visit.shots.reduce((total, shot) => total + shot.penaltyStrokes, 0);
  const comparison = opening.comparison;
  const riskAvailable = comparison?.measures.length === baseline.group.length && comparison.measures.every((row) =>
    ([row.riskBefore, row.riskAfter, row.riskyLeavesBefore, row.riskyLeavesAfter] as number[]).every(Number.isFinite));
  const countComparisonChanges = comparison?.measures.reduce((counts, row) => {
    const deltas = [row.strokesBefore - row.strokesAfter, row.satisfactionAfter - row.satisfactionBefore, row.penaltiesBefore - row.penaltiesAfter];
    if (riskAvailable) deltas.push(row.riskBefore! - row.riskAfter!, row.riskyLeavesBefore! - row.riskyLeavesAfter!);
    for (const delta of deltas) {
      if (delta > 0) counts.improved++;
      else if (delta < 0) counts.worsened++;
    }
    return counts;
  }, { improved: 0, worsened: 0 }) ?? { improved: 0, worsened: 0 };
  return <div data-testid="opening-demo-details" style={{ display: "grid", gap: 8, fontSize: 13, lineHeight: 1.45 }}>
    {progress.stage !== "compare-preview" && <button style={presenterButtonStyle} onClick={onFocus}>{t(progress.stage === "improve-hole" ? "opening.focusForPaint" : "opening.focus")}</button>}
    {playbackVisible && <>
      <div role="status" aria-live="polite" data-testid="opening-current-shot" data-preview-id={playback?.previewId} data-shot-id={playback?.shotId}>{marker && t("opening.shot", { name: marker.golferName, shot: marker.shot.shotNumber, intent: marker.shot.intent, club: marker.shot.club, lie: marker.shot.lieAfter })}</div>
      {playback && <div data-testid="opening-playback-frame">{t("opening.frame", { id: playback.shotId, fromX: playback.shot.from.x, fromY: playback.shot.from.y, landingX: playback.landing.x, landingY: playback.landing.y, restX: playback.rest.x, restY: playback.rest.y })}</div>}
      <div data-testid="opening-shot-penalty">{marker && t("opening.shotPenalty", { penalties: marker.shot.penaltyStrokes })}</div>
      <div data-testid="opening-evidence-context">{t("opening.evidenceContext", { preview: evidenceContext.id, seed: evidenceContext.runSeed, hole: evidenceContext.holeId, index: evidenceContext.holeIndex, course: evidenceContext.courseName })}</div>
      <p style={{ margin: 0 }}>{t(reducedMotion ? "opening.markerLegendReduced" : "opening.markerLegend")}</p>
      <div>{t("opening.shotCount", { cursor: Math.min(opening.cursor, shots.length), total: shots.length })}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button data-testid="opening-play-pause" style={presenterButtonStyle} onClick={onTogglePlaying} disabled={reducedMotion || opening.cursor >= shots.length}>{t(playing ? "opening.pause" : "opening.resume")}</button>
        <button data-testid="opening-step" style={presenterButtonStyle} onClick={() => onCursor(opening.cursor + 1)} disabled={opening.cursor >= shots.length}>{t("opening.next")}</button>
        <button data-testid="opening-replay" style={presenterButtonStyle} onClick={() => onCursor(0)}>{t("opening.restart")}</button>
        <button data-testid="opening-skip" style={presenterButtonStyle} onClick={() => onCursor(shots.length)}>{t("opening.skip")}</button>
        <button data-testid="opening-follow" aria-pressed={following} style={presenterButtonStyle} onClick={onToggleFollow}>{t(following ? "opening.unfollow" : "opening.follow")}</button>
        {([0.5, 1, 2] as const).map((speed) => <button key={speed} data-testid={`opening-speed-${speed}`} aria-pressed={playbackSpeed === speed} style={presenterButtonStyle} onClick={() => onSpeed(speed)} disabled={reducedMotion}>{speed}×</button>)}
      </div>
    </>}
    {["review-reaction", "creative-reward", "improve-hole"].includes(progress.stage) && <div data-testid="opening-diagnosis">{opening.diagnosis?.kind === "supported"
      ? t("opening.diagnosis", { name: opening.diagnosis.golferName, shot: opening.diagnosis.shotId, region: opening.diagnosis.regionId, x: opening.diagnosis.anchor.x, y: opening.diagnosis.anchor.y })
      : target === undefined
      ? t("opening.noTarget")
      : t("opening.target", { x: target % width, y: Math.floor(target / width) })}</div>}
    {progress.stage === "compare-preview" && opening.candidate && <>
      <div data-testid="opening-comparison-state" data-state={comparison?.status ?? "unsupported"}>{t(`opening.comparison.${comparison?.status ?? "unsupported"}` as "opening.comparison.positive")}</div>
      <div data-testid="opening-comparison-summary">{t(riskAvailable ? "opening.comparisonSummary" : "opening.comparisonSummaryLegacy", countComparisonChanges)}</div>
      <table data-testid="opening-comparison" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead><tr>{(["opening.golfer", "opening.before", "opening.after"] as const).map((key) => <th scope="col" key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{baseline.group.map((golfer, index) => {
          const measure = comparison?.measures[index];
          return <tr key={golfer.id} data-testid="opening-comparison-row" data-golfer-id={golfer.id}>
            <th scope="row" style={{ overflowWrap: "anywhere" }}>{golfer.name}</th>
            {[golfer, opening.candidate!.group[index]].map((visit, i) => <td key={i} style={{ padding: 5, overflowWrap: "anywhere" }}>{visit && <><div>{t("opening.score", { strokes: visit.strokes, satisfaction: Math.round(visit.satisfaction) })}</div><div>{t("opening.penaltyTotal", { penalties: penaltiesFor(visit) })}</div>{riskAvailable && <div data-testid="opening-comparison-risk">{t("opening.comparisonRisk", i ? { risk: measure!.riskAfter!, riskyLeaves: measure!.riskyLeavesAfter! } : { risk: measure!.riskBefore!, riskyLeaves: measure!.riskyLeavesBefore! })}</div>}</>}</td>)}
          </tr>;
        })}</tbody>
      </table>
      {riskAvailable && <p data-testid="opening-comparison-risk-note" style={noteStyle}>{t("opening.comparisonRiskNote")}</p>}
      <div>{t("opening.revision", { before: baseline.holeFingerprint, after: opening.candidate.holeFingerprint })}</div>
      <div data-testid="opening-comparison-cost">{comparison?.terrainCost == null ? t("opening.costUnavailable") : t("opening.cost", { cost: comparison.terrainCost })}</div>
      <div data-testid="opening-comparison-penalties">{t("opening.comparisonPenalties", { before: openingPenaltyTotal(baseline), after: openingPenaltyTotal(opening.candidate) })}</div>
      <p style={noteStyle}>{t("opening.scoreNote")}</p>
      <button style={presenterButtonStyle} onClick={onFocus}>{t("opening.focus")}</button>
      <button style={presenterButtonStyle} onClick={onRetry}>{t("opening.retry")}</button>
    </>}
  </div>;
}
