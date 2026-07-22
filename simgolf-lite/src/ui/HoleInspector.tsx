import type { HoleEvaluation } from "../game/eval/evaluateHole";
import { formatCurrency } from "../i18n/format";
import type { Course, Hole, ParSetting, PinRotation, Point, TeeSet, Terrain, ObstacleType } from "../game/models/types";
import { computeHoleTerrainStats, type TerrainComposition } from "../game/eval/terrainStats";
import { T } from "../i18n/T";
import { translateCurrent } from "../i18n/core";
import type { ReactNode } from "react";
import { useState } from "react";
import { getParSetting, getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS, validateHoleCourseSetup } from "../game/models/courseSetup";

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
  // Editor tools props
  editorMode?: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
  setEditorMode?: (mode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING") => void;
  selectedTerrain?: Terrain;
  setSelected?: (terrain: Terrain) => void;
  obstacleType?: ObstacleType;
  setObstacleType?: (type: ObstacleType) => void;
  onBeginTeePlacement?: (teeSet: TeeSet) => void;
  onBeginPinPlacement?: (pinRotation: PinRotation) => void;
  onSetTeeBox?: (teeSet: TeeSet, point: Point) => void;
  onSetPinPosition?: (pinRotation: PinRotation, point: Point) => void;
  onRemoveTeeBox?: (teeSet: TeeSet) => void;
  onRemovePinPosition?: (pinRotation: PinRotation) => void;
  onSetActivePinRotation?: (pinRotation: PinRotation) => void;
  selectedTeeSet?: TeeSet;
  onSelectTeeSet?: (teeSet: TeeSet) => void;
  onSetTeePar?: (teeSet: TeeSet, setting: ParSetting) => void;
}

function MarkerRow(props: { label: string; point: Point | null; onPlace: () => void; onSave: (point: Point) => void; onRemove: () => void }) {
  const [x, setX] = useState(props.point?.x ?? 0);
  const [y, setY] = useState(props.point?.y ?? 0);
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(88px,1fr) 48px 48px auto auto", gap: 5, alignItems: "center" }}>
    <strong style={{ fontSize: 11 }}>{props.label}</strong>
    <input aria-label={translateCurrent("courseSetup.coordX", { marker: props.label })} type="number" value={x} onChange={(event) => setX(Number(event.target.value))} style={{ width: 46 }} />
    <input aria-label={translateCurrent("courseSetup.coordY", { marker: props.label })} type="number" value={y} onChange={(event) => setY(Number(event.target.value))} style={{ width: 46 }} />
    <button onClick={() => props.onSave({ x, y })} style={{ fontSize: 10 }}>{translateCurrent("courseSetup.save")}</button>
    <span style={{ display: "flex", gap: 3 }}><button onClick={props.onPlace} style={{ fontSize: 10 }}>{translateCurrent("courseSetup.map")}</button>{props.point && <button aria-label={translateCurrent("courseSetup.remove", { marker: props.label })} onClick={props.onRemove} style={{ fontSize: 10 }}>×</button>}</span>
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
  editorMode = "PAINT",
  setEditorMode,
  selectedTerrain = "fairway",
  setSelected,
  obstacleType = "tree",
  setObstacleType,
  onBeginTeePlacement,
  onBeginPinPlacement,
  onSetTeeBox,
  onSetPinPosition,
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
              <MarkerRow label={`${teeSet[0].toUpperCase() + teeSet.slice(1)} ${translateCurrent("courseSetup.tee")}`} point={point} onPlace={() => onBeginTeePlacement?.(teeSet)} onSave={(next) => onSetTeeBox?.(teeSet, next)} onRemove={() => onRemoveTeeBox?.(teeSet)} />
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
          {PIN_ROTATIONS.map((pinRotation) => { const point = getPinPosition(hole, pinRotation); return <MarkerRow key={`${pinRotation}-${point?.x ?? "x"}-${point?.y ?? "y"}`} label={translateCurrent("courseSetup.pin", { rotation: pinRotation })} point={point} onPlace={() => onBeginPinPlacement?.(pinRotation)} onSave={(next) => onSetPinPosition?.(pinRotation, next)} onRemove={() => onRemovePinPosition?.(pinRotation)} />; })}
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
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1 && val <= 18) {
                  // Update hole index in course
                  onSetHoleIndex(val - 1);
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

      {/* Editor Tools */}
      <div style={{ marginBottom: 16, padding: 12, backgroundColor: "rgba(255, 255, 255, 0.7)", borderRadius: 6, border: "1px solid rgba(0, 0, 0, 0.1)" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 13, fontWeight: 600 }}><T id="auto.ui.holeinspector.editor.tools" /></h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {setEditorMode && (
            <>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setEditorMode("PAINT")}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: editorMode === "PAINT" ? "#e8f5e9" : "#fff",
                    cursor: "pointer",
                    fontWeight: editorMode === "PAINT" ? 600 : 400,
                  }}
                >
                  <T id="auto.ui.holeinspector.paint" /></button>
                <button
                  onClick={() => setEditorMode("OBSTACLE")}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid #ddd",
                    background: editorMode === "OBSTACLE" ? "#e8f5e9" : "#fff",
                    cursor: "pointer",
                    fontWeight: editorMode === "OBSTACLE" ? 600 : 400,
                  }}
                >
                  <T id="auto.ui.holeinspector.obstacle" /></button>
              </div>
              {editorMode === "OBSTACLE" && setObstacleType && (
                <div style={{ display: "flex", gap: 4, fontSize: 10 }}>
                  {(["tree", "bush", "rock"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setObstacleType(type)}
                      style={{
                        flex: 1,
                        padding: "4px 6px",
                        fontSize: 10,
                        borderRadius: 3,
                        border: "1px solid #ddd",
                        background: obstacleType === type ? "#e3f2fd" : "#fff",
                        cursor: "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}
              {editorMode === "PAINT" && setSelected && (
                <div data-tutorial-target="terrain-palette" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, fontSize: 10 }}>
                  {(["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"] as const).map((terrain) => (
                    <button
                      key={terrain}
                      onClick={() => setSelected(terrain as Terrain)}
                      style={{
                        padding: "4px 6px",
                        fontSize: 10,
                        borderRadius: 3,
                        border: "1px solid #ddd",
                        background: selectedTerrain === terrain ? "#e8f5e9" : "#fff",
                        cursor: "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {terrain.replace("_", " ")}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
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
