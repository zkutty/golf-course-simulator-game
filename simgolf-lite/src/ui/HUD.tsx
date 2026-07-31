import { useMemo, useState } from "react";
import { formatCurrency, formatNumber, formatWeekLabel } from "../i18n/format";
import type { TutorialTarget } from "../game/onboarding/tutorial";
import type { SculptBrush, SculptRadius } from "../game/models/sculpt";
import {
  ELEVATION_COST_PER_STEP,
  terrainMaintenanceWeight,
  themeEarthworkMult,
} from "../game/models/terrainEconomics";
import { useAudio } from "../audio/audioContext";
import type { BuildingTier, ConcessionType, Course, DecorationKind, DecorationRotation, Point, Terrain, WeekResult, World } from "../game/models/types";
import { demandBreakdown, priceAttractiveness } from "../game/sim/score";
import { scoreCourseHoles } from "../game/sim/holes";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import { computeCourseRatingAndSlope, computeRatingsByTee } from "../game/sim/courseRating";
import { canTakeBridgeLoan, canTakeExpansionLoan } from "../game/sim/loanEligibility";
import type { LegacyState } from "../utils/legacy";
import { getEffectiveBalance, getDifficultyProfile } from "../game/balance/difficulty";
import paperTex from "../assets/textures/paper.svg";
import { IconCash, IconCondition, IconHoles, IconReputation, LogoCourseCraft } from "@/assets/icons";
import { GameButton } from "@/ui/gameui";
import { ObjectiveMiniTracker, ObjectivesPanel } from "./ObjectivesPanel";
import { BUILDING_SPECS, isConcession } from "../game/models/buildings";
import { Tooltip } from "./help/Tooltip";
import { REPORT_HELP } from "./help/tooltipContent";
import { T } from "../i18n/T";
import { translateCurrent } from "../i18n/core";
import { HoleMinimap } from "./HoleMinimap";
import { concessionMinReputation, isConcessionUnlocked, reputationTier } from "../game/progression/progression";
import { courseVibeLabel } from "./courseVibe";
import {
  biomeContextAttributes,
  type BiomeUiTheme,
} from "./biomeUiTheme";

type Tab = "Editor" | "Metrics" | "Results" | "Upgrades";

export function HUD(props: {
  course: Course;
  world: World;
  last?: WeekResult;
  prev?: WeekResult;
  terrainBrushWidth: number;
  setTerrainBrushWidth: (width: number) => void;
  onUndoTerrain: () => void;
  onRedoTerrain: () => void;
  setGreenFee: (n: number) => void;
  setMaintenance: (n: number) => void;
  editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
  setEditorMode: (m: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR") => void;
  onEnterDesignMode: () => void;
  sculptBrush?: SculptBrush;
  setSculptBrush?: (b: SculptBrush) => void;
  sculptRadius?: SculptRadius;
  setSculptRadius?: (r: SculptRadius) => void;
  startWizard: () => void;
  startPlaceTee?: () => void;
  startPlaceGreen?: () => void;
  buildingType: ConcessionType;
  setBuildingType: (t: ConcessionType) => void;
  concessionTypes: readonly ConcessionType[];
  decorationKind: DecorationKind;
  setDecorationKind: (kind: DecorationKind) => void;
  decorationRotation: DecorationRotation;
  setDecorationRotation: (rotation: DecorationRotation) => void;
  decorationSpan: number;
  setDecorationSpan: (span: number) => void;
  decorationAction: "place" | "rotate" | "remove";
  setDecorationAction: (action: "place" | "rotate" | "remove") => void;
  onConfigureBuilding: (x: number, y: number, tier: BuildingTier, price: number) => void;
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
  paintError?: string | null;
  viewMode: "COZY" | "ARCHITECT";
  setViewMode: (m: "COZY" | "ARCHITECT") => void;
  onFlyover: () => void;
  showObstacles?: boolean;
  setShowObstacles?: (b: boolean) => void;
  isBankrupt: boolean;
  onTakeBridgeLoan: () => void;
  onTakeExpansionLoan: () => void;
  legacy: LegacyState;
  onUnlockFlagColor: (color: "BLUE" | "GOLD", cost: number) => void;
  onSelectFlagColor: (rgba: string) => void;
  showShotPlan: boolean;
  setShowShotPlan: (b: boolean) => void;
  onOpenGolfopedia: (entry?: string) => void;
  onStartTutorial: () => void;
  tutorialTarget?: TutorialTarget;
  biomeContext?: BiomeUiTheme;
}) {
  const {
    course,
    world,
    last,
    prev,
    setGreenFee,
    setMaintenance,
    editorMode,
    setEditorMode,
    onEnterDesignMode,
    startWizard,
    startPlaceTee,
    startPlaceGreen,
    buildingType,
    setBuildingType,
    concessionTypes,
    onConfigureBuilding,
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
    paintError,
    viewMode,
    setViewMode,
    onFlyover,
    showObstacles,
    setShowObstacles,
    isBankrupt,
    onTakeBridgeLoan,
    onTakeExpansionLoan,
    legacy,
    onUnlockFlagColor,
    onSelectFlagColor,
    showShotPlan,
    setShowShotPlan,
    onOpenGolfopedia,
    onStartTutorial,
    tutorialTarget,
  } = props;

  const [tab, setTab] = useState<Tab>("Editor");
  const [objectivesOpen, setObjectivesOpen] = useState(false);
  const activeTab: Tab = tutorialTarget === "weekly-report"
    ? "Results"
    : tutorialTarget === "green-fee" || tutorialTarget === "maintenance"
      ? "Upgrades"
      : tutorialTarget
        ? "Editor"
        : tab;
  // Difficulty-resolved balance for loan terms/eligibility (ZKU-165).
  const BALANCE = getEffectiveBalance(world.difficulty);
  const costMult = getDifficultyProfile(world.difficulty).terrainCostMult;
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
    return course.tiles.reduce(
      (sum, terrain) => sum + terrainMaintenanceWeight(terrain, course.theme),
      0,
    );
  }, [course.theme, course.tiles]);
  const avgMaintWeight = totalMaintWeight / totalTiles;
  const rating = useMemo(() => computeCourseRatingAndSlope(course), [course]);
  const teeRatings = useMemo(() => computeRatingsByTee(course), [course]);

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

    // Tone comes from difficulty/aesthetics/slope; biome identity comes only
    // from the authoritative registry and remains on the localization path.
    const vibeLabel = courseVibeLabel(course.theme, {
      slope,
      averageDifficulty: avgDiff,
      averageAesthetics: avgAest,
    });

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
  }, [course.theme, holeSummary, rating.slope]);

  const validHoles = useMemo(() => {
    return holeSummary.holes.filter((h) => h.isComplete && h.isValid).length;
  }, [holeSummary]);
  const loansBarred = world.constraints?.noLoans === true;
  const bridgeEligible = canTakeBridgeLoan(course, world, BALANCE);
  const expansionEligible = canTakeExpansionLoan(course, world, BALANCE);

  return (
    <div
      className="cc-hud cc-tycoon-panel"
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
      <div
        {...(props.biomeContext
          ? biomeContextAttributes(props.biomeContext, "course-header")
          : {})}
        style={{ padding: 12, borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.22)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <LogoCourseCraft height={44} />
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#3d4a3e",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={course.name}
              >
                {course.name}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{formatWeekLabel(world.week)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Tooltip content="Open the searchable reference for terrain, golfers, management systems, and controls.">
              <button onClick={() => onOpenGolfopedia()} style={{ padding: "6px 8px", borderRadius: 999, border: "1px solid #ddd", background: "#fff", fontSize: 12, fontWeight: 800 }}>
                <T id="auto.ui.hud.help" /></button>
            </Tooltip>
            <button onClick={onStartTutorial} style={{ padding: "6px 8px", borderRadius: 999, border: "1px solid #ddd", background: "#fff", fontSize: 12, fontWeight: 800 }}>
              <T id="auto.ui.hud.tutorial" /></button>
            <span
              title={translateCurrent("hud.difficultyTitle", { difficulty: getDifficultyProfile(world.difficulty).label })}
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.06em",
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.12)",
                background:
                  world.difficulty === "hard"
                    ? "#fde8e8"
                    : world.difficulty === "easy"
                      ? "#e8f5e0"
                      : "rgba(255,255,255,0.7)",
                color:
                  world.difficulty === "hard"
                    ? "#b91c1c"
                    : world.difficulty === "easy"
                      ? "#2f6b33"
                      : "#6b7280",
              }}
            >
              {getDifficultyProfile(world.difficulty).label.toUpperCase()}
            </span>
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
            <b><T id="auto.ui.hud.bankrupt" /></b> <T id="auto.ui.hud.this.run.has.ended.restart.to.continue" /></div>
        )}
        {/* Pinned objective mini-tracker (ZKU-163); click for the full panel */}
        <div style={{ marginTop: 10 }}>
          <ObjectiveMiniTracker objectives={world.objectives} onOpen={() => setObjectivesOpen(true)} />
        </div>
        <ObjectivesPanel
          open={objectivesOpen}
          onClose={() => setObjectivesOpen(false)}
          objectives={world.objectives}
          week={world.week}
        />
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {viewMode === "COZY" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Tooltip block label={translateCurrent("hud.cashHelp")} content="Your available operating runway. Construction, losses, and loan payments reduce it; profitable play restores it." learnMore={() => onOpenGolfopedia("management-cash")}>
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
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}><T id="auto.ui.hud.cash" /></div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{formatCurrency(world.cash)}</div>
                </div>
              </div>
              </Tooltip>
              <Tooltip block label={translateCurrent("hud.reputationHelp")} content="The market's memory of golfer satisfaction. It falls faster than it recovers and directly supports demand." learnMore={() => onOpenGolfopedia("management-reputation")}>
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
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}><T id="auto.ui.hud.reputation" /></div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{world.reputation}/100</div>
                </div>
              </div>
              </Tooltip>
              <Tooltip block label={translateCurrent("hud.conditionHelp")} content="Playing-surface health. Traffic causes wear; the maintenance budget restores condition each period." learnMore={() => onOpenGolfopedia("management-condition")}>
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
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}><T id="auto.ui.hud.condition" /></div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{Math.round(course.condition * 100)}%</div>
                </div>
              </div>
              </Tooltip>
              <Tooltip block label={translateCurrent("hud.openHolesHelp")} content="Valid holes with a tee, green, and safe playable corridor. Nine valid holes open the full course." learnMore={() => onOpenGolfopedia("management-demand")}>
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
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#6b7280" }}><T id="auto.ui.hud.holes.open" /></div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{validHoles}/9</div>
                </div>
              </div>
              </Tooltip>
            </div>
          ) : (
            <>
              <div data-tooltip="Available operating cash. Building, maintenance, staffing, and debt payments spend this balance." style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}><T id="auto.ui.hud.cash.2" /></div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{formatCurrency(world.cash)}</div>
              </div>
              <div data-tooltip={REPORT_HELP.Reputation} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}><T id="auto.ui.hud.reputation.2" /></div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{world.reputation}/100</div>
              </div>
              <div data-tooltip={REPORT_HELP.Condition} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}><T id="auto.ui.hud.condition.2" /></div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{Math.round(course.condition * 100)}%</div>
              </div>
            </>
          )}
          {viewMode === "COZY" && (
            <div style={{ display: "grid", gap: 6 }}>
              <div data-tooltip="A quick summary of the course's atmosphere, based on condition, satisfaction, and recent results." style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}><T id="auto.ui.hud.vibe" /></div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{vibe.vibeLabel}</div>
              </div>
              <div data-tooltip="The current mood of golfers on the course, summarized from their recent experiences." style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}><T id="auto.ui.hud.golfer.sentiment" /></div>
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
                  <T id="auto.ui.hud.flyover" /></button>
                {setShowObstacles && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#374151" }}>
                    <input
                      type="checkbox"
                      checked={showObstacles ?? true}
                      onChange={(e) => setShowObstacles(e.target.checked)}
                    />
                    <T id="auto.ui.hud.obstacles" /></label>
                )}
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
                border: activeTab === t ? "2px solid rgba(0,0,0,0.75)" : "1px solid rgba(0,0,0,0.10)",
                background: activeTab === t ? "var(--cc-grass)" : "rgba(255,255,255,0.75)",
                color: activeTab === t ? "#fff" : "#3d4a3e",
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
        {activeTab === "Editor" && (
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
                {paintError.startsWith("Game") ? null : <b><T id="auto.ui.hud.build.blocked" /></b>} {paintError}
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <div style={{ marginBottom: 8 }}>
                <b><T id="auto.ui.hud.editor.mode" /></b>
              </div>
              <div data-tutorial-target="editor-tools" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  onClick={onEnterDesignMode}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "PAINT" || editorMode === "OBSTACLE" || editorMode === "DECOR" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  <T id="workspace.design" />
                </button>
                <button
                  onClick={startWizard}
                  data-tutorial-target={editorMode === "HOLE_WIZARD" ? undefined : "hole-wizard"}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "HOLE_WIZARD" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  <T id="auto.ui.hud.hole.wizard" /></button>
                <button
                  onClick={() => setEditorMode("SCULPT")}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "SCULPT" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  <T id="auto.ui.hud.sculpt" /></button>
                <button
                  onClick={() => setEditorMode("BUILDING")}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: editorMode === "BUILDING" ? "2px solid #000" : "1px solid #ccc",
                    background: "#fff",
                    fontSize: 12,
                  }}
                >
                  <T id="auto.ui.hud.shops" /></button>
              </div>

              {editorMode === "SCULPT" && props.sculptBrush && props.setSculptBrush && props.setSculptRadius && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ marginBottom: 6 }}>
                    <b><T id="auto.ui.hud.sculpt.brush" /></b>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    {(["raise", "lower", "smooth", "level"] as const).map((b) => (
                      <button
                        key={b}
                        onClick={() => props.setSculptBrush!(b)}
                        style={{
                          flex: "1 1 40%",
                          padding: "7px 6px",
                          borderRadius: 10,
                          border: props.sculptBrush === b ? "2px solid #000" : "1px solid #ccc",
                          background: "#fff",
                          fontSize: 12,
                          textTransform: "capitalize",
                        }}
                      >
                        {b === "raise" ? "⬆ Raise" : b === "lower" ? "⬇ Lower" : b === "smooth" ? "〜 Smooth" : "▭ Level"}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "#555" }}><T id="auto.ui.hud.size" /></span>
                    {([1, 2, 3] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => props.setSculptRadius!(r)}
                        style={{
                          width: 32,
                          padding: "5px 0",
                          borderRadius: 8,
                          border: props.sculptRadius === r ? "2px solid #000" : "1px solid #ccc",
                          background: "#fff",
                          fontSize: 12,
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "#777" }}>
                    <T id="auto.ui.hud.earthworks.cost" />
                    {formatCurrency(ELEVATION_COST_PER_STEP * themeEarthworkMult(course.theme) * costMult)}{" "}
                    <T id="auto.ui.hud.per.step.per.tile.steep.edges.auto.terrace.and.are.inc" /></div>
                </div>
              )}

              {viewMode === "ARCHITECT" && (
                <div data-tutorial-target="shot-plan" style={{ marginTop: -2, marginBottom: 10, fontSize: 12, color: "#374151" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={showShotPlan}
                      onChange={(e) => setShowShotPlan(e.target.checked)}
                    />
                    <T id="auto.ui.hud.show.shot.plan.overlay" /></label>
                </div>
              )}

              {activeHole && (
                <div style={{ fontSize: 12, color: "#222" }}>
                  <div>
                    <b><T id="auto.ui.hud.hole" />{activeHoleIndex + 1}</b>:{" "}
                    {activeHole.isComplete ? (
                      <>
                        <T id="auto.ui.hud.score" />{Math.round(activeHole.score)}<T id="auto.ui.hud.100.par" />{activeHole.par}{" "}
                        <span style={{ color: "#6b7280" }}>
                          {Number.isFinite(activeHole.autoPar) ? ` (auto ${activeHole.autoPar})` : ""}
                        </span>
                      </>
                    ) : (
                      <><T id="auto.ui.hud.place.tee.green" /></>
                    )}
                  </div>
                  <div style={{ marginTop: 4, color: "#444" }}>
                    <T id="auto.ui.hud.straight" />{" "}
                    {distanceTiles != null
                      ? `${Math.round(distanceTiles * course.yardsPerTile)} yds (${distanceTiles.toFixed(1)} tiles)`
                      : "—"}{" "}
                    <T id="auto.ui.hud.effective" />{" "}
                    {activeHole.isComplete
                      ? `${Math.round(activeHole.effectiveDistance * course.yardsPerTile)} yds (${activeHole.effectiveDistance.toFixed(1)} tiles)`
                      : "—"}{" "}
                    <T id="auto.ui.hud.par" />{effectivePar}{" "}
                    <span style={{ color: "#777" }}>({holeDef?.parMode === "MANUAL" ? "manual" : "auto"})</span>
                  </div>
                  {activeHole.isComplete && Number.isFinite(activeHole.scratchShotsToGreen) && (
                    <div style={{ marginTop: 4, color: "#444" }}>
                      <T id="auto.ui.hud.scratch.to.green" /><b>{activeHole.scratchShotsToGreen.toFixed(2)}</b> <T id="auto.ui.hud.bogey" />{" "}
                      <b>{Number.isFinite(activeHole.bogeyShotsToGreen) ? activeHole.bogeyShotsToGreen.toFixed(2) : "—"}</b>
                      {activeHole.autoPar === 5 && (
                        <span style={{ color: "#6b7280" }}>
                          {" "}
                          <T id="auto.ui.hud.reachable.in.two" />{" "}
                          <b style={{ color: activeHole.reachableInTwo ? "#065f46" : "#7a0000" }}>
                            {activeHole.reachableInTwo ? "Yes" : "No"}
                          </b>
                        </span>
                      )}
                    </div>
                  )}
                  {viewMode === "ARCHITECT" && activeHole.isComplete && (
                    <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                      <div data-tooltip={REPORT_HELP.Playability}>
                        <T id="auto.ui.hud.playability" /><b>{Math.round(activeHole.playabilityScore)}</b>/100
                      </div>
                      <div data-tooltip="The strategic challenge created by distance, hazards, elevation, and shot demands.">
                        <T id="auto.ui.hud.difficulty" /><b>{Math.round(activeHole.difficultyScore)}</b>/100
                      </div>
                      <div data-tooltip={REPORT_HELP.Aesthetics}>
                        <T id="auto.ui.hud.aesthetics" /><b>{Math.round(activeHole.aestheticsScore)}</b>/100
                      </div>
                      <div data-tooltip="The combined hole score used in course-quality calculations.">
                        <T id="auto.ui.hud.overall" /><b>{Math.round(activeHole.overallHoleScore)}</b>/100
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
                            <T id="auto.ui.hud.par.5.not.reachable.in.two.scratch.needs" />{activeHole.scratchShotsToGreen.toFixed(2)} <T id="auto.ui.hud.shots.to.reach.green" /></div>
                        )}
                      {activeHole.shotPlan && activeHole.shotPlan.length >= 3 && (
                        <div style={{ marginTop: 4 }}>
                          <T id="auto.ui.hud.layup.preferred.optimal.route.is" />{activeHole.shotPlan.length} <T id="auto.ui.hud.shots.to.reach.green.hazard.dispersion.risk.makes.aggr" /></div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {editorMode === "HOLE_WIZARD" ? (
              <div data-tutorial-target="hole-wizard"><Section title={translateCurrent("auto.ui.hud.hole.setup.wizard")}>
                <div>
                  <b><T id="auto.ui.hud.hole" />{activeHoleIndex + 1} <T id="auto.ui.hud.of.9" /></b>
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
                  <T id="auto.ui.hud.draft.tee" />{draftTee ? `(${draftTee.x},${draftTee.y})` : "—"} <T id="auto.ui.hud.green" />{" "}
                  {draftGreen ? `(${draftGreen.x},${draftGreen.y})` : "—"}
                </div>
              </Section></div>
            ) : editorMode === "OBSTACLE" || editorMode === "DECOR" ? (
              <Section title={translateCurrent("designDock.guidanceTitle")}>
                <div style={{ color: "#444", fontSize: 12 }}>
                  <T id="designDock.guidance" />
                </div>
              </Section>
            ) : editorMode === "BUILDING" ? (
              <>
                <Section title={translateCurrent("auto.ui.hud.concession.buildings")}>
                  <div style={{ color: "#444", fontSize: 12, marginBottom: 8 }}>
                    <T id="auto.ui.hud.choose.a.shop.then.click.clear.near.flat.land.to.build" /></div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {concessionTypes.map((type) => {
                      const spec = BUILDING_SPECS[type];
                      const locked = !isConcessionUnlocked(type, world.reputation);
                      return (
                        <button
                          key={type}
                          disabled={locked}
                          title={locked ? translateCurrent("progression.locked", { reputation: concessionMinReputation(type) }) : undefined}
                          onClick={() => setBuildingType(type)}
                          style={{
                            padding: 9,
                            borderRadius: 9,
                            border: buildingType === type ? "2px solid #000" : "1px solid #ccc",
                            background: locked ? "#eee" : "#fff",
                            opacity: locked ? .58 : 1,
                            textAlign: "left",
                            fontSize: 12,
                          }}
                        >
                          <b>{locked ? `🔒 ${spec.name}` : spec.name}</b> · {formatCurrency(spec.buildCost)} <T id="auto.ui.hud.starts.at" />{formatCurrency(spec.defaultPrice ?? 0)}
                        </button>
                      );
                    })}
                  </div>
                </Section>
                <Section title={translateCurrent("auto.ui.hud.pricing.tiers")}>
                  <div style={{ display: "grid", gap: 8 }}>
                    {course.buildings.filter(isConcession).map((building, i) => {
                      const spec = BUILDING_SPECS[building.type];
                      const tier = building.tier ?? 1;
                      const price = building.price ?? spec.defaultPrice!;
                      return (
                        <div key={`${building.x},${building.y},${i}`} style={{ padding: 8, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
                          <div style={{ fontSize: 12, marginBottom: 6 }}><b>{spec.name}</b> <T id="auto.ui.hud.at" />{building.x},{building.y}</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <select
                              aria-label={translateCurrent("hud.buildingTierLabel", { building: spec.name })}
                              value={tier}
                              onChange={(e) => onConfigureBuilding(building.x, building.y, Number(e.target.value) as BuildingTier, price)}
                            >
                              <option value={1}><T id="auto.ui.hud.tier.1" /></option><option disabled={reputationTier(world.reputation).buildingTierCap < 2} value={2}><T id="auto.ui.hud.tier.2" /></option><option disabled={reputationTier(world.reputation).buildingTierCap < 3} value={3}><T id="auto.ui.hud.tier.3" /></option>
                            </select>
                            <label style={{ fontSize: 12 }}>
                              $ <input
                                aria-label={translateCurrent("hud.buildingPriceLabel", { building: spec.name })}
                                type="number" min={1} max={250} value={price}
                                onChange={(e) => onConfigureBuilding(building.x, building.y, tier, Number(e.target.value))}
                                style={{ width: 58 }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                    {course.buildings.filter(isConcession).length === 0 && <div style={{ fontSize: 12, color: "#666" }}><T id="auto.ui.hud.no.concessions.built.yet" /></div>}
                  </div>
                </Section>
              </>
            ) : (
              <>
                {viewMode === "ARCHITECT" && (
                  <Section title={translateCurrent("auto.ui.hud.par.settings.active.hole")}>
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
                      <T id="auto.ui.hud.auto" /></button>
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
                      <T id="auto.ui.hud.manual" /></button>
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
                          <T id="auto.ui.hud.par.2" />{p}
                        </button>
                      ))}
                    </div>
                  )}

                  {holeDef?.parMode === "AUTO" && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                      <T id="auto.ui.hud.auto.par.thresholds.14.3.15.30.4.31.5" /></div>
                  )}
                </Section>
                )}

                {viewMode === "ARCHITECT" && (
                  <Section title={translateCurrent("auto.ui.hud.hole.list.overall.score")}>
                  {course.holes[activeHoleIndex]?.tee && course.holes[activeHoleIndex]?.green && (
                    <HoleMinimap course={course} hole={course.holes[activeHoleIndex]} holeIndex={activeHoleIndex} thumbnail />
                  )}
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "34px 44px 1fr 54px 70px", fontSize: 12, color: "#555" }}>
                      <div>
                        <b>#</b>
                      </div>
                      <div>
                        <b><T id="auto.ui.hud.par.2" /></b>
                      </div>
                      <div>
                        <b><T id="auto.ui.hud.dist.yds" /></b>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <b><T id="auto.ui.hud.overall.2" /></b>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <b><T id="auto.ui.hud.edit" /></b>
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
                                audio.playSfx("driver");
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
                              <T id="auto.ui.hud.edit" /></button>
                          ) : (
                            <span style={{ fontSize: 11, color: "#999" }}>—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                    <T id="auto.ui.hud.layout.issue.tee.green.missing.low.overall.holes.drag." /></div>
                </Section>
                )}

                <div style={{ padding: 8, border: "1px solid #cbbd9d", borderRadius: 8, color: "#555", fontSize: 12 }}>
                  <T id="designDock.terrainGuidance" />
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "Metrics" && (
          <>
            <Section title={translateCurrent("auto.ui.hud.course.metrics")}>
              <div data-tooltip={REPORT_HELP["Course quality"]}><T id="auto.ui.hud.course.quality" />{Math.round(holeSummary.courseQuality)}/100</div>
              <div data-tooltip="The mean overall score of every completed, valid hole."><T id="auto.ui.hud.hole.quality.avg" />{Math.round(holeSummary.holeQualityAvg)}/100</div>
              <div data-tooltip="Rewards a course that mixes hole lengths, pars, shapes, hazards, and scenery."><T id="auto.ui.hud.variety" />{Math.round(holeSummary.variety)}/100</div>
              <div data-tooltip={REPORT_HELP.Price}><T id="auto.ui.hud.price.attractiveness" />{price}/100</div>
              <div data-tooltip="The combined demand factors before capacity and random visitor noise are applied."><T id="auto.ui.hud.demand.index" />{liveDemand.demandIndex.toFixed(2)}</div>
              <div style={{ marginTop: 8 }}>
                <Tooltip
                  content="Rating estimates a scratch golfer's expected score; slope measures how much harder the course becomes for bogey golfers."
                  learnMore={() => onOpenGolfopedia("management-rating")}
                >
                  <span style={{ cursor: "help" }}><T id="auto.ui.hud.course.rating" /><b>{rating.courseRating.toFixed(1)}</b> <T id="auto.ui.hud.slope" /><b>{rating.slope}</b></span>
                </Tooltip>
              </div>
              <div data-tooltip="Expected scoring for scratch and bogey golfers; their gap drives the slope rating." style={{ fontSize: 12, color: "#6b7280" }}>
                <T id="auto.ui.hud.scratch" />{rating.expectedScratchScore.toFixed(1)} <T id="auto.ui.hud.bogey.2" />{rating.expectedBogeyScore.toFixed(1)} <T id="auto.ui.hud.yards.tile" />{course.yardsPerTile}
              </div>
              <div aria-label={translateCurrent("courseSetup.ratingMatrix")} style={{ display: "grid", gridTemplateColumns: "minmax(76px,1fr) repeat(4,auto)", gap: "3px 7px", marginTop: 9, padding: 7, background: "rgba(255,255,255,.55)", borderRadius: 6, fontSize: 10, overflowX: "auto" }}>
                <b>{translateCurrent("auto.ui.holeinspector.tee")}</b><b>{translateCurrent("courseSetup.rating")}</b><b>{translateCurrent("courseSetup.slope")}</b><b>{translateCurrent("courseSetup.yards")}</b><b>{translateCurrent("courseSetup.rotations")}</b>
                {(["forward", "member", "championship"] as const).map((teeSet) => { const row = teeRatings[teeSet]; const deltas = (["A", "B", "C"] as const).map((rotation) => row.rotationDeltas[rotation] == null ? "—" : `${row.rotationDeltas[rotation]! > 0 ? "+" : ""}${row.rotationDeltas[rotation]!.toFixed(1)}`).join("/"); return <span key={teeSet} style={{ display: "contents", opacity: row.setupComplete ? 1 : .72 }}><span>{teeSet[0].toUpperCase() + teeSet.slice(1)}<small style={{ display: "block" }}>{row.rotationsUsed.length}/3 {translateCurrent("courseSetup.complete")}</small></span><span>{row.courseRating.toFixed(1)}</span><span>{row.slope}</span><span>{row.effectiveYardage}</span><span title={translateCurrent("courseSetup.rotationDeltas")}>{deltas}</span></span>; })}
              </div>
              <div data-tooltip="Completed holes that currently fail route, placement, or shot-corridor validation." style={{ marginTop: 8, fontSize: 12, color: "#444" }}>
                <T id="auto.ui.hud.layout.issues" />{holeSummary.holes.filter((h) => h.isComplete && !h.isValid).length} /{" "}
                {course.holes.length}
              </div>
            </Section>
            <Section title={translateCurrent("auto.ui.hud.terrain.mix.maintenance.burden")}>
              <div data-tooltip="The average and total upkeep pressure created by the course's terrain mix.">
                <T id="auto.ui.hud.estimated.maintenance.weight" /><b>{avgMaintWeight.toFixed(2)}</b> <T id="auto.ui.hud.avg" />{" "}
                <span style={{ color: "#555" }}>{formatNumber(totalMaintWeight, "en", { maximumFractionDigits: 0 })} <T id="auto.ui.hud.total" /></span>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                {(Object.keys(terrainCounts) as Terrain[])
                  .sort((a, b) => (terrainCounts[b] ?? 0) - (terrainCounts[a] ?? 0))
                  .map((t) => {
                    const n = terrainCounts[t] ?? 0;
                    const pct = (100 * n) / totalTiles;
                    return (
                      <div key={t} data-tooltip={`The share and tile count of ${t.replace("_", " ")} terrain on this course.`} style={{ display: "flex", justifyContent: "space-between" }}>
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

        {activeTab === "Results" && (
          <div data-tutorial-target="weekly-report">
            {!last && <div style={{ color: "#555", fontSize: 13 }}><T id="weekClose.resultsHint" /></div>}
            {last && (
              <Section title={translateCurrent("auto.ui.hud.last.week")}>
                <div data-tooltip="Golfers who completed a visit during the simulated week."><T id="auto.ui.hud.visitors" />{last.visitors}</div>
                {typeof last.capacity === "number" && (
                  <div data-tooltip="The maximum number of golfers the course can serve this week; excess demand becomes turnaways." style={{ fontSize: 12, color: "#555" }}>
                    <T id="auto.ui.hud.capacity" />{last.capacity}{" "}
                    {typeof last.turnaways === "number" && last.turnaways > 0 && (
                      <>
                        <T id="auto.ui.hud.turned.away" /><b>{last.turnaways}</b>
                      </>
                    )}
                  </div>
                )}
                <div data-tooltip="Total green-fee and concession income earned this week."><T id="auto.ui.hud.revenue" />{formatCurrency(last.revenue)}</div>
                {last.revenueBreakdown && (
                  <div data-tooltip="The sources that make up this week's total revenue." style={{ marginTop: 4, padding: 7, borderRadius: 7, background: "#f7f3e8", fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.green.fees" /></span><b>{formatCurrency(last.revenueBreakdown.greenFees)}</b>
                      {(last.revenueBreakdown.property ?? 0) > 0 && <><span>{translateCurrent("property.report.revenue")}</span><b>{formatCurrency(last.revenueBreakdown.property ?? 0)}</b></>}
                      {(last.revenueBreakdown.propertyCosts ?? 0) > 0 && <><span>{translateCurrent("property.report.costs")}</span><b>{formatCurrency(last.revenueBreakdown.propertyCosts ?? 0)}</b></>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.concessions" />{last.revenueBreakdown.transactions.length} <T id="auto.ui.hud.sales" /></span>
                      <b>{formatCurrency(last.revenueBreakdown.concessions)}</b>
                    </div>
                    {Object.entries(last.revenueBreakdown.byConcession).map(([type, amount]) => (
                      <div key={type} style={{ display: "flex", justifyContent: "space-between", color: "#666", paddingLeft: 8 }}>
                        <span>{BUILDING_SPECS[type as ConcessionType].name}</span>
                        <span>{formatCurrency(amount ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div data-tooltip="All variable costs, fixed overhead, maintenance, staffing, marketing, and debt costs this week."><T id="auto.ui.hud.costs" />{formatCurrency(last.costs)}</div>
                {last.biomeEconomy && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{translateCurrent("weekClose.biomeWater")}</span>
                      <b>{formatCurrency(last.biomeEconomy.waterCost)}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{translateCurrent("weekClose.plantCare")}</span>
                      <span>{formatCurrency(last.biomeEconomy.plantCareCost)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{translateCurrent("weekClose.drainageCare")}</span>
                      <span>{formatCurrency(last.biomeEconomy.drainageCareCost)}</span>
                    </div>
                  </div>
                )}
                {last.variableCosts && (
                  <div data-tooltip="Costs that scale with rounds played and transactions completed." style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.variable.costs" /></span>
                      <span>
                        <b>{formatCurrency(last.variableCosts.total)}</b>
                      </span>
                    </div>
                    <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.labor.per.round" /></span>
                        <span>{formatCurrency(last.variableCosts.labor)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.consumables" /></span>
                        <span>{formatCurrency(last.variableCosts.consumables)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.merchant.fees" /></span>
                        <span>{formatCurrency(last.variableCosts.merchantFees)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {last.overhead && (
                  <div data-tooltip="Fixed weekly insurance, utilities, administration, and base staffing expenses." style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.overhead.fixed" /></span>
                      <span>
                        <b>{formatCurrency(last.overhead.total)}</b>
                      </span>
                    </div>
                    <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.insurance" /></span>
                        <span>{formatCurrency(last.overhead.insurance)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.utilities" /></span>
                        <span>{formatCurrency(last.overhead.utilities)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.admin" /></span>
                        <span>{formatCurrency(last.overhead.admin)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span><T id="auto.ui.hud.base.staff" /></span>
                        <span>{formatCurrency(last.overhead.baseStaff)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {last.maintenance && (
                  <div data-tooltip="Required upkeep versus the maintenance budget; a shortfall lowers course condition." style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.required.maintenance" /></span>
                      <span>
                        <b>{formatCurrency(last.maintenance.required)}</b>
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span><T id="auto.ui.hud.budget" /></span>
                      <span>{formatCurrency(last.maintenance.budget)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span>{last.maintenance.shortfall > 0 ? "Shortfall" : "Excess"}</span>
                      <span>
                        {formatCurrency(
                          last.maintenance.shortfall > 0 ? -Math.abs(last.maintenance.shortfall) : Math.abs(last.maintenance.shortfall),
                          "en",
                          { signDisplay: "always" },
                        )}
                      </span>
                    </div>
                  </div>
                )}
                <div data-tooltip="Revenue minus operating costs before any displayed profit tax.">
                  <b><T id="auto.ui.hud.profit" /></b> {formatCurrency(last.profit)}
                </div>
                {typeof last.tax === "number" && last.tax > 0 && (
                  <div data-tooltip="Tax charged on profitable weeks at the current difficulty's rate." style={{ fontSize: 12, color: "#555" }}>
                    <T id="auto.ui.hud.profit.tax" />{formatCurrency(last.tax)}
                  </div>
                )}
                <div data-tooltip="The average golfer experience score for visits completed this week."><T id="auto.ui.hud.avg.satisfaction" />{Math.round(last.avgSatisfaction)}/100</div>
                <div data-tooltip="The lasting reputation change caused by this week's golfer experiences.">
                  <T id="auto.ui.hud.reputation.3" />{last.reputationDelta >= 0 ? "+" : ""}
                  {last.reputationDelta}
                </div>
                {last.reputationMomentum && (
                  <div style={{ fontSize: 12, color: "#555" }}>{last.reputationMomentum}</div>
                )}
                <div data-tooltip="A small random visitor fluctuation that keeps otherwise identical weeks from being perfectly predictable.">
                  <T id="auto.ui.hud.noise" />{last.visitorNoise >= 0 ? "+" : ""}
                  {last.visitorNoise} <T id="auto.ui.hud.visitors.2" /></div>
              </Section>
            )}

            {last?.demand && (
              <Section title={translateCurrent("auto.ui.hud.demand.breakdown")}>
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
                <div data-tooltip="The final demand index converted into an expected base visitor count before capacity and noise." style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
                  <T id="auto.ui.hud.demandindex" />{last.demand.demandIndex.toFixed(2)} <T id="auto.ui.hud.base.visitors" />{" "}
                  {last.demand.segments?.totalBaseVisitors ?? 120 + Math.round(520 * last.demand.demandIndex)}
                </div>
                {last.demand.segments && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#444", display: "grid", gap: 4 }}>
                    <div data-tooltip="Casual golfers are more price-sensitive and make up the broadest visitor segment." style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.casual" /></span>
                      <span>
                        {Math.round(last.demand.segments.casual.share * 100)}<T id="auto.ui.hud.idx" />{" "}
                        {last.demand.segments.casual.demandIndex.toFixed(2)} <T id="auto.ui.hud.base" />{" "}
                        {last.demand.segments.casual.baseVisitors}
                      </span>
                    </div>
                    <div data-tooltip="Core golfers value course quality more strongly but are capped as a share of total visitors." style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><T id="auto.ui.hud.core" /></span>
                      <span>
                        {Math.round(last.demand.segments.core.share * 100)}<T id="auto.ui.hud.idx" />{" "}
                        {last.demand.segments.core.demandIndex.toFixed(2)} <T id="auto.ui.hud.base" />{" "}
                        {last.demand.segments.core.baseVisitors}{" "}
                        <span style={{ color: "#6b7280" }}>
                          <T id="auto.ui.hud.cap" />{Math.round(last.demand.segments.core.cap * 100)}%)
                        </span>
                      </span>
                    </div>
                  </div>
                )}
                {prev?.demand && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                    <T id="auto.ui.hud.demandindex.vs.last.week" />{(last.demand.demandIndex - prev.demand.demandIndex).toFixed(2)}
                  </div>
                )}
              </Section>
            )}

            {viewMode === "ARCHITECT" && last?.satisfaction && (
              <Section title={translateCurrent("auto.ui.hud.satisfaction.breakdown")}>
                <BreakdownTableDetailed
                  rows={[
                    ["Playability", last.satisfaction.playability, last.satisfaction.weights.playability, last.satisfaction.weights.playability * (last.satisfaction.playability / 100)],
                    ["Aesthetics", last.satisfaction.aesthetics, last.satisfaction.weights.aesthetics, last.satisfaction.weights.aesthetics * (last.satisfaction.aesthetics / 100)],
                    ["Difficulty (ease)", 100 - last.satisfaction.difficulty, last.satisfaction.weights.difficultyEase, last.satisfaction.weights.difficultyEase * ((100 - last.satisfaction.difficulty) / 100)],
                    ["Condition", last.satisfaction.condition, last.satisfaction.weights.condition, last.satisfaction.weights.condition * (last.satisfaction.condition / 100)],
                    ["Staff", last.satisfaction.staff, last.satisfaction.weights.staff, last.satisfaction.weights.staff * (last.satisfaction.staff / 100)],
                  ]}
                />
                <div data-tooltip="The weighted combination of playability, aesthetics, difficulty fit, condition, and staff." style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
                  <T id="auto.ui.hud.satisfaction" /><b>{last.satisfaction.satisfaction}</b>/100
                </div>
                {prev?.satisfaction && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                    <T id="auto.ui.hud.satisfaction.vs.last.week" />{last.satisfaction.satisfaction - prev.satisfaction.satisfaction}
                  </div>
                )}
              </Section>
            )}

            {viewMode === "ARCHITECT" && last?.topIssues && last.topIssues.length > 0 && (
              <Section title={translateCurrent("auto.ui.hud.top.issues.what.to.fix.next")}>
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
              <Section title={translateCurrent("auto.ui.hud.why.people.like.don.t.like.it")}>
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
              <Section title={translateCurrent("auto.ui.hud.capital.spending.terrain.builds")}>
                <div>
                  <T id="auto.ui.hud.spent" /><b>{formatCurrency(last.capitalSpending.spent)}</b> <T id="auto.ui.hud.refunded" />{" "}
                  <b>{formatCurrency(last.capitalSpending.refunded)}</b> <T id="auto.ui.hud.net" />{" "}
                  <b>{formatCurrency(last.capitalSpending.net)}</b>
                </div>
                <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12 }}>
                  {Object.entries(last.capitalSpending.byTerrainSpent)
                    .filter(([, v]) => (v ?? 0) > 0)
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .map(([t, v]) => (
                      <div key={t} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{t}</span>
                        <span>
                          {formatCurrency(v ?? 0)}{" "}
                          <span style={{ color: "#777" }}>
                            ({last.capitalSpending!.byTerrainTiles[t as Terrain] ?? 0} <T id="auto.ui.hud.tiles" /></span>
                        </span>
                      </div>
                    ))}
                </div>
              </Section>
            )}

            {last?.maintenancePressure && (
              <Section title={translateCurrent("auto.ui.hud.maintenance.pressure")}>
                <div>
                  <T id="auto.ui.hud.avg.terrain.weight" /><b>{last.maintenancePressure.avgWeight.toFixed(2)}</b> <T id="auto.ui.hud.wear.this.week" /><b>{Math.round(last.maintenancePressure.wear * 100)}%</b>
                </div>
              </Section>
            )}

          </div>
        )}

        {activeTab === "Upgrades" && (
          <>
            <Section title={translateCurrent("auto.ui.hud.business")}>
              <label data-tutorial-target="green-fee" style={{ display: "block", marginBottom: 12 }}>
                <T id="auto.ui.hud.green.fee" />{course.baseGreenFee})
                {world.constraints?.fixedGreenFee != null && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#8a6d1a" }}>
                    <T id="auto.ui.hud.set.by.the.scenario" /></span>
                )}
                <input
                  type="range"
                  min={20}
                  max={150}
                  value={course.baseGreenFee}
                  disabled={world.constraints?.fixedGreenFee != null}
                  onChange={(e) => setGreenFee(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </label>

              <label data-tutorial-target="maintenance" style={{ display: "block" }}>
                <T id="auto.ui.hud.maintenance.budget" />{world.maintenanceBudget}<T id="auto.ui.hud.wk" /><input
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

            <Section title={translateCurrent("auto.ui.hud.financing")}>
              <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
                {loansBarred
                  ? "No bank will touch this deal — the scenario forbids loans."
                  : "Loans can keep you afloat — but weekly payments are a fixed cost. Missed payments hurt reputation and worsen APR."}
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
                  <T id="auto.ui.hud.bridge.loan" />{formatCurrency(BALANCE.loans.bridge.maxPrincipal)} •{" "}
                  {Math.round(BALANCE.loans.bridge.apr * 100)}<T id="auto.ui.hud.apr" />{BALANCE.loans.bridge.termWeeks}<T id="auto.ui.hud.w" />{" "}
                  {!bridgeEligible && (
                    <span style={{ fontWeight: 500, color: "#777" }}>
                      <T id="auto.ui.hud.need.rep" />{BALANCE.loans.bridge.repMin}, ≥{BALANCE.loans.bridge.minValidHolesAlt} <T id="auto.ui.hud.valid.holes.or.playable.and" />{BALANCE.loans.bridgeCooldownWeeks}<T id="auto.ui.hud.week.cooldown" /></span>
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
                  <T id="auto.ui.hud.expansion.loan" />{formatCurrency(BALANCE.loans.expansion.maxPrincipal)} •{" "}
                  {Math.round(BALANCE.loans.expansion.apr * 100)}<T id="auto.ui.hud.apr" />{BALANCE.loans.expansion.termWeeks}<T id="auto.ui.hud.w" />{" "}
                  {!expansionEligible && (
                    <span style={{ fontWeight: 500, color: "#777" }}>
                      <T id="auto.ui.hud.need.rep" />{BALANCE.loans.expansion.repMin}, {BALANCE.loans.expansion.minValidHoles} <T id="auto.ui.hud.valid.holes.and.last.week.profit.gt.0" /></span>
                  )}
                </button>
              </div>

              {(world.loans ?? []).length > 0 && (
                <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 800 }}><T id="auto.ui.hud.active.loans" /></div>
                  {(world.loans ?? [])
                    .filter((l) => l.status === "ACTIVE")
                    .map((l) => (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>
                          {l.kind} • {Math.round(l.apr * 100)}% • {l.weeksRemaining}<T id="auto.ui.hud.w.left" /></span>
                        <span>
                          {formatCurrency(l.weeklyPayment)}<T id="auto.ui.hud.wk.bal" />{" "}
                          {formatCurrency(l.balance)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </Section>

            <Section title={translateCurrent("auto.ui.hud.unlocks.cosmetic")}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: "#555" }}><T id="auto.ui.hud.legacy.points" /></span>
                <b>{legacy.legacyPoints}</b>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
                <T id="auto.ui.hud.earn.points.on.bankruptcy.based.on.weeks.survived.peak" /></div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <b><T id="auto.ui.hud.flag.color.blue" /></b>{" "}
                    <span style={{ color: "#6b7280" }}><T id="auto.ui.hud.cost.3" /></span>
                  </div>
                  {legacy.unlocked.FLAG_BLUE ? (
                    <button
                      onClick={() => onSelectFlagColor("rgba(37,99,235,0.92)")}
                      style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                    >
                      <T id="auto.ui.hud.use" /></button>
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
                      <T id="auto.ui.hud.unlock" /></button>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <b><T id="auto.ui.hud.flag.color.gold" /></b>{" "}
                    <span style={{ color: "#6b7280" }}><T id="auto.ui.hud.cost.5" /></span>
                  </div>
                  {legacy.unlocked.FLAG_GOLD ? (
                    <button
                      onClick={() => onSelectFlagColor("rgba(245,158,11,0.92)")}
                      style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                    >
                      <T id="auto.ui.hud.use" /></button>
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
                      <T id="auto.ui.hud.unlock" /></button>
                  )}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                  <T id="auto.ui.hud.current.flag" />{" "}
                  <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid #ddd" }}>
                    <span style={{ color: legacy.selected.flagColor }}>●</span> <T id="auto.ui.hud.active" /></span>
                </div>
              </div>
            </Section>

            <Section title={translateCurrent("auto.ui.hud.upgrades")}>
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
                  <T id="auto.ui.hud.staff.level" />{world.staffLevel}/5{" "}
                  {staffUpgradeCost != null
                    ? `(Buy: ${formatCurrency(staffUpgradeCost)})`
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
                  <T id="auto.ui.hud.marketing.level" />{world.marketingLevel}/5{" "}
                  {marketingUpgradeCost != null
                    ? `(Buy: ${formatCurrency(marketingUpgradeCost)})`
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
              <b><T id="auto.ui.hud.hole" />{activeHoleIndex + 1} / 9</b>
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
              <T id="auto.ui.hud.confirm" /></button>
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
              <T id="auto.ui.hud.redo" /></button>
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
              <T id="auto.ui.hud.next.hole" /></button>
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
            <T id="auto.ui.hud.save" /></GameButton>
          <GameButton variant="secondary" size="md" onClick={onLoad} style={{ flex: 1, borderRadius: 16 }}>
            <T id="auto.ui.hud.load" /></GameButton>
          <GameButton variant="secondary" size="md" onClick={onResetSave} style={{ flex: 1, borderRadius: 16 }}>
            <T id="auto.ui.hud.reset" /></GameButton>
        </div>

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
          data-tooltip={REPORT_HELP[label] ?? `How ${label.toLowerCase()} contributes to the combined score.`}
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
