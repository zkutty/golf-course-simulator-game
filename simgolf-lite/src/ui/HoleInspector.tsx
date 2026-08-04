import type { HoleEvaluation } from "../game/eval/evaluateHole";
import { formatCurrency } from "../i18n/format";
import type { Course, Hole, ParSetting, PinRotation, TeeSet } from "../game/models/types";
import { computeHoleTerrainStats, type TerrainComposition } from "../game/eval/terrainStats";
import { T } from "../i18n/T";
import { translateCurrent } from "../i18n/core";
import type { ReactNode } from "react";
import { getParSetting, getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS, validateHoleCourseSetup } from "../game/models/courseSetup";
import { analyzePinFairness } from "../game/greens/pinFairness";

interface HoleInspectorProps {
  holeIndex: number;
  evaluation: HoleEvaluation;
  showFixOverlay: boolean;
  setShowFixOverlay: (show: boolean) => void;
  onFitHole?: (preset?: "fit" | "tee" | "landing" | "green") => void;
  onFlyover?: () => void; // cinematic hole flyover (ZKU-157)
  course: Course;
  hole: Hole;
  thumbnail?: ReactNode;
  onSetHoleIndex?: (index: number) => void;
  onSmartPaintFairway?: (widthYards: number) => void;
  onBeginTeePlacement?: (teeSet: TeeSet) => void;
  onBeginPinPlacement?: (pinRotation: PinRotation) => void;
  onRemoveTeeBox?: (teeSet: TeeSet) => void;
  onRemovePinPosition?: (pinRotation: PinRotation) => void;
  onSetActivePinRotation?: (pinRotation: PinRotation) => void;
  selectedTeeSet?: TeeSet;
  onSelectTeeSet?: (teeSet: TeeSet) => void;
  onSetTeePar?: (teeSet: TeeSet, setting: ParSetting) => void;
}

function MarkerRow(props: { id: string; label: string; placed: boolean; onPlace: () => void; onRemove: () => void }) {
  const action = translateCurrent(props.placed ? "courseSetup.move" : "courseSetup.place");
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(112px,1fr) auto", gap: 8, alignItems: "center" }}>
    <span style={{ minWidth: 0 }}>
      <strong style={{ display: "block", fontSize: 11 }}>{props.label}</strong>
      <small style={{ display: "block", marginTop: 1, color: props.placed ? "#3f6d35" : "#746b5c" }}>
        {translateCurrent(props.placed ? "courseSetup.placed" : "courseSetup.notPlaced")}
      </small>
    </span>
    <span style={{ display: "flex", gap: 4 }}>
      <button
        data-testid={`place-${props.id}`}
        aria-label={translateCurrent("courseSetup.markerActionAria", { action, marker: props.label })}
        onClick={props.onPlace}
        style={{ minWidth: 52, fontSize: 10 }}
      >
        {action}
      </button>
      {props.placed && <button aria-label={translateCurrent("courseSetup.remove", { marker: props.label })} onClick={props.onRemove} style={{ fontSize: 10 }}>×</button>}
    </span>
  </div>;
}

export function HoleInspector({
  holeIndex,
  evaluation,
  showFixOverlay,
  setShowFixOverlay,
  onFitHole,
  onFlyover,
  course,
  hole,
  thumbnail,
  onSetHoleIndex,
  onSmartPaintFairway,
  onBeginTeePlacement,
  onBeginPinPlacement,
  onRemoveTeeBox,
  onRemovePinPosition,
  onSetActivePinRotation,
  selectedTeeSet = "member",
  onSelectTeeSet,
  onSetTeePar,
}: HoleInspectorProps) {
  const { scratchShotsToGreen, bogeyShotsToGreen, autoPar, reachableInTwo, effectiveDistanceYards, issues } =
    evaluation;

  const terrainStats = computeHoleTerrainStats(course, hole, holeIndex);
  const setupIssues = validateHoleCourseSetup(course, hole);
  
  // Get straight distance (for display)
  const straightDistYards = hole.tee && hole.green
    ? Math.sqrt((hole.tee.x - hole.green.x) ** 2 + (hole.tee.y - hole.green.y) ** 2) * course.yardsPerTile
    : 0;

  const groupedIssues = {
    bad: issues.filter((i) => i.severity === "bad"),
    warn: issues.filter((i) => i.severity === "warn"),
    info: issues.filter((i) => i.severity === "info"),
  };

  const isPlayable = issues.filter((i) => i.code === "BLOCKED_ROUTE" || i.code === "MISSING_MARKERS").length === 0;

  function handleIssueAction(action: string, issueCode: string) {
    if (issueCode === "FAIRWAY_CONTINUITY" && onSmartPaintFairway) {
      if (action.includes("+5y")) {
        onSmartPaintFairway(5);
      } else if (action.includes("+10y")) {
        onSmartPaintFairway(10);
      } else if (action.includes("Paint fairway along centerline")) {
        // Default width: 30 yards (15 each side)
        onSmartPaintFairway(30);
      }
    }
  }

  return (
    <div
      className="cc-tycoon-panel cc-hole-inspector"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 16,
        backgroundColor: "rgba(255, 248, 235, 0.95)",
        borderRadius: 8,
        overflowY: "auto",
        fontFamily: "var(--cc-font-body)",
        fontSize: 13,
        color: "#333",
      }}
    >
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#1a1a1a" }}><T id="auto.ui.holeinspector.hole" />{holeIndex + 1}</h2>
        {onFitHole && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => onFitHole("fit")}
              style={{
                padding: "6px 10px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
              title={translateCurrent("auto.ui.holeinspector.fit.hole.f")}
            >
              <T id="auto.ui.holeinspector.fit" /></button>
            <button
              onClick={() => onFitHole("tee")}
              style={{
                padding: "6px 10px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              <T id="auto.ui.holeinspector.tee" /></button>
            <button
              onClick={() => onFitHole("landing")}
              style={{
                padding: "6px 10px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              <T id="auto.ui.holeinspector.landing" /></button>
            <button
              onClick={() => onFitHole("green")}
              style={{
                padding: "6px 10px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              <T id="auto.ui.holeinspector.green" /></button>
            {onFlyover && (
              <button
                onClick={onFlyover}
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
                title={translateCurrent("auto.ui.holeinspector.cinematic.hole.flyover")}
              >
                <T id="auto.ui.holeinspector.flyover" /></button>
            )}
          </div>
        )}
      </div>

      {thumbnail}

      <section aria-label={translateCurrent("courseSetup.region")} style={{ margin: "12px 0", padding: 10, background: "rgba(255,255,255,.72)", border: "1px solid #c9b999", borderRadius: 7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <strong>{translateCurrent("courseSetup.title")}</strong>
          <label style={{ fontSize: 11 }}>{translateCurrent("courseSetup.dailyPin")}{" "}<select aria-label={translateCurrent("courseSetup.activePin")} value={course.activePinRotation ?? "A"} onChange={(event) => onSetActivePinRotation?.(event.target.value as PinRotation)}>{PIN_ROTATIONS.map((rotation) => <option key={rotation}>{rotation}</option>)}</select></label>
        </div>
        <div style={{ display: "grid", gap: 5 }}>
          {TEE_SETS.map((teeSet) => {
            const point = getTeeBox(hole, teeSet);
            const selected = teeSet === selectedTeeSet;
            return <div key={`${teeSet}-${point?.x ?? "x"}-${point?.y ?? "y"}`} data-testid={`tee-row-${teeSet}`} style={{ padding: 6, borderRadius: 6, border: selected ? "2px solid #7b5429" : "1px solid #d7c8aa", background: selected ? "#fff7e6" : "rgba(255,255,255,.55)" }} onClick={() => onSelectTeeSet?.(teeSet)}>
              <MarkerRow id={`${teeSet}-tee`} label={`${teeSet[0].toUpperCase() + teeSet.slice(1)} ${translateCurrent("courseSetup.tee")}`} placed={!!point} onPlace={() => onBeginTeePlacement?.(teeSet)} onRemove={() => onRemoveTeeBox?.(teeSet)} />
              {selected && <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 11 }}>
                <span>{point ? translateCurrent("courseSetup.routeSummary", { yards: Math.round(effectiveDistanceYards), status: translateCurrent(isPlayable ? "courseSetup.playable" : "courseSetup.routeBlocked") }) : translateCurrent("courseSetup.notErected")}</span>
                <span style={{ marginLeft: "auto" }}>{translateCurrent("courseSetup.par")}</span>
                <select data-testid={`tee-par-${teeSet}`} aria-label={translateCurrent("courseSetup.teeParAria", { tee: teeSet })} value={getParSetting(hole, teeSet).mode === "AUTO" ? "AUTO" : String((getParSetting(hole, teeSet) as Extract<ParSetting, { mode: "MANUAL" }>).par)} onChange={(event) => {
                  const value = event.target.value;
                  onSetTeePar?.(teeSet, value === "AUTO" ? { mode: "AUTO" } : { mode: "MANUAL", par: Number(value) as 3 | 4 | 5 });
                }}>
                  <option value="AUTO">{translateCurrent("courseSetup.autoPar", { par: autoPar })}</option>
                  <option value="3">3</option><option value="4">4</option><option value="5">5</option>
                </select>
              </div>}
            </div>;
          })}
          {PIN_ROTATIONS.map((pinRotation) => {
            const point = getPinPosition(hole, pinRotation);
            const fairness = point ? analyzePinFairness(course, hole, point, pinRotation) : null;
            return <div key={`${pinRotation}-${point?.x ?? "x"}-${point?.y ?? "y"}`} data-testid={`pin-fairness-${pinRotation}`} style={{ padding: 6, border: "1px solid #d7c8aa", borderRadius: 6, background: "rgba(255,255,255,.55)" }}>
              <MarkerRow id={`pin-${pinRotation}`} label={translateCurrent("courseSetup.pin", { rotation: pinRotation })} placed={!!point} onPlace={() => onBeginPinPlacement?.(pinRotation)} onRemove={() => onRemovePinPosition?.(pinRotation)} />
              {fairness && <div style={{ marginTop: 5, fontSize: 10, color: fairness.legal ? "#4c574c" : "#8b2e1b" }}>
                <strong>{fairness.legal ? translateCurrent("courseSetup.tournamentReady", { percent: Math.round(fairness.tournamentReadiness * 100) }) : translateCurrent("courseSetup.invalidCup")}</strong>
                {fairness.legal && <div>{translateCurrent("courseSetup.pinDifficulty", { difficulty: Math.round(fairness.difficulty * 100), edge: fairness.edgeClearanceTiles.toFixed(1) })}</div>}
                {fairness.legal && <div data-testid={`pin-cohorts-${pinRotation}`} style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, marginTop: 4 }}>
                  {(["scratch", "bogey", "casual"] as const).map((cohort) => <span key={cohort} title={translateCurrent("courseSetup.pinCohortTitle", { cohort, putts: fairness.cohorts[cohort].expectedPutts.toFixed(2), pace: `${fairness.cohorts[cohort].paceMinutesDelta >= 0 ? "+" : ""}${fairness.cohorts[cohort].paceMinutesDelta.toFixed(2)}`, satisfaction: fairness.cohorts[cohort].satisfactionDelta.toFixed(1), complaint: Math.round(fairness.cohorts[cohort].complaintRisk * 100) })}>
                    <b style={{ display: "block", textTransform: "capitalize" }}>{cohort}</b>{translateCurrent("courseSetup.pinCohortCompact", { putts: fairness.cohorts[cohort].expectedPutts.toFixed(2), satisfaction: fairness.cohorts[cohort].satisfactionDelta.toFixed(1) })}
                  </span>)}
                </div>}
                {[...fairness.blockingReasons, ...fairness.warnings.map((warning) => warning.message)].map((message) => <div key={message} role="alert" style={{ marginTop: 3, color: "#8b2e1b" }}>{message}</div>)}
              </div>}
            </div>;
          })}
        </div>
        {setupIssues.length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#8b2e1b", fontSize: 11 }}>{setupIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>}
        <small style={{ display: "block", marginTop: 7, opacity: .68 }}>{translateCurrent("courseSetup.help")}</small>
      </section>

      {/* Hole Index / Stroke Index */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}><T id="auto.ui.holeinspector.hole.index.stroke.index" /></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13 }}><T id="auto.ui.holeinspector.hole" />{holeIndex + 1}</span>
          {onSetHoleIndex && (
            <input
              type="number"
              min={1}
              max={18}
              value={hole.holeIndex ?? holeIndex + 1}
              onChange={(e) => {
                const value = e.target.value;
                if (/^(?:[1-9]|1[0-8])$/.test(value)) {
                  // Update hole index in course
                  onSetHoleIndex(Number(value));
                }
              }}
              style={{
                width: 60,
                padding: "4px 6px",
                fontSize: 12,
                border: "1px solid #ddd",
                borderRadius: 4,
              }}
            />
          )}
          <span style={{ fontSize: 11, color: "#888" }}>
            <T id="auto.ui.holeinspector.defaults.to.array.position" /></span>
        </div>
      </div>

      {/* Key Stats */}
      <div
        style={{
          marginBottom: 20,
          padding: 12,
          backgroundColor: "rgba(255, 255, 255, 0.7)",
          borderRadius: 6,
          border: "1px solid rgba(0, 0, 0, 0.1)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div data-tooltip="The recommended par calculated from effective playing distance.">
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}><T id="auto.ui.holeinspector.auto.par" /></div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{autoPar}</div>
          </div>
          <div data-tooltip="Playing length after route shape and elevation adjustments; this drives automatic par.">
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}><T id="auto.ui.holeinspector.effective.distance" /></div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{effectiveDistanceYards.toFixed(0)} <T id="auto.ui.holeinspector.yds" /></div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div data-tooltip="Direct tee-to-green distance without route or elevation adjustments.">
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}><T id="auto.ui.holeinspector.straight.distance" /></div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{straightDistYards.toFixed(0)} <T id="auto.ui.holeinspector.yds" /></div>
          </div>
          <div data-tooltip="Net height change from tee to green; elevation data is not yet available in this summary.">
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}><T id="auto.ui.holeinspector.elevation.change" /></div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#888" }}>—</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div data-tooltip="Estimated shots a scratch golfer needs to reach the green.">
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}><T id="auto.ui.holeinspector.scratch.shots" /></div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {scratchShotsToGreen === Infinity ? "—" : scratchShotsToGreen.toFixed(1)}
            </div>
          </div>
          <div data-tooltip="Estimated shots a bogey golfer needs to reach the green.">
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}><T id="auto.ui.holeinspector.bogey.shots" /></div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {bogeyShotsToGreen === Infinity ? "—" : bogeyShotsToGreen.toFixed(1)}
            </div>
          </div>
        </div>
        {autoPar === 5 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.1)" }}>
            <div style={{ fontSize: 12, color: reachableInTwo ? "#2d7a2d" : "#888" }}>
              {reachableInTwo ? "✓ Reachable in two" : "Not reachable in two"}
            </div>
          </div>
        )}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.1)" }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: isPlayable ? "#2d7a2d" : "#c33" }}>
            {isPlayable ? "✓ Playable" : "✗ Not Playable"}
          </div>
        </div>
      </div>

      {/* Terrain Composition Stats */}
      <div
        style={{
          marginBottom: 20,
          padding: 12,
          backgroundColor: "rgba(255, 255, 255, 0.7)",
          borderRadius: 6,
          border: "1px solid rgba(0, 0, 0, 0.1)",
        }}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}><T id="auto.ui.holeinspector.terrain.composition" /></h3>
        
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 6 }}><T id="auto.ui.holeinspector.total.hole.area" /></div>
          <TerrainPercentages composition={terrainStats.total} />
        </div>
        
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 6 }}><T id="auto.ui.holeinspector.corridor.area" /></div>
          <TerrainPercentages composition={terrainStats.corridor} />
        </div>
      </div>

      {/* Fix Overlay Toggle */}
      <div data-tutorial-target="fix-overlay" style={{ marginBottom: 16 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 13,
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={showFixOverlay}
            onChange={(e) => setShowFixOverlay(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span><T id="auto.ui.holeinspector.show.fix.overlay" /></span>
        </label>
      </div>

      {/* Issues */}
      {issues.length === 0 && (
        <div
          style={{
            padding: 12,
            backgroundColor: "rgba(45, 122, 45, 0.1)",
            borderRadius: 6,
            color: "#2d7a2d",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          <T id="auto.ui.holeinspector.no.issues.found.hole.looks.good" /></div>
      )}

      {groupedIssues.bad.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: 14,
              fontWeight: 600,
              color: "#c33",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>●</span> <T id="auto.ui.holeinspector.critical.issues" /></h3>
          {groupedIssues.bad.map((issue, idx) => (
            <IssueCard key={idx} issue={issue} onAction={handleIssueAction} />
          ))}
        </div>
      )}

      {groupedIssues.warn.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: 14,
              fontWeight: 600,
              color: "#d67d00",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>●</span> <T id="auto.ui.holeinspector.warnings" /></h3>
          {groupedIssues.warn.map((issue, idx) => (
            <IssueCard key={idx} issue={issue} onAction={handleIssueAction} />
          ))}
        </div>
      )}

      {groupedIssues.info.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: 14,
              fontWeight: 600,
              color: "#2b7bbb",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>●</span> <T id="auto.ui.holeinspector.notes" /></h3>
          {groupedIssues.info.map((issue, idx) => (
            <IssueCard key={idx} issue={issue} onAction={handleIssueAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function TerrainPercentages({ composition }: { composition: TerrainComposition }) {
  const terrainTypes: Array<{ key: keyof TerrainComposition; label: string }> = [
    { key: "fairway", label: "Fairway" },
    { key: "rough", label: "Rough" },
    { key: "deep_rough", label: "Deep Rough" },
    { key: "sand", label: "Sand" },
    { key: "waste_area", label: "Waste Area" },
    { key: "water", label: "Water" },
    { key: "wetland", label: "Wetland" },
    { key: "green", label: "Green" },
    { key: "tee", label: "Tee" },
    { key: "path", label: "Path" },
  ];

  if (composition.total === 0) {
    return <div style={{ fontSize: 12, color: "#888" }}><T id="auto.ui.holeinspector.no.area" /></div>;
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      {terrainTypes
        .filter((t) => t.key !== "total" && t.key !== "other" && composition[t.key] > 0)
        .map((t) => {
          const pct = (composition[t.key] / composition.total) * 100;
          return (
            <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <div style={{ width: 80, textAlign: "left" }}>{t.label}:</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    backgroundColor: "#e5e5e5",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      backgroundColor: pct > 50 ? "#5dbb6a" : pct > 25 ? "#4fa64f" : "#888",
                      transition: "width 0.2s",
                    }}
                  />
                </div>
                <div style={{ width: 45, textAlign: "right", fontWeight: 500 }}>
                  {pct.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      {composition.other > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <div style={{ width: 80, textAlign: "left" }}><T id="auto.ui.holeinspector.other" /></div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                flex: 1,
                height: 8,
                backgroundColor: "#e5e5e5",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${(composition.other / composition.total) * 100}%`,
                  height: "100%",
                  backgroundColor: "#aaa",
                }}
              />
            </div>
            <div style={{ width: 45, textAlign: "right", fontWeight: 500 }}>
              {((composition.other / composition.total) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface IssueCardProps {
  issue: {
    severity: "info" | "warn" | "bad";
    code: string;
    title: string;
    detail: string;
    suggestedFixes: string[];
    metadata?: {
      currentValue?: number;
      targetValue?: number;
      costEstimate?: number;
      failingSegments?: Array<{ x: number; y: number }>;
    };
  };
  onAction?: (action: string, issueCode: string) => void;
}

function IssueCard({ issue, onAction }: IssueCardProps) {
  const bgColor =
    issue.severity === "bad"
      ? "rgba(204, 51, 51, 0.08)"
      : issue.severity === "warn"
        ? "rgba(214, 125, 0, 0.08)"
        : "rgba(43, 123, 187, 0.08)";
  const borderColor =
    issue.severity === "bad"
      ? "rgba(204, 51, 51, 0.3)"
      : issue.severity === "warn"
        ? "rgba(214, 125, 0, 0.3)"
        : "rgba(43, 123, 187, 0.3)";

  const isFairwayIssue = issue.code === "FAIRWAY_CONTINUITY";

  return (
    <div
      style={{
        marginBottom: 10,
        padding: 10,
        backgroundColor: bgColor,
        borderRadius: 6,
        border: `1px solid ${borderColor}`,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{issue.title}</div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 8, lineHeight: 1.4 }}>{issue.detail}</div>
      
      {/* Enhanced metadata display for FAIRWAY_CONTINUITY */}
      {isFairwayIssue && issue.metadata && (
        <div style={{ marginBottom: 8, fontSize: 11, color: "#666" }}>
          {issue.metadata.currentValue != null && issue.metadata.targetValue != null && (
            <div style={{ marginBottom: 4 }}>
              <T id="auto.ui.holeinspector.current" />{(issue.metadata.currentValue * 100).toFixed(1)}<T id="auto.ui.holeinspector.target" />{(issue.metadata.targetValue * 100).toFixed(0)}%
            </div>
          )}
          {issue.metadata.costEstimate != null && issue.metadata.costEstimate > 0 && (
            <div style={{ marginBottom: 4, fontWeight: 500 }}>
              <T id="auto.ui.holeinspector.est.cost" />{formatCurrency(issue.metadata.costEstimate)}
            </div>
          )}
        </div>
      )}

      {issue.suggestedFixes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 4 }}><T id="auto.ui.holeinspector.suggested.fixes" /></div>
          {isFairwayIssue && onAction ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {issue.suggestedFixes.map((fix, idx) => (
                <button
                  key={idx}
                  onClick={() => onAction(fix, issue.code)}
                  style={{
                    padding: "6px 10px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    fontWeight: 500,
                  }}
                >
                  {fix}
                </button>
              ))}
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: "#555", lineHeight: 1.5 }}>
              {issue.suggestedFixes.map((fix, idx) => (
                <li key={idx}>{fix}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
