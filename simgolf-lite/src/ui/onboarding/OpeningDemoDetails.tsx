import type { TutorialProgress } from "../../game/onboarding/tutorial";
import { openingPenaltyTotal, openingShots } from "../../game/onboarding/openingDemo";
import { useI18n } from "../../i18n/useI18n";
import { presenterButtonStyle } from "./presenterStyles";

export function OpeningDemoDetails({ progress, width, onCursor, onRetry, onFocus }: {
  progress: TutorialProgress;
  width: number;
  onCursor: (cursor: number) => void;
  onRetry: () => void;
  onFocus: () => void;
}) {
  const { t } = useI18n();
  const opening = progress.opening;
  const baseline = progress.receipts.preview.evidence;
  if (!opening || !baseline) return null;
  const playing = progress.stage === "observe-play" || progress.stage === "retest-play";
  const evidence = progress.stage === "retest-play" ? opening.candidate : baseline;
  const shots = openingShots(evidence);
  const marker = shots[Math.min(opening.cursor, shots.length - 1)];
  const evidenceContext = evidence ?? baseline;
  const target = opening.targetCells[0];
  const penaltiesFor = (visit: typeof baseline.group[number]) => visit.shots.reduce((total, shot) => total + shot.penaltyStrokes, 0);
  return <div data-testid="opening-demo-details" style={{ display: "grid", gap: 8, fontSize: 13, lineHeight: 1.45 }}>
    <button style={presenterButtonStyle} onClick={onFocus}>{t("opening.focus")}</button>
    {playing && <>
      <div role="status" aria-live="polite" data-testid="opening-current-shot">{marker && t("opening.shot", { name: marker.golferName, shot: marker.shot.shotNumber, intent: marker.shot.intent, club: marker.shot.club, lie: marker.shot.lieAfter })}</div>
      <div data-testid="opening-shot-penalty">{marker && t("opening.shotPenalty", { penalties: marker.shot.penaltyStrokes })}</div>
      <div data-testid="opening-evidence-context">{t("opening.evidenceContext", { seed: evidenceContext.runSeed, hole: evidenceContext.holeId, index: evidenceContext.holeIndex, course: evidenceContext.courseName })}</div>
      <p style={{ margin: 0 }}>{t("opening.markerLegend")}</p>
      <div>{t("opening.shotCount", { cursor: Math.min(opening.cursor, shots.length), total: shots.length })}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button style={presenterButtonStyle} onClick={() => onCursor(opening.cursor + 1)} disabled={opening.cursor >= shots.length}>{t("opening.next")}</button>
        <button style={presenterButtonStyle} onClick={() => onCursor(0)}>{t("opening.restart")}</button>
        <button style={presenterButtonStyle} onClick={() => onCursor(shots.length)}>{t("opening.skip")}</button>
      </div>
    </>}
    {["review-reaction", "creative-reward", "improve-hole"].includes(progress.stage) && <div data-testid="opening-diagnosis">{target === undefined
      ? t("opening.noTarget")
      : t("opening.target", { x: target % width, y: Math.floor(target / width) })}</div>}
    {progress.stage === "compare-preview" && opening.candidate && <>
      <div>{t("opening.revision", { before: baseline.holeFingerprint, after: opening.candidate.holeFingerprint })}</div>
      <div data-testid="opening-comparison-penalties">{t("opening.comparisonPenalties", { before: openingPenaltyTotal(baseline), after: openingPenaltyTotal(opening.candidate) })}</div>
      <table data-testid="opening-comparison" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{(["opening.golfer", "opening.before", "opening.after"] as const).map((key) => <th scope="col" key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{baseline.group.map((golfer, index) => <tr key={golfer.id}>
          <th scope="row">{golfer.name}</th>
          {[golfer, opening.candidate!.group[index]].map((visit, i) => <td key={i} style={{ padding: 5 }}>{visit && <><div>{t("opening.score", { strokes: visit.strokes, satisfaction: Math.round(visit.satisfaction) })}</div><div>{t("opening.penaltyTotal", { penalties: penaltiesFor(visit) })}</div></>}</td>)}
        </tr>)}</tbody>
      </table>
      <p style={{ margin: 0, color: "#647067" }}>{t("opening.scoreNote")}</p>
      <button style={presenterButtonStyle} onClick={onRetry}>{t("opening.retry")}</button>
    </>}
  </div>;
}
