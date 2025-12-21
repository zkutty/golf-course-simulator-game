import type { HoleEvaluation } from "../game/eval/evaluateHole";
import type { Course, Hole, Terrain, ObstacleType } from "../game/models/types";
import { computeHoleTerrainStats, type TerrainComposition } from "../game/eval/terrainStats";

interface HoleInspectorProps {
  holeIndex: number;
  evaluation: HoleEvaluation;
  showFixOverlay: boolean;
  setShowFixOverlay: (show: boolean) => void;
  onFitHole?: (preset?: "fit" | "tee" | "landing" | "green") => void;
  course: Course;
  hole: Hole;
  onSetHoleIndex?: (index: number) => void;
  onSmartPaintFairway?: (widthYards: number) => void;
  // Editor tools props
  editorMode?: "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
  setEditorMode?: (mode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE") => void;
  selectedTerrain?: Terrain;
  setSelected?: (terrain: Terrain) => void;
  obstacleType?: ObstacleType;
  setObstacleType?: (type: ObstacleType) => void;
}

export function HoleInspector({
  holeIndex,
  evaluation,
  showFixOverlay,
  setShowFixOverlay,
  onFitHole,
  course,
  hole,
  onSetHoleIndex,
  onSmartPaintFairway,
  editorMode = "PAINT",
  setEditorMode,
  selectedTerrain = "fairway",
  setSelected,
  obstacleType = "tree",
  setObstacleType,
}: HoleInspectorProps) {
  const { scratchShotsToGreen, bogeyShotsToGreen, autoPar, reachableInTwo, effectiveDistanceYards, issues } =
    evaluation;

  const terrainStats = computeHoleTerrainStats(course, hole, holeIndex);
  
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
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#1a1a1a" }}>Hole {holeIndex + 1}</h2>
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
              title="Fit Hole (F)"
            >
              Fit
            </button>
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
              Tee
            </button>
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
              Landing
            </button>
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
              Green
            </button>
          </div>
        )}
      </div>

      {/* Hole Index / Stroke Index */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Hole Index / Stroke Index</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>Hole {holeIndex + 1}</span>
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
            (defaults to array position)
          </span>
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
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Auto Par</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{autoPar}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Effective Distance</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{effectiveDistanceYards.toFixed(0)} yds</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Straight Distance</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{straightDistYards.toFixed(0)} yds</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Elevation Change</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#888" }}>—</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Scratch Shots</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {scratchShotsToGreen === Infinity ? "—" : scratchShotsToGreen.toFixed(1)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Bogey Shots</div>
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
        <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>Terrain Composition</h3>
        
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 6 }}>Total Hole Area</div>
          <TerrainPercentages composition={terrainStats.total} />
        </div>
        
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 6 }}>Corridor Area</div>
          <TerrainPercentages composition={terrainStats.corridor} />
        </div>
      </div>

      {/* Editor Tools */}
      <div style={{ marginBottom: 16, padding: 12, backgroundColor: "rgba(255, 255, 255, 0.7)", borderRadius: 6, border: "1px solid rgba(0, 0, 0, 0.1)" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 13, fontWeight: 600 }}>Editor Tools</h3>
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
                  Paint
                </button>
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
                  Obstacle
                </button>
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, fontSize: 10 }}>
                  {(["fairway", "rough", "deep_rough", "sand", "water", "green", "tee", "path"] as const).map((terrain) => (
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
      <div style={{ marginBottom: 16 }}>
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
          <span>Show fix overlay</span>
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
          No issues found. Hole looks good!
        </div>
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
            <span style={{ fontSize: 16 }}>●</span> Critical Issues
          </h3>
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
            <span style={{ fontSize: 16 }}>●</span> Warnings
          </h3>
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
            <span style={{ fontSize: 16 }}>●</span> Notes
          </h3>
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
    { key: "water", label: "Water" },
    { key: "green", label: "Green" },
    { key: "tee", label: "Tee" },
    { key: "path", label: "Path" },
  ];

  if (composition.total === 0) {
    return <div style={{ fontSize: 12, color: "#888" }}>No area</div>;
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
          <div style={{ width: 80, textAlign: "left" }}>Other:</div>
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
              Current: {(issue.metadata.currentValue * 100).toFixed(1)}% | Target: {(issue.metadata.targetValue * 100).toFixed(0)}%
            </div>
          )}
          {issue.metadata.costEstimate != null && issue.metadata.costEstimate > 0 && (
            <div style={{ marginBottom: 4, fontWeight: 500 }}>
              Est. cost: ${issue.metadata.costEstimate.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {issue.suggestedFixes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 4 }}>Suggested fixes:</div>
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

