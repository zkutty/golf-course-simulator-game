import { useMemo, useState } from "react";
import { useAudio } from "../audio/AudioProvider";
import type { Course, ObstacleType, Point, Terrain, WeekResult, World } from "../game/models/types";
import { demandBreakdown, priceAttractiveness } from "../game/sim/score";
import { scoreCourseHoles } from "../game/sim/holes";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import { TERRAIN_MAINT_WEIGHT } from "../game/models/terrainEconomics";
import { computeCourseRatingAndSlope } from "../game/sim/courseRating";
import { isCoursePlayable } from "../game/sim/isCoursePlayable";
import type { LegacyState } from "../utils/legacy";
import { BALANCE } from "../game/balance/balanceConfig";
import paperTex from "../assets/textures/paper.svg";
import { IconBush, IconCash, IconCondition, IconHoles, IconReputation, IconRock, IconTree, LogoCourseCraft } from "@/assets/icons";
import { GameButton } from "@/ui/gameui";

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
  startPlaceTee?: () => void;
  startPlaceGreen?: () => void;
  obstacleType: ObstacleType;
  setObstacleType: (t: ObstacleType) => void;
  activeHoleIndex: number;
  setActiveHoleIndex: (n: number) => void;
  onEnterHoleEditMode?: (holeIndex: number) => void;
  wizardStep: "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
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
  soundEnabled: boolean;
  setSoundEnabled: (b: boolean) => void;
  isBankrupt: boolean;
  onTakeBridgeLoan: () => void;
  onTakeExpansionLoan: () => void;
  legacy: LegacyState;
  onUnlockFlagColor: (color: "BLUE" | "GOLD", cost: number) => void;
  onSelectFlagColor: (rgba: string) => void;
  showShotPlan: boolean;
  setShowShotPlan: (b: boolean) => void;
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
    startPlaceTee,
    startPlaceGreen,
    obstacleType,
    setObstacleType,
    activeHoleIndex,
    setActiveHoleIndex,
    onEnterHoleEditMode,
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
    soundEnabled,
    setSoundEnabled,
    isBankrupt,
    onTakeBridgeLoan,
    onTakeExpansionLoan,
    legacy,
    onUnlockFlagColor,
    onSelectFlagColor,
    showShotPlan,
    setShowShotPlan,
  } = props;

  const [tab, setTab] = useState<Tab>("Editor");
  const audio = useAudio();

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

  const vibe = useMemo(() => {
    const complete = holeSummary.holes.filter((h) => h.isComplete && h.isValid);
    const avgAest =
      complete.length === 0
        ? 0
        : complete.reduce((a, h) => a + h.aestheticsScore, 0) / complete.length;
    const avgDiff =
      complete.length === 0
        ? 0
        : complete.reduce((a, h) => a + h.difficultyScore, 0) / complete.length;
    const slope = rating.slope ?? 113;

    // Vibe label (game-y, not dashboard-y) derived from difficulty/aesthetics/slope.
    let vibeLabel = "Everyday Parkland";
    if (slope >= 145 || avgDiff >= 78) vibeLabel = "Punishing Links";
    else if (slope >= 132 || avgDiff >= 62) vibeLabel = "Championship Test";
    else if (avgAest >= 75 && slope < 132) vibeLabel = "Resort Lakeside";
    else if (slope <= 110 && avgDiff <= 42) vibeLabel = "Beginner-friendly Parkland";

    // Golfer sentiment: simple + live (leans on overall courseQuality as a proxy).
    const q = holeSummary.courseQuality;
    let sentiment: "Positive" | "Mixed" | "Negative" = "Mixed";
    if (q >= 70 && slope <= 140) sentiment = "Positive";
    else if (q < 52 || slope >= 150) sentiment = "Negative";

    const stars =
      sentiment === "Positive"
        ? "★★★★☆"
        : sentiment === "Mixed"
          ? "★★★☆☆"
          : "★★☆☆☆";

    return { vibeLabel, sentiment, stars, avgAest, avgDiff, slope };
  }, [holeSummary, rating.slope]);

  const validHoles = useMemo(() => {
    return holeSummary.holes.filter((h) => h.isComplete && h.isValid).length;
  }, [holeSummary]);
  const playable = useMemo(() => isCoursePlayable(course), [course]);

  const hasActiveBridge = useMemo(() => {
    return (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "BRIDGE");
  }, [world.loans]);
  const hasActiveExpansion = useMemo(() => {
    return (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "EXPANSION");
  }, [world.loans]);

  const bridgeEligible =
    world.reputation >= BALANCE.loans.bridge.repMin &&
    (playable || validHoles >= 6) &&
    !hasActiveBridge &&
    world.week - (world.lastBridgeLoanWeek ?? -999) >= BALANCE.loans.bridgeCooldownWeeks;

  const expansionEligible =
    world.reputation >= BALANCE.loans.expansion.repMin &&
    validHoles >= BALANCE.loans.expansion.minValidHoles &&
    (world.lastWeekProfit ?? 0) > 0 &&
    !hasActiveExpansion;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        fontFamily: "var(--font-body)",
        display: "flex",
        flexDirection: "column",
        border: "none",
        borderRadius: 0,
        overflow: "hidden",
        background:
          viewMode === "COZY"
            ? `url(${paperTex}), var(--cc-parchment)`
            : "#fff",
        backgroundSize: viewMode === "COZY" ? "320px 320px" : undefined,
      }}
    >
      <div style={{ padding: 12, borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <LogoCourseCraft height={44} />
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Week {world.week}</div>
              <div style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--cc-muted)" }}>
                Design &amp; run your course
              </div>
            </div>
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
        {isBankrupt && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 12,
              border: "1px solid #f0b4b4",
              background: "#fff5f5",
              color: "#7a0000",
              fontSize: 12,
            }}
          >
            <b>Bankrupt.</b> This run has ended — restart to continue.
          </div>
        )}
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {viewMode === "COZY" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.65)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  alignItems: "center",
                }}
              >
                <IconCash size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}>CASH</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>${Math.round(world.cash).toLocaleString()}</div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.65)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  alignItems: "center",
                }}
              >
                <IconReputation size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}>REPUTATION</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{world.reputation}/100</div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.65)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  alignItems: "center",
                }}
              >
                <IconCondition size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}>CONDITION</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{Math.round(course.condition * 100)}%</div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.65)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  alignItems: "center",
                }}
              >
                <IconHoles size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}>HOLES OPEN</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{validHoles}/9</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Cash</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>${Math.round(world.cash).toLocaleString()}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Reputation</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{world.reputation}/100</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Condition</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{Math.round(course.condition * 100)}%</div>
              </div>
            </>
          )}
          {viewMode === "COZY" && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Vibe</div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{vibe.vibeLabel}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Golfer sentiment</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, letterSpacing: 1, color: "#111" }}>{vibe.stars}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{vibe.sentiment}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
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
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151" }}>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                  />
                  Sound
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {viewMode === "ARCHITECT" && (
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: 10,
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            background: "rgba(255,255,255,0.35)",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => {
                void audio.unlock();
                setTab(t);
              }}
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: 999,
                border: tab === t ? "2px solid rgba(0,0,0,0.75)" : "1px solid rgba(0,0,0,0.10)",
                background: tab === t ? "var(--cc-grass)" : "rgba(255,255,255,0.75)",
                color: tab === t ? "#fff" : "#3d4a3e",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 10,
          pointerEvents: isBankrupt ? "none" : "auto",
          opacity: isBankrupt ? 0.55 : 1,
        }}
      >
        {tab === "Editor" && (
          <>
            {paintError && (
              <div
                style={{
                  marginBottom: 10,
                  padding: 10,
                  borderRadius: 10,
                  border: paintError.startsWith("Game") ? "1px solid #b4d4b4" : "1px solid #f0b4b4",
                  background: paintError.startsWith("Game") ? "#f5fff5" : "#fff5f5",
                  color: paintError.startsWith("Game") ? "#00a400" : "#a40000",
                  fontSize: 12,
                }}
              >
                {paintError.startsWith("Game") ? null : <b>Build blocked:</b>} {paintError}
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

              {viewMode === "ARCHITECT" && (
                <div style={{ marginTop: -2, marginBottom: 10, fontSize: 12, color: "#374151" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={showShotPlan}
                      onChange={(e) => setShowShotPlan(e.target.checked)}
                    />
                    Show shot plan overlay
                  </label>
                </div>
              )}

              {activeHole && (
                <div style={{ fontSize: 12, color: "#222" }}>
                  <div>
                    <b>Hole {activeHoleIndex + 1}</b>:{" "}
                    {activeHole.isComplete ? (
                      <>
                        score {Math.round(activeHole.score)}/100 • par {activeHole.par}{" "}
                        <span style={{ color: "#6b7280" }}>
                          {Number.isFinite(activeHole.autoPar) ? ` (auto ${activeHole.autoPar})` : ""}
                        </span>
                      </>
                    ) : (
                      <>place tee + green</>
                    )}
                  </div>
                  <div style={{ marginTop: 4, color: "#444" }}>
                    Straight:{" "}
                    {distanceTiles != null
                      ? `${Math.round(distanceTiles * course.yardsPerTile)} yds (${distanceTiles.toFixed(1)} tiles)`
                      : "—"}{" "}
                    • Effective:{" "}
                    {activeHole.isComplete
                      ? `${Math.round(activeHole.effectiveDistance * course.yardsPerTile)} yds (${activeHole.effectiveDistance.toFixed(1)} tiles)`
                      : "—"}{" "}
                    • Par: {effectivePar}{" "}
                    <span style={{ color: "#777" }}>({holeDef?.parMode === "MANUAL" ? "manual" : "auto"})</span>
                  </div>
                  {activeHole.isComplete && Number.isFinite(activeHole.scratchShotsToGreen) && (
                    <div style={{ marginTop: 4, color: "#444" }}>
                      Scratch to green: <b>{activeHole.scratchShotsToGreen.toFixed(2)}</b> • Bogey:{" "}
                      <b>{Number.isFinite(activeHole.bogeyShotsToGreen) ? activeHole.bogeyShotsToGreen.toFixed(2) : "—"}</b>
                      {activeHole.autoPar === 5 && (
                        <span style={{ color: "#6b7280" }}>
                          {" "}
                          • Reachable in two:{" "}
                          <b style={{ color: activeHole.reachableInTwo ? "#065f46" : "#7a0000" }}>
                            {activeHole.reachableInTwo ? "Yes" : "No"}
                          </b>
                        </span>
                      )}
                    </div>
                  )}
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
                  {viewMode === "ARCHITECT" && activeHole.isComplete && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
                      {activeHole.autoPar === 5 &&
                        !activeHole.reachableInTwo &&
                        Number.isFinite(activeHole.scratchShotsToGreen) && (
                          <div>
                            Par 5 not reachable in two: scratch needs ~{activeHole.scratchShotsToGreen.toFixed(2)} shots to reach green.
                          </div>
                        )}
                      {activeHole.shotPlan && activeHole.shotPlan.length >= 3 && (
                        <div style={{ marginTop: 4 }}>
                          Layup preferred: optimal route is {activeHole.shotPlan.length} shots to reach green (hazard/dispersion risk makes aggression costly).
                        </div>
                      )}
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
                <div style={{ display: "flex", gap: 6, marginTop: 8, marginBottom: 8 }}>
                  <button
                    onClick={startPlaceTee}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: wizardStep === "TEE" || wizardStep === "MOVE_TEE" ? "2px solid #000" : "1px solid #ccc",
                      background: wizardStep === "TEE" || wizardStep === "MOVE_TEE" ? "#e8f5e9" : "#fff",
                      fontSize: 12,
                      fontWeight: wizardStep === "TEE" || wizardStep === "MOVE_TEE" ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {course.holes[activeHoleIndex]?.tee ? "Move Tee" : "Place Tee"}
                  </button>
                  <button
                    onClick={startPlaceGreen}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: wizardStep === "GREEN" || wizardStep === "MOVE_GREEN" ? "2px solid #000" : "1px solid #ccc",
                      background: wizardStep === "GREEN" || wizardStep === "MOVE_GREEN" ? "#e8f5e9" : "#fff",
                      fontSize: 12,
                      fontWeight: wizardStep === "GREEN" || wizardStep === "MOVE_GREEN" ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {course.holes[activeHoleIndex]?.green ? "Move Green" : "Place Green"}
                  </button>
                </div>
                <div style={{ color: "#444", fontSize: 12, marginTop: 8 }}>
                  {wizardStep === "TEE" || wizardStep === "MOVE_TEE"
                    ? "Click on the canvas to set tee position"
                    : wizardStep === "GREEN" || wizardStep === "MOVE_GREEN"
                      ? "Click on the canvas to set green position"
                      : "Confirm to save this hole, or redo to try again."}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
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
                  {(["tree", "bush", "rock"] as const).map((t) => (
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {t === "tree" ? <IconTree size={22} /> : t === "bush" ? <IconBush size={22} /> : <IconRock size={22} />}
                        <span style={{ textTransform: "capitalize" }}>{t}</span>
                      </span>
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
                    <div style={{ display: "grid", gridTemplateColumns: "34px 44px 1fr 54px 70px", fontSize: 12, color: "#555" }}>
                      <div>
                        <b>#</b>
                      </div>
                      <div>
                        <b>Par</b>
                      </div>
                      <div>
                        <b>Dist (yds)</b>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <b>Overall</b>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <b>Edit</b>
                      </div>
                    </div>
                    {holeSummary.holes.slice(0, 9).map((h) => (
                      <div
                        key={h.holeIndex}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "34px 44px 1fr 54px 70px",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 8px",
                          borderRadius: 10,
                          border: h.holeIndex === activeHoleIndex ? "2px solid #000" : "1px solid #ddd",
                          background: "#fff",
                          fontSize: 12,
                        }}
                      >
                        <button
                          onClick={() => {
                            setActiveHoleIndex(h.holeIndex);
                          }}
                          style={{
                            textAlign: "left",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          {h.holeIndex + 1}
                          {!h.isComplete && <span style={{ color: "#a40000" }}> *</span>}
                        </button>
                        <div>{h.isComplete ? h.par : "—"}</div>
                        <div style={{ color: "#555" }}>
                          {h.isComplete
                            ? `${Math.round(h.effectiveDistance * course.yardsPerTile)} yds`
                            : "missing tee/green"}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <b>{Math.round(h.overallHoleScore)}</b>
                        </div>
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          {onEnterHoleEditMode && course.holes[h.holeIndex]?.tee && course.holes[h.holeIndex]?.green ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                audio.unlock();
                                audio.playSfx("/audio/ball-strike.mp3");
                                onEnterHoleEditMode(h.holeIndex);
                              }}
                              style={{
                                padding: "4px 10px",
                                fontSize: 11,
                                borderRadius: 4,
                                border: "1px solid #ddd",
                                background: "#fff",
                                cursor: "pointer",
                                fontWeight: 500,
                              }}
                            >
                              Edit
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: "#999" }}>—</span>
                          )}
                        </div>
                      </div>
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
                {typeof last.capacity === "number" && (
                  <div style={{ fontSize: 12, color: "#555" }}>
                    Capacity: {last.capacity}{" "}
                    {typeof last.turnaways === "number" && last.turnaways > 0 && (
                      <>
                        • Turned away: <b>{last.turnaways}</b>
                      </>
                    )}
                  </div>
                )}
                <div>Revenue: ${Math.round(last.revenue).toLocaleString()}</div>
                <div>Costs: ${Math.round(last.costs).toLocaleString()}</div>
                {last.variableCosts && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Variable costs</span>
                      <span>
                        <b>${Math.round(last.variableCosts.total).toLocaleString()}</b>
                      </span>
                    </div>
                    <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Labor (per round)</span>
                        <span>${Math.round(last.variableCosts.labor).toLocaleString()}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Consumables</span>
                        <span>${Math.round(last.variableCosts.consumables).toLocaleString()}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Merchant fees</span>
                        <span>${Math.round(last.variableCosts.merchantFees).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )}
                {last.overhead && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Overhead (fixed)</span>
                      <span>
                        <b>${Math.round(last.overhead.total).toLocaleString()}</b>
                      </span>
                    </div>
                    <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Insurance</span>
                        <span>${Math.round(last.overhead.insurance).toLocaleString()}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Utilities</span>
                        <span>${Math.round(last.overhead.utilities).toLocaleString()}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Admin</span>
                        <span>${Math.round(last.overhead.admin).toLocaleString()}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Base staff</span>
                        <span>${Math.round(last.overhead.baseStaff).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )}
                {last.maintenance && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Required maintenance</span>
                      <span>
                        <b>${Math.round(last.maintenance.required).toLocaleString()}</b>
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span>Budget</span>
                      <span>${Math.round(last.maintenance.budget).toLocaleString()}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span>{last.maintenance.shortfall > 0 ? "Shortfall" : "Excess"}</span>
                      <span>
                        {last.maintenance.shortfall > 0 ? "-" : "+"}$
                        {Math.round(Math.abs(last.maintenance.shortfall)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
                <div>
                  <b>Profit:</b> ${Math.round(last.profit).toLocaleString()}
                </div>
                {typeof last.tax === "number" && last.tax > 0 && (
                  <div style={{ fontSize: 12, color: "#555" }}>
                    Profit tax: -${Math.round(last.tax).toLocaleString()}
                  </div>
                )}
                <div>Avg satisfaction: {Math.round(last.avgSatisfaction)}/100</div>
                <div>
                  Reputation Δ: {last.reputationDelta >= 0 ? "+" : ""}
                  {last.reputationDelta}
                </div>
                {last.reputationMomentum && (
                  <div style={{ fontSize: 12, color: "#555" }}>{last.reputationMomentum}</div>
                )}
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
                  {last.demand.segments?.totalBaseVisitors ?? 120 + Math.round(520 * last.demand.demandIndex)}
                </div>
                {last.demand.segments && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#444", display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Casual</span>
                      <span>
                        {Math.round(last.demand.segments.casual.share * 100)}% • idx{" "}
                        {last.demand.segments.casual.demandIndex.toFixed(2)} • base{" "}
                        {last.demand.segments.casual.baseVisitors}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Core</span>
                      <span>
                        {Math.round(last.demand.segments.core.share * 100)}% • idx{" "}
                        {last.demand.segments.core.demandIndex.toFixed(2)} • base{" "}
                        {last.demand.segments.core.baseVisitors}{" "}
                        <span style={{ color: "#6b7280" }}>
                          (cap {Math.round(last.demand.segments.core.cap * 100)}%)
                        </span>
                      </span>
                    </div>
                  </div>
                )}
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

            <Section title="Financing">
              <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
                Loans can keep you afloat — but weekly payments are a fixed cost. Missed payments hurt reputation and worsen APR.
              </div>

              <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={onTakeBridgeLoan}
                  disabled={!bridgeEligible}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: bridgeEligible ? "1px solid #000" : "1px solid #ccc",
                    background: bridgeEligible ? "#000" : "#f6f6f6",
                    color: bridgeEligible ? "#fff" : "#555",
                    fontWeight: 700,
                    textAlign: "left",
                  }}
                >
                  Bridge Loan — ${BALANCE.loans.bridge.maxPrincipal.toLocaleString()} •{" "}
                  {Math.round(BALANCE.loans.bridge.apr * 100)}% APR • {BALANCE.loans.bridge.termWeeks}w{" "}
                  {!bridgeEligible && (
                    <span style={{ fontWeight: 500, color: "#777" }}>
                      (need rep ≥ {BALANCE.loans.bridge.repMin}, ≥{BALANCE.loans.bridge.minValidHolesAlt} valid holes or playable, and {BALANCE.loans.bridgeCooldownWeeks}-week cooldown)
                    </span>
                  )}
                </button>

                <button
                  onClick={onTakeExpansionLoan}
                  disabled={!expansionEligible}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: expansionEligible ? "1px solid #000" : "1px solid #ccc",
                    background: expansionEligible ? "#000" : "#f6f6f6",
                    color: expansionEligible ? "#fff" : "#555",
                    fontWeight: 700,
                    textAlign: "left",
                  }}
                >
                  Expansion Loan — ${BALANCE.loans.expansion.maxPrincipal.toLocaleString()} •{" "}
                  {Math.round(BALANCE.loans.expansion.apr * 100)}% APR • {BALANCE.loans.expansion.termWeeks}w{" "}
                  {!expansionEligible && (
                    <span style={{ fontWeight: 500, color: "#777" }}>
                      (need rep ≥ {BALANCE.loans.expansion.repMin}, {BALANCE.loans.expansion.minValidHoles} valid holes, and last week profit &gt; 0)
                    </span>
                  )}
                </button>
              </div>

              {(world.loans ?? []).length > 0 && (
                <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 800 }}>Active loans</div>
                  {(world.loans ?? [])
                    .filter((l) => l.status === "ACTIVE")
                    .map((l) => (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>
                          {l.kind} • {Math.round(l.apr * 100)}% • {l.weeksRemaining}w left
                        </span>
                        <span>
                          ${Math.round(l.weeklyPayment).toLocaleString()}/wk • bal $
                          {Math.round(l.balance).toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </Section>

            <Section title="Unlocks (cosmetic)">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: "#555" }}>Legacy points</span>
                <b>{legacy.legacyPoints}</b>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
                Earn points on bankruptcy based on weeks survived + peak reputation. Purely cosmetic.
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <b>Flag color: Blue</b>{" "}
                    <span style={{ color: "#6b7280" }}>(cost 3)</span>
                  </div>
                  {legacy.unlocked.FLAG_BLUE ? (
                    <button
                      onClick={() => onSelectFlagColor("rgba(37,99,235,0.92)")}
                      style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                    >
                      Use
                    </button>
                  ) : (
                    <button
                      onClick={() => onUnlockFlagColor("BLUE", 3)}
                      disabled={legacy.legacyPoints < 3}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: legacy.legacyPoints >= 3 ? "1px solid #000" : "1px solid #ccc",
                        background: legacy.legacyPoints >= 3 ? "#000" : "#f6f6f6",
                        color: legacy.legacyPoints >= 3 ? "#fff" : "#555",
                        fontWeight: 700,
                      }}
                    >
                      Unlock
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <b>Flag color: Gold</b>{" "}
                    <span style={{ color: "#6b7280" }}>(cost 5)</span>
                  </div>
                  {legacy.unlocked.FLAG_GOLD ? (
                    <button
                      onClick={() => onSelectFlagColor("rgba(245,158,11,0.92)")}
                      style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                    >
                      Use
                    </button>
                  ) : (
                    <button
                      onClick={() => onUnlockFlagColor("GOLD", 5)}
                      disabled={legacy.legacyPoints < 5}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: legacy.legacyPoints >= 5 ? "1px solid #000" : "1px solid #ccc",
                        background: legacy.legacyPoints >= 5 ? "#000" : "#f6f6f6",
                        color: legacy.legacyPoints >= 5 ? "#fff" : "#555",
                        fontWeight: 700,
                      }}
                    >
                      Unlock
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                  Current flag:{" "}
                  <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid #ddd" }}>
                    <span style={{ color: legacy.selected.flagColor }}>●</span> active
                  </span>
                </div>
              </div>
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
            pointerEvents: isBankrupt ? "none" : "auto",
            opacity: isBankrupt ? 0.55 : 1,
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
          borderTop: "1px solid rgba(0,0,0,0.06)",
          background: "rgba(255,255,255,0.35)",
          pointerEvents: isBankrupt ? "none" : "auto",
          opacity: isBankrupt ? 0.55 : 1,
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <GameButton variant="secondary" size="md" onClick={onSave} style={{ flex: 1, borderRadius: 16 }}>
            💾 Save
          </GameButton>
          <GameButton variant="secondary" size="md" onClick={onLoad} style={{ flex: 1, borderRadius: 16 }}>
            📁 Load
          </GameButton>
          <GameButton variant="secondary" size="md" onClick={onResetSave} style={{ flex: 1, borderRadius: 16 }}>
            ↺ Reset
          </GameButton>
        </div>

        <GameButton
          onClick={simulate}
          disabled={isBankrupt}
          variant="primary"
          size="lg"
          style={{ width: "100%", borderRadius: 18 }}
        >
          {isBankrupt ? "Run ended" : "⏩ Simulate week"}
        </GameButton>
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


