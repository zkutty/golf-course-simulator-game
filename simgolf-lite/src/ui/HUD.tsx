import type { Course, Terrain, WeekResult, World } from "../game/models/types";
import { priceAttractiveness } from "../game/sim/score";
import { scoreCourseHoles } from "../game/sim/holes";

const TERRAIN: Terrain[] = [
  "fairway",
  "rough",
  "sand",
  "water",
  "green",
  "tee",
  "path",
];

export function HUD(props: {
  course: Course;
  world: World;
  last?: WeekResult;
  selected: Terrain;
  setSelected: (t: Terrain) => void;
  setGreenFee: (n: number) => void;
  setMaintenance: (n: number) => void;
  mode: "paint" | "tee" | "green";
  setMode: (m: "paint" | "tee" | "green") => void;
  activeHoleIndex: number;
  setActiveHoleIndex: (n: number) => void;
  onUpgradeStaff: () => void;
  onUpgradeMarketing: () => void;
  staffUpgradeCost: number | null;
  marketingUpgradeCost: number | null;
  canUpgradeStaff: boolean;
  canUpgradeMarketing: boolean;
  onSave: () => void;
  onLoad: () => void;
  onResetSave: () => void;
  simulate: () => void;
}) {
  const {
    course,
    world,
    last,
    selected,
    setSelected,
    setGreenFee,
    setMaintenance,
    mode,
    setMode,
    activeHoleIndex,
    setActiveHoleIndex,
    onUpgradeStaff,
    onUpgradeMarketing,
    staffUpgradeCost,
    marketingUpgradeCost,
    canUpgradeStaff,
    canUpgradeMarketing,
    onSave,
    onLoad,
    onResetSave,
    simulate,
  } = props;

  const holeSummary = scoreCourseHoles(course);
  const price = Math.round(priceAttractiveness(course) * 100);
  const activeHole = holeSummary.holes[activeHoleIndex];

  return (
    <div style={{ width: 340, fontFamily: "system-ui, sans-serif" }}>
      <h3 style={{ margin: "0 0 8px" }}>SimGolf-lite Tycoon</h3>

      <div
        style={{
          padding: 10,
          border: "1px solid #ddd",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div>
          <b>Week:</b> {world.week}
        </div>
        <div>
          <b>Cash:</b> ${Math.round(world.cash).toLocaleString()}
        </div>
        <div>
          <b>Reputation:</b> {world.reputation}/100
        </div>
        <div>
          <b>Course condition:</b> {Math.round(course.condition * 100)}%
        </div>
      </div>

      <div
        style={{
          padding: 10,
          border: "1px solid #ddd",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <b>Editor</b>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {(["paint", "tee", "green"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: mode === m ? "2px solid #000" : "1px solid #ccc",
                background: "#fff",
              }}
            >
              {m === "paint" ? "Paint" : m === "tee" ? "Place tee" : "Place green"}
            </button>
          ))}
        </div>

        <label style={{ display: "block", marginBottom: 10 }}>
          Hole #
          <select
            value={activeHoleIndex}
            onChange={(e) => setActiveHoleIndex(Number(e.target.value))}
            style={{ width: "100%", padding: 6, borderRadius: 8, border: "1px solid #ccc" }}
          >
            {course.holes.map((_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>

        {activeHole && (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#222" }}>
            <div>
              <b>Hole {activeHoleIndex + 1}</b>:{" "}
              {activeHole.isComplete ? (
                <>
                  score {Math.round(activeHole.score)}/100 • par {activeHole.par} • dist{" "}
                  {activeHole.distance.toFixed(1)}
                </>
              ) : (
                <>place tee + green</>
              )}
            </div>
            {activeHole.issues.length > 0 && (
              <div style={{ marginTop: 4, color: "#a40000" }}>
                {activeHole.issues.slice(0, 2).join(" • ")}
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <b>Paint terrain</b>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TERRAIN.map((t) => (
            <button
              key={t}
              onClick={() => setSelected(t)}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: selected === t ? "2px solid #000" : "1px solid #ccc",
                background: "#fff",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: 10,
          border: "1px solid #ddd",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <b>Course metrics</b>
        </div>
        <div>Course quality: {Math.round(holeSummary.courseQuality)}/100</div>
        <div>Hole quality avg: {Math.round(holeSummary.holeQualityAvg)}/100</div>
        <div>Variety: {Math.round(holeSummary.variety)}/100</div>
        <div>Price attractiveness: {price}/100</div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#444" }}>
          Layout issues: {holeSummary.holes.filter((h) => h.isComplete && !h.isValid).length} /{" "}
          {course.holes.length}
        </div>
      </div>

      <div
        style={{
          padding: 10,
          border: "1px solid #ddd",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <b>Business</b>
        </div>

        <label style={{ display: "block", marginBottom: 8 }}>
          Green fee (${course.baseGreenFee})
          <input
            type="range"
            min={20}
            max={150}
            value={course.baseGreenFee}
            onChange={(e) => setGreenFee(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>

        <label style={{ display: "block" }}>
          Maintenance budget (${world.maintenanceBudget}/wk)
          <input
            type="range"
            min={0}
            max={5000}
            step={50}
            value={world.maintenanceBudget}
            onChange={(e) => setMaintenance(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
      </div>

      <div
        style={{
          padding: 10,
          border: "1px solid #ddd",
          borderRadius: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <b>Upgrades</b>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button
            onClick={onUpgradeStaff}
            disabled={!canUpgradeStaff}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ccc",
              background: canUpgradeStaff ? "#fff" : "#f6f6f6",
            }}
          >
            Staff level: {world.staffLevel}/5{" "}
            {staffUpgradeCost != null ? `(Buy: $${staffUpgradeCost.toLocaleString()})` : "(Max)"}
          </button>
          <button
            onClick={onUpgradeMarketing}
            disabled={!canUpgradeMarketing}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ccc",
              background: canUpgradeMarketing ? "#fff" : "#f6f6f6",
            }}
          >
            Marketing level: {world.marketingLevel}/5{" "}
            {marketingUpgradeCost != null
              ? `(Buy: $${marketingUpgradeCost.toLocaleString()})`
              : "(Max)"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button
          onClick={onSave}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "#fff",
          }}
        >
          Save
        </button>
        <button
          onClick={onLoad}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "#fff",
          }}
        >
          Load
        </button>
        <button
          onClick={onResetSave}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "#fff",
          }}
        >
          Reset
        </button>
      </div>

      <button
        onClick={simulate}
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 10,
          border: "1px solid #000",
          background: "#000",
          color: "#fff",
        }}
      >
        Simulate week
      </button>

      {last && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <b>Last week results</b>
          </div>
          <div>Visitors: {last.visitors}</div>
          <div>Revenue: ${Math.round(last.revenue).toLocaleString()}</div>
          <div>Costs: ${Math.round(last.costs).toLocaleString()}</div>
          <div>
            <b>Profit:</b> ${Math.round(last.profit).toLocaleString()}
          </div>
          <div>Avg satisfaction: {Math.round(last.avgSatisfaction)}/100</div>
          <div>
            Reputation Δ: {last.reputationDelta >= 0 ? "+" : ""}
            {last.reputationDelta}
          </div>
          <div>
            Noise: {last.visitorNoise >= 0 ? "+" : ""}
            {last.visitorNoise} visitors
          </div>

          {last.demand && (
            <div style={{ marginTop: 10 }}>
              <div style={{ marginBottom: 6 }}>
                <b>Demand breakdown</b>
              </div>
              <BreakdownTable
                rows={[
                  ["Course quality", last.demand.courseQuality],
                  ["Condition", last.demand.condition],
                  ["Reputation", last.demand.reputation],
                  ["Price", last.demand.priceAttractiveness],
                  ["Marketing", last.demand.marketing],
                  ["Staff", last.demand.staff],
                ]}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
                DemandIndex: {last.demand.demandIndex.toFixed(2)} → base visitors:{" "}
                {120 + Math.round(520 * last.demand.demandIndex)}
              </div>
            </div>
          )}

          {last.satisfaction && (
            <div style={{ marginTop: 10 }}>
              <div style={{ marginBottom: 6 }}>
                <b>Satisfaction breakdown</b>
              </div>
              <BreakdownTable
                rows={[
                  ["Playability", last.satisfaction.playability],
                  ["Condition", last.satisfaction.condition],
                  ["Staff", last.satisfaction.staff],
                  ["Total", last.satisfaction.satisfaction],
                ]}
              />
            </div>
          )}

          {last.tips && last.tips.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ marginBottom: 6 }}>
                <b>Advisor tips</b>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {last.tips.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreakdownTable(props: { rows: Array<[string, number]> }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {props.rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{k}</span>
          <span>
            <b>{v}</b>
          </span>
        </div>
      ))}
    </div>
  );
}


