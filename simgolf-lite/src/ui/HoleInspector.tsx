import type { HoleEvaluation } from "../game/eval/evaluateHole";

interface HoleInspectorProps {
  holeIndex: number;
  evaluation: HoleEvaluation;
  showFixOverlay: boolean;
  setShowFixOverlay: (show: boolean) => void;
  onFitHole?: (preset?: "fit" | "tee" | "landing" | "green") => void;
}

export function HoleInspector({
  holeIndex,
  evaluation,
  showFixOverlay,
  setShowFixOverlay,
  onFitHole,
}: HoleInspectorProps) {
  const { scratchShotsToGreen, bogeyShotsToGreen, autoPar, reachableInTwo, effectiveDistanceYards, issues } =
    evaluation;

  const groupedIssues = {
    bad: issues.filter((i) => i.severity === "bad"),
    warn: issues.filter((i) => i.severity === "warn"),
    info: issues.filter((i) => i.severity === "info"),
  };

  const isPlayable = issues.filter((i) => i.code === "BLOCKED_ROUTE" || i.code === "MISSING_MARKERS").length === 0;

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
            <IssueCard key={idx} issue={issue} />
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
            <IssueCard key={idx} issue={issue} />
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
            <IssueCard key={idx} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: { severity: "info" | "warn" | "bad"; code: string; title: string; detail: string; suggestedFixes: string[] } }) {
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
      {issue.suggestedFixes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 4 }}>Suggested fixes:</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: "#555", lineHeight: 1.5 }}>
            {issue.suggestedFixes.map((fix, idx) => (
              <li key={idx}>{fix}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

