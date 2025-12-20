import { useMemo, useState } from "react";
import type { Course, ObstacleType, Point, Terrain, WeekResult, World } from "../game/models/types";
import { demandBreakdown, priceAttractiveness } from "../game/sim/score";
import { scoreCourseHoles } from "../game/sim/holes";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import { TERRAIN_MAINT_WEIGHT } from "../game/models/terrainEconomics";
import { computeCourseRatingAndSlope } from "../game/sim/courseRating";

const TERRAIN: Terrain[] = [
  "fairway",
  "rough",
  "deep_rough",
  "sand",
  "water",
  "green",
  "tee",
  "path",
];

type Tab = "Editor" | "Metrics" | "Results" | "Upgrades";

export function HUD(props: {
  course: Course;
  world: World;
  last?: WeekResult;
  prev?: WeekResult;
  selected: Terrain;
  setSelected: (t: Terrain) => void;
  setGreenFee: (n: number) => void;
  setMaintenance: (n: number) => void;
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
  setEditorMode: (m: "PAINT" | "HOLE_WIZARD" | "OBSTACLE") => void;
  startWizard: () => void;
  obstacleType: ObstacleType;
  setObstacleType: (t: ObstacleType) => void;
  activeHoleIndex: number;
  setActiveHoleIndex: (n: number) => void;
  wizardStep: "TEE" | "GREEN" | "CONFIRM";
  draftTee: Point | null;
  draftGreen: Point | null;
  onWizardConfirm: () => void;
  onWizardRedo: () => void;
  onWizardNextHole: () => void;
  setActiveHoleParMode: (m: "AUTO" | "MANUAL") => void;
  setActiveHoleParManual: (p: 3 | 4 | 5) => void;
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
  paintError?: string | null;
  viewMode: "COZY" | "ARCHITECT";
  setViewMode: (m: "COZY" | "ARCHITECT") => void;
  animationsEnabled: boolean;
  setAnimationsEnabled: (b: boolean) => void;
  onFlyover: () => void;
}) {
  const {
    course,
    world,
    last,
    prev,
    selected,
    setSelected,
    setGreenFee,
    setMaintenance,
    editorMode,
    setEditorMode,
    startWizard,
    obstacleType,
    setObstacleType,
    activeHoleIndex,
    setActiveHoleIndex,
    wizardStep,
    draftTee,
    draftGreen,
    onWizardConfirm,
    onWizardRedo,
    onWizardNextHole,
    setActiveHoleParMode,
    setActiveHoleParManual,
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
    paintError,
    viewMode,
    setViewMode,
    animationsEnabled,
    setAnimationsEnabled,
    onFlyover,
  } = props;

  const [tab, setTab] = useState<Tab>("Editor");

  const holeSummary = useMemo(() => scoreCourseHoles(course), [course]);
  const price = useMemo(() => Math.round(priceAttractiveness(course) * 100), [course]);
  const liveDemand = useMemo(() => demandBreakdown(course, world), [course, world]);
  const activeHole = holeSummary.holes[activeHoleIndex];
  const wizardCanConfirm = editorMode === "HOLE_WIZARD" && wizardStep === "CONFIRM" && !!draftTee && !!draftGreen;
  const holeDef = course.holes[activeHoleIndex];
  const distanceTiles =
    holeDef?.tee && holeDef?.green ? computeHoleDistanceTiles(holeDef.tee, holeDef.green) : null;
  const autoPar = distanceTiles != null ? computeAutoPar(distanceTiles) : null;
  const effectivePar =
    holeDef?.parMode === "MANUAL" ? (holeDef.parManual ?? 4) : autoPar ?? 4;

  const tabs: Tab[] = viewMode === "ARCHITECT" ? ["Editor", "Metrics", "Results", "Upgrades"] : ["Editor", "Results", "Upgrades"];
  const terrainCounts = useMemo(() => {
    const acc: Partial<Record<Terrain, number>> = {};
    for (const t of course.tiles) acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, [course.tiles]);
  const totalTiles = course.tiles.length || 1;
  const totalMaintWeight = useMemo(() => {
    return course.tiles.reduce((sum, t) => sum + (TERRAIN_MAINT_WEIGHT[t] ?? 1), 0);
  }, [course.tiles]);
  const avgMaintWeight = totalMaintWeight / totalTiles;
  const rating = useMemo(() => computeCourseRatingAndSlope(course), [course]);

  const courseVibe = useMemo(() => {
    const complete = holeSummary.holes.filter((h) => h.isComplete && h.isValid);
    const avgAest =
      complete.length === 0
        ? 0
        : complete.reduce((a, h) => a + h.aestheticsScore, 0) / complete.length;
    const quality = holeSummary.courseQuality;
    if (quality < 35) return "Untamed & punishing";
    if (quality < 55) return avgAest >= 55 ? "Scrappy but charming" : "Scrappy municipal";
    if (quality < 75) return avgAest >= 60 ? "Pleasant parkland" : "Playable & simple";
    return avgAest >= 65 ? "Premium resort vibe" : "Championship-ready";
  }, [holeSummary]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        border: "none",
        borderRadius: 0,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>SimGolf-lite Tycoon</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Week {world.week}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["COZY", "ARCHITECT"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                style={{
                  padding: "6px 8px",
                  borderRadius: 999,
                  border: viewMode === m ? "2px solid #000" : "1px solid #ddd",
                  background: "#fff",
                  fontSize: 12,
                }}
              >
                {m === "COZY" ? "Cozy" : "Architect"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Cash</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              ${Math.round(world.cash).toLocaleString()}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Reputation</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{world.reputation}/100</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Condition</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {Math.round(course.condition * 100)}%
            </div>
          </div>
          {viewMode === "COZY" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Course vibe</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{courseVibe}</div>
                <button
                  onClick={onFlyover}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Flyover
                </button>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151" }}>
                  <input
                    type="checkbox"
                    checked={animationsEnabled}
                    onChange={(e) => setAnimationsEnabled(e.target.checked)}
                  />
                  Animations
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {viewMode === "ARCHITECT" && (
        <div style={{ display: "flex", gap: 6, padding: 10, borderBottom: "1px solid #eee" }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: 10,
                border: tab === t ? "2px solid #000" : "1px solid #ccc",
                background: "#fff",
                fontSize: 12,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
        {tab === "Editor" && (
          <>
            {paintError && (
              <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, border: "1px solid #f0b4b4", background: "#fff5f5", color: "#a40000", fontSize: 12 }}>
                <b>Build blocked:</b> {paintError}
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <div style={{ marginBottom: 8 }}>
                <b>Editor mode</b>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  onClick={() => setEditorMode("PAINT")}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "PAINT" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  Paint
                </button>
                <button
                  onClick={startWizard}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "HOLE_WIZARD" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  Hole Wizard
                </button>
                <button
                  onClick={() => setEditorMode("OBSTACLE")}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "OBSTACLE" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  Obstacles
                </button>
              </div>

              {activeHole && (
                <div style={{ fontSize: 12, color: "#222" }}>
                  <div>
                    <b>Hole {activeHoleIndex + 1}</b>:{" "}
                    {activeHole.isComplete ? (
                      <>
                        score {Math.round(activeHole.score)}/100 • par {activeHole.par} • eff{" "}
                        {activeHole.effectiveDistance.toFixed(0)}
                      </>
                    ) : (
                      <>place tee + green</>
                    )}
                  </div>
                  <div style={{ marginTop: 4, color: "#444" }}>
                    Straight dist:{" "}
                    {distanceTiles != null ? `${distanceTiles.toFixed(1)} tiles` : "—"} • Effective dist:{" "}
                    {activeHole.isComplete ? `${activeHole.effectiveDistance.toFixed(0)} tiles` : "—"} • Par:{" "}
                    {effectivePar}{" "}
                    <span style={{ color: "#777" }}>
                      ({holeDef?.parMode === "MANUAL" ? "manual" : "auto"})
                    </span>
                  </div>
                  {viewMode === "ARCHITECT" && activeHole.isComplete && (
                    <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                      <div>
                        Playability: <b>{Math.round(activeHole.playabilityScore)}</b>/100
                      </div>
                      <div>
                        Difficulty: <b>{Math.round(activeHole.difficultyScore)}</b>/100
                      </div>
                      <div>
                        Aesthetics: <b>{Math.round(activeHole.aestheticsScore)}</b>/100
                      </div>
                      <div>
                        Overall: <b>{Math.round(activeHole.overallHoleScore)}</b>/100
                      </div>
                    </div>
                  )}
                  {activeHole.issues.length > 0 && (
                    <div style={{ marginTop: 4, color: "#a40000" }}>
                      {activeHole.issues.slice(0, 2).join(" • ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            {editorMode === "HOLE_WIZARD" ? (
              <Section title="Hole Setup Wizard">
                <div>
                  <b>Hole {activeHoleIndex + 1} of 9</b>
                </div>
                <div style={{ color: "#444" }}>
                  {wizardStep === "TEE"
                    ? "Click on the canvas to place the tee."
                    : wizardStep === "GREEN"
                      ? "Click on the canvas to place the green."
                      : "Confirm to save this hole, or redo to try again."}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  Draft: tee {draftTee ? `(${draftTee.x},${draftTee.y})` : "—"} • green{" "}
                  {draftGreen ? `(${draftGreen.x},${draftGreen.y})` : "—"}
                </div>
              </Section>
            ) : editorMode === "OBSTACLE" ? (
              <Section title="Place obstacle">
                <div style={{ color: "#444" }}>
                  Click on the canvas to place/remove an obstacle (does not change terrain).
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {(["tree", "bush"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setObstacleType(t)}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: obstacleType === t ? "2px solid #000" : "1px solid #ccc",
                        background: "#fff",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Section>
            ) : (
              <>
                {viewMode === "ARCHITECT" && (
                  <Section title="Par settings (active hole)">
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setActiveHoleParMode("AUTO")}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: holeDef?.parMode === "AUTO" ? "2px solid #000" : "1px solid #ccc",
                        background: "#fff",
                      }}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => setActiveHoleParMode("MANUAL")}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border:
                          holeDef?.parMode === "MANUAL" ? "2px solid #000" : "1px solid #ccc",
                        background: "#fff",
                      }}
                    >
                      Manual
                    </button>
                  </div>

                  {holeDef?.parMode === "MANUAL" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      {([3, 4, 5] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setActiveHoleParManual(p)}
                          style={{
                            flex: 1,
                            padding: 10,
                            borderRadius: 10,
                            border: (holeDef.parManual ?? 4) === p ? "2px solid #000" : "1px solid #ccc",
                            background: "#fff",
                          }}
                        >
                          Par {p}
                        </button>
                      ))}
                    </div>
                  )}

                  {holeDef?.parMode === "AUTO" && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                      Auto par thresholds: ≤14 → 3, 15–30 → 4, 31+ → 5
                    </div>
                  )}
                </Section>
                )}

                {viewMode === "ARCHITECT" && (
                  <Section title="Hole list (overall score)">
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "34px 44px 1fr 54px", fontSize: 12, color: "#555" }}>
                      <div>
                        <b>#</b>
                      </div>
                      <div>
                        <b>Par</b>
                      </div>
                      <div>
                        <b>Dist</b>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <b>Overall</b>
                      </div>
                    </div>
                    {holeSummary.holes.slice(0, 9).map((h) => (
                      <button
                        key={h.holeIndex}
                        onClick={() => {
                          setActiveHoleIndex(h.holeIndex);
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "34px 44px 1fr 54px",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 8px",
                          borderRadius: 10,
                          border: h.holeIndex === activeHoleIndex ? "2px solid #000" : "1px solid #ddd",
                          background: "#fff",
                          textAlign: "left",
                          fontSize: 12,
                        }}
                      >
                        <div>
                          {h.holeIndex + 1}
                          {!h.isComplete && <span style={{ color: "#a40000" }}> *</span>}
                        </div>
                        <div>{h.isComplete ? h.par : "—"}</div>
                        <div style={{ color: "#555" }}>
                          {h.isComplete ? `${h.effectiveDistance.toFixed(0)} tiles` : "missing tee/green"}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <b>{Math.round(h.overallHoleScore)}</b>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                    * layout issue (tee/green missing). Low overall holes drag down course quality.
                  </div>
                </Section>
                )}

                <div style={{ marginBottom: 8 }}>
                  <b>Terrain brush</b>
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
                        fontSize: 12,
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "Metrics" && (
          <>
            <Section title="Course metrics">
              <div>Course quality: {Math.round(holeSummary.courseQuality)}/100</div>
              <div>Hole quality avg: {Math.round(holeSummary.holeQualityAvg)}/100</div>
              <div>Variety: {Math.round(holeSummary.variety)}/100</div>
              <div>Price attractiveness: {price}/100</div>
              <div>Demand index: {liveDemand.demandIndex.toFixed(2)}</div>
              <div style={{ marginTop: 8 }}>
                <span
                  title={
                    "Course Rating ≈ expected scratch score (18 holes).\n" +
                    "Slope measures how much harder the course is for bogey golfers vs scratch.\n" +
                    "We scale slope so a ~20-stroke bogey-scratch spread maps to 113 (average), clamped 55–155."
                  }
                  style={{ cursor: "help" }}
                >
                  Course Rating: <b>{rating.courseRating.toFixed(1)}</b> • Slope: <b>{rating.slope}</b>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Scratch: {rating.expectedScratchScore.toFixed(1)} • Bogey: {rating.expectedBogeyScore.toFixed(1)} •
                yards/tile: {course.yardsPerTile}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#444" }}>
                Layout issues: {holeSummary.holes.filter((h) => h.isComplete && !h.isValid).length} /{" "}
                {course.holes.length}
              </div>
            </Section>
            <Section title="Terrain mix + maintenance burden">
              <div>
                Estimated maintenance weight: <b>{avgMaintWeight.toFixed(2)}</b> avg •{" "}
                <span style={{ color: "#555" }}>{Math.round(totalMaintWeight).toLocaleString()} total</span>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                {(Object.keys(terrainCounts) as Terrain[])
                  .sort((a, b) => (terrainCounts[b] ?? 0) - (terrainCounts[a] ?? 0))
                  .map((t) => {
                    const n = terrainCounts[t] ?? 0;
                    const pct = (100 * n) / totalTiles;
                    return (
                      <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{t}</span>
                        <span style={{ color: "#555" }}>
                          {pct.toFixed(1)}% ({n})
                        </span>
                      </div>
                    );
                  })}
              </div>
            </Section>
          </>
        )}

        {tab === "Results" && (
          <>
            {!last && <div style={{ color: "#555", fontSize: 13 }}>Simulate a week to see results.</div>}
            {last && (
              <Section title="Last week">
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
              </Section>
            )}

            {last?.demand && (
              <Section title="Demand breakdown">
                <BreakdownTableDetailed
                  rows={[
                    [
                      "Course quality",
                      last.demand.courseQuality,
                      last.demand.weights.courseQuality,
                      last.demand.contributions.courseQuality,
                    ],
                    ["Condition", last.demand.condition, last.demand.weights.condition, last.demand.contributions.condition],
                    ["Reputation", last.demand.reputation, last.demand.weights.reputation, last.demand.contributions.reputation],
                    ["Price", last.demand.priceAttractiveness, last.demand.weights.priceAttractiveness, last.demand.contributions.priceAttractiveness],
                    ["Marketing", last.demand.marketing, last.demand.weights.marketing, last.demand.contributions.marketing],
                    ["Staff", last.demand.staff, last.demand.weights.staff, last.demand.contributions.staff],
                  ]}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
                  DemandIndex: {last.demand.demandIndex.toFixed(2)} → base visitors:{" "}
                  {120 + Math.round(520 * last.demand.demandIndex)}
                </div>
                {prev?.demand && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                    Δ DemandIndex vs last week: {(last.demand.demandIndex - prev.demand.demandIndex).toFixed(2)}
                  </div>
                )}
              </Section>
            )}

            {viewMode === "ARCHITECT" && last?.satisfaction && (
              <Section title="Satisfaction breakdown">
                <BreakdownTableDetailed
                  rows={[
                    ["Playability", last.satisfaction.playability, last.satisfaction.weights.playability, last.satisfaction.weights.playability * (last.satisfaction.playability / 100)],
                    ["Aesthetics", last.satisfaction.aesthetics, last.satisfaction.weights.aesthetics, last.satisfaction.weights.aesthetics * (last.satisfaction.aesthetics / 100)],
                    ["Difficulty (ease)", 100 - last.satisfaction.difficulty, last.satisfaction.weights.difficultyEase, last.satisfaction.weights.difficultyEase * ((100 - last.satisfaction.difficulty) / 100)],
                    ["Condition", last.satisfaction.condition, last.satisfaction.weights.condition, last.satisfaction.weights.condition * (last.satisfaction.condition / 100)],
                    ["Staff", last.satisfaction.staff, last.satisfaction.weights.staff, last.satisfaction.weights.staff * (last.satisfaction.staff / 100)],
                  ]}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
                  Satisfaction: <b>{last.satisfaction.satisfaction}</b>/100
                </div>
                {prev?.satisfaction && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                    Δ Satisfaction vs last week: {last.satisfaction.satisfaction - prev.satisfaction.satisfaction}
                  </div>
                )}
              </Section>
            )}

            {viewMode === "ARCHITECT" && last?.topIssues && last.topIssues.length > 0 && (
              <Section title="Top issues (what to fix next)">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {last.topIssues.map((t, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {t}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {last?.tips && last.tips.length > 0 && (
              <Section title="Why people like / don’t like it">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {last.tips.map((t, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {t}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {last?.capitalSpending && (
              <Section title="Capital spending (terrain builds)">
                <div>
                  Spent: <b>${Math.round(last.capitalSpending.spent).toLocaleString()}</b> • Refunded:{" "}
                  <b>${Math.round(last.capitalSpending.refunded).toLocaleString()}</b> • Net:{" "}
                  <b>${Math.round(last.capitalSpending.net).toLocaleString()}</b>
                </div>
                <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12 }}>
                  {Object.entries(last.capitalSpending.byTerrainSpent)
                    .filter(([, v]) => (v ?? 0) > 0)
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .map(([t, v]) => (
                      <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{t}</span>
                        <span>
                          ${Math.round(v ?? 0).toLocaleString()}{" "}
                          <span style={{ color: "#777" }}>
                            ({last.capitalSpending!.byTerrainTiles[t as Terrain] ?? 0} tiles)
                          </span>
                        </span>
                      </div>
                    ))}
                </div>
              </Section>
            )}

            {last?.maintenancePressure && (
              <Section title="Maintenance pressure">
                <div>
                  Avg terrain weight: <b>{last.maintenancePressure.avgWeight.toFixed(2)}</b> • Wear this
                  week: <b>{Math.round(last.maintenancePressure.wear * 100)}%</b>
                </div>
              </Section>
            )}

          </>
        )}

        {tab === "Upgrades" && (
          <>
            <Section title="Business">
              <label style={{ display: "block", marginBottom: 12 }}>
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
            </Section>

            <Section title="Upgrades">
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
                  {staffUpgradeCost != null
                    ? `(Buy: $${staffUpgradeCost.toLocaleString()})`
                    : "(Max)"}
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
            </Section>
          </>
        )}
      </div>

      {editorMode === "HOLE_WIZARD" && (
        <div
          style={{
            padding: 10,
            borderTop: "1px solid #eee",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
            <div>
              <b>Hole {activeHoleIndex + 1} / 9</b>
            </div>
            <div style={{ color: "#555" }}>
              {wizardStep === "TEE"
                ? "Click to place tee"
                : wizardStep === "GREEN"
                  ? "Click to place green"
                  : "Confirm / redo"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onWizardConfirm}
              disabled={!wizardCanConfirm}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 10,
                border: wizardCanConfirm ? "1px solid #000" : "1px solid #ccc",
                background: wizardCanConfirm ? "#000" : "#f6f6f6",
                color: wizardCanConfirm ? "#fff" : "#555",
                fontWeight: 600,
              }}
            >
              Confirm
            </button>
            <button
              onClick={onWizardRedo}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "#fff",
              }}
            >
              Redo
            </button>
            <button
              onClick={onWizardNextHole}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "#fff",
              }}
            >
              Next hole
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          padding: 10,
          borderTop: "1px solid #eee",
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
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
            padding: 12,
            borderRadius: 12,
            border: "1px solid #000",
            background: "#000",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          Simulate week
        </button>
      </div>
    </div>
  );
}

function BreakdownTableDetailed(props: {
  rows: Array<[label: string, value: number, weight: number, contribution01: number]>;
}) {
  return (
    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
      {props.rows.map(([label, value, weight, contrib]) => (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "baseline",
          }}
        >
          <div>
            {label}{" "}
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              ({Math.round(weight * 100)}%)
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <b>{value}</b>{" "}
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              (+{(contrib * 100).toFixed(1)})
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 10,
        border: "1px solid #ddd",
        borderRadius: 10,
        marginBottom: 10,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <b>{props.title}</b>
      </div>
      <div style={{ display: "grid", gap: 4, fontSize: 13 }}>{props.children}</div>
    </div>
  );
}


