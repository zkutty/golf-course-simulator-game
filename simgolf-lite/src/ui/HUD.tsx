import type { Course, Terrain, WeekResult, World } from "../game/models/types";

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
  simulate: () => void;
}) {
  const { course, world, last, selected, setSelected, setGreenFee, setMaintenance, simulate } =
    props;

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
          <b>Build</b>
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
        </div>
      )}
    </div>
  );
}


