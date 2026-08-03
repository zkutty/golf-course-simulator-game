import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState, useCallback, type CSSProperties } from "react";
import { formatCurrency } from "./i18n/format";
import { useI18n } from "./i18n/useI18n";
import { perfProfiler } from "./utils/performanceProfiler";
import { lastItem } from "./utils/array";
import "./ui/cozyLayout.css";
import "./App.css";
import { PixiStage } from "./ui/PixiStage";
import { HUD } from "./ui/HUD";
import { DesignDock } from "./ui/DesignDock";
import {
  buildDesignCatalog,
  type DesignCatalogItem,
} from "./ui/designCatalog";
import { DEFAULT_STATE, type GameState } from "./game/gameState";
import { GameSession, useGameSessionSelector } from "./game/session";
import type { BuildingTier, ConcessionType, Course, DecorationKind, DecorationRotation, ParSetting, PinRotation, Point, SurfaceFeature, TeeSet, Terrain, TerrainAuthoringTool, WeekResult, World } from "./game/models/types";
import { hasSavedGame, parseSaveText, resetSave, type SavePayload } from "./utils/save";
import {
  __deleteSlotPayloadForTests,
  __omitSlotThemeForTests,
  autosave,
  loadSlot,
  mostRecentSlot,
  saveToSlot,
} from "./utils/saveStore";
import { computeElevationChangeCost, computeTerrainChangeCost } from "./game/models/terrainEconomics";
import { previewTerrainStroke, type TerrainStrokePreview } from "./game/models/terrainStroke";
import { corridorFeature, rasterizeSurfaceFeatureDetailed, regionFeature, simplifySurfacePoints } from "./game/models/surfaceIntent";
import { prepareSurfaceFeatureEdit } from "./game/models/surfaceFeatureEdit";
import {
  AdaptiveGraphicsQualityController,
  qualityResolutionMultiplier,
  resolveGraphicsQuality,
  type ResolvedGraphicsQuality,
} from "./game/render/graphicsQuality";
import {
  m35TelemetrySnapshot,
  recordM35Metric,
  resetM35Telemetry,
} from "./game/render/m35Telemetry";
import { computeSculptDeltas, sculptSteps, type SculptBrush, type SculptRadius } from "./game/models/sculpt";
import {
  computeFineGreenSculptPreview,
  type FineGreenBrush,
  type FineGreenRadius,
  type FineGreenSculptPreview,
} from "./game/greens/fineGreenSculpt";
import { normalizeGreenProgram } from "./game/greens/greenSurface";
import { greenKeepingOverview } from "./game/greens/greenMaintenance";
import { maxSlopeInRect } from "./game/models/elevation";
import type { ObstacleType } from "./game/models/types";
import { scoreCourseHoles } from "./game/sim/holes";
import { computeCourseRatingAndSlope, computeRatingForSetup, computeRatingsByTee } from "./game/sim/courseRating";
import { canTakeBridgeLoan, canTakeExpansionLoan } from "./game/sim/loanEligibility";
import { legacyAwardForRun, loadLegacy, saveLegacy } from "./utils/legacy";
import { getEffectiveBalance, terrainCostMult } from "./game/balance/difficulty";
import { GameBackground } from "./ui/gameui";
import { useAudio } from "./audio/audioContext";
const HoleInspector = lazy(() => import("./ui/HoleInspector").then((module) => ({ default: module.HoleInspector })));
import { evaluateHole } from "./game/eval/evaluateHole";
import type { CameraState, IsoCameraSnapshot } from "./game/render/camera";
import { computeHoleCamera, computeZoomPreset } from "./game/render/camera";
import { HoleMinimap } from "./ui/HoleMinimap";
import { createNewGame } from "./game/gen/newGame";
import type { GameSetup } from "./game/models/setup";
import { BIOME_KEYS, isLandTheme } from "./game/models/biomes";
import { createScenarioGame, getScenario, SCENARIOS } from "./game/scenarios/scenarios";
import type { ScenarioDefinition } from "./game/scenarios/types";
import { recordCampaignChoice, recordScenarioAttempt, recordScenarioCompleted } from "./utils/careerStore";
import {
  biomeContextAttributes,
  biomeUiStyle,
  biomeUiTheme,
} from "./ui/biomeUiTheme";
import {
  neutralLoadingBiomeContext,
  savedLoadingBiomeContext,
  type LoadingBiomeContext,
} from "./ui/loadingBiomeContext";
import { generateCourseName } from "./utils/courseNames";
import type { Action } from "./core/actions";
import { DEBUG_PERF, logReducerDispatch } from "./utils/performance";
import { useLiveSimulation } from "./hooks/useLiveSimulation";
import { LiveControls } from "./ui/LiveControls";
import { GolferInspector } from "./ui/GolferInspector";
import { LiveOverview } from "./ui/LiveOverview";
import { ProgressionPanel } from "./ui/ProgressionPanel";
import { DefeatModal } from "./ui/DefeatModal";
import { VictoryModal } from "./ui/VictoryModal";
import type { GoalDefinition, RunOutcome } from "./game/models/objectives";
import { createM20TerrainReferenceCourse, createM21BiomeReferenceCourse, createM22VisualReferenceCourse, createM23CourseSetupReferenceCourse, createM26MultiCourseReferenceCourse, createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse, createPlayerProReferenceCourse, createReferenceCourse, createRenderPerfCourse, createTournamentStandardsCourse } from "./game/testing/referenceCourse";
import {
  BIOME_REFERENCE_ROTATIONS,
  BIOME_REFERENCE_VIEWS,
  biomeCameraBookmarks,
  createBiomeAuthoringReferenceCourse,
  type BiomeCameraBookmark,
  type BiomeReferenceRotation,
  type BiomeReferenceView,
} from "./game/testing/biomeAuthoring";
import { createM47CertificationCourse } from "./game/testing/m47Certification";
import { createLiveState, createRenderPerfLiveState } from "./game/live/simulation";
import { runLiveDaysHeadless } from "./game/live/headless";
import { snapshotLiveSimulation } from "./game/live/persistence";
import { hashGameState } from "./utils/stateHash";
import { seasonalVisualState } from "./game/presentation/seasonalVisualState";
import { seasonalTerrainSummary } from "./game/render/seasonalTerrainPresentation";
import {
  M53_SEVERE_WEATHER_FIXTURES,
  m53SeasonalTerrainFixture,
} from "./game/testing/m53SeasonalTerrainFixtures";
import {
  BUILDING_SPECS,
  CONCESSION_TYPES,
  buildingAtTile,
  canPlaceBuilding,
} from "./game/models/buildings";
import {
  canPlaceDecoration,
  decorationAtTile,
  decorationCost,
  decorationSpec,
  normalizedDecoration,
} from "./game/models/decorations";
import {
  defaultDecorationPlantId,
  defaultObstaclePlantId,
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
  plantDefinition,
} from "./game/models/plantRegistry";
import type { PlantId } from "./game/models/plantTypes";
import { TooltipSurface } from "./ui/help/TooltipSurface";
import { AdvisorCard } from "./ui/onboarding/AdvisorCard";
import { TutorialOverlay } from "./ui/onboarding/TutorialOverlay";
import { TutorialOffer } from "./ui/onboarding/TutorialOffer";
import {
  TUTORIAL_STEPS,
  createTutorialProgress,
  loadTutorialProgress,
  reconcileTutorialProgress,
  saveTutorialProgress,
  type TutorialProgress,
} from "./game/onboarding/tutorial";
import { loadAppProfile, saveAppProfile, updateAppProfile, type AppProfile } from "./game/onboarding/profile";
import { advisorMessages, allowsMessage, type AdvisorMessage } from "./game/advisor/advisor";
import { INITIAL_SCREEN_FLOW, reduceScreenFlow } from "./app/screenFlow";
import { PauseOverlay } from "./ui/appShell/PauseOverlay";
import { LoadingCard } from "./ui/appShell/LoadingCard";
import { LIVE, type SpeedName } from "./game/live/liveConfig";
import { courseForCourseSetup, getParSetting, getPinPosition, getTeeBox, TEE_SETS, validateHoleCourseSetup, withNormalizedHoleSetup } from "./game/models/courseSetup";
import { eventMatchesBinding } from "./accessibility/keybindings";
import { T } from "./i18n/T";
import { ambientMixFor, audioSurfaceFor, distanceVolume, musicContextFor, worldAmbienceEnabledFor } from "./audio/environment";
import { emptyCourseRecords, recordCompletedRound, recordWeek } from "./game/retention/records";
import type { CompletedRound, CourseRecords, RetentionEvent } from "./game/retention/types";
import { publishRetentionEvent, subscribeRetentionEvents } from "./game/retention/eventBus";
import { evaluateAchievements, type AchievementContext, type AchievementDefinition } from "./game/retention/achievements";
import { AchievementToasts } from "./ui/retention/AchievementToasts";
import { NewsTicker } from "./ui/retention/NewsTicker";
import { PhotoModeOverlay } from "./ui/retention/PhotoModeOverlay";
import { captureCourseCanvas, createCourseCard, downloadBlob, shareBlob } from "./utils/photoCapture";
import { platformServices } from "./platform";
import { usePwa } from "./hooks/usePwa";
import { TournamentPanel } from "./ui/TournamentPanel";
import { LandOfficePanel } from "./ui/LandOfficePanel";
import { isOwnedTile } from "./game/estate/estate";
import { isWaterHazard } from "./game/models/terrainRules";
import {
  concessionMinReputation,
  isConcessionUnlocked,
  isObstacleUnlocked,
  isTerrainUnlocked,
  obstacleMinReputation,
  reputationTier,
  terrainMinReputation,
} from "./game/progression/progression";
import { createTournamentEvent, prepareTournamentDay, revalidateScheduledTournaments, scheduleTournament, tournamentCalendar } from "./game/tournaments/tournaments";
import { evaluateTournamentCourseQualification } from "./game/tournaments/eligibility";
import type { TournamentTier } from "./game/tournaments/types";
import { debugLog } from "./utils/debugLog";
import { CourseManagerPanel } from "./ui/CourseManagerPanel";
import { activeCourseLayout, courseForLayout, courseLayouts, normalizeCourseLayouts, selectLayout, updateLayout } from "./game/models/courseLayouts";
import { analyzeArchitecture } from "./game/architecture/architecture";
import { emptyPaceDayMetrics, ensureCoursePaceMetrics, normalizedStaff, staffFromLevel } from "./game/live/pace";
import { recordPaceDay } from "./game/live/paceHistory";
import { WeekCloseReport } from "./ui/WeekCloseReport";
import { appendDayToLedger, createWeekLedger } from "./game/live/weeklyLedger";
import { PropertyManagementPanel } from "./ui/PropertyManagementPanel";
import { analyzeResidentialSafety, applyPropertyCommand, emptyPropertyEnterprise, propertySummary, settlePropertyDay, starterPropertyCourse, type PropertyCommand } from "./game/property/property";
import { LivingClubPanel } from "./ui/LivingClubPanel";
import { SeasonsLegacyPanel } from "./ui/SeasonsLegacyPanel";
import type { PlayerCareerRound, PlayerProCareer, PlayerProPoint, PlayerShotTrace } from "./game/models/playerProTypes";
import {
  activatePlayerChallenge,
  activatePlayerTournament,
  advancePlayerRound,
  autoFinishPlayerRound,
  caddieRecommendation,
  caddieShotGuidance,
  commitPlayerShot,
  completePlayerTraining,
  concedePlayerRound,
  createDefaultPlayerPro,
  createPlayerChallenge,
  currentPlayerTournament,
  finishPlayerShot,
  normalizePlayerPro,
  registerPlayerTournament,
  settlePlayerRound,
  startPlayableRound,
  type PlayerOpponent,
  type PlayerShotSelection,
  type PlayerTrainingOption,
} from "./game/playerPro/playerPro";
import type { TournamentEvent } from "./game/tournaments/types";
import { decodeControlledRoundSnapshotV2, type ControlledRoundSnapshotV2 } from "./game/rules/roundSnapshot";
import type { SharedShotOutcome } from "./game/rules/contracts";
import { buildArchitectureReview, defaultArchitectureFilters, withGreenStrategyHeatmap } from "./game/architecture/review";
import type { GreenStrategyHeatmap } from "./game/architecture/greenStrategyHeatmap";
import { compareM48DesignTest, createM48DesignTestSession, refreshM48DesignTestSession } from "./game/architecture/comparison";
import { strategicGeometryVersion } from "./game/architecture/strategic";
import {
  effectiveSurfaceTiles,
  observedSurfaceCareEvidence,
  surfaceCareConditionSummary,
} from "./game/conditions/surfaceCare";
import { surfaceCarePresentationSummary } from "./game/render/surfaceCarePresentation";
import {
  createM53SurfaceCareRoutineFixture,
  createM53SurfaceCarePresentationFixture,
  resolveM53SurfaceCarePresentationFixture,
} from "./game/testing/m53SurfaceCareFixtures";

function textSharedOutcome(outcome: SharedShotOutcome | null | undefined) {
  if (!outcome) return null;
  return {
    rulesVersion: outcome.rulesVersion,
    lieEffect: outcome.lieEffect,
    flightProfile: outcome.flight.profile,
    flight: outcome.flight,
    collision: outcome.collision,
    ruling: outcome.ruling,
    relief: outcome.relief,
    physicalRest: outcome.physicalRest,
    finalPosition: outcome.finalPosition,
  };
}

function textShotTrace(trace: PlayerShotTrace | null | undefined) {
  if (!trace) return null;
  const sharedOutcome = textSharedOutcome(trace.sharedOutcome);
  return {
    ...trace,
    sharedOutcome,
    lieEffect: sharedOutcome?.lieEffect ?? null,
    flightProfile: sharedOutcome?.flightProfile ?? trace.flightProfile ?? null,
    collision: sharedOutcome?.collision ?? null,
    ruling: sharedOutcome?.ruling ?? null,
    relief: sharedOutcome?.relief ?? null,
    physicalRest: sharedOutcome?.physicalRest ?? trace.rest,
    finalPosition: sharedOutcome?.finalPosition ?? trace.rest,
  };
}

function textRulesSnapshot(snapshot: ControlledRoundSnapshotV2 | null | undefined) {
  if (!snapshot) return null;
  const decoded = decodeControlledRoundSnapshotV2(snapshot);
  return {
    version: snapshot.version,
    dimensions: { width: snapshot.width, height: snapshot.height },
    snapshot,
    classificationSummary: snapshot.holeClassifications.map((hole) => ({
      holeId: hole.holeId,
      red: hole.red.slice(),
      yellow: hole.yellow.slice(),
      redCount: hole.red.length,
      yellowCount: hole.yellow.length,
    })),
    penaltyComponentCount: snapshot.penaltyComponentCount,
    inBoundsCells: decoded.ok ? decoded.value.inBounds.filter(Boolean).length : null,
    penaltyCells: decoded.ok ? decoded.value.penaltyComponents.filter((component) => component !== 0).length : null,
    decodeError: decoded.ok ? null : { code: decoded.error.code, path: decoded.error.path },
  };
}

function textCompletedRound(round: PlayerCareerRound | null | undefined) {
  if (!round) return null;
  const latestShot = lastItem(round.shots) ?? null;
  const automaticPutting = round.shots
    .map((shot) => shot.greenPutting)
    .filter((result): result is NonNullable<typeof result> => result != null);
  return {
    id: round.id,
    kind: round.kind,
    result: round.result,
    courseId: round.courseId,
    courseName: round.courseName,
    strokes: round.strokes,
    penalties: round.penalties,
    scoreToPar: round.scoreToPar,
    scorecard: round.scorecard,
    rulesSnapshot: textRulesSnapshot(round.rulesSnapshot),
    latestShot: textShotTrace(latestShot),
    latestSharedOutcome: textSharedOutcome(latestShot?.sharedOutcome),
    automaticPutting: {
      holes: automaticPutting.length,
      putts: automaticPutting.reduce((total, result) => total + result.putts, 0),
      latest: automaticPutting.at(-1) ?? null,
    },
  };
}
import {
  acknowledgeStoryEvent,
  advanceLivingClubDay,
  applyStaffCommand,
  normalizeLivingClub,
  recordLivingClubRound,
  recordPlayerRoundArchitecture,
  resolveStoryChoice,
  setReturnToDesignContext,
} from "./game/livingClub/livingClub";
import { absoluteDayFor, advanceSeasonalDay, applySeasonCommand, createSeasonalState, seasonalState } from "./game/seasons/seasons";
import { SEASONS, type SeasonCommand, type SeasonName } from "./game/seasons/types";
import {
  activeCampaignMatch,
  advanceCampaign,
  campaignPhaseBlockers,
  campaignScene,
  continueCampaignInSandbox,
  registerCampaignMatch,
  resolveCampaignChoice,
} from "./game/campaign/campaign";
import { CAMPAIGN_CHAPTER_BY_ID } from "./game/campaign/content";
import { CampaignSceneModal } from "./ui/CampaignSceneModal";
import { CampaignPanel } from "./ui/CampaignPanel";
import { WorkspaceNav, type WorkspaceActionId, type WorkspaceId } from "./ui/WorkspaceNav";
import { ContextualInspectorPanel } from "./ui/ContextualInspectorPanel";
import { DeferredSurface } from "./app/DeferredSurface";
import { ContentLibraryPanel } from "./ui/ContentLibraryPanel";
import { IS_DEMO, saveAvailableInEdition } from "./config/edition";
import {
  recordBugAction,
  updateBugDiagnosticContext,
} from "./bug-reporting/diagnostics";

type EditorMode = "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
type WizardStep = "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
type ViewMode = "global" | "hole";

// Vision is a media-heavy title-menu surface. Keep the core play path eager and
// load this optional route only when the user explicitly opens it.
const VisionPage = lazy(async () => {
  const module = await import("./ui/VisionPage");
  return { default: module.VisionPage };
});
const StartMenu = lazy(() => import("./ui/StartMenu").then(({ StartMenu }) => ({ default: StartMenu })));
const NewGameWizard = lazy(() => import("./ui/NewGameWizard").then(({ NewGameWizard }) => ({ default: NewGameWizard })));
const SaveLoadModal = lazy(() => import("./ui/SaveLoadModal").then(({ SaveLoadModal }) => ({ default: SaveLoadModal })));
const SettingsModal = lazy(() => import("./ui/SettingsModal").then(({ SettingsModal }) => ({ default: SettingsModal })));
const RetentionHub = lazy(() => import("./ui/retention/RetentionHub").then(({ RetentionHub }) => ({ default: RetentionHub })));
const GolfopediaModal = lazy(() => import("./ui/help/GolfopediaModal").then(({ GolfopediaModal }) => ({ default: GolfopediaModal })));
const PlayerProPanel = lazy(() => import("./ui/PlayerProPanel").then(({ PlayerProPanel }) => ({ default: PlayerProPanel })));
const PlayerShotHud = lazy(() => import("./ui/PlayerProPanel").then(({ PlayerShotHud }) => ({ default: PlayerShotHud })));
const ArchitectureReviewPanel = lazy(() => import("./ui/ArchitectureReviewPanel").then(({ ArchitectureReviewPanel }) => ({ default: ArchitectureReviewPanel })));

export default function App() {
  const { t } = useI18n();
  const [flow, flowDispatch] = useReducer(reduceScreenFlow, INITIAL_SCREEN_FLOW);
  const [showVision, setShowVision] = useState(() => new URLSearchParams(window.location.search).get("view") === "vision");
  const [appProfile, setAppProfile] = useState<AppProfile>(() => loadAppProfile());
  const [pendingLoadingContext, setPendingLoadingContext] = useState<LoadingBiomeContext | null>(null);
  const screen = flow.base === "title" ? "menu" : flow.base === "setup-wizard" ? "setup" : flow.base === "in-game" ? "game" : "loading";
  const audioSurface = audioSurfaceFor({ screen, showVision });
  const changeSequenceRef = useRef(0);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => {
    changeSequenceRef.current += 1;
    setDirty(true);
  }, []);
  const markClean = useCallback((sequence = changeSequenceRef.current) => {
    if (sequence !== changeSequenceRef.current) return;
    setDirty(false);
  }, []);
  const [gameSession] = useState(() => new GameSession({
    initialState: DEFAULT_STATE,
    platform: platformServices,
  }));
  const gameState = useGameSessionSelector(gameSession, (state) => state);

  useEffect(() => {
    if (flow.base !== "loading" && pendingLoadingContext !== null) {
      setPendingLoadingContext(null);
    }
  }, [flow.base, pendingLoadingContext]);

  useEffect(() => {
    const syncVisionRoute = () => setShowVision(new URLSearchParams(window.location.search).get("view") === "vision");
    window.addEventListener("popstate", syncVisionRoute);
    return () => window.removeEventListener("popstate", syncVisionRoute);
  }, []);

  const openVision = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "vision");
    window.history.pushState({ coursecraftView: "vision" }, "", url);
    setShowVision(true);
  }, []);

  const closeVision = useCallback(() => {
    if (window.history.state?.coursecraftView === "vision") {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
    setShowVision(false);
  }, []);
  type TerrainEditSnapshot = Pick<GameState, "course" | "world"> & {
    capital: {
      spent: number;
      refunded: number;
      byTerrainSpent: Partial<Record<Terrain, number>>;
      byTerrainTiles: Partial<Record<Terrain, number>>;
    };
  };
  const terrainUndoRef = useRef<TerrainEditSnapshot[]>([]);
  const terrainRedoRef = useRef<TerrainEditSnapshot[]>([]);
  const [capital, setCapital] = useState<TerrainEditSnapshot["capital"]>(() => ({
    spent: 0,
    refunded: 0,
    byTerrainSpent: {},
    byTerrainTiles: {},
  }));
  const capitalRef = useRef(capital);
  useEffect(() => {
    capitalRef.current = capital;
  }, [capital]);
  const [records, setRecords] = useState<CourseRecords>(() => emptyCourseRecords(DEFAULT_STATE.course.holes.length));
  const recordsRef = useRef(records);
  const sculptedRef = useRef(false);
  const { course, world } = gameState;
  const activeLayout = useMemo(() => activeCourseLayout(course), [course]);
  const activeOperatingCourse = useMemo(() => courseForLayout(course, activeLayout.id), [course, activeLayout.id]);
  const [selected, setSelected] = useState<Terrain>("fairway");
  // Difficulty-resolved balance + terrain cost scaler (ZKU-165).
  const BALANCE = getEffectiveBalance(world.difficulty);
  const costMult = terrainCostMult(world.difficulty);

  // Dispatch function for actions
  const dispatch = useCallback((action: Action) => {
    if (action.type === "SCULPT_TILES" || action.type === "SCULPT_GREEN") sculptedRef.current = true;
    recordBugAction(action);
    // Log reducer dispatch count (only for mutations, not UI-only actions)
    if (DEBUG_PERF && (action.type !== "SET_MODE" && action.type !== "SET_ACTIVE_HOLE" && action.type !== "SET_BRUSH")) {
      logReducerDispatch();
    }
    const previous = gameSession.getState();
    const controlledRound = previous.world.playerPro?.activeRound;
    const editingLocked = controlledRound && controlledRound.phase !== "round_complete" && controlledRound.phase !== "conceded";
    const physicalEdit = new Set([
      "PAINT_TILES", "EDIT_SURFACE_FEATURE", "SCULPT_TILES", "SCULPT_GREEN", "PLACE_TEE", "MOVE_TEE", "PLACE_GREEN", "MOVE_GREEN",
      "SET_TEE_BOX", "REMOVE_TEE_BOX", "SET_PIN_POSITION", "REMOVE_PIN_POSITION", "ADD_WAYPOINT",
      "UPDATE_WAYPOINT", "REMOVE_WAYPOINT", "PLACE_OBSTACLE", "REMOVE_OBSTACLE", "PLACE_BUILDING",
      "REMOVE_BUILDING", "PLACE_DECORATION", "REMOVE_DECORATION", "ROTATE_DECORATION", "SET_COURSE_LAYOUTS",
    ]).has(action.type);
    if (editingLocked && physicalEdit) return;
    const next = gameSession.dispatch(action);
    if ((action.type === "PAINT_TILES" || action.type === "EDIT_SURFACE_FEATURE" || action.type === "SCULPT_TILES" || action.type === "SCULPT_GREEN") && next !== previous) {
      terrainUndoRef.current = [...terrainUndoRef.current.slice(-19), {
        course: previous.course,
        world: previous.world,
        capital: capitalRef.current,
      }];
      terrainRedoRef.current = [];
    } else if (action.type === "NEW_GAME" || action.type === "LOAD_GAME") {
      terrainUndoRef.current = [];
      terrainRedoRef.current = [];
    }
    if (action.type !== "NEW_GAME" && action.type !== "LOAD_GAME" && !action.type.startsWith("SET_")) markDirty();
  }, [gameSession, markDirty]);

  // Versioned integration setters for live-simulation and UI configuration
  // commits that are intentionally outside the serializable core action list.
  const setCourse = useCallback((updater: (c: typeof course) => typeof course) => {
    markDirty();
    gameSession.updateCourse(updater);
  }, [gameSession, markDirty]);
  
  const setWorld = useCallback((updater: (w: typeof world) => typeof world) => {
    markDirty();
    gameSession.updateWorld(updater);
  }, [gameSession, markDirty]);
  const [last, setLast] = useState<WeekResult | undefined>(undefined);
  const [history, setHistory] = useState<WeekResult[]>([]);
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
    recordsRef.current = records;
  }, [history, records]);

  const [editorMode, setEditorMode] = useState<EditorMode>("PAINT");
  const [terrainTool, setTerrainTool] = useState<TerrainAuthoringTool>("curve");
  const [terrainBrushWidth, setTerrainBrushWidth] = useState(1);
  const [activeHoleIndex, setActiveHoleIndex] = useState(0); // 0..8
  const [selectedTeeSet, setSelectedTeeSet] = useState<TeeSet>("member");
  const [wizardStep, setWizardStepState] = useState<WizardStep>("TEE");
  const [draftTee, setDraftTeeState] = useState<Point | null>(null);
  const [draftGreen, setDraftGreenState] = useState<Point | null>(null);
  // Native canvas pointer events can deliver tee and green clicks within one
  // React render. Keep the interaction state synchronously current so the
  // second click cannot observe the stale TEE step and overwrite the first.
  const wizardStepRef = useRef<WizardStep>("TEE");
  const draftTeeRef = useRef<Point | null>(null);
  const draftGreenRef = useRef<Point | null>(null);
  const setWizardStep = (next: WizardStep) => {
    wizardStepRef.current = next;
    setWizardStepState(next);
  };
  const setDraftTee = (next: Point | null) => {
    draftTeeRef.current = next;
    setDraftTeeState(next);
  };
  const setDraftGreen = (next: Point | null) => {
    draftGreenRef.current = next;
    setDraftGreenState(next);
  };
  const [setupPlacement, setSetupPlacement] = useState<{ kind: "tee"; key: TeeSet } | { kind: "pin"; key: PinRotation } | null>(null);
  const [teeSetupPrompt, setTeeSetupPrompt] = useState<{ holeIndex: number } | null>(null);
  const [pendingTeePlacement, setPendingTeePlacement] = useState<{ holeIndex: number; teeSet: TeeSet; point: Point; netCost: number } | null>(null);
  const [obstacleType, setObstacleType] = useState<ObstacleType>("tree");
  const [selectedPlantId, setSelectedPlantId] = useState<PlantId | null>(null);
  const [selectedDesignItemId, setSelectedDesignItemId] = useState(
    "terrain:fairway",
  );
  const [sculptBrush, setSculptBrush] = useState<SculptBrush>("raise");
  const [sculptRadius, setSculptRadius] = useState<SculptRadius>(1);
  const [fineGreenBrush, setFineGreenBrush] = useState<FineGreenBrush>("raise");
  const [fineGreenRadius, setFineGreenRadius] = useState<FineGreenRadius>(1);
  const [buildingType, setBuildingType] = useState<ConcessionType>("snack_bar");
  const [decorationKind, setDecorationKind] = useState<DecorationKind>("bench");
  const [decorationRotation, setDecorationRotation] = useState<DecorationRotation>(0);
  const [decorationSpan, setDecorationSpan] = useState(3);
  const [decorationAction, setDecorationAction] = useState<"place" | "rotate" | "remove">("place");

  const activateTerrainEditing = useCallback((
    tool: TerrainAuthoringTool = terrainTool,
    terrain: Terrain = selected,
  ) => {
    setTerrainTool(tool);
    setSelected(terrain);
    setSelectedPlantId(null);
    setSelectedDesignItemId(`terrain:${terrain}`);
    setEditorMode("PAINT");
    setPaintError(null);
  }, [selected, terrainTool]);

  const activateObstacleEditing = useCallback((
    nextObstacleType: ObstacleType = obstacleType,
    requestedPlantId: PlantId | null = selectedPlantId,
    requestedItemId?: string,
  ) => {
    const requestedPlant = requestedPlantId
      ? plantDefinition(requestedPlantId)
      : null;
    const plantId = nextObstacleType === "rock"
      ? null
      : requestedPlant?.semantics.kind === "obstacle"
          && requestedPlant.semantics.obstacleType === nextObstacleType
        ? requestedPlantId
        : defaultObstaclePlantId(course.theme, nextObstacleType);
    setObstacleType(nextObstacleType);
    setSelectedPlantId(plantId);
    setSelectedDesignItemId(
      requestedItemId
        ?? (plantId ? `plant:${plantId}` : "nature:rock"),
    );
    setEditorMode("OBSTACLE");
    setPaintError(null);
  }, [course.theme, obstacleType, selectedPlantId]);

  const activateDecorationEditing = useCallback((
    nextDecorationKind: DecorationKind,
    requestedPlantId: PlantId | null,
    requestedItemId?: string,
  ) => {
    const requestedPlant = requestedPlantId
      ? plantDefinition(requestedPlantId)
      : null;
    const plantId = requestedPlant?.semantics.kind === "decoration"
        && requestedPlant.semantics.decorationKind === nextDecorationKind
      ? requestedPlantId
      : null;
    const maxSpan = decorationSpec(nextDecorationKind).maxSpan;
    setDecorationKind(nextDecorationKind);
    setSelectedPlantId(plantId);
    setSelectedDesignItemId(
      requestedItemId
        ?? (plantId ? `plant:${plantId}` : `decor:${nextDecorationKind}`),
    );
    if (maxSpan) {
      setDecorationSpan((current) =>
        Math.max(1, Math.min(maxSpan, Math.floor(current))));
    }
    setDecorationAction("place");
    setEditorMode("DECOR");
    setPaintError(null);
  }, []);

  const [pendingWeekReport, setPendingWeekReport] = useState<{
    week: number;
    result: WeekResult;
    resumeSpeed: Exclude<SpeedName, "paused">;
  } | null>(null);

  // Hover state moved to refs in canvas component to avoid React re-renders

  const [paintError, setPaintError] = useState<string | null>(null);
  const undoTerrainEdit = useCallback(() => {
    const snapshot = terrainUndoRef.current.pop();
    if (!snapshot) return;
    const current = gameSession.getState();
    terrainRedoRef.current = [...terrainRedoRef.current.slice(-19), {
      course: current.course,
      world: current.world,
      capital,
    }];
    gameSession.update((state) => ({
      ...state,
      course: snapshot.course,
      world: snapshot.world,
      terrainVersion: state.terrainVersion + 1,
      obstaclesVersion: state.obstaclesVersion + 1,
      economyVersion: state.economyVersion + 1,
    }));
    setCapital(snapshot.capital);
    setPaintError(t("terrainEdit.undone"));
    markDirty();
  }, [capital, gameSession, markDirty, t]);

  const redoTerrainEdit = useCallback(() => {
    const snapshot = terrainRedoRef.current.pop();
    if (!snapshot) return;
    const current = gameSession.getState();
    terrainUndoRef.current = [...terrainUndoRef.current.slice(-19), {
      course: current.course,
      world: current.world,
      capital,
    }];
    gameSession.update((state) => ({
      ...state,
      course: snapshot.course,
      world: snapshot.world,
      terrainVersion: state.terrainVersion + 1,
      obstaclesVersion: state.obstaclesVersion + 1,
      economyVersion: state.economyVersion + 1,
    }));
    setCapital(snapshot.capital);
    setPaintError(t("terrainEdit.redone"));
    markDirty();
  }, [capital, gameSession, markDirty, t]);

  useEffect(() => {
    if (screen !== "game" || (editorMode !== "PAINT" && editorMode !== "SCULPT")) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const command = event.metaKey || event.ctrlKey;
      if (!command || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redoTerrainEdit();
      else undoTerrainEdit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorMode, redoTerrainEdit, screen, undoTerrainEdit]);
  const [saveModalCanSave, setSaveModalCanSave] = useState(false);
  const payloadSequenceRef = useRef(0);
  const [showObstacles, setShowObstacles] = useState(true);
  const [viewMode, setViewMode] = useState<"COZY" | "ARCHITECT">(() => appProfile.graphics.gridOverlays ? "ARCHITECT" : "COZY");
  const [holeEditMode, setHoleEditMode] = useState<ViewMode>("global"); // "global" or "hole"
  const [holeEditCamera, setHoleEditCamera] = useState<CameraState | null>(null);
  const [minimapView, setMinimapView] = useState<IsoCameraSnapshot | null>(null);
  const [minimapJump, setMinimapJump] = useState<{ center: Point; nonce: number } | null>(null);
  const [m52ReferenceCamera, setM52ReferenceCamera] = useState<BiomeCameraBookmark | null>(null);
  const [audioCameraCenter, setAudioCameraCenter] = useState<Point>(() => ({ x: course.width / 2, y: course.height / 2 }));
  const audioCameraCenterRef = useRef(audioCameraCenter);
  const holeEditCameraManualRef = useRef(false); // Track if camera was manually set
  const [showFixOverlay, setShowFixOverlay] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => appProfile.graphics.animations);
  const [flyoverNonce, setFlyoverNonce] = useState(0);
  const soundEnabled = !appProfile.audio.masterMuted && appProfile.audio.masterVolume > 0 && appProfile.audio.sfxVolume > 0;
  const [safeMode, setSafeMode] = useState(false);
  const effectiveAnimations = animationsEnabled && !appProfile.accessibility.reducedMotion && !safeMode;
  const startupGraphicsQuality = useMemo(() => resolveGraphicsQuality("auto", {
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    devicePixelRatio: window.devicePixelRatio || 1,
  }), []);
  const [autoGraphicsQuality, setAutoGraphicsQuality] = useState<ResolvedGraphicsQuality>(
    startupGraphicsQuality,
  );
  const adaptiveGraphicsRef = useRef(
    new AdaptiveGraphicsQualityController(startupGraphicsQuality),
  );
  useEffect(() => {
    if (appProfile.graphics.quality !== "auto") return;
    adaptiveGraphicsRef.current.reset(startupGraphicsQuality);
    setAutoGraphicsQuality(startupGraphicsQuality);
  }, [appProfile.graphics.quality, startupGraphicsQuality]);
  const resolvedGraphicsQuality: ResolvedGraphicsQuality = safeMode
    ? "low"
    : appProfile.graphics.quality === "auto"
      ? autoGraphicsQuality
      : appProfile.graphics.quality;
  const handleGraphicsFrame = useCallback((frameMs: number) => {
    if (appProfile.graphics.quality !== "auto") return;
    const decision = adaptiveGraphicsRef.current.pushFrame(frameMs);
    if (decision.changed) setAutoGraphicsQuality(decision.quality);
  }, [appProfile.graphics.quality]);
  const effectiveResolutionScale = appProfile.graphics.resolutionScale *
    qualityResolutionMultiplier(resolvedGraphicsQuality);
  const [showShotPlan, setShowShotPlan] = useState(true);
  const [peakCash, setPeakCash] = useState(DEFAULT_STATE.world.cash);

  function handleProfileChange(next: AppProfile) {
    saveAppProfile(next);
    setAppProfile(next);
  }
  const [peakRep, setPeakRep] = useState(DEFAULT_STATE.world.reputation);
  const [showBridgePrompt, setShowBridgePrompt] = useState(false);
  const [prevDistress, setPrevDistress] = useState(0);
  const [legacy, setLegacy] = useState(() => loadLegacy());
  const legacyAwardedRef = useRef(false);
  const [prevOutcome, setPrevOutcome] = useState<RunOutcome>("OPEN");
  const [showVictory, setShowVictory] = useState(false);
  const scenarioRecordedRef = useRef(false);
  const [golfopediaEntry, setGolfopediaEntry] = useState<string | null | undefined>(undefined);
  const [tutorialProgress, setTutorialProgress] = useState<TutorialProgress | null>(() => loadTutorialProgress());
  const [tutorialSaveStatus, setTutorialSaveStatus] = useState<"saving" | "saved">("saving");
  const tutorialSaveSequenceRef = useRef(0);
  const [showTutorialOffer, setShowTutorialOffer] = useState(false);
  const [advisorMessage, setAdvisorMessage] = useState<AdvisorMessage | null>(null);
  const [advisorWake, setAdvisorWake] = useState(0);
  const seenAdvisorMessagesRef = useRef(new Set(loadAppProfile().advisorSeen));
  const advisorCooldownUntilRef = useRef(0);
  const [a11yMessage, setA11yMessage] = useState("");
  const perfFixtureLoadedRef = useRef(false);
  const audio = useAudio();
  const [showRetention, setShowRetention] = useState(false);
  const [showTournaments, setShowTournaments] = useState(false);
  const [showLandOffice, setShowLandOffice] = useState(false);
  const [showCourseManager, setShowCourseManager] = useState(false);
  const [showPropertyManagement, setShowPropertyManagement] = useState(false);
  const [showContextualInspector, setShowContextualInspector] = useState(false);
  const inspectorPropertySummary = useMemo(() => propertySummary(course, world), [course, world]);
  const architectureReport = useMemo(() => showCourseManager ? analyzeArchitecture(activeOperatingCourse) : null, [activeOperatingCourse, showCourseManager]);
  const [showArchitectureReview, setShowArchitectureReview] = useState(false);
  const [architectureFilters, setArchitectureFilters] = useState(() => defaultArchitectureFilters(course));
  const architectureReviewBase = useMemo(
    () => buildArchitectureReview(course, world, architectureFilters),
    [architectureFilters, course, world],
  );
  const [architectureGreenStrategy, setArchitectureGreenStrategy] = useState<GreenStrategyHeatmap | null>(null);
  const architectureReview = useMemo(
    () => withGreenStrategyHeatmap(architectureReviewBase, architectureGreenStrategy),
    [architectureGreenStrategy, architectureReviewBase],
  );
  useEffect(() => {
    let canceled = false;
    if (!architectureFilters.kind.startsWith("green-")) {
      setArchitectureGreenStrategy(null);
      return () => { canceled = true; };
    }
    setArchitectureGreenStrategy(null);
    void import("./game/architecture/greenStrategyHeatmap").then((module) => {
      const result = module.buildGreenStrategyHeatmapForReview({
        course,
        filters: architectureFilters,
        evidence: architectureReviewBase.evidence,
        currentGeometryVersion: architectureReviewBase.currentGeometryVersion,
      });
      if (!canceled) setArchitectureGreenStrategy(result);
    }).catch(() => {
      if (!canceled) setArchitectureGreenStrategy(null);
    });
    return () => { canceled = true; };
  }, [architectureFilters, architectureReviewBase.currentGeometryVersion, architectureReviewBase.evidence, course]);
  useEffect(() => {
    if (normalizeCourseLayouts(course).layouts!.some((layout) => layout.id === architectureFilters.courseId)) return;
    setArchitectureFilters(defaultArchitectureFilters(course));
  }, [architectureFilters.courseId, course]);
  const [showLivingClub, setShowLivingClub] = useState(false);
  const [showSeasonsLegacy, setShowSeasonsLegacy] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showContentLibrary, setShowContentLibrary] = useState(false);
  const contentTestSnapshotRef = useRef<GameState | null>(null);
  const [workspace, setWorkspaceState] = useState<WorkspaceId>(() => {
    const candidate = new URLSearchParams(window.location.search).get("workspace");
    return candidate === "operate" || candidate === "legacy" ? candidate : "design";
  });

  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [showProgression, setShowProgression] = useState(false);
  const [showPlayerPro, setShowPlayerPro] = useState(false);
  const [playerShotAim, setPlayerShotAim] = useState<PlayerProPoint | null>(null);
  const playerRoundResumeSpeedRef = useRef<SpeedName>("1x");
  const storyResumeSpeedRef = useRef<SpeedName>("1x");
  const majorStoryPausedRef = useRef(false);
  const campaignResumeSpeedRef = useRef<SpeedName>("1x");
  const campaignPausedRef = useRef(false);
  const [showLiveOverview, setShowLiveOverview] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<AchievementDefinition[]>([]);
  const [photoMode, setPhotoMode] = useState(false);
  const [photoGolfers, setPhotoGolfers] = useState(true);
  const [photoMarkers, setPhotoMarkers] = useState(false);

  const selectWorkspace = useCallback((next: WorkspaceId) => {
    setWorkspaceState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const runWorkspaceAction = (action: WorkspaceActionId) => {
    if (action === "architecture") setShowArchitectureReview((open) => !open);
    if (action === "courses") setShowCourseManager((open) => !open);
    if (action === "land") {
      setShowLandOffice((open) => !open);
      setSelectedParcelId((current) => current ?? course.estate?.starterParcelId ?? null);
    }
    if (action === "player") setShowPlayerPro((open) => !open);
    if (action === "tournaments") setShowTournaments((open) => !open);
    if (action === "property") setShowPropertyManagement((open) => !open);
    if (action === "people") setShowLivingClub(true);
    if (action === "seasons") setShowSeasonsLegacy((open) => !open);
    if (action === "campaign") setShowCampaign((open) => !open);
    if (action === "progression") setShowProgression((open) => !open);
    if (action === "records") setShowRetention(true);
    if (action === "content") setShowContentLibrary((open) => !open);
    if (action === "photo") enterPhotoMode(false);
  };

  const startContentTestPlay = useCallback((testRun: { course: Course; world: World }) => {
    gameSession.update((current) => {
      if (!contentTestSnapshotRef.current) contentTestSnapshotRef.current = structuredClone(current);
      return {
        ...current,
        course: testRun.course,
        world: testRun.world,
        terrainVersion: current.terrainVersion + 1,
        markersVersion: current.markersVersion + 1,
        economyVersion: current.economyVersion + 1,
      };
    });
    setShowContentLibrary(false);
    setA11yMessage(t("content.testMode"));
  }, [gameSession, t]);

  const exitContentTestPlay = useCallback(() => {
    const snapshot = contentTestSnapshotRef.current;
    if (!snapshot) return;
    contentTestSnapshotRef.current = null;
    gameSession.replaceState(snapshot);
    setA11yMessage(t("content.testEnded"));
  }, [gameSession, t]);
  const lastCourseCardRef = useRef<Blob | null>(null);
  const pwa = usePwa();
  const playerPro = useMemo(
    () => world.playerPro ?? createDefaultPlayerPro({ seed: world.runSeed, name: world.founderName }),
    [world.founderName, world.playerPro, world.runSeed],
  );
  const activePlayerRound = playerPro.activeRound;
  const playerRoundLocksEditing = !!activePlayerRound && activePlayerRound.phase !== "round_complete" && activePlayerRound.phase !== "conceded";

  useEffect(() => {
    if (world.playerPro) return;
    setWorld((current) => current.playerPro ? current : {
      ...current,
      playerPro: createDefaultPlayerPro({ seed: current.runSeed, name: current.founderName }),
    });
  }, [setWorld, world.playerPro]);

  const runPropertyCommand = useCallback((command: PropertyCommand) => {
    const current = gameSession.getState();
    const result = applyPropertyCommand(current.course, current.world, command);
    if (result.ok) {
      dispatch({ type: "PROPERTY_COMMAND", command });
    }
    return result;
  }, [dispatch, gameSession]);

  const runSeasonCommand = useCallback((command: SeasonCommand) => {
    const current = gameSession.getState();
    const result = applySeasonCommand(current.course, current.world, command);
    if (!result.ok) return result;
    gameSession.update((latest) => {
      const next = latest === current ? result : applySeasonCommand(latest.course, latest.world, command);
      if (!next.ok) return latest;
      return {
        ...latest,
        course: next.course,
        world: next.world,
        terrainVersion: latest.terrainVersion + (next.course !== latest.course ? 1 : 0),
        economyVersion: latest.economyVersion + 1,
      };
    });
    markDirty();
    return result;
  }, [gameSession, markDirty]);

  const achievementContext = useCallback((nextRecords = recordsRef.current, perfectMood = false): AchievementContext => ({
    course: gameSession.getState().course,
    world: gameSession.getState().world,
    records: nextRecords,
    rating: computeCourseRatingAndSlope(gameSession.getState().course).courseRating,
    tutorialCompleted: loadAppProfile().tutorialCompleted,
    profitStreak: nextRecords.currentProfitStreak,
    sculpted: sculptedRef.current,
    recoveredDistress: prevDistress > 0 && gameSession.getState().world.distressWeeks === 0,
    perfectMood,
  }), [gameSession, prevDistress]);

  const checkAchievements = useCallback((nextRecords = recordsRef.current, perfectMood = false) => {
    const current = loadAppProfile();
    const evaluated = evaluateAchievements(current, achievementContext(nextRecords, perfectMood), gameSession.getState().course.name);
    if (!evaluated.earned.length) return;
    saveAppProfile(evaluated.profile);
    setAppProfile(evaluated.profile);
    setAchievementQueue((queue) => [...queue, ...evaluated.earned]);
    void platformServices.achievements.unlock(evaluated.earned.map((achievement) => achievement.id)).catch(() => undefined);
    void audio.playSting("celebration");
  }, [achievementContext, audio, gameSession]);

  useEffect(() => {
    let cancelled = false;
    void platformServices.app.safeMode().then((enabled) => {
      if (!cancelled) setSafeMode(enabled);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const presence = screen !== "game"
      ? "title"
      : activePlayerRound
        ? (activePlayerRound.tournamentId ? "tournament" : "playing")
        : world.mode === "career"
          ? "campaign"
          : viewMode === "ARCHITECT"
            ? "designing"
            : "operating";
    void platformServices.presence.set(presence).catch(() => undefined);
  }, [activePlayerRound, screen, viewMode, world.mode]);

  // Real-time "living course" simulation: golfers arrive, play, and pay live.
  const live = useLiveSimulation({
    enabled: screen === "game" && !world.isBankrupt,
    course,
    world,
    setWorld,
    setCourse,
    onDayCommitted: (result, liveSnapshot, completedWeek) => {
      if (completedWeek) {
        const report: WeekResult = {
          ...completedWeek.result,
          capitalSpending: {
            spent: capital.spent,
            refunded: capital.refunded,
            net: capital.spent - capital.refunded,
            byTerrainSpent: capital.byTerrainSpent,
            byTerrainTiles: capital.byTerrainTiles,
          },
        };
        setLast(report);
        historyRef.current = [...historyRef.current, report];
        setHistory(historyRef.current);
        const nextRecords = recordWeek(recordsRef.current, {
          week: completedWeek.week,
          cash: completedWeek.cash,
          rating: computeCourseRatingAndSlope(gameSession.getState().course).courseRating,
          reputation: completedWeek.reputation,
          result: report,
        });
        recordsRef.current = nextRecords;
        setRecords(nextRecords);
        publishRetentionEvent({
          type: report.profit >= 0 ? "profitable-week" : "loss-week",
          category: "economy",
          severity: Math.abs(report.profit) >= 10_000 ? "notable" : "routine",
          message: t("retention.weekProfit", { week: completedWeek.week, profit: formatCurrency(report.profit) }),
          week: completedWeek.week,
          day: 6,
        });
        if (nextRecords.attendanceRecord?.week === completedWeek.week) publishRetentionEvent({ type: "attendance-record", category: "milestone", severity: "notable", message: t("retention.attendance", { rounds: report.visitors }), week: completedWeek.week, day: 6 });
        setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
        setPendingWeekReport({ week: completedWeek.week, result: report, resumeSpeed: completedWeek.resumeSpeed });
        checkAchievements(nextRecords);
      }
      // Rotating autosave after every committed game day (ZKU-174). The
      // setState reader snapshots post-commit state without extra renders.
      if (appProfile.gameplay.autosaveCadence === "off") return;
      if (appProfile.gameplay.autosaveCadence === "weekly" && result.dayIndex !== 6) return;
      const sequence = changeSequenceRef.current;
      void gameSession.save(autosave, { history: historyRef.current, records: recordsRef.current, live: liveSnapshot, tutorial: tutorialProgress })
        .then(() => markClean(sequence));
    },
    onRoundCompleted: (round, dayIndex) => {
      const captured = recordCompletedRound(recordsRef.current, round, gameSession.getState().world.week);
      recordsRef.current = captured.records;
      setRecords(captured.records);
      for (const holeIndex of captured.aceHoles) {
        const holeId = round.holeIds?.[holeIndex];
        const globalIndex = holeId ? gameSession.getState().course.holes.findIndex((hole) => hole.id === holeId) : holeIndex;
        const point = gameSession.getState().course.holes[globalIndex]?.green ?? undefined;
        publishRetentionEvent({ type: "hole-in-one", category: "play", severity: "major", message: t("retention.holeInOne", { golfer: round.golferName, hole: holeIndex + 1 }), week: gameSession.getState().world.week, day: dayIndex, golferId: round.golferId, golferName: round.golferName, holeIndex: globalIndex, holeId, courseId: round.courseId, point });
      }
      if (captured.courseRecord) {
        const lastHoleId = lastItem(round.holeIds);
        const lastHole = lastHoleId ? gameSession.getState().course.holes.find((hole) => hole.id === lastHoleId) : lastItem(gameSession.getState().course.holes);
        publishRetentionEvent({ type: "course-record", category: "play", severity: "major", message: t("retention.courseRecord", { golfer: round.golferName, score: round.scoreToPar > 0 ? `+${round.scoreToPar}` : round.scoreToPar }), week: gameSession.getState().world.week, day: dayIndex, golferId: round.golferId, golferName: round.golferName, courseId: round.courseId, holeId: lastHoleId, point: lastHole?.green ?? undefined });
      }
      checkAchievements(captured.records, round.mood >= .99);
    },
    onCashTick: () => {
      if (soundEnabled) void audio.playSfx("cash");
    },
    onAudioEvent: (event) => {
      const point = event.kind === "shot" ? event.from : event.at;
      const volume = distanceVolume(point, audioCameraCenterRef.current);
      if (volume <= .03) return;
      if (event.kind === "shot") {
        const distance = Math.hypot(event.to.x - event.from.x, event.to.y - event.from.y);
        const name = event.shot === "putt" ? "putt" : distance > 16 ? "driver" : distance > 7 ? "iron" : "chip";
        void audio.playSfx(name, { volume });
      } else if (event.kind === "landing") {
        const hitTree = course.obstacles.some((obstacle) => obstacle.type === "tree" && Math.hypot(obstacle.x - event.at.x, obstacle.y - event.at.y) < .75);
        const name = hitTree ? "tree" : event.surface === "water" || event.surface === "wetland" ? "land-water" : event.surface === "sand" || event.surface === "waste_area" ? "land-sand" : event.surface === "green" ? "land-green" : event.surface === "fairway" || event.surface === "tee" ? "land-fairway" : "land-rough";
        void audio.playSfx(name, { volume });
      } else {
        void audio.playSfx("cup", { volume, force: true });
        if (event.scoreDelta <= 0) void audio.playSfx("crowd-cheer", { volume: volume * .7 });
        else if (event.scoreDelta >= 2) void audio.playSfx("crowd-groan", { volume: volume * .55 });
      }
    },
  });

  useEffect(() => {
    let sequence = changeSequenceRef.current;
    return gameSession.bindPlatformQuitBoundary({
      shouldSave: () => {
        sequence = changeSequenceRef.current;
        return dirty && flow.base === "in-game";
      },
      attachments: () => ({
        history: historyRef.current,
        records: recordsRef.current,
        live: live.getSnapshot(),
        tutorial: tutorialProgress,
      }),
      persist: autosave,
      onPersisted: () => markClean(sequence),
      onError: () => {
        setA11yMessage("CourseCraft could not reach a safe save boundary; the game remains open.");
      },
    });
  }, [dirty, flow.base, gameSession, live, markClean, tutorialProgress]);
  const getLiveSnapshot = live.getSnapshot;

  useEffect(() => {
    const activeModal = flow.modal
      ?? (showArchitectureReview ? "architecture-review"
        : showCampaign ? "campaign"
        : showContentLibrary ? "content-library"
        : showCourseManager ? "course-manager"
        : showLandOffice ? "land-office"
        : showLivingClub ? "living-club"
        : showLiveOverview ? "live-overview"
        : showPlayerPro ? "player-pro"
        : showProgression ? "progression"
        : showPropertyManagement ? "property-management"
        : showRetention ? "records"
        : showSeasonsLegacy ? "seasons"
        : showTournaments ? "tournaments"
        : undefined);
    updateBugDiagnosticContext({
      activeCourseId: activeLayout.id,
      day: live.status.dayIndex,
      holeIndex: activeHoleIndex,
      ...(activeModal ? { modal: activeModal } : {}),
      mode: world.mode ?? "sandbox",
      screen,
      seed: String(world.runSeed),
      tool: editorMode === "PAINT"
        ? `PAINT:${terrainTool}:${selected}`
        : editorMode === "SCULPT"
          ? `SCULPT:${fineGreenBrush}:${fineGreenRadius}`
          : editorMode,
      week: world.week,
      ...(minimapView
        ? {
            camera: {
              centerX: minimapView.center.x,
              centerY: minimapView.center.y,
              rotation: minimapView.rotation,
              zoom: minimapView.zoom,
            },
          }
        : {}),
    });
  }, [
    activeHoleIndex,
    activeLayout.id,
    editorMode,
    fineGreenBrush,
    fineGreenRadius,
    flow.modal,
    live.status.dayIndex,
    minimapView,
    screen,
    selected,
    showArchitectureReview,
    showCampaign,
    showContentLibrary,
    showCourseManager,
    showLandOffice,
    showLivingClub,
    showLiveOverview,
    showPlayerPro,
    showProgression,
    showPropertyManagement,
    showRetention,
    showSeasonsLegacy,
    showTournaments,
    terrainTool,
    world.mode,
    world.runSeed,
    world.week,
  ]);

  const pendingMajorStory = useMemo(
    () => normalizeLivingClub(world.livingClub).story.instances.find((instance) =>
      instance.priority === "major" && instance.status === "pending"
    ) ?? null,
    [world.livingClub],
  );
  const activeCampaignScene = useMemo(() => campaignScene(world.campaign), [world.campaign]);

  useEffect(() => {
    if (!pendingMajorStory) return;
    storyResumeSpeedRef.current = live.speed;
    majorStoryPausedRef.current = true;
    live.setSpeed("paused");
    setShowLivingClub(true);
    setWorld((current) => acknowledgeStoryEvent(current, pendingMajorStory.id));
  }, [live, pendingMajorStory, setWorld]);

  useEffect(() => {
    if (activeCampaignScene) {
      if (!campaignPausedRef.current) {
        campaignResumeSpeedRef.current = live.speed;
        campaignPausedRef.current = true;
        live.setSpeed("paused");
      }
      return;
    }
    if (!campaignPausedRef.current) return;
    campaignPausedRef.current = false;
    live.setSpeed(campaignResumeSpeedRef.current);
  }, [activeCampaignScene, live]);

  const updatePlayerPro = useCallback((updater: (career: PlayerProCareer) => PlayerProCareer) => {
    setWorld((current) => {
      const career = normalizePlayerPro(current.playerPro, { seed: current.runSeed, founderName: current.founderName });
      const next = updater(career);
      return next === career ? current : { ...current, playerPro: next };
    });
  }, [setWorld]);

  const enterPlayerRoundView = useCallback((career: PlayerProCareer) => {
    const round = career.activeRound;
    if (!round) return;
    const recommendation = caddieRecommendation(round, career.skills);
    setPlayerShotAim(recommendation.aim);
    setShowPlayerPro(false);
    setShowCourseManager(false);
    setShowPropertyManagement(false);
    setShowLandOffice(false);
    playerRoundResumeSpeedRef.current = live.speed === "paused" ? "1x" : live.speed;
    live.setSpeed("paused");
  }, [live]);

  const beginPlayerRound = useCallback((layoutId: string, teeSet: TeeSet, pinRotation: PinRotation): string | null => {
    const current = gameSession.getState();
    const started = startPlayableRound({
      course: current.course,
      world: current.world,
      layoutId,
      teeSet,
      pinRotation,
      day: live.status.dayIndex,
    });
    if (!started.ok) return started.reason;
    const career = normalizePlayerPro(current.world.playerPro, { seed: current.world.runSeed, founderName: current.world.founderName });
    const next = { ...career, activeRound: started.round };
    updatePlayerPro(() => next);
    enterPlayerRoundView(next);
    return null;
  }, [enterPlayerRoundView, gameSession, live.status.dayIndex, updatePlayerPro]);

  const beginArchitectureTestRound = useCallback((layoutId: string): string | null => {
    const current = gameSession.getState();
    const holeId = architectureFilters.holeId === "all"
      ? current.course.holes.find((hole) => hole.id)?.id
      : architectureFilters.holeId;
    if (!holeId) return t("architecture.review.testNeedsHole");
    const session = createM48DesignTestSession({
      course: current.course,
      courseId: layoutId,
      holeId,
      teeSet: architectureFilters.teeSet === "all" ? "member" : architectureFilters.teeSet,
      pinRotation: architectureFilters.pinRotation === "all" ? "A" : architectureFilters.pinRotation,
      week: current.world.week,
      seed: current.world.runSeed ^ 0x48_0001,
    });
    if (!session) return t("architecture.review.testNeedsCompleteHole");
    const started = startPlayableRound({
      course: current.course,
      world: current.world,
      layoutId,
      teeSet: session.teeSet,
      pinRotation: session.pinRotation,
      kind: "exhibition",
      day: live.status.dayIndex,
    });
    if (!started.ok) return started.reason;
    const career = normalizePlayerPro(current.world.playerPro, { seed: current.world.runSeed, founderName: current.world.founderName });
    setWorld((world) => {
      const living = normalizeLivingClub(world.livingClub);
      return {
        ...world,
        livingClub: { ...living, architecture: { ...living.architecture, testSession: session, comparison: null } },
        playerPro: { ...career, activeRound: started.round },
      };
    });
    enterPlayerRoundView({ ...career, activeRound: started.round });
    return null;
  }, [architectureFilters, enterPlayerRoundView, gameSession, live.status.dayIndex, setWorld, t]);

  useEffect(() => {
    const living = normalizeLivingClub(world.livingClub);
    const session = living.architecture.testSession;
    if (!session || (session.stage !== "returned" && session.stage !== "played" && session.stage !== "compared")) return;
    if (session.after?.geometryVersion === strategicGeometryVersion(course)) return;
    const refreshed = refreshM48DesignTestSession({ course, session });
    if (!refreshed.after || refreshed.after.geometryVersion === session.after?.geometryVersion) return;
    const comparison = compareM48DesignTest(refreshed);
    setWorld((current) => {
      const currentLiving = normalizeLivingClub(current.livingClub);
      if (currentLiving.architecture.testSession?.id !== session.id) return current;
      return { ...current, livingClub: { ...currentLiving, architecture: { ...currentLiving.architecture, testSession: refreshed, comparison } } };
    });
  }, [course, setWorld, world.livingClub]);

  const startCampaignMatch = useCallback((): string | null => {
    const current = gameSession.getState();
    const match = activeCampaignMatch(current.world.campaign);
    if (!match || !current.world.campaign) return t("campaign.match.unavailable");
    const nonMatchBlockers = campaignPhaseBlockers(current.course, current.world).filter((blocker) => !blocker.startsWith("campaign.blocker.match:"));
    if (nonMatchBlockers.length) return t("campaign.match.objectivesFirst");
    const career = normalizePlayerPro(current.world.playerPro, { seed: current.world.runSeed, founderName: current.world.founderName });
    if (career.careerPoints < match.minCareerPoints) return t("campaign.match.pointsRequired", { points: match.minCareerPoints });

    if (match.opponent) {
      const created = createPlayerChallenge(career, {
        id: match.opponent.id,
        name: match.opponent.name,
        skill: match.opponent.skill,
        relationship: current.world.campaign.relationships[match.opponent.characterId],
      }, "friendly", 0);
      const started = startPlayableRound({
        course: current.course,
        world: current.world,
        kind: "friendly",
        layoutId: activeCourseLayout(current.course).id,
        teeSet: "member",
        pinRotation: current.course.activePinRotation ?? "A",
        day: live.status.dayIndex,
        opponent: {
          id: match.opponent.id,
          name: match.opponent.name,
          skill: match.opponent.skill,
          relationshipDelta: 0,
          wager: 0,
          projectedStrokes: 0,
        },
      });
      if (!started.ok) return started.reason;
      const nextCareer = {
        ...activatePlayerChallenge(created.career, created.challenge.id, started.round.id),
        activeRound: started.round,
      };
      const nextWorld = registerCampaignMatch({ ...current.world, playerPro: nextCareer }, match.id, started.round.id);
      gameSession.update((latest) => latest === current ? { ...latest, world: nextWorld, economyVersion: latest.economyVersion + 1 } : latest);
      enterPlayerRoundView(nextCareer);
      markDirty();
      return null;
    }

    const created = createTournamentEvent({
      course: current.course,
      world: current.world,
      tier: "championship",
      currentDay: live.status.dayIndex,
      daysAhead: 1,
      courseId: activeCourseLayout(current.course).id,
    });
    if (!created.ok) return created.reason;
    const event = { ...created.event, name: t("campaign.match.championship.eventName") };
    const scheduledWorld = scheduleTournament(current.world, event);
    const registered = registerPlayerTournament(career, event, { campaignQualified: true });
    const started = startPlayableRound({
      course: current.course,
      world: scheduledWorld,
      kind: "tournament",
      layoutId: event.courseId ?? activeCourseLayout(current.course).id,
      teeSet: event.teeSet ?? "championship",
      pinRotation: event.pinRotation ?? current.course.activePinRotation ?? "A",
      day: live.status.dayIndex,
      tournament: { id: event.id, name: event.name },
    });
    if (!started.ok) return started.reason;
    const nextCareer = {
      ...activatePlayerTournament(registered, event.id, started.round.id),
      activeRound: started.round,
    };
    const nextWorld = registerCampaignMatch({ ...scheduledWorld, playerPro: nextCareer }, match.id, started.round.id, event.id);
    gameSession.update((latest) => latest === current ? { ...latest, world: nextWorld, economyVersion: latest.economyVersion + 1 } : latest);
    enterPlayerRoundView(nextCareer);
    markDirty();
    return null;
  }, [enterPlayerRoundView, gameSession, live.status.dayIndex, markDirty, t]);

  const trainPlayerPro = useCallback((option: PlayerTrainingOption): string | null => {
    const current = gameSession.getState().world;
    const career = normalizePlayerPro(current.playerPro, { seed: current.runSeed, founderName: current.founderName });
    const trained = completePlayerTraining(career, current, option, live.status.dayIndex);
    if (trained.cost <= 0) return option.blocker ?? (current.cash < option.cost ? "cash" : "unavailable");
    const previousSpeed = live.speed;
    live.setSpeed("1x");
    let remainingMinutes = option.minutes;
    while (remainingMinutes > 0) {
      const realMs = Math.min(2_000, remainingMinutes / LIVE.speed["1x"] * 1_000);
      live.advanceTime(realMs);
      remainingMinutes -= realMs / 1_000 * LIVE.speed["1x"];
    }
    live.setSpeed(previousSpeed);
    setWorld((worldNow) => ({
      ...worldNow,
      cash: worldNow.cash - trained.cost,
      playerPro: trained.career,
    }));
    if (soundEnabled) void audio.playSfx("cash");
    return null;
  }, [audio, gameSession, live, setWorld, soundEnabled]);

  const challengePlayerPro = useCallback((opponent: PlayerOpponent, kind: "friendly" | "wager", wager: number): string | null => {
    const current = gameSession.getState();
    const career = normalizePlayerPro(current.world.playerPro, { seed: current.world.runSeed, founderName: current.world.founderName });
    if (kind === "wager" && current.world.cash < wager) return "cash";
    const created = createPlayerChallenge(career, opponent, kind, wager);
    const layout = activeCourseLayout(current.course);
    const started = startPlayableRound({
      course: current.course,
      world: current.world,
      kind,
      layoutId: layout.id,
      teeSet: "member",
      pinRotation: current.course.activePinRotation ?? "A",
      day: live.status.dayIndex,
      opponent: {
        id: opponent.id,
        name: opponent.name,
        skill: opponent.skill,
        relationshipDelta: 0,
        wager: created.challenge.wager,
        projectedStrokes: 0,
      },
    });
    if (!started.ok) return started.reason;
    const next = {
      ...activatePlayerChallenge(created.career, created.challenge.id, started.round.id),
      activeRound: started.round,
    };
    updatePlayerPro(() => next);
    enterPlayerRoundView(next);
    return null;
  }, [enterPlayerRoundView, gameSession, live.status.dayIndex, updatePlayerPro]);

  const enterPlayerTournament = useCallback((event: TournamentEvent): string | null => {
    const current = gameSession.getState();
    const career = normalizePlayerPro(current.world.playerPro, { seed: current.world.runSeed, founderName: current.world.founderName });
    const registered = registerPlayerTournament(career, event);
    if (registered === career) return "eligibility";
    const started = startPlayableRound({
      course: current.course,
      world: current.world,
      kind: "tournament",
      layoutId: event.courseId ?? activeCourseLayout(current.course).id,
      teeSet: event.teeSet ?? "member",
      pinRotation: event.pinRotation ?? current.course.activePinRotation ?? "A",
      day: live.status.dayIndex,
      tournament: { id: event.id, name: event.name },
    });
    if (!started.ok) return started.reason;
    const next = {
      ...activatePlayerTournament(registered, event.id, started.round.id),
      activeRound: started.round,
    };
    updatePlayerPro(() => next);
    enterPlayerRoundView(next);
    return null;
  }, [enterPlayerRoundView, gameSession, live.status.dayIndex, updatePlayerPro]);

  const commitControlledShot = useCallback((selection: PlayerShotSelection) => {
    updatePlayerPro((career) => {
      if (!career.activeRound) return career;
      const round = commitPlayerShot(career.activeRound, career.skills, selection);
      if (round === career.activeRound) return career;
      if (soundEnabled) void audio.playSfx(selection.club === "Putter" ? "putt" : selection.club === "Driver" ? "driver" : "iron");
      return { ...career, activeRound: round };
    });
  }, [audio, soundEnabled, updatePlayerPro]);

  const advanceControlledRound = useCallback(() => {
    updatePlayerPro((career) => {
      if (!career.activeRound) return career;
      const round = advancePlayerRound(career.activeRound);
      if (round !== career.activeRound && round.phase === "awaiting_shot") {
        setPlayerShotAim(caddieRecommendation(round, career.skills).aim);
      }
      return { ...career, activeRound: round };
    });
  }, [updatePlayerPro]);

  const autoFinishControlledRound = useCallback(() => {
    updatePlayerPro((career) => career.activeRound
      ? { ...career, activeRound: autoFinishPlayerRound(career.activeRound, career.skills) }
      : career);
  }, [updatePlayerPro]);

  const concedeControlledRound = useCallback(() => {
    updatePlayerPro((career) => career.activeRound
      ? { ...career, activeRound: concedePlayerRound(career.activeRound) }
      : career);
  }, [updatePlayerPro]);

  useEffect(() => {
    const round = activePlayerRound;
    if (!round || round.phase !== "flight" || !round.pendingShot) return;
    const delay = appProfile.accessibility.reducedMotion ? 40 : 720;
    const timer = window.setTimeout(() => {
      updatePlayerPro((career) => career.activeRound?.id === round.id
        ? { ...career, activeRound: finishPlayerShot(career.activeRound) }
        : career);
      const landing = round.pendingShot;
      if (landing) {
        const sfx = landing.penaltyStrokes > 0 ? "land-water" : landing.lieAfter === "sand" ? "land-sand" : landing.holed ? "cup" : landing.lieAfter === "green" ? "land-green" : "land-fairway";
        void audio.playSfx(sfx, { force: landing.holed });
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activePlayerRound, appProfile.accessibility.reducedMotion, audio, updatePlayerPro]);

  useEffect(() => {
    const round = activePlayerRound;
    if (!round || round.rewardsApplied || (round.phase !== "round_complete" && round.phase !== "conceded")) return;
    setWorld((current) => {
      const career = normalizePlayerPro(current.playerPro, { seed: current.runSeed, founderName: current.founderName });
      const authoritative = career.activeRound;
      if (!authoritative || authoritative.id !== round.id || authoritative.rewardsApplied) return current;
      const event = currentPlayerTournament(current, authoritative.tournamentId);
      const settlement = settlePlayerRound(career, authoritative, event);
      if (!settlement.round) return current;
      const recorded = recordPlayerRoundArchitecture(current, authoritative, settlement.round);
      const recordedCareer = {
        ...settlement.career,
        rounds: settlement.career.rounds.map((careerRound) =>
          careerRound.id === recorded.careerRound.id ? recorded.careerRound : careerRound
        ),
      };
      const events = settlement.tournamentEvent
        ? tournamentCalendar(current).events.map((candidate) => candidate.id === settlement.tournamentEvent!.id ? settlement.tournamentEvent! : candidate)
        : null;
      return advanceCampaign(gameSession.getState().course, {
        ...recorded.world,
        cash: recorded.world.cash + settlement.cashDelta,
        reputation: Math.max(0, Math.min(100, recorded.world.reputation + settlement.reputationDelta)),
        tournaments: events ? { version: 2, events } : current.tournaments,
        playerPro: {
          ...recordedCareer,
          activeRound: { ...authoritative, rewardsApplied: true },
        },
      });
    });
  }, [activePlayerRound, gameSession, setWorld]);

  useEffect(() => {
    const round = activePlayerRound;
    if (!round || round.phase === "flight") return;
    const timer = window.setTimeout(() => {
      const current = gameSession.getState();
      void autosave({
        course: current.course,
        world: current.world,
        history: historyRef.current,
        records: recordsRef.current,
        live: live.getSnapshot(),
        tutorial: tutorialProgress,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activePlayerRound, gameSession, live, tutorialProgress]);

  const returnPlayerToDesign = useCallback(() => {
    const round = gameSession.getState().world.playerPro?.activeRound;
    if (!round) return;
    const selectedTrace = round.shots[round.shots.length - 1] ?? null;
    const holeId = selectedTrace?.holeId ?? round.course.holes[round.currentHoleIndex]?.id;
    const holeIndex = gameSession.getState().course.holes.findIndex((hole) => hole.id === holeId);
    if (holeIndex >= 0) {
      setActiveHoleIndex(holeIndex);
      setHoleEditMode("hole");
      const center = selectedTrace?.rest ?? gameSession.getState().course.holes[holeIndex]?.green;
      if (center) setMinimapJump((current) => ({ center, nonce: (current?.nonce ?? 0) + 1 }));
    }
    setWorld((current) => {
      const contextual = setReturnToDesignContext(current, round, selectedTrace?.id ?? null);
      const career = normalizePlayerPro(contextual.playerPro, { seed: contextual.runSeed, founderName: contextual.founderName });
      const living = normalizeLivingClub(contextual.livingClub);
      const session = living.architecture.testSession;
      if (!session) return { ...contextual, playerPro: { ...career, activeRound: null } };
      const returnedSession = refreshM48DesignTestSession({ course: gameSession.getState().course, session: { ...session, stage: "returned" } });
      return {
        ...contextual,
        playerPro: { ...career, activeRound: null },
        livingClub: { ...living, architecture: { ...living.architecture, testSession: returnedSession, comparison: compareM48DesignTest(returnedSession) } },
      };
    });
    setArchitectureFilters({
      kind: "traces",
      courseId: round.course.courseId,
      holeId: holeId ?? "all",
      teeSet: round.teeSet,
      sourceSegment: "player-pro",
      recency: "all",
      pinRotation: round.pinRotation,
      cohortId: "all",
      mobilityMode: "all",
    });
    setShowArchitectureReview(true);
    setPlayerShotAim(null);
    setShowPlayerPro(false);
    live.setSpeed(playerRoundResumeSpeedRef.current);
  }, [gameSession, live, setWorld]);

  const runStaffCommand = useCallback((command: Parameters<typeof applyStaffCommand>[1]): string | null => {
    const snapshot = gameSession.getState().world;
    const initial = applyStaffCommand(snapshot, command);
    if (!initial.ok) return initial.reason ?? "missing";
    setWorld((current) => current === snapshot ? initial.world : applyStaffCommand(current, command).world);
    return null;
  }, [gameSession, setWorld]);

  const chooseStory = useCallback((instanceId: string, choiceId: string) => {
    gameSession.update((current) => {
      const result = resolveStoryChoice(current.course, current.world, instanceId, choiceId);
      if (!result.ok) return current;
      return {
        ...current,
        course: result.course,
        world: result.world,
        terrainVersion: current.terrainVersion + 1,
        economyVersion: current.economyVersion + 1,
      };
    });
    markDirty();
  }, [gameSession, markDirty]);

  const chooseCampaign = useCallback((sceneId: string, choiceId: string) => {
    gameSession.update((current) => {
      const result = resolveCampaignChoice(current.course, current.world, sceneId, choiceId);
      if (!result.ok) return current;
      const recorded = lastItem(result.world.campaign?.choices);
      if (recorded && result.world.scenarioId) recordCampaignChoice(result.world.scenarioId, recorded);
      return {
        ...current,
        course: result.course,
        world: result.world,
        terrainVersion: current.terrainVersion + (result.course === current.course ? 0 : 1),
        economyVersion: current.economyVersion + 1,
      };
    });
    markDirty();
  }, [gameSession, markDirty]);

  const continueCampaign = useCallback(() => {
    setWorld((current) => continueCampaignInSandbox(current));
    setShowCampaign(false);
    markDirty();
  }, [markDirty, setWorld]);

  const deferStory = useCallback((instanceId: string) => {
    setWorld((current) => acknowledgeStoryEvent(current, instanceId, true));
  }, [setWorld]);

  const closeLivingClub = useCallback(() => {
    const living = normalizeLivingClub(gameSession.getState().world.livingClub);
    const presentedMajor = living.story.instances.find((instance) =>
      instance.priority === "major" && instance.status === "presented"
    );
    if (presentedMajor) setWorld((current) => acknowledgeStoryEvent(current, presentedMajor.id, true));
    setShowLivingClub(false);
    if (majorStoryPausedRef.current) {
      majorStoryPausedRef.current = false;
      live.setSpeed(storyResumeSpeedRef.current);
    }
  }, [gameSession, live, setWorld]);

  const bookTournament = useCallback((tier: TournamentTier, daysAhead: number): string | null => {
    const current = gameSession.getState();
    const created = createTournamentEvent({
      course: current.course,
      world: current.world,
      tier,
      currentDay: live.status.dayIndex,
      daysAhead,
      courseId: activeCourseLayout(current.course).id,
    });
    if (!created.ok) return created.reason;
    setWorld((next) => scheduleTournament(next, created.event));
    setA11yMessage(t("tournament.booked"));
    if (soundEnabled) void audio.playSfx("cash");
    return null;
  }, [audio, gameSession, live.status.dayIndex, setWorld, soundEnabled, t]);

  useEffect(() => {
    if (!import.meta.env.DEV || perfFixtureLoadedRef.current) return;
    const fixtureParams = new URLSearchParams(window.location.search);
    const isPerfFixture = fixtureParams.get("perfFixture") === "1";
    const isM19Fixture = fixtureParams.get("m19Fixture") === "1";
    const isM20Fixture = fixtureParams.get("m20Fixture") === "1";
    const isM21Fixture = fixtureParams.get("m21Fixture") === "1";
    const isM22Fixture = fixtureParams.get("m22Fixture") === "1";
    const isM23Fixture = fixtureParams.get("m23Fixture") === "1";
    const showTeeOfferFixture = isM23Fixture && fixtureParams.get("teeOfferFixture") === "1";
    const isM24Fixture = fixtureParams.get("m24Fixture") === "1";
    const isM25Fixture = fixtureParams.get("m25Fixture") === "1";
    const isM26Fixture = fixtureParams.get("m26Fixture") === "1";
    const isM27Fixture = fixtureParams.get("m27Fixture") === "1";
    const isM30Fixture = fixtureParams.get("m30Fixture") === "1";
    const isM38Fixture = fixtureParams.get("m38Fixture") === "1";
    const isM47Fixture = fixtureParams.get("m47Fixture") === "1";
    const isM52Fixture = fixtureParams.get("m52Fixture") === "1";
    const isM53Fixture = fixtureParams.get("m53Fixture") === "1";
    const m53Fixture = isM53Fixture ? m53SeasonalTerrainFixture(fixtureParams) : null;
    const requestedM52View = fixtureParams.get("m52View");
    const m52View: BiomeReferenceView = BIOME_REFERENCE_VIEWS.includes(requestedM52View as BiomeReferenceView)
      ? requestedM52View as BiomeReferenceView
      : "overview";
    const parsedM52Rotation = Number(fixtureParams.get("m52Rotation") ?? 0);
    const m52Rotation: BiomeReferenceRotation = BIOME_REFERENCE_ROTATIONS.includes(parsedM52Rotation as BiomeReferenceRotation)
      ? parsedM52Rotation as BiomeReferenceRotation
      : 0;
    const isPropertyFixture = fixtureParams.get("propertyFixture") === "1";
    const isPerfMeasurement = fixtureParams.get("perfMeasure") === "1";
    if (!isPerfFixture && !isM19Fixture && !isM20Fixture && !isM21Fixture && !isM22Fixture && !isM23Fixture && !isM24Fixture && !isM25Fixture && !isM26Fixture && !isM27Fixture && !isM30Fixture && !isM38Fixture && !isM47Fixture && !isM52Fixture && !isM53Fixture && !isPropertyFixture) return;
    perfFixtureLoadedRef.current = true;
    const m25SeedParam = fixtureParams.get("m25Seed");
    const parsedM25Seed = m25SeedParam == null ? Number.NaN : Number(m25SeedParam);
    const m25Seed = Number.isInteger(parsedM25Seed) ? parsedM25Seed | 0 : 250025;
    const fixtureRepParam = fixtureParams.get("m7Rep");
    const fixtureRep = fixtureRepParam == null ? Number.NaN : Number(fixtureRepParam);
    const requestedTheme = fixtureParams.get("m53Theme") ?? fixtureParams.get("m52Theme") ?? fixtureParams.get("m22Theme") ?? fixtureParams.get("m21Theme") ?? fixtureParams.get("m20Theme") ?? fixtureParams.get("perfTheme");
    const fixtureTheme = isLandTheme(requestedTheme) ? requestedTheme : BIOME_KEYS[0];
    let fixtureCourse = isPropertyFixture
      ? { ...createReferenceCourse(), property: starterPropertyCourse() }
      : isM38Fixture
      ? createPlayerProReferenceCourse()
      : isM27Fixture
      ? createM27ReleaseReferenceCourse(fixtureTheme)
      : isM53Fixture
      ? createBiomeAuthoringReferenceCourse(fixtureTheme)
      : isM52Fixture
      ? createBiomeAuthoringReferenceCourse(fixtureTheme)
      : isM47Fixture
      ? createM47CertificationCourse(18)
      : isM30Fixture
      ? createM26MultiCourseReferenceCourse()
      : isM26Fixture
      ? createM26MultiCourseReferenceCourse()
      : isM25Fixture
      ? createNewGame({ mode: "sandbox", courseName: "M25 Survey Estate", seed: m25Seed, theme: fixtureTheme, difficulty: "normal", sandboxOverrides: { startingCash: 500_000 } }).course
      : isM24Fixture
      ? createTournamentStandardsCourse()
      : isM23Fixture
      ? createM23CourseSetupReferenceCourse()
      : isM22Fixture
      ? createM22VisualReferenceCourse(fixtureTheme)
      : isM21Fixture
        ? createM21BiomeReferenceCourse(fixtureTheme)
      : isM20Fixture
        ? createM20TerrainReferenceCourse(fixtureTheme)
        : isM19Fixture
          ? createParklandVisualReferenceCourse()
          : createRenderPerfCourse(fixtureTheme);
    if (showTeeOfferFixture) {
      const first = fixtureCourse.holes[0];
      const tiles = fixtureCourse.tiles.slice();
      for (const teeSet of ["forward", "championship"] as const) {
        const point = getTeeBox(first, teeSet);
        if (point) tiles[point.y * fixtureCourse.width + point.x] = "rough";
      }
      fixtureCourse = {
        ...fixtureCourse,
        tiles,
        holes: [withNormalizedHoleSetup({ ...first, teeBoxes: { ...first.teeBoxes, forward: null, championship: null } }), ...fixtureCourse.holes.slice(1)],
      };
    }
    // Browser fixtures should enter the same normalized shape as migrated and
    // newly created games. Otherwise the first management-only update adds
    // layout IDs, looks like a physical hole edit, and needlessly replans every
    // live golfer in the renderer stress scenes.
    fixtureCourse = normalizeCourseLayouts(fixtureCourse);
    const m52Bookmark = isM52Fixture
      ? biomeCameraBookmarks(fixtureCourse).find((bookmark) =>
        bookmark.view === m52View && bookmark.rotation === m52Rotation) ?? null
      : m53Fixture
      ? biomeCameraBookmarks(fixtureCourse).find((bookmark) =>
        bookmark.view === "overview" && bookmark.rotation === m53Fixture.rotation) ?? null
      : null;
    setM52ReferenceCamera(m52Bookmark);
    let fixtureWorld: World = {
      ...gameSession.getState().world,
      week: 1,
      cash: isPropertyFixture ? 1_000_000 : isM25Fixture ? 500_000 : 250_000,
      reputation: Number.isFinite(fixtureRep) ? Math.max(0, Math.min(100, fixtureRep)) : 95,
      runSeed: isM25Fixture ? m25Seed : m53Fixture?.seed ?? 12160,
      isBankrupt: false,
      distressWeeks: 0,
      mode: "sandbox" as const,
      ...(isPerfFixture ? {
        staffLevel: 5,
        staffRoster: staffFromLevel(5, activeCourseLayout(fixtureCourse).id),
      } : {}),
      ...(isPropertyFixture ? { enterprise: emptyPropertyEnterprise() } : {}),
    };
    if (m53Fixture) {
      const dayOfWeek = m53Fixture.absoluteDay % 7;
      const seasonal = createSeasonalState({
        runSeed: fixtureWorld.runSeed,
        theme: fixtureTheme,
        week: Math.floor(m53Fixture.absoluteDay / 7) + 1,
        day: dayOfWeek,
      });
      fixtureWorld = {
        ...fixtureWorld,
        week: Math.floor(m53Fixture.absoluteDay / 7) + 1,
        seasonal,
      };
    }
    if (isM30Fixture) {
      const layouts = courseLayouts(fixtureCourse);
      for (let day = 0; day < 10; day++) {
        const metrics = emptyPaceDayMetrics(layouts.map((layout) => layout.id));
        for (const [courseIndex, layout] of layouts.entries()) {
          const pace = ensureCoursePaceMetrics(metrics, layout.id);
          const rounds = courseIndex === 0 ? 16 : 8;
          const delay = courseIndex === 0 ? 18 + day : 6 + day / 2;
          pace.groupsStarted = Math.ceil(rounds / 4);
          pace.groupsFinished = pace.groupsStarted;
          pace.roundsCompleted = rounds;
          pace.roundDurations = [112 + delay, 118 + delay, 124 + delay, 132 + delay];
          pace.totalWaitMinutes = rounds * delay;
          pace.greenFeeRevenue = rounds * layout.greenFee;
          pace.beverageRevenue = rounds * (courseIndex === 0 ? 14 : 8);
          pace.occupiedTeeMinutes = pace.groupsStarted * 120;
          pace.satisfaction = rounds * (courseIndex === 0 ? 66 : 82);
          const bottleneckHoleId = layout.publishedHoleIds[Math.min(2, layout.publishedHoleIds.length - 1)];
          pace.holes[bottleneckHoleId] = {
            holeId: bottleneckHoleId,
            queueMinutes: (courseIndex === 0 ? 74 : 24) + day,
            occupancyMinutes: 88,
            recoveryDelayMinutes: courseIndex === 0 ? 18 : 4,
            visits: 8,
          };
          pace.cohorts.skilled_impatient = {
            samples: Math.ceil(rounds / 2),
            durationMinutes: Math.ceil(rounds / 2) * (118 + delay),
            timeParVarianceMinutes: Math.ceil(rounds / 2) * delay,
            waitMinutes: Math.ceil(rounds / 2) * delay,
            pickups: courseIndex === 0 ? 1 : 0,
            abandonments: 0,
            satisfaction: Math.ceil(rounds / 2) * (courseIndex === 0 ? 58 : 80),
          };
          pace.cohorts.novice_social = {
            samples: Math.floor(rounds / 2),
            durationMinutes: Math.floor(rounds / 2) * (132 + delay / 2),
            timeParVarianceMinutes: Math.floor(rounds / 2) * delay / 2,
            waitMinutes: Math.floor(rounds / 2) * delay,
            pickups: 0,
            abandonments: 0,
            satisfaction: Math.floor(rounds / 2) * (courseIndex === 0 ? 73 : 86),
          };
        }
        fixtureWorld = recordPaceDay({ ...fixtureWorld, week: 1 + Math.floor(day / 7) }, fixtureCourse, day % 7, metrics);
      }
    }
    if (isM38Fixture) {
      const evidenceHoles = fixtureCourse.holes.filter((hole) => hole.id && hole.tee && hole.green);
      const makeRound = (visit: number): CompletedRound => ({
        golferId: 38,
        golferName: "Morgan Links",
        archetype: "lowHandicap",
        score: 35 + visit,
        scoreToPar: visit - 2,
        holePar: evidenceHoles.map(() => 4),
        holeStrokes: evidenceHoles.map(() => 4),
        mood: 0.9,
        courseId: fixtureCourse.activeCourseId,
        courseName: fixtureCourse.name,
        holeIds: evidenceHoles.map((hole) => hole.id!),
        teeSet: "member",
        waitMinutes: 8,
        shots: Array.from({ length: 12 }, (_, index) => {
          const hole = evidenceHoles[index % evidenceHoles.length];
          const from = hole.tee!;
          const green = hole.green!;
          const progress = (index % 4 + 1) / 5;
          return {
            id: `m38-${visit}-${index}`,
            holeId: hole.id!,
            shotNumber: index % 4 + 1,
            shotType: index % 4 === 0 ? "drive" as const : index % 4 === 3 ? "recovery" as const : "approach" as const,
            from: { x: from.x + index % 2, y: from.y },
            landing: { x: from.x + (green.x - from.x) * progress, y: from.y + (green.y - from.y) * progress },
            rest: { x: from.x + (green.x - from.x) * progress + 0.5, y: from.y + (green.y - from.y) * progress + (index % 2 ? 0.5 : -0.5) },
            lieBefore: index % 4 === 3 ? "rough" : "fairway",
            lieAfter: index % 4 === 3 ? "sand" : "fairway",
          };
        }),
      });
      fixtureWorld = recordLivingClubRound(fixtureWorld, fixtureCourse, makeRound(1), 1);
      fixtureWorld = recordLivingClubRound(fixtureWorld, fixtureCourse, makeRound(2), 4);
      fixtureWorld = advanceLivingClubDay(fixtureCourse, fixtureWorld, 5).world;
    }
    if (isM52Fixture && m52View === "direct-play") {
      const career = createDefaultPlayerPro({
        seed: fixtureWorld.runSeed,
        name: "ZK-564 Reference Player",
        background: "architect",
      });
      const started = startPlayableRound({
        course: fixtureCourse,
        world: { ...fixtureWorld, playerPro: career },
        layoutId: activeCourseLayout(fixtureCourse).id,
        teeSet: "member",
        pinRotation: "A",
        day: 0,
      });
      if (!started.ok) throw new Error(`ZK-564 direct-play fixture failed: ${started.reason}`);
      fixtureWorld = {
        ...fixtureWorld,
        playerPro: { ...career, activeRound: started.round },
      };
      setPlayerShotAim(caddieRecommendation(started.round, career.skills).aim);
      setShowPlayerPro(false);
    } else if (isM52Fixture || isM53Fixture) {
      setPlayerShotAim(null);
      setFollowSelected(false);
    }
    dispatch({ type: "LOAD_GAME", course: fixtureCourse, world: fixtureWorld });
    if (isM23Fixture) {
      setActiveHoleIndex(0);
      setHoleEditMode("hole");
      setViewMode("ARCHITECT");
      if (showTeeOfferFixture) setTeeSetupPrompt({ holeIndex: 0 });
    }
    if (isM52Fixture && m52View === "golfer-follow") {
      const state = createRenderPerfLiveState(fixtureCourse, fixtureWorld);
      const selectedGolferId = state.golfers[0]?.id ?? null;
      live.restoreSnapshot(snapshotLiveSimulation({
        state,
        pendingCash: 0,
        speed: "paused",
        selectedGolferId,
      }));
      if (selectedGolferId != null) {
        live.selectGolfer(selectedGolferId);
        setFollowSelected(true);
      }
    } else if (isM52Fixture || isM53Fixture) {
      live.restoreSnapshot(snapshotLiveSimulation({
        state: createLiveState(fixtureCourse, fixtureWorld, m53Fixture?.absoluteDay ? m53Fixture.absoluteDay % 7 : 0),
        pendingCash: 0,
        speed: "paused",
        selectedGolferId: null,
      }));
    } else if (isPerfFixture || isM27Fixture) {
      live.restoreSnapshot(snapshotLiveSimulation({
        state: createRenderPerfLiveState(fixtureCourse, fixtureWorld),
        pendingCash: 0,
        speed: isPerfMeasurement ? "paused" : "4x",
        selectedGolferId: null,
      }));
    } else if (isM38Fixture || isM30Fixture || isM47Fixture) {
      live.restoreSnapshot(snapshotLiveSimulation({
        state: createLiveState(fixtureCourse, fixtureWorld, isM38Fixture ? 5 : 0),
        pendingCash: 0,
        speed: "paused",
        selectedGolferId: null,
      }));
    }
    setAppProfile((current) => ({
      ...current,
      tutorialOffered: true,
      tutorialCompleted: true,
      ...(m53Fixture ? {
        graphics: { ...current.graphics, quality: m53Fixture.quality },
      } : {}),
    }));
    setTutorialProgress(null);
    setShowTutorialOffer(false);
    if (isM52Fixture || isM53Fixture) {
      setViewMode(m52View === "overview" || m52View === "build" ? "ARCHITECT" : "COZY");
      setHoleEditMode("global");
      setActiveHoleIndex(0);
    }
    if (isM27Fixture && !isPerfMeasurement) setShowCourseManager(true);
    flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreCourse") });
    setPendingLoadingContext(null);
    flowDispatch({ type: "ENTER_GAME" });
    live.setSpeed((isPerfFixture || isM27Fixture) && !isPerfMeasurement ? "4x" : "paused");
  }, [dispatch, gameSession, live, t]);

  const resumeSpeedRef = useRef<SpeedName>(appProfile.gameplay.defaultGameSpeed);

  const openPauseMenu = useCallback(() => {
    if (flow.base !== "in-game" || flow.modal || flow.paused) return;
    resumeSpeedRef.current = live.speed;
    live.setSpeed("paused");
    flowDispatch({ type: "OPEN_PAUSE" });
  }, [flow.base, flow.modal, flow.paused, live]);

  const resumeFromPause = useCallback(() => {
    if (!flow.paused || flow.modal) return;
    flowDispatch({ type: "CLOSE_PAUSE" });
    live.setSpeed(resumeSpeedRef.current);
  }, [flow.paused, flow.modal, live]);

  const toggleClock = useCallback(() => {
    if (flow.base !== "in-game" || flow.modal || flow.paused) return;
    if (live.speed === "paused") live.setSpeed(resumeSpeedRef.current === "paused" ? "1x" : resumeSpeedRef.current);
    else {
      resumeSpeedRef.current = live.speed;
      live.setSpeed("paused");
    }
  }, [flow.base, flow.modal, flow.paused, live]);
  const quickSave = useCallback(async () => {
    if (flow.base !== "in-game") return;
    const sequence = changeSequenceRef.current;
    await gameSession.save(
      (payload) => saveToSlot("quick-save", "manual", t("save.quick"), payload),
      { history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress },
    );
    markClean(sequence);
    setA11yMessage(t("save.quickComplete"));
  }, [flow.base, gameSession, live, markClean, t, tutorialProgress]);


  const quitToTitle = useCallback(() => {
    if (dirty && !window.confirm(t("quit.confirm"))) return;
    live.setSpeed("paused");
    setPendingLoadingContext(null);
    flowDispatch({ type: "BACK_TO_TITLE" });
  }, [dirty, live, t]);

  function restartCurrentScenario() {
    const scenario = getScenario(world.scenarioId);
    if (!scenario || !window.confirm(t("confirm.restartScenario"))) return;
    startScenario(scenario);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      if (event.key === "Escape") {
        if (flow.modal) {
          event.preventDefault();
          flowDispatch({ type: "CLOSE_TOP_LAYER" });
        } else if (tutorialProgress) {
          // The tutorial owns the top layer. Opening the pause menu here would
          // stack two competing dialogs and obscure the highlighted control.
          event.preventDefault();
        } else if (flow.base === "in-game") {
          event.preventDefault();
          if (flow.paused) resumeFromPause();
          else openPauseMenu();
        }
        return;
      }
      if (typing || flow.modal || flow.paused || flow.base !== "in-game") return;
      const bindings = appProfile.accessibility.keybindings;
      if (eventMatchesBinding(event, bindings.pause)) {
        event.preventDefault();
        toggleClock();
      } else if (eventMatchesBinding(event, bindings.speed1)) {
        event.preventDefault(); resumeSpeedRef.current = "1x"; live.setSpeed("1x");
      } else if (eventMatchesBinding(event, bindings.speed2)) {
        event.preventDefault(); resumeSpeedRef.current = "2x"; live.setSpeed("2x");
      } else if (eventMatchesBinding(event, bindings.speed3)) {
        event.preventDefault(); resumeSpeedRef.current = "4x"; live.setSpeed("4x");
      } else if (eventMatchesBinding(event, bindings.terrainTool)) {
        event.preventDefault(); activateTerrainEditing();
      } else if (eventMatchesBinding(event, bindings.obstacleTool)) {
        event.preventDefault(); activateObstacleEditing();
      } else if (eventMatchesBinding(event, bindings.buildingTool)) {
        event.preventDefault(); setEditorMode("BUILDING");
      } else if (eventMatchesBinding(event, bindings.quicksave)) {
        event.preventDefault(); void quickSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateObstacleEditing, activateTerrainEditing, appProfile.accessibility.keybindings, flow.base, flow.modal, flow.paused, live, openPauseMenu, quickSave, resumeFromPause, toggleClock, tutorialProgress]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || flow.base !== "in-game") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, flow.base]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${appProfile.accessibility.textScale}%`;
    root.dataset.reducedMotion = String(appProfile.accessibility.reducedMotion);
    root.dataset.colorVision = appProfile.accessibility.colorVision;
    root.dataset.terrainPatterns = String(appProfile.accessibility.terrainPatterns);
  }, [appProfile.accessibility]);

  useEffect(() => {
    const cadence = appProfile.gameplay.autosaveCadence;
    if (flow.base !== "in-game" || (cadence !== "5m" && cadence !== "15m")) return;
    const interval = window.setInterval(() => {
      const sequence = changeSequenceRef.current;
      void gameSession.save(autosave, { history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress })
        .then(() => markClean(sequence));
    }, cadence === "5m" ? 300_000 : 900_000);
    return () => window.clearInterval(interval);
  }, [appProfile.gameplay.autosaveCadence, flow.base, gameSession, live, markClean, tutorialProgress]);

  const canvasPaneRef = useRef<HTMLDivElement | null>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    // When starting in the StartMenu, the canvas pane doesn't exist yet.
    // Re-run this effect when we enter the game so the canvas can size correctly.
    if (screen !== "game") return;
    const el = canvasPaneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setPaneSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setPaneSize({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, [screen]);

  const tileSize = useMemo(() => {
    // Fit the entire course without scroll, maintain aspect ratio.
    const w = Math.max(0, paneSize.width);
    const h = Math.max(0, paneSize.height);
    if (w === 0 || h === 0) return 16;
    const size = Math.floor(Math.min(w / course.width, h / course.height));
    return Math.max(4, Math.min(40, size));
  }, [paneSize.width, paneSize.height, course.width, course.height]);

  const activeSetupCourse = useMemo(
    () => courseForCourseSetup(course, selectedTeeSet, course.activePinRotation ?? "A"),
    [course, selectedTeeSet],
  );
  const activeSetupSummary = useMemo(() => scoreCourseHoles(activeSetupCourse), [activeSetupCourse]);
  const activePath = useMemo(() => activeSetupSummary.holes[activeHoleIndex]?.path ?? [], [activeSetupSummary, activeHoleIndex]);
  const activeShotPlan = useMemo(
    () => activeSetupSummary.holes[activeHoleIndex]?.shotPlan ?? [],
    [activeSetupSummary, activeHoleIndex]
  );

  // Extract failing corridor segments for overlay
  const activeHoleEvaluation = useMemo(
    () =>
      perfProfiler.measure('evaluateHole', () =>
        evaluateHole(
          activeSetupCourse,
          activeSetupCourse.holes[activeHoleIndex],
          activeHoleIndex,
          costMult,
        )
      ),
    [activeSetupCourse, activeHoleIndex, costMult]
  );
  const failingCorridorSegments = useMemo(() => {
    const fairwayIssue = activeHoleEvaluation.issues.find((i) => i.code === "FAIRWAY_CONTINUITY");
    return fairwayIssue?.metadata?.failingSegments ?? [];
  }, [activeHoleEvaluation]);

  const eligibleBridge = useMemo(() => {
    return canTakeBridgeLoan(course, world, BALANCE);
  }, [course, world, BALANCE]);

  // Hole edit mode functions
  function enterHoleEditMode(holeIndex: number, teeSet: TeeSet = selectedTeeSet) {
    const hole = course.holes[holeIndex];
    const framingTee = getTeeBox(hole, teeSet) ?? TEE_SETS.map((set) => getTeeBox(hole, set)).find(Boolean) ?? null;
    if (!framingTee || !hole.green) {
      // Cannot enter hole edit mode without tee and green
      return;
    }
    setActiveHoleIndex(holeIndex);
    setHoleEditMode("hole");
    holeEditCameraManualRef.current = false; // Reset manual flag on entry
    // Compute camera state with auto-fit (zoom = null)
    // Convert 12% of viewport to approximate tiles for padding
    const paddingPercent = 0.12;
    const paddingTiles = Math.max(2, Math.min(paneSize.width, paneSize.height) * paddingPercent / (tileSize || 16));
    const camera = computeHoleCamera(
      framingTee,
      hole.green,
      paddingTiles,
      null, // null = auto-fit
      paneSize.width,
      paneSize.height,
      course,
      hole,
      holeIndex,
      tileSize
    );
    setHoleEditCamera(camera);
  }

  function fitHole(preset: "fit" | "tee" | "landing" | "green" = "fit") {
    if (holeEditMode !== "hole") return;
    const hole = activeSetupCourse.holes[activeHoleIndex];
    if (!hole?.tee || !hole.green) return;
    
    const camera = computeZoomPreset(preset, activeSetupCourse, hole, activeHoleIndex, paneSize.width, paneSize.height, tileSize);
    if (camera) {
      holeEditCameraManualRef.current = true; // Mark as manually set
      setHoleEditCamera(camera);
    }
  }

  function exitHoleEditMode() {
    setHoleEditMode("global");
    setHoleEditCamera(null);
    setShowFixOverlay(false);
  }

  function navigateHole(delta: number) {
    const nextIndex = (activeHoleIndex + delta + 9) % 9;
    enterHoleEditMode(nextIndex);
  }

  // Update camera when pane size changes in hole edit mode (re-fit)
  // Only auto-fit on initial entry or pane size change, not when manually set
  useEffect(() => {
    if (holeEditMode === "hole" && !holeEditCameraManualRef.current) {
      const hole = course.holes[activeHoleIndex];
      if (hole.tee && hole.green && paneSize.width > 0 && paneSize.height > 0) {
        // Preserve current zoom if camera exists, otherwise auto-fit
        const currentZoom = holeEditCamera?.zoom ?? null;
        // Convert 12% of viewport to approximate tiles for padding
        const paddingPercent = 0.12;
        const paddingTiles = Math.max(2, Math.min(paneSize.width, paneSize.height) * paddingPercent / (tileSize || 16));
        const camera = computeHoleCamera(
          hole.tee,
          hole.green,
          paddingTiles,
          currentZoom, // preserve zoom if exists
          paneSize.width,
          paneSize.height,
          course,
          hole,
          activeHoleIndex,
          tileSize
        );
        // Legit effect-shaped sync: gated by holeEditCameraManualRef, a mutable
        // flag written from event handlers, so this can't be derived in render.
        setHoleEditCamera(camera);
      }
    }
  }, [paneSize.width, paneSize.height, tileSize, holeEditMode, activeHoleIndex]);

  // Keyboard shortcuts for hole edit mode
  useEffect(() => {
    if (holeEditMode !== "hole") return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        exitHoleEditMode();
      } else if (e.key === "[" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        navigateHole(-1);
      } else if (e.key === "]" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        navigateHole(1);
      } else if (e.key === "f" || e.key === "F") {
        // Fit Hole shortcut (only when not in input/textarea)
        if (
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement)
        ) {
          e.preventDefault();
          fitHole();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [holeEditMode, activeHoleIndex]);

  // Distress transition → bridge-loan prompt, via render adjustment (React's
  // documented "storing information from previous renders" pattern; avoids
  // setState-in-effect cascades).
  if (!world.isBankrupt) {
    const distressNow = world.distressWeeks ?? 0;
    if (distressNow !== prevDistress) {
      setPrevDistress(distressNow);
      if (prevDistress === 0 && distressNow > 0 && eligibleBridge) setShowBridgePrompt(true);
      if (distressNow === 0) setShowBridgePrompt(false);
    }
  }

  // Peak cash/reputation tracking via render adjustment (same pattern).
  if (!world.isBankrupt && world.cash > peakCash) setPeakCash(world.cash);
  if (!world.isBankrupt && world.reputation > peakRep) setPeakRep(world.reputation);

  // Victory celebration fires once on the OPEN → WON transition (render
  // adjustment; restart/load reset prevOutcome so it can't re-fire).
  const objectiveOutcome: RunOutcome = world.campaign && !world.campaign.completed
    ? "OPEN"
    : world.objectives?.outcome ?? "OPEN";
  if (objectiveOutcome !== prevOutcome) {
    setPrevOutcome(objectiveOutcome);
    if (objectiveOutcome === "WON" && prevOutcome === "OPEN") setShowVictory(true);
  }

  // Career medal (ZKU-164): record the win once per run; replays keep the
  // best (earliest) week via the store.
  const objectivesOutcomeForRecord: RunOutcome = world.campaign
    ? world.campaign.completed ? "WON" : "OPEN"
    : world.objectives?.outcome ?? "OPEN";
  useEffect(() => {
    if (showVictory) void audio.playSting("celebration");
  }, [audio, showVictory]);

  useEffect(() => {
    if (objectivesOutcomeForRecord !== "WON") return;
    if (scenarioRecordedRef.current) return;
    if (world.mode !== "career" || !world.scenarioId) return;
    scenarioRecordedRef.current = true;
    const campaign = world.campaign;
    const chapter = campaign ? CAMPAIGN_CHAPTER_BY_ID.get(campaign.chapterId) : undefined;
    recordScenarioCompleted(world.scenarioId, {
      week: world.objectives?.wonWeek ?? world.week,
      cash: world.cash,
      medal: campaign?.medal,
      choices: campaign?.choices,
      rewards: chapter ? [...chapter.rewards] : undefined,
      epilogueFacts: campaign?.epilogueFacts,
    });
  }, [objectivesOutcomeForRecord, world]);

  useEffect(() => {
    const onProfileChange = () => {
      const next = loadAppProfile();
      setAppProfile(next);
      setAnimationsEnabled(next.graphics.animations);
      audio.syncVolumes(next.audio);
      if (next.advisorFrequency === "off") setAdvisorMessage(null);
      setAdvisorWake((value) => value + 1);
    };
    window.addEventListener("coursecraft-profile-change", onProfileChange);
    return () => window.removeEventListener("coursecraft-profile-change", onProfileChange);
  }, [audio]);

  useEffect(() => {
    if (screen !== "game" || tutorialProgress || showTutorialOffer || advisorMessage || flow.modal || flow.paused || showVictory || showBridgePrompt) return;
    if (Date.now() < advisorCooldownUntilRef.current) return;
    const frequency = loadAppProfile().advisorFrequency;
    const previous = history.length >= 2 ? history[history.length - 2] : undefined;
    const next = advisorMessages(activeOperatingCourse, world, last, previous, t).find(
      (message) => allowsMessage(frequency, message) && !seenAdvisorMessagesRef.current.has(message.id)
    );
    if (next) {
      setAdvisorMessage(next);
      setA11yMessage(`${next.title}. ${next.body}`);
    }
  }, [screen, tutorialProgress, showTutorialOffer, advisorMessage, flow.modal, flow.paused, showVictory, showBridgePrompt, activeOperatingCourse, world, last, history, advisorWake, t]);

  function dismissAdvisor() {
    if (advisorMessage) {
      seenAdvisorMessagesRef.current.add(advisorMessage.id);
      const profile = loadAppProfile();
      saveAppProfile({ ...profile, advisorSeen: [...seenAdvisorMessagesRef.current].slice(-100) });
    }
    setAdvisorMessage(null);
    const frequency = loadAppProfile().advisorFrequency;
    const cooldown = frequency === "chatty" ? 8_000 : 18_000;
    advisorCooldownUntilRef.current = Date.now() + cooldown;
    window.setTimeout(() => setAdvisorWake((value) => value + 1), cooldown + 50);
  }

  function startFlyover() {
    if (appProfile.accessibility.reducedMotion) {
      setA11yMessage(t("flyover.disabled"));
      return;
    }
    if (advisorMessage) dismissAdvisor();
    setFlyoverNonce((value) => value + 1);
  }

  // Course name propagates to the browser tab (ZKU-162).
  useEffect(() => {
    document.title = screen === "game" ? `${course.name} — ${t("app.name")}` : t("app.name");
  }, [screen, course.name, t]);

  useEffect(() => {
    audioCameraCenterRef.current = audioCameraCenter;
  }, [audioCameraCenter]);

  const seasonalPresentation = useMemo(
    () => seasonalVisualState({ course, world, day: live.status.dayIndex, result: last }),
    [course, last, live.status.dayIndex, world],
  );

  // One app-state mapping owns music selection. Track files remain preload=none
  // until the first user gesture unlocks the manager.
  useEffect(() => {
    void audio.setMusicContext(musicContextFor({
      screen,
      viewMode,
      cash: world.cash,
      liveRunning: live.speed !== "paused",
      won: world.objectives?.outcome === "WON",
      theme: course.theme,
      playerRoundActive: !!activePlayerRound
        && activePlayerRound.phase !== "round_complete"
        && activePlayerRound.phase !== "conceded",
      tournamentTier: live.status.tournament?.tier
        ?? (activePlayerRound?.tournamentId
          ? currentPlayerTournament(world, activePlayerRound.tournamentId)?.tier
          : undefined),
      dayMinute: live.status.dayMinute,
    }));
  }, [
    activePlayerRound,
    audio,
    course.theme,
    live.speed,
    live.status.tournament?.tier,
    live.status.dayMinute,
    screen,
    viewMode,
    world,
  ]);

  useEffect(() => {
    audio.setSurface(audioSurface);
    const worldAudioEnabled = worldAmbienceEnabledFor(audioSurface);
    const worldAudioPaused = worldAudioEnabled && (flow.paused || live.speed === "paused");
    audio.setPaused(worldAudioPaused);
    audio.setAmbientMix(ambientMixFor({
      course,
      center: audioCameraCenter,
      dayMinute: live.status.dayMinute,
      visibleGolfers: live.status.onCourse,
      paused: worldAudioPaused,
      enabled: worldAudioEnabled,
      seasonalVisualState: seasonalPresentation,
    }));
  }, [
    audio,
    audioCameraCenter,
    course,
    flow.paused,
    live.speed,
    live.status.dayIndex,
    live.status.dayMinute,
    live.status.onCourse,
    audioSurface,
    seasonalPresentation,
    world,
  ]);

  // THE new-run path (ZKU-162): every fresh run goes through createNewGame
  // (or createScenarioGame for career runs) and then this shared reset.
  function prepareTutorialPaintCorridor() {
    selectWorkspace("design");
    setPhotoMode(false);
    setViewMode("ARCHITECT");
    activateTerrainEditing("curve", "fairway");
  }

  function beginTutorial(tutorialCourse = course, tutorialWorld = world) {
    const progress = createTutorialProgress(tutorialCourse, tutorialWorld);
    prepareTutorialPaintCorridor();
    setTutorialProgress(progress);
    saveTutorialProgress(progress);
    updateAppProfile({ tutorialOffered: true });
    setGolfopediaEntry(undefined);
    setAdvisorMessage(null);
    setShowTutorialOffer(false);
  }

  function finishTutorial(completed: boolean) {
    setTutorialProgress(null);
    setTeeSetupPrompt(null);
    saveTutorialProgress(null);
    updateAppProfile({ tutorialOffered: true, tutorialCompleted: completed || loadAppProfile().tutorialCompleted });
    setShowTutorialOffer(false);
    void autosave({ course, world, history, records, live: live.getSnapshot(), tutorial: null });
    checkAchievements(records);
  }

  function startRun(newCourse: typeof course, newWorld: typeof world) {
    const worldWithPlayerPro = newWorld.playerPro ? newWorld : {
      ...newWorld,
      playerPro: createDefaultPlayerPro({ seed: newWorld.runSeed, name: newWorld.founderName }),
    };
    dispatch({ type: "NEW_GAME", course: newCourse, world: worldWithPlayerPro });
    markClean();
    setHistory([]);
    sculptedRef.current = false;
    const freshRecords = emptyCourseRecords(newCourse.holes.length);
    recordsRef.current = freshRecords;
    setRecords(freshRecords);
    setLast(undefined);
    setPendingWeekReport(null);
    activateTerrainEditing("curve", "fairway");
    setActiveHoleIndex(0);
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
    setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
    setPaintError(null);
    setShowLandOffice(false);
    setSelectedParcelId(newCourse.estate?.starterParcelId ?? null);
    setObstacleType("tree");
    setDecorationKind("bench");
    setDecorationAction("place");
    setFlyoverNonce(0);
    setPeakCash(newWorld.cash);
    setPeakRep(newWorld.reputation);
    setShowBridgePrompt(false);
    setPrevDistress(0);
    legacyAwardedRef.current = false;
    scenarioRecordedRef.current = false;
    setPrevOutcome("OPEN");
    setShowVictory(false);
    setShowPlayerPro(false);
    setPlayerShotAim(null);
    if (!loadAppProfile().tutorialOffered) setShowTutorialOffer(true);
  }

  useEffect(() => {
    if (screen !== "game" || !tutorialProgress) return;
    const sequence = ++tutorialSaveSequenceRef.current;
    setTutorialSaveStatus("saving");
    const timer = window.setTimeout(() => {
      const current = gameSession.getState();
      void autosave({
        course: current.course,
        world: current.world,
        history: historyRef.current,
        records: recordsRef.current,
        live: getLiveSnapshot(),
        tutorial: tutorialProgress,
      }).then(() => {
        if (tutorialSaveSequenceRef.current === sequence) setTutorialSaveStatus("saved");
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [screen, course, gameSession, tutorialProgress, getLiveSnapshot]);

  // Milestones and resumed saves reconcile from authoritative course state,
  // rather than relying on a one-shot ninth-hole event that may already have
  // fired. The pure reconciler advances only the open-course lesson once.
  useEffect(() => {
    if (screen !== "game" || !tutorialProgress) return;
    const reconciled = reconcileTutorialProgress(tutorialProgress, course);
    if (reconciled === tutorialProgress) return;
    setViewMode("ARCHITECT");
    setTutorialProgress(reconciled);
    saveTutorialProgress(reconciled);
    const nextStep = TUTORIAL_STEPS[reconciled.stepIndex];
    setA11yMessage(`${t(nextStep.titleKey)}. ${t(nextStep.bodyKey)}`);
  }, [course, screen, t, tutorialProgress]);

  useEffect(() => {
    if (
      screen !== "game"
      || !tutorialProgress
      || TUTORIAL_STEPS[tutorialProgress.stepIndex]?.id !== "paint-corridor"
    ) return;
    prepareTutorialPaintCorridor();
    // The lesson transition or loaded step is the only trigger. Keeping these
    // controls authoritative prevents an older selection from making the
    // fairway-painting lesson impossible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, tutorialProgress?.stepIndex]);

  // `goals` overrides the mode's default goal set (defeat-retry keeps a
  // run's exact goals).
  function restartRun(setup: GameSetup, goals?: GoalDefinition[] | null) {
    debugLog('[Performance] Starting new game...');
    const start = performance.now();
    const { course: newCourse, world: newWorld } = createNewGame(setup, goals);
    debugLog('[Performance] Wild land generated in', performance.now() - start, 'ms');
    live.restoreSnapshot(undefined);
    startRun(newCourse, newWorld);
  }

  // Career (ZKU-164): scenarios build their run from the authored definition.
  function startScenario(scenario: ScenarioDefinition) {
    setPendingLoadingContext(neutralLoadingBiomeContext(scenario.theme));
    flowDispatch({ type: "BEGIN_LOADING", label: t("scenario.preparing", { name: t(scenario.nameKey) }) });
    window.setTimeout(() => {
      recordScenarioAttempt(scenario.id);
      const { course: newCourse, world: newWorld } = createScenarioGame(scenario);
      live.restoreSnapshot(undefined);
      startRun(newCourse, newWorld);
      live.setSpeed(appProfile.gameplay.defaultGameSpeed);
      setPendingLoadingContext(null);
      flowDispatch({ type: "ENTER_GAME" });
    }, 0);
  }

  /** GameSetup matching the CURRENT run, for retry-same-seed / new-seed. */
  function currentRunSetup(seed: number): GameSetup {
    return {
      mode: world.mode ?? "sandbox",
      courseName: course.name,
      founderName: world.founderName,
      seed,
      theme: course.theme ?? "parkland",
      difficulty: world.difficulty ?? "normal",
      playerPro: world.playerPro ? {
        name: world.playerPro.identity.name,
        appearance: world.playerPro.identity.appearance,
        handedness: world.playerPro.identity.handedness,
        background: world.playerPro.identity.background,
      } : undefined,
    };
  }

  function quickStartSetup(): GameSetup {
    return {
      mode: "sandbox",
      courseName: generateCourseName(),
      seed: import.meta.env.MODE === "e2e" ? 424242 : (Date.now() % 1_000_000) | 0,
      theme: "parkland",
      difficulty: "normal",
    };
  }

  const [canLoadFromMenu, setCanLoadFromMenu] = useState(false);
  useEffect(() => {
    // Slot store (incl. migrated legacy save) drives the menu's Load button.
    let alive = true;
    void import("./utils/saveStore").then(({ listSlots }) =>
      listSlots().then((slots) => {
        if (alive) setCanLoadFromMenu(slots.length > 0 || hasSavedGame());
      })
    );
    return () => {
      alive = false;
    };
  }, [screen]);

  function applyLoadedGame(loaded: SavePayload): boolean {
    if (!saveAvailableInEdition(loaded)) {
      setPaintError(t("demo.saveRejected"));
      return false;
    }
    recordBugAction({ type: "LOAD_GAME", course: loaded.course, world: loaded.world });
    terrainUndoRef.current = [];
    terrainRedoRef.current = [];
    gameSession.restore(loaded);
    live.restoreSnapshot(loaded.live);
    setHistory(loaded.history ?? []);
    setLast(loaded.history?.[loaded.history.length - 1]);
    setPendingWeekReport(null);
    const loadedRecords = loaded.records ?? emptyCourseRecords(loaded.course.holes.length);
    recordsRef.current = loadedRecords;
    setRecords(loadedRecords);
    // Loading a finished run must not replay the celebration or re-record
    // the medal (the store keeps best results anyway).
    setPrevOutcome(loaded.world.objectives?.outcome ?? "OPEN");
    setShowVictory(false);
    scenarioRecordedRef.current = loaded.world.campaign?.completed ?? loaded.world.objectives?.outcome === "WON";
    setTutorialProgress(loaded.tutorial ?? null);
    saveTutorialProgress(loaded.tutorial ?? null);
    const loadedRound = loaded.world.playerPro?.activeRound;
    setShowPlayerPro(false);
    setPlayerShotAim(loadedRound
      ? caddieRecommendation(loadedRound, loaded.world.playerPro!.skills).aim
      : null);
    if (loadedRound) {
      playerRoundResumeSpeedRef.current = loaded.live?.speed === "paused" ? "1x" : loaded.live?.speed ?? "1x";
      live.setSpeed("paused");
    }
    if (loaded.tutorial && TUTORIAL_STEPS[loaded.tutorial.stepIndex]?.id === "open-course") {
      const nextIncompleteHole = loaded.course.holes.findIndex((hole) => !hole.tee || !hole.green);
      if (nextIncompleteHole >= 0) {
        setActiveHoleIndex(nextIncompleteHole);
        setEditorMode("HOLE_WIZARD");
        setWizardStep("TEE");
        setDraftTee(null);
        setDraftGreen(null);
      }
    }
    markClean();
    return true;
  }

  useEffect(() => {
    const hasExpandedSetup = course.holes.some((hole) => hole.teeBoxes?.forward || hole.teeBoxes?.championship || hole.pinPositions?.B || hole.pinPositions?.C);
    const textMemberRating = computeCourseRatingAndSlope(activeOperatingCourse);
    const tournamentReadiness = Object.fromEntries((["local", "regional", "championship"] as const).map((tier) => {
      const result = evaluateTournamentCourseQualification(activeOperatingCourse, tier);
      return [tier, { eligible: result.eligible, teeSet: result.teeSet, pinRotation: result.pinRotation, rating: result.rating, slope: result.slope, completeRotations: result.completeRotations, blockers: result.requirements.filter((item) => !item.passed).map((item) => ({ id: item.id, current: item.current, required: item.required })) }];
    }));
    const textTeeRatings = hasExpandedSetup
      ? computeRatingsByTee(activeOperatingCourse)
      : {
          forward: { courseRating: 0, slope: 55, effectiveYardage: 0, setupComplete: false, rotationDeltas: {} },
          member: { courseRating: textMemberRating.courseRating, slope: textMemberRating.slope, effectiveYardage: 0, setupComplete: false, rotationDeltas: {} },
          championship: { courseRating: 0, slope: 55, effectiveYardage: 0, setupComplete: false, rotationDeltas: {} },
        };
    const liveStateById = new Map((live.getSnapshot()?.state.golfers ?? []).map((golfer) => [golfer.id, golfer]));
    const textSurfaceCareSummary = surfaceCareConditionSummary(course);
    const textGreenKeeping = greenKeepingOverview(course, world);
    const textSurfaceCareEvidence = observedSurfaceCareEvidence(course);
    const textSurfaceCarePresentation = surfaceCarePresentationSummary({
      course,
      quality: resolvedGraphicsQuality,
      seed: world.runSeed,
      reducedMotion: appProfile.accessibility.reducedMotion || !effectiveAnimations,
    });
    const textCaddieGuidance = activePlayerRound
      ? caddieShotGuidance(activePlayerRound, playerPro.skills)
      : null;
    const renderText = () => JSON.stringify({
      coordinateSystem: "tile coordinates; origin top-left, +x right, +y down",
      screen,
      screenBase: flow.base,
      modal: flow.modal,
      paused: flow.paused,
      workspace,
      tutorialStep: tutorialProgress?.stepIndex ?? null,
      course: {
        name: course.name,
        theme: course.theme ?? "parkland",
        width: course.width,
        height: course.height,
        smoothSurfaceFeatures: course.surfaceIntent?.features.length ?? 0,
        surfaceFeatures: (course.surfaceIntent?.features ?? []).map((feature) => ({
          id: feature.id,
          terrain: feature.terrain,
          kind: feature.geometry.kind,
          coverage: feature.coverage.length,
          renderRings: feature.renderRings?.length ?? 0,
        })),
        surfaceCare: {
          version: course.surfaceCare?.version ?? null,
          cellSize: course.surfaceCare?.cellSize ?? 8,
          lastAdvancedAbsoluteDay:
            course.surfaceCare?.lastAdvancedAbsoluteDay ?? null,
          ...textSurfaceCareSummary,
          presentation: textSurfaceCarePresentation,
          evidence: textSurfaceCareEvidence.map((zone) => ({
            key: zone.key,
            surfaceId: zone.surfaceId,
            cell: [zone.cellX, zone.cellY],
            terrain: zone.terrain,
            tiles: zone.tiles,
            effectiveTerrain: zone.effectiveTerrain,
            turfHealth: zone.turfHealth,
            mowingQuality: zone.mowingQuality,
            moisture: zone.moisture,
            wear: zone.wear,
            serviceRatio: zone.serviceRatio,
            repairRequired: zone.repairRequired,
            action: zone.action,
          })),
        },
        greenKeeping: {
          program: course.greenProgram?.preset ?? "balanced",
          explicitAdvancedControls: textGreenKeeping.explicitAdvancedControls,
          targets: {
            speedFeet: course.greenProgram?.targetSpeedFeet ?? 9.5,
            firmness: course.greenProgram?.targetFirmness ?? 0.5,
            mowingHeightMillimeters: course.greenProgram?.mowingHeightMillimeters ?? 3.5,
            rollingPasses: course.greenProgram?.rollingPasses ?? 1,
            irrigationTarget: course.greenProgram?.irrigationTarget ?? 0.58,
          },
          realized: {
            speedFeet: textGreenKeeping.realizedSpeedFeet,
            firmness: textGreenKeeping.realizedFirmness,
            health: textGreenKeeping.averageHealth,
            moisture: textGreenKeeping.averageMoisture,
            compaction: textGreenKeeping.averageCompaction,
            wear: textGreenKeeping.averageWear,
          },
          delivery: {
            requiredWeeklyBudget: textGreenKeeping.requiredWeeklyBudget,
            allocatedDailyBudget: textGreenKeeping.allocatedDailyBudget,
            requiredDailyBudget: textGreenKeeping.requiredDailyBudget,
            staffCoverage: textGreenKeeping.staffCoverage,
          },
          tradeoffs: {
            paceMinutesDelta: textGreenKeeping.paceMinutesDelta,
            satisfactionDelta: textGreenKeeping.satisfactionDelta,
          },
        },
        holesOpen: course.holes.filter((hole) => hole.tee && hole.green).length,
        terrainCounts: course.tiles.reduce((counts, terrain) => ({ ...counts, [terrain]: (counts[terrain] ?? 0) + 1 }), {} as Partial<Record<Terrain, number>>),
        obstacleCounts: course.obstacles.reduce((counts, obstacle) => ({ ...counts, [obstacle.type]: (counts[obstacle.type] ?? 0) + 1 }), {} as Partial<Record<ObstacleType, number>>),
        decorations: (course.decorations ?? []).map((decoration) => ({ kind: decoration.kind, x: decoration.x, y: decoration.y, rotation: decoration.rotation, span: decoration.span ?? null })),
        activePinRotation: course.activePinRotation ?? "A",
        teeRatings: Object.fromEntries(Object.entries(textTeeRatings).map(([teeSet, summary]) => [teeSet, { rating: summary.courseRating, slope: summary.slope, yardage: summary.effectiveYardage, complete: summary.setupComplete, deltas: summary.rotationDeltas }])),
        holeSetups: course.holes.map((hole) => ({ teeBoxes: hole.teeBoxes ?? { member: hole.tee }, pinPositions: hole.pinPositions ?? { A: hole.green }, parByTee: Object.fromEntries(TEE_SETS.map((teeSet) => [teeSet, getParSetting(hole, teeSet)])) })),
        courseManagerOpen: showCourseManager,
        activeCourseId: activeLayout.id,
        layouts: normalizeCourseLayouts(course).layouts!.map((layout) => ({ id: layout.id, name: layout.name, state: layout.state, greenFee: layout.greenFee, roundLength: layout.roundLength, draftHoleIds: layout.draftHoleIds, publishedHoleIds: layout.publishedHoleIds })),
        architecture: architectureReport ? { total: architectureReport.total, components: Object.fromEntries(Object.entries(architectureReport.components).map(([id, item]) => [id, { score: item.score, weight: item.weight, raw: item.raw }])), warnings: architectureReport.warnings.map((warning) => ({ id: warning.id, kind: warning.kind, holeIds: warning.holeIds, location: warning.location, measurement: warning.measurement })) } : null,
        estate: course.estate ? {
          generationVersion: course.estate.generationVersion,
          ownedParcelIds: course.estate.ownedParcelIds,
          landOfficeOpen: showLandOffice,
          selectedParcelId,
          parcels: course.estate.parcels.map((parcel) => ({ id: parcel.id, name: parcel.name, center: parcel.center, acreage: parcel.acreage, traits: parcel.traits, adjacent: parcel.adjacentParcelIds, owned: course.estate!.ownedParcelIds.includes(parcel.id), affordable: world.cash >= parcel.appraisal.total, price: parcel.appraisal.total })),
        } : null,
        property: (() => {
          const summary = propertySummary(course, world);
          return {
            panelOpen: showPropertyManagement,
            accessCapacity: summary.accessCapacity,
            assets: summary.assets.map((asset) => ({
              id: asset.id,
              kind: asset.kind,
              tier: asset.tier,
              surface: asset.surface ?? null,
              condition: asset.condition,
              capacity: asset.capacity,
              price: asset.price,
              x: asset.x,
              y: asset.y,
              open: asset.enabled,
              hours: [asset.openHour ?? 7, asset.closeHour ?? 20],
              upkeep: asset.upkeepPolicy ?? "standard",
              constructionDays: asset.constructionDaysRemaining ?? 0,
              modules: asset.modules?.filter((module) => module.enabled).map((module) => module.kind) ?? [],
              lastDay: asset.lastDay ?? null,
              tenure: asset.tenure ?? "operating",
              developmentId: asset.developmentId ?? null,
              mitigation: asset.mitigationKind ? { kind: asset.mitigationKind, height: asset.coverageHeight ?? 0 } : null,
            })),
            professionals: summary.enterprise.professionals.length,
            membership: summary.enterprise.membership,
            reservations: summary.enterprise.reservations.length,
            reservationDetails: summary.enterprise.reservations.map((reservation) => ({
              id: reservation.id,
              propertyId: reservation.assetId,
              package: reservation.package,
              status: reservation.status ?? "booked",
              segment: reservation.travelerSegment ?? "tourist",
              rooms: reservation.roomCount ?? 1,
              guests: reservation.partySize ?? 1,
              checkIn: [reservation.checkInWeek ?? reservation.week, reservation.checkInDay ?? 0],
              checkOut: [reservation.checkOutWeek ?? reservation.week, reservation.checkOutDay ?? 6],
              transport: reservation.transportMode ?? "self_drive",
              itinerary: reservation.entitlements?.map((entitlement) => ({ kind: entitlement.kind, status: entitlement.status ?? (entitlement.redeemed ? "fulfilled" : "pending") })) ?? [],
              folioTotal: (reservation.folio ?? []).reduce((sum, item) => sum + item.amount, 0),
              refund: reservation.refund ?? 0,
            })),
            resort: summary.resortMetrics,
            outings: summary.enterprise.outings.filter((outing) => outing.status === "scheduled").length,
            occupiedHomes: summary.occupiedHomes,
            complaints: summary.openComplaints,
            communitySatisfaction: summary.communitySatisfaction,
            developments: summary.developments.map((development) => ({ id: development.id, assetId: development.assetId, strategy: development.strategy, status: development.status, constructionDays: development.constructionDaysRemaining, releaseDays: development.releaseDaysRemaining, unitIds: development.unitIds })),
            units: summary.units.map((unit) => ({ id: unit.id, developmentId: unit.developmentId, status: unit.status, tenure: unit.tenure, householdId: unit.householdId ?? null, marketValue: unit.marketValue, rent: unit.weeklyRent ?? 0 })),
            easements: summary.easements.map((easement) => ({ id: easement.id, kind: easement.kind, protected: easement.protected, bounds: [easement.x, easement.y, easement.width, easement.height] })),
            safety: { score: summary.safety.score, eligibility: summary.safety.eligibility, expected: summary.safety.expectedExposure, outlier: summary.safety.outlierExposure, mitigation: summary.safety.mitigation, setback: summary.safety.measuredSetback, heatCells: summary.safety.heatmap.length, blockingReasons: summary.safety.blockingReasons, policy: summary.safetyPolicy },
            households: summary.enterprise.residents.map((resident) => ({ id: resident.id, home: resident.unitIds?.[0] ?? resident.assetId, archetype: resident.archetype ?? "resident", satisfaction: resident.satisfaction, complaints: resident.complaints, advocacy: resident.advocacy ?? 0, opposition: resident.opposition ?? 0 })),
            complaintDetails: summary.enterprise.complaints.slice(-10).map((complaint) => ({ id: complaint.id, source: complaint.source, severity: complaint.severity, recurrence: complaint.recurrence, status: complaint.status, sourceId: complaint.sourceId ?? null })),
            claims: summary.enterprise.claims.slice(-10).map((claim) => ({ id: claim.id, incidentId: claim.incidentId, status: claim.status, damage: claim.damage, playerPayment: claim.playerPayment, insurerPayment: claim.insurerPayment, priorWarnings: claim.priorWarnings })),
            insurance: summary.enterprise.insurance,
            recentRevenue: summary.recentRevenue,
            recentCosts: summary.recentCosts,
            incidents: summary.enterprise.incidents.slice(-5),
          };
        })(),
      },
      camera: {
        center: minimapView?.center ?? audioCameraCenter,
        zoom: minimapView?.zoom ?? null,
        rotation: minimapView?.rotation ?? 0,
        visibleEstateBounds: minimapView?.bounds ?? null,
        viewMode,
        renderer: "pixi",
        regionalSurround: true,
        reference: m52ReferenceCamera ? {
          id: m52ReferenceCamera.id,
          view: m52ReferenceCamera.view,
          focus: m52ReferenceCamera.focus,
          expectedCenter: m52ReferenceCamera.center,
          expectedZoom: m52ReferenceCamera.zoom,
          expectedRotation: m52ReferenceCamera.rotation * 90,
        } : null,
      },
      simulation: { speed: live.speed, dayMinute: live.status.dayMinute, clock: live.status.clockLabel, onCourse: live.status.onCourse, roundsToday: live.status.roundsToday, arrivalsRemaining: live.status.arrivalsRemaining, weekReport: pendingWeekReport ? { week: pendingWeekReport.week, profit: pendingWeekReport.result.profit, weather: pendingWeekReport.result.weatherSummary ?? null } : null, overviewOpen: showLiveOverview, following: followSelected ? live.selectedId : null, pace: live.status.pace, golfers: live.status.golfers.map((golfer) => ({ id: golfer.id, courseId: golfer.courseId, currentHoleId: golfer.currentHoleId, scoreToPar: golfer.scoreToPar })) },
      seasons: (() => {
        const state = seasonalState(world, course, live.status.dayIndex);
        return {
          panelOpen: showSeasonsLegacy,
          calendar: seasonalPresentation.climate.calendar,
          weather: seasonalPresentation.weather,
          modifiers: seasonalPresentation.modifiers,
          forecast: state.forecast,
          charter: state.charter,
          automation: state.automation,
          operations: state.operations,
          yearbooks: state.yearbooks.map((book) => ({ id: book.id, year: book.year, charter: book.charter, awards: book.awards, ranking: book.rankings.find((ranking) => ranking.player)?.rank ?? null, dismissed: book.dismissed })),
          timelineEntries: state.timeline.length,
          hallOfFame: state.hallOfFame.length,
          presentation: {
            climate: seasonalPresentation.climate,
            weather: seasonalPresentation.weather,
            modifiers: seasonalPresentation.modifiers,
            condition: seasonalPresentation.condition,
            maintenance: seasonalPresentation.maintenance,
            activeLayers: seasonalPresentation.activeLayers,
            renderer: seasonalPresentation.renderer,
            audio: seasonalPresentation.audio,
            terrain: seasonalTerrainSummary(
              seasonalPresentation,
              resolvedGraphicsQuality,
              appProfile.accessibility.colorVision,
              appProfile.accessibility.reducedMotion,
            ),
          },
        };
      })(),
      economy: { cash: world.cash, reputation: world.reputation, condition: world.isBankrupt ? "bankrupt" : course.condition },
      architectureReview: {
        panelOpen: showArchitectureReview,
        filters: architectureReview.filters,
        status: architectureReview.status,
        currentEvidence: architectureReview.currentEvidence,
        historicalEvidence: architectureReview.historicalEvidence,
        strategic: {
          score: architectureReview.strategic.summary.total,
          fairnessFloor: architectureReview.strategic.summary.fairnessFloor,
          genuineChoice: architectureReview.strategic.summary.genuineChoice,
          opportunityRotation: architectureReview.strategic.summary.opportunityRotation,
          recommendations: architectureReview.recommendations.length,
        },
        selectedTraceId: architectureReview.selectedTraceId,
        overlay: {
          kind: architectureReview.overlay.kind,
          traces: architectureReview.overlay.traces.length,
          cells: architectureReview.overlay.cells.length,
          points: architectureReview.overlay.points.length,
        },
        greenStrategy: architectureReview.greenStrategy ? {
          evidenceSource: architectureReview.greenStrategy.evidenceSource,
          forecastGeometryVersion: architectureReview.greenStrategy.forecastGeometryVersion,
          maintenanceProgram: architectureReview.greenStrategy.maintenanceProgram,
          selectedPins: architectureReview.greenStrategy.selectedPins,
          selectedCohorts: architectureReview.greenStrategy.selectedCohorts,
          predictiveSamples: architectureReview.greenStrategy.predictiveSamples,
          observedCurrent: architectureReview.greenStrategy.observedCurrent,
          observedHistorical: architectureReview.greenStrategy.observedHistorical,
          observedGeometryVersions: architectureReview.greenStrategy.observedGeometryVersions,
          report: architectureReview.greenStrategy.report,
          recommendations: architectureReview.greenStrategy.recommendations.map((item) => ({ id: item.id, kind: item.kind, holeId: item.holeId, severity: item.severity, metric: item.metric })),
          legend: architectureReview.greenStrategy.legend,
          textSummary: architectureReview.greenStrategy.textSummary,
          reducedMotionSafe: architectureReview.greenStrategy.reducedMotionSafe,
        } : null,
        returnToDesign: architectureReview.returnToDesign ? {
          holeId: architectureReview.returnToDesign.holeId,
          geometryVersion: architectureReview.returnToDesign.geometryVersion,
          currentGeometry: architectureReview.returnToDesign.geometryVersion === architectureReview.currentGeometryVersion,
          point: architectureReview.returnToDesign.point,
        } : null,
        revisions: architectureReview.revisions.map((revision) => ({
          geometryVersion: revision.geometryVersion,
          rounds: revision.rounds,
          shots: revision.shots,
          averageToPar: revision.averageToPar,
        })),
      },
      livingClub: (() => {
        const living = normalizeLivingClub(world.livingClub);
        return {
          panelOpen: showLivingClub,
          regulars: living.regulars.map((regular) => ({
            id: regular.id,
            name: regular.name,
            archetype: regular.archetype,
            rounds: regular.rounds,
            loyalty: regular.loyalty,
            relationship: regular.relationship,
            memories: regular.memories.length,
          })),
          staff: (world.staffRoster ?? []).map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            proficiency: member.proficiency ?? null,
            morale: member.morale ?? null,
          })),
          pendingStories: living.story.instances.filter((instance) => ["pending", "presented", "deferred"].includes(instance.status)).map((instance) => ({
            id: instance.id,
            definitionId: instance.definitionId,
            priority: instance.priority,
            status: instance.status,
          })),
          journalEntries: living.story.journal.length,
        };
      })(),
      progression: { panelOpen: showProgression, tier: reputationTier(world.reputation).id, staffCap: reputationTier(world.reputation).staffCap, buildingTierCap: reputationTier(world.reputation).buildingTierCap },
      campaign: world.campaign ? {
        panelOpen: showCampaign,
        chapterId: world.campaign.chapterId,
        phaseIndex: world.campaign.phaseIndex,
        pendingSceneId: world.campaign.pendingSceneIds[0] ?? null,
        choices: world.campaign.choices,
        priorChoices: world.campaign.priorChoices.length,
        relationships: world.campaign.relationships,
        eventPool: world.campaign.eventPool,
        matches: world.campaign.matches,
        pendingCallbacks: world.campaign.scheduledScenes.length,
        completed: world.campaign.completed,
        medal: world.campaign.medal ?? null,
        outcome: world.campaign.outcome ?? null,
        epilogueFacts: world.campaign.epilogueFacts,
      } : null,
      playerPro: {
        panelOpen: showPlayerPro,
        identity: playerPro.identity,
        skills: playerPro.skills,
        techniques: playerPro.unlockedTechniques,
        careerPoints: playerPro.careerPoints,
        earnings: playerPro.earnings,
        rounds: playerPro.rounds.length,
        latestCompletedRound: textCompletedRound(lastItem(playerPro.rounds)),
        activeRound: activePlayerRound ? {
          id: activePlayerRound.id,
          kind: activePlayerRound.kind,
          phase: activePlayerRound.phase,
          courseId: activePlayerRound.course.courseId,
          currentHole: activePlayerRound.currentHoleIndex + 1,
          holes: activePlayerRound.course.holes.length,
          ball: activePlayerRound.ball,
          lie: activePlayerRound.lie,
          aim: playerShotAim,
          strokes: activePlayerRound.strokes,
          penalties: activePlayerRound.penalties,
          caddieGuidance: textCaddieGuidance ? {
            selection: textCaddieGuidance.selection,
            risk: textCaddieGuidance.preview.risk,
            expectedPenalty: textCaddieGuidance.preview.expectedPenalty,
            shotSlope: textCaddieGuidance.shotSlope,
          } : null,
          scorecard: activePlayerRound.scorecard,
          rulesSnapshot: textRulesSnapshot(activePlayerRound.rulesSnapshot),
          pendingShot: textShotTrace(activePlayerRound.pendingShot),
          recentTrace: textShotTrace(lastItem(activePlayerRound.shots)),
          editingLocked: playerRoundLocksEditing,
        } : null,
      },
      editor: {
        mode: editorMode,
        terrainTool,
        selectedTerrain: selected,
        designDockVisible: workspace === "design" && !photoMode && !playerRoundLocksEditing,
        selectedDesignItem: selectedDesignItemId,
        selectedPlantId,
        selectedDecoration: decorationKind,
        decorationRotation,
        decorationSpan,
        decorationAction,
        activeHole: activeHoleIndex + 1,
        selectedTeeSet,
        setupPlacement: setupPlacement ? { kind: setupPlacement.kind, key: setupPlacement.key } : null,
        teePlacementPending: pendingTeePlacement ? { teeSet: pendingTeePlacement.teeSet, point: pendingTeePlacement.point, netCost: pendingTeePlacement.netCost } : null,
        fineGreen: {
          brush: fineGreenBrush,
          radius: fineGreenRadius,
          shapedTiles: course.greenSurface?.tiles.length ?? 0,
        },
      },
      graphics: { quality: appProfile.graphics.quality, resolvedQuality: resolvedGraphicsQuality, animations: effectiveAnimations, waterAnimation: effectiveAnimations && appProfile.graphics.waterAnimation, treeSway: effectiveAnimations && appProfile.graphics.treeSway },
      retention: { photoMode, recordsOpen: showRetention, achievementsEarned: appProfile.achievements.earned.length, totalRounds: records.totalRounds, aces: records.aces.length, tickerVisible: appProfile.gameplay.tickerVisible },
      tournament: {
        panelOpen: showTournaments,
        scheduled: tournamentCalendar(world).events.filter((event) => event.status === "scheduled").length,
        cancelled: tournamentCalendar(world).events.filter((event) => event.status === "cancelled").length,
        warnings: tournamentCalendar(world).events.filter((event) => event.status === "scheduled" && event.warning).map((event) => ({ name: event.name, warning: event.warning })),
        readiness: tournamentReadiness,
        active: live.status.tournament ? { name: live.status.tournament.name, teeSet: live.status.tournament.teeSet, pinRotation: live.status.tournament.pinRotation, standings: live.status.tournament.standings.slice(0, 5) } : null,
      },
      golfers: live.golfersRef.current.slice(0, 24).map((golfer) => {
        const latestOutcome = lastItem(liveStateById.get(golfer.id)?.shotOutcomes);
        return {
          id: golfer.id,
          x: Number(golfer.x.toFixed(2)),
          y: Number(golfer.y.toFixed(2)),
          segment: golfer.segKind,
          shot: golfer.shot,
          mood: Number(golfer.mood.toFixed(2)),
          teeSet: golfer.teeSet,
          pinRotation: golfer.pinRotation,
          latestSharedOutcome: textSharedOutcome(latestOutcome?.sharedOutcome),
          latestRuling: latestOutcome?.sharedOutcome?.ruling ?? null,
          latestShotSlope: latestOutcome?.shotSlope ?? null,
          latestSlopeExplanation: latestOutcome?.slopeExplanation ?? null,
          latestLanding: latestOutcome?.landing ?? null,
          latestRest: latestOutcome?.rest ?? null,
        };
      }),
    });
    window.render_game_to_text = renderText;
    window.advanceTime = live.advanceTime;
    return () => {
      if (window.render_game_to_text === renderText) delete window.render_game_to_text;
      if (window.advanceTime === live.advanceTime) delete window.advanceTime;
    };
  }, [activeHoleIndex, activeLayout.id, activeOperatingCourse, activePlayerRound, architectureReport, architectureReview, appProfile.accessibility.colorVision, appProfile.accessibility.reducedMotion, appProfile.achievements.earned.length, appProfile.gameplay.tickerVisible, appProfile.graphics.quality, appProfile.graphics.treeSway, appProfile.graphics.waterAnimation, audioCameraCenter, course, decorationAction, decorationKind, decorationRotation, decorationSpan, editorMode, effectiveAnimations, fineGreenBrush, fineGreenRadius, flow.base, flow.modal, flow.paused, followSelected, live, m52ReferenceCamera, minimapView, pendingTeePlacement, pendingWeekReport, photoMode, playerPro, playerRoundLocksEditing, playerShotAim, records, resolvedGraphicsQuality, screen, seasonalPresentation, selected, selectedDesignItemId, selectedParcelId, selectedPlantId, selectedTeeSet, setupPlacement, showArchitectureReview, showCampaign, showCourseManager, showLandOffice, showLivingClub, showLiveOverview, showPlayerPro, showProgression, showPropertyManagement, showRetention, showSeasonsLegacy, showTournaments, terrainTool, tutorialProgress?.stepIndex, viewMode, workspace, world]);

  useEffect(() => {
    if (import.meta.env.MODE !== "e2e") return;
    window.__coursecraftTest = {
      state: () => {
        const current = gameSession.getState();
        const liveSnapshot = live.getSnapshot();
        return {
          screen,
          screenBase: flow.base,
          paused: flow.paused,
          modal: flow.modal,
          dirty,
          speed: live.speed,
          dayMinute: liveSnapshot?.state.dayMinute ?? 0,
          weekReportOpen: pendingWeekReport != null,
          golferPositions: liveSnapshot?.state.golfers.map((golfer) => [golfer.id, golfer.pos.x, golfer.pos.y]) ?? [],
          week: current.world.week,
          cash: current.world.cash,
          terrainVersion: current.terrainVersion,
          economyVersion: current.economyVersion,
          loadingContext: pendingLoadingContext,
          terrainCounts: current.course.tiles.reduce((counts, terrain) => ({
            ...counts,
            [terrain]: (counts[terrain] ?? 0) + 1,
          }), {} as Partial<Record<Terrain, number>>),
          courseHash: hashGameState({ course: current.course, world: current.world, live: liveSnapshot }),
        };
      },
      seedLoadingSaveFixture: async (options) => {
        const theme = isLandTheme(options.theme) ? options.theme : BIOME_KEYS[0];
        const week = Math.max(1, Math.floor(options.week));
        const dayIndex = Math.max(0, Math.min(6, Math.floor(options.dayIndex)));
        const run = createNewGame({
          mode: "sandbox",
          courseName: `ZK-626 ${theme} loading save`,
          seed: 626_000 + week * 10 + dayIndex,
          theme,
          difficulty: "normal",
        });
        const saveWorld = {
          ...run.world,
          week,
          seasonal: createSeasonalState({
            runSeed: run.world.runSeed,
            theme,
            week,
            day: dayIndex,
          }),
        };
        const payload: SavePayload = {
          course: run.course,
          world: saveWorld,
          history: [],
          live: snapshotLiveSimulation({
            state: createLiveState(run.course, saveWorld, dayIndex),
            pendingCash: 0,
            speed: "paused",
            selectedGolferId: null,
          }),
          records: emptyCourseRecords(run.course.holes.length),
          tutorial: null,
        };
        const meta = await saveToSlot(
          options.id,
          "manual",
          `ZK-626 ${options.id}`,
          payload,
        );
        if (options.omitManifestTheme) await __omitSlotThemeForTests(meta.id);
        if (options.deletePayload) await __deleteSlotPayloadForTests(meta.id);
        return { id: meta.id, context: savedLoadingBiomeContext(payload) };
      },
      returnToTitle: () => {
        live.setSpeed("paused");
        setPendingLoadingContext(null);
        flowDispatch({ type: "BACK_TO_TITLE" });
      },
      terrainSurfaceState: () => {
        const current = gameSession.getState().course;
        const scoredHoles = scoreCourseHoles(current).holes;
        return {
          width: current.width,
          height: current.height,
          tiles: [...current.tiles],
          effectiveTiles: [...effectiveSurfaceTiles(current)],
          elevations: [...current.elevations],
          owned: current.tiles.map((_, index) => isOwnedTile(
            current,
            index % current.width,
            Math.floor(index / current.width),
          )),
          holes: current.holes.map((hole, index) => ({
            tee: hole.tee ? { ...hole.tee } : null,
            green: hole.green ? { ...hole.green } : null,
            valid: Boolean(scoredHoles[index]?.isValid),
            issues: [...(scoredHoles[index]?.issues ?? [])],
          })),
          obstacles: current.obstacles.map((obstacle) => ({ ...obstacle })),
          greenSurface: current.greenSurface
            ? structuredClone(current.greenSurface)
            : null,
          features: (current.surfaceIntent?.features ?? []).map((feature) => ({
            id: feature.id,
            terrain: feature.terrain,
            kind: feature.geometry.kind,
            points: (feature.geometry.kind === "corridor"
              ? feature.geometry.knots
              : feature.geometry.ring).map((point) => ({ ...point })),
            tangents: feature.geometry.tangents?.map((handles) => ({
              in: { ...handles.in },
              out: { ...handles.out },
            })) ?? null,
            width: feature.geometry.kind === "corridor" ? feature.geometry.width : null,
            coverage: [...feature.coverage],
            renderRings: feature.renderRings?.map((ring) => ring.map((point) => ({ ...point }))) ?? [],
          })),
        };
      },
      m35Metrics: m35TelemetrySnapshot,
      resetM35Metrics: resetM35Telemetry,
      setPaintCash: (cash: number) => {
        gameSession.update((current) => ({ ...current, world: { ...current.world, cash } }));
      },
      setPropertyFixture: () => {
        const fixtureCourse = { ...createReferenceCourse(), property: starterPropertyCourse() };
        const fixtureWorld = { ...gameSession.getState().world, cash: 1_000_000, reputation: 82, enterprise: emptyPropertyEnterprise(), isBankrupt: false, distressWeeks: 0 };
        dispatch({ type: "LOAD_GAME", course: fixtureCourse, world: fixtureWorld });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(fixtureCourse, fixtureWorld, 0), pendingCash: 0, speed: "paused", selectedGolferId: null }));
      },
      setPlayerProFixture: () => {
        const fixtureCourse = createPlayerProReferenceCourse();
        const fixtureWorld = {
          ...gameSession.getState().world,
          cash: 250_000,
          reputation: 75,
          runSeed: 360037,
          isBankrupt: false,
          distressWeeks: 0,
          playerPro: createDefaultPlayerPro({ seed: 360037, name: "Casey Fairway", background: "architect" }),
        };
        dispatch({ type: "LOAD_GAME", course: fixtureCourse, world: fixtureWorld });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(fixtureCourse, fixtureWorld, 0), pendingCash: 0, speed: "paused", selectedGolferId: null }));
        setShowPlayerPro(false);
        setPlayerShotAim(null);
      },
      setM39Fixture: () => {
        const fixtureCourse = createPlayerProReferenceCourse();
        const baseWorld: World = {
          ...gameSession.getState().world,
          week: 32,
          cash: 750_000,
          reputation: 84,
          runSeed: 390040,
          isBankrupt: false,
          distressWeeks: 0,
          seasonal: {
            ...createSeasonalState({ runSeed: 390040, theme: fixtureCourse.theme, week: 32, day: 6 }),
            charter: "destination-retreat",
            lastCommittedAbsoluteDay: absoluteDayFor(32, 5),
          },
        };
        const fixture = advanceSeasonalDay(fixtureCourse, baseWorld, 6);
        dispatch({ type: "LOAD_GAME", course: fixture.course, world: fixture.world });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(fixture.course, fixture.world, 6), pendingCash: 0, speed: "paused", selectedGolferId: null }));
        setShowSeasonsLegacy(true);
      },
      setM53SeasonalFixture: (season: SeasonName) => {
        if (!SEASONS.includes(season)) throw new Error(`Unknown M53 season "${season}"`);
        const current = gameSession.getState();
        const biome = current.course.theme ?? BIOME_KEYS[0];
        const fixture = M53_SEVERE_WEATHER_FIXTURES[biome][season];
        const dayOfWeek = fixture.absoluteDay % 7;
        const week = Math.floor(fixture.absoluteDay / 7) + 1;
        const nextWorld: World = {
          ...current.world,
          week,
          runSeed: fixture.seed,
          seasonal: createSeasonalState({
            runSeed: fixture.seed,
            theme: biome,
            week,
            day: dayOfWeek,
          }),
        };
        // Preserve the mounted Course and its tile/elevation array identities;
        // this hook exists specifically to exercise presentation cache
        // invalidation without a navigation, course load, or canvas remount.
        setWorld(() => nextWorld);
        live.restoreSnapshot(snapshotLiveSimulation({
          state: createLiveState(current.course, nextWorld, dayOfWeek),
          pendingCash: 0,
          speed: "paused",
          selectedGolferId: null,
        }));
      },
      setM53SurfaceCareFixture: (
        mode: "evidence" | "resolved" | "healthy" | "cue-only" | "mowing" = "evidence",
      ) => {
        const current = gameSession.getState();
        const nextCourse = mode === "resolved"
          ? resolveM53SurfaceCarePresentationFixture(current.course)
          : mode === "evidence"
            ? createM53SurfaceCarePresentationFixture(current.course)
            : createM53SurfaceCareRoutineFixture(current.course, mode);
        dispatch({ type: "LOAD_GAME", course: nextCourse, world: current.world });
        live.restoreSnapshot(snapshotLiveSimulation({
          state: createLiveState(
            nextCourse,
            current.world,
            0,
          ),
          pendingCash: 0,
          speed: "paused",
          selectedGolferId: null,
        }));
      },
      setM52ReferenceBookmark: (view, rotation) => {
        const bookmark = biomeCameraBookmarks(gameSession.getState().course).find((candidate) =>
          candidate.view === view && candidate.rotation === rotation);
        if (!bookmark) throw new Error(`Unknown ZK-564 reference bookmark ${view}-r${rotation}`);
        setM52ReferenceCamera(bookmark);
      },
      startWeekCloseFixture: async (weekOverride?: number) => {
        const course = gameSession.getState().course;
        const world = { ...gameSession.getState().world, week: weekOverride ?? gameSession.getState().world.week, cash: Math.max(100_000, gameSession.getState().world.cash), runSeed: 424242, isBankrupt: false, distressWeeks: 0 };
        dispatch({ type: "LOAD_GAME", course, world });
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const state = createLiveState(course, world, 6);
        state.arrivals = [];
        state.nextArrivalIdx = 0;
        state.golfers = [];
        state.dayMinute = LIVE.day.closeMinute;
        let weekLedger = createWeekLedger(world.week);
        for (let dayIndex = 0; dayIndex < 6; dayIndex++) weekLedger = appendDayToLedger(weekLedger, {
          dayIndex, rounds: 4, revenue: 400,
          revenueBreakdown: { greenFees: 320, concessions: 80, byConcession: { snack_bar: 80 }, transactions: [] },
          costs: 250, profit: 150, avgSatisfaction: 82, reputationDelta: .25, conditionDelta: -.001,
          promoters: 3, detractors: 0, willReturnRate: .8,
        });
        live.restoreSnapshot(snapshotLiveSimulation({ state, pendingCash: 0, speed: "4x", selectedGolferId: null, weekLedger }));
        live.setSpeed("4x");
      },
      runGoldenWeek: async () => {
        const current = gameSession.getState();
        const course = createReferenceCourse();
        const world = {
          ...current.world,
          week: 1,
          cash: 100_000,
          runSeed: 424242,
          isBankrupt: false,
          distressWeeks: 0,
        };
        const run = runLiveDaysHeadless({ course, world, days: 7 });
        const liveSnapshot = snapshotLiveSimulation({
          state: run.live,
          pendingCash: 0,
          speed: "4x",
          selectedGolferId: null,
        });
        const payload: SavePayload = {
          course: run.course,
          world: run.world,
          history: historyRef.current,
          records: recordsRef.current,
          live: liveSnapshot,
          tutorial: tutorialProgress,
        };
        const beforeHash = hashGameState(payload);
        await saveToSlot("e2e-golden", "manual", "E2E golden path", payload);
        const loaded = await loadSlot("e2e-golden");
        if (!loaded) throw new Error("Golden-path slot failed to reload");
        const afterHash = hashGameState(loaded);
        dispatch({ type: "LOAD_GAME", course: loaded.course, world: loaded.world });
        live.restoreSnapshot(loaded.live);
        setHistory(loaded.history ?? []);
        recordsRef.current = loaded.records ?? emptyCourseRecords(loaded.course.holes.length);
        setRecords(recordsRef.current);
        setLast(loaded.history?.[loaded.history.length - 1]);
        setPrevOutcome(loaded.world.objectives?.outcome ?? "OPEN");
        setShowVictory(false);
        scenarioRecordedRef.current = loaded.world.campaign?.completed ?? loaded.world.objectives?.outcome === "WON";
        setPendingLoadingContext(null);
        flowDispatch({ type: "BACK_TO_TITLE" });
        flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreCourse") });
        setPendingLoadingContext(null);
        flowDispatch({ type: "ENTER_GAME" });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return {
          beforeHash,
          afterHash,
          week: loaded.world.week,
          cash: loaded.world.cash,
          rounds: run.rounds,
        };
      },
      runResortGoldenPath: async () => {
        let fixtureCourse: Course = { ...createReferenceCourse(), property: starterPropertyCourse() };
        let fixtureWorld: World = { ...gameSession.getState().world, cash: 1_000_000, reputation: 82, enterprise: emptyPropertyEnterprise(), isBankrupt: false, distressWeeks: 0 };
        const commands: PropertyCommand[] = [
          { type: "BUILD", kind: "driving_range" },
          { type: "BUILD", kind: "clubhouse" },
          { type: "BUILD", kind: "restaurant" },
          { type: "BUILD", kind: "lodge" },
          { type: "BUILD", kind: "shuttle" },
          { type: "HIRE_SERVICE", role: "frontDesk" },
          { type: "HIRE_SERVICE", role: "housekeeping" },
          { type: "HIRE_SERVICE", role: "maintenance" },
          { type: "HIRE_SERVICE", role: "concierge" },
          { type: "HIRE_SERVICE", role: "foodService" },
          { type: "HIRE_SERVICE", role: "shuttleDrivers" },
          { type: "BOOK_PACKAGE", package: "stay_and_play" },
        ];
        for (const command of commands) {
          const result = applyPropertyCommand(fixtureCourse, fixtureWorld, command);
          if (!result.ok) throw new Error(result.message);
          fixtureCourse = result.course;
          fixtureWorld = result.world;
        }
        fixtureWorld = {
          ...fixtureWorld,
          enterprise: {
            ...fixtureWorld.enterprise!,
            resort: { ...fixtureWorld.enterprise!.resort, dirtyRooms: 2, serviceQueue: 2 },
          },
        };
        const recovered = applyPropertyCommand(fixtureCourse, fixtureWorld, { type: "RECOVER_SERVICE" });
        if (!recovered.ok) throw new Error(recovered.message);
        fixtureWorld = recovered.world;
        fixtureWorld = { ...fixtureWorld, week: fixtureWorld.week + 1 };
        const arrival = settlePropertyDay(fixtureCourse, fixtureWorld, 0, 0);
        const saveWorld = { ...arrival.world, staffRoster: normalizedStaff(arrival.world, arrival.course) };
        const midStayPayload: SavePayload = {
          course: arrival.course,
          world: saveWorld,
          history: historyRef.current,
          records: recordsRef.current,
          live: snapshotLiveSimulation({ state: createLiveState(arrival.course, saveWorld, 0), pendingCash: 0, speed: "paused", selectedGolferId: null }),
          tutorial: tutorialProgress,
        };
        const beforeHash = hashGameState(midStayPayload);
        await saveToSlot("e2e-m32", "manual", "M32 mid-stay", midStayPayload);
        const loaded = await loadSlot("e2e-m32");
        if (!loaded) throw new Error("M32 mid-stay slot failed to reload");
        const afterHash = hashGameState(loaded);
        const serviceDay = settlePropertyDay(loaded.course, loaded.world, 1, 0);
        const checkout = settlePropertyDay(serviceDay.course, serviceDay.world, 2, 0);
        const reservation = checkout.world.enterprise?.reservations.find((candidate) => candidate.package === "stay_and_play");
        dispatch({ type: "LOAD_GAME", course: checkout.course, world: checkout.world });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(checkout.course, checkout.world, 2), pendingCash: 0, speed: "paused", selectedGolferId: null }));
        return {
          beforeHash,
          afterHash,
          status: reservation?.status ?? "missing",
          fulfilled: reservation?.entitlements?.filter((entitlement) => entitlement.status === "fulfilled").length ?? 0,
          total: reservation?.entitlements?.length ?? 0,
          folioTotal: reservation?.folio?.reduce((sum, item) => sum + item.amount, 0) ?? 0,
          value: reservation?.value ?? 0,
          serviceQueue: checkout.world.enterprise?.resort.serviceQueue ?? -1,
        };
      },
      runM33GoldenPath: async () => {
        let fixtureCourse: Course = { ...createReferenceCourse(), property: starterPropertyCourse() };
        let fixtureWorld: World = { ...gameSession.getState().world, cash: 2_000_000, reputation: 86, enterprise: emptyPropertyEnterprise(), isBankrupt: false, distressWeeks: 0, week: 3 };
        const runCommand = (command: PropertyCommand) => {
          const result = applyPropertyCommand(fixtureCourse, fixtureWorld, command);
          if (!result.ok) throw new Error(result.message);
          fixtureCourse = result.course;
          fixtureWorld = result.world;
        };
        runCommand({ type: "BUILD", kind: "driving_range" });
        runCommand({ type: "BUILD", kind: "clubhouse" });
        runCommand({ type: "BUILD", kind: "restaurant" });
        runCommand({ type: "HIRE_SERVICE", role: "foodService" });
        runCommand({ type: "LAUNCH_MEMBERSHIP" });
        runCommand({ type: "BUILD", kind: "safety_buffer" });
        runCommand({ type: "BUILD", kind: "netting" });
        runCommand({ type: "PLAN_DEVELOPMENT", kind: "houses", strategy: "retain", confirmed: true });
        for (let day = 0; day < 5; day++) {
          const result = settlePropertyDay(fixtureCourse, fixtureWorld, day, 0);
          fixtureCourse = result.course;
          fixtureWorld = { ...result.world, cash: result.world.cash + result.report.revenue - result.report.costs };
        }
        const home = fixtureCourse.property!.assets.find((asset) => asset.kind === "houses");
        if (!home) throw new Error("M33 phase did not create a residential asset");
        const safetyAssets = fixtureCourse.property!.assets.filter((asset) => asset.category === "safety");
        for (const asset of safetyAssets) runCommand({ type: "TOGGLE", assetId: asset.id });
        const riskWithoutMitigation = analyzeResidentialSafety(fixtureCourse, home.id).score;
        const center = { x: home.x + home.width / 2, y: home.y + home.height / 2 };
        const incidentDay = 5;
        const sequence = fixtureWorld.enterprise!.sequence;
        fixtureWorld = { ...fixtureWorld, runSeed: (1000 - ((fixtureWorld.week * 31 + incidentDay * 17 + sequence * 13) % 1000)) % 1000 };
        const incident = settlePropertyDay(fixtureCourse, fixtureWorld, incidentDay, 1, [{
          golferId: 0,
          holeId: "m33-live-hole",
          holeName: "Community 1st",
          teeSet: "member",
          shotType: "drive",
          from: { x: Math.max(0, home.x - 30), y: center.y },
          to: { x: Math.min(fixtureCourse.width - 1, home.x + home.width + 30), y: center.y },
        }]);
        fixtureCourse = incident.course;
        fixtureWorld = { ...incident.world, cash: incident.world.cash + incident.report.revenue - incident.report.costs };
        const midIncidentWorld = { ...fixtureWorld, staffRoster: normalizedStaff(fixtureWorld, fixtureCourse) };
        const midIncidentPayload: SavePayload = {
          course: fixtureCourse,
          world: midIncidentWorld,
          history: historyRef.current,
          records: recordsRef.current,
          live: snapshotLiveSimulation({ state: createLiveState(fixtureCourse, midIncidentWorld, 6), pendingCash: 0, speed: "paused", selectedGolferId: null }),
          tutorial: tutorialProgress,
        };
        const beforeHash = hashGameState(midIncidentPayload);
        await saveToSlot("e2e-m33", "manual", "M33 open resident claim", midIncidentPayload);
        const loadedMidIncident = await loadSlot("e2e-m33");
        if (!loadedMidIncident) throw new Error("M33 open-claim slot failed to reload");
        const afterHash = hashGameState(loadedMidIncident);
        fixtureCourse = loadedMidIncident.course;
        fixtureWorld = loadedMidIncident.world;
        const complaint = lastItem(fixtureWorld.enterprise!.complaints);
        const claim = lastItem(fixtureWorld.enterprise!.claims);
        if (!complaint || !claim) throw new Error("M33 incident did not create its complaint and claim evidence");
        runCommand({ type: "RESPOND_COMPLAINT", complaintId: complaint.id, response: "compensate" });
        runCommand({ type: "FILE_CLAIM", claimId: claim.id });
        runCommand({ type: "SETTLE_CLAIM", claimId: claim.id });
        for (const asset of safetyAssets) runCommand({ type: "TOGGLE", assetId: asset.id });
        const riskWithMitigation = analyzeResidentialSafety(fixtureCourse, home.id).score;
        const finalWorld = { ...fixtureWorld, staffRoster: normalizedStaff(fixtureWorld, fixtureCourse) };
        dispatch({ type: "LOAD_GAME", course: fixtureCourse, world: finalWorld });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(fixtureCourse, finalWorld, 6), pendingCash: 0, speed: "paused", selectedGolferId: null }));
        const loadedProperty = fixtureCourse.property!;
        const loadedEnterprise = finalWorld.enterprise!;
        const realEstateEntries = loadedEnterprise.ledger.filter((entry) => entry.category === "real_estate");
        return {
          beforeHash,
          afterHash,
          strategy: loadedProperty.developments[0]?.strategy ?? "missing",
          status: loadedProperty.developments[0]?.status ?? "missing",
          units: loadedProperty.units.length,
          households: loadedEnterprise.residents.length,
          tenure: loadedProperty.assets.find((asset) => asset.id === home.id)?.tenure ?? "missing",
          incidentKind: lastItem(loadedEnterprise.incidents)?.kind ?? "missing",
          complaintStatus: lastItem(loadedEnterprise.complaints)?.status ?? "missing",
          claimStatus: lastItem(loadedEnterprise.claims)?.status ?? "missing",
          riskWithoutMitigation,
          riskWithMitigation,
          protectedEasements: loadedProperty.easements.filter((easement) => easement.protected).length,
          realEstateRevenue: realEstateEntries.reduce((sum, entry) => sum + entry.revenue, 0),
          realEstateCosts: realEstateEntries.reduce((sum, entry) => sum + entry.cost, 0),
          residentLocalSpend: loadedEnterprise.residents.reduce((sum, resident) => sum + (resident.localSpend ?? 0), 0),
          residentMembers: loadedEnterprise.customers.filter((customer) => customer.segment === "resident" && customer.member).length,
          cash: finalWorld.cash,
        };
      },
      validateFixture: (text: string) => {
        const result = parseSaveText(text);
        return result.ok
          ? { ok: true as const, migratedFrom: result.migratedFrom ?? null }
          : { ok: false as const, error: result.error.message };
      },
      startTournamentFixture: () => {
        const current = gameSession.getState();
        const fixtureWorld = { ...current.world, tournaments: { version: 2 as const, events: [] } };
        const created = createTournamentEvent({ course: current.course, world: fixtureWorld, tier: "local", currentDay: live.status.dayIndex, daysAhead: 1 });
        if (!created.ok) throw new Error(created.reason);
        const event = { ...created.event, scheduledWeek: current.world.week, scheduledDay: live.status.dayIndex };
        const tournamentWorld = scheduleTournament(fixtureWorld, event);
        dispatch({ type: "LOAD_GAME", course: current.course, world: tournamentWorld });
        live.restoreSnapshot(snapshotLiveSimulation({
          state: createLiveState(current.course, tournamentWorld, live.status.dayIndex),
          pendingCash: 0,
          speed: "4x",
          selectedGolferId: null,
        }));
        live.setSpeed("4x");
      },
      invalidateAndCancelTournamentFixture: () => {
        const current = gameSession.getState();
        const editedCourse = { ...current.course, holes: current.course.holes.map((hole) => ({ ...hole, pinPositions: { ...hole.pinPositions, B: null, C: null } })) };
        const warnedWorld = revalidateScheduledTournaments(editedCourse, current.world);
        const scheduled = tournamentCalendar(warnedWorld).events.find((event) => event.status === "scheduled");
        if (!scheduled) throw new Error("No scheduled tournament to invalidate");
        const eventWorld = { ...warnedWorld, week: scheduled.scheduledWeek };
        const prepared = prepareTournamentDay(editedCourse, eventWorld, scheduled.scheduledDay);
        dispatch({ type: "LOAD_GAME", course: editedCourse, world: prepared.world });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(editedCourse, prepared.world, scheduled.scheduledDay), pendingCash: 0, speed: "paused", selectedGolferId: null }));
      },
    };
    return () => {
      delete window.__coursecraftTest;
    };
  }, [dispatch, dirty, flow.base, flow.modal, flow.paused, gameSession, live, pendingLoadingContext, pendingWeekReport, screen, setWorld, t, tutorialProgress]);

  function newGameFromMenu() {
    void audio.unlock();
    flowDispatch({ type: "OPEN_SETUP" });
  }

  function startNewGame(setup: GameSetup) {
    void audio.unlock();
    void audio.playSfx("confirm");
    setPendingLoadingContext(neutralLoadingBiomeContext(setup.theme));
    flowDispatch({ type: "BEGIN_LOADING", label: t("loading.growCourse") });
    window.setTimeout(() => {
      restartRun(setup);
      live.setSpeed(appProfile.gameplay.defaultGameSpeed);
      setPendingLoadingContext(null);
      flowDispatch({ type: "ENTER_GAME" });
    }, 0);
  }

  function loadFromMenu() {
    void audio.unlock();
    setSaveModalCanSave(false);
    flowDispatch({ type: "OPEN_MODAL", modal: "save-load" });
  }

  async function continueFromMenu() {
    void audio.unlock();
    const recent = await mostRecentSlot();
    if (!recent) {
      setPendingLoadingContext(null);
      return;
    }
    setPendingLoadingContext(neutralLoadingBiomeContext(recent.theme));
    flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreLatest") });
    const loaded = await loadSlot(recent.id);
    if (!loaded) {
      setPendingLoadingContext(null);
      flowDispatch({ type: "BACK_TO_TITLE" });
      return;
    }
    setPendingLoadingContext(savedLoadingBiomeContext(loaded));
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const applied = applyLoadedGame(loaded);
        setPendingLoadingContext(null);
        flowDispatch({ type: applied ? "ENTER_GAME" : "BACK_TO_TITLE" });
      }, 0);
    });
  }

  function takeBridgeLoan() {
    if (!eligibleBridge) return;
    dispatch({ type: "TAKE_LOAN", kind: "BRIDGE" });
    setShowBridgePrompt(false);
  }

  function takeExpansionLoan() {
    if (!canTakeExpansionLoan(course, world, BALANCE)) return;
    dispatch({ type: "TAKE_LOAN", kind: "EXPANSION" });
  }

  function purchaseParcel(parcelId: string) {
    const parcel = course.estate?.parcels.find((entry) => entry.id === parcelId);
    if (!parcel) return;
    dispatch({ type: "PURCHASE_PARCEL", parcelId });
    setA11yMessage(t("land.purchased", { name: parcel.name }));
    setPaintError(null);
  }

  function applyTileChange(idx: number, next: Terrain, opts?: { silent?: boolean }): boolean {
    if (world.isBankrupt) return false;
    if (!isTerrainUnlocked(next, world.reputation)) {
      setPaintError(t("progression.locked", { reputation: terrainMinReputation(next) }));
      return false;
    }
    const x = idx % course.width;
    const y = Math.floor(idx / course.width);
    if (!isOwnedTile(course, x, y)) {
      if (!opts?.silent) setPaintError(t("land.buildBlocked"));
      return false;
    }
    const preview = previewTerrainStroke(
      course,
      [{ x, y }],
      next,
      world.cash,
      costMult,
      world.reputation,
      world.constraints?.protectedTrees,
      {
        season: seasonalPresentation.climate.calendar.season,
        currentWeather: seasonalPresentation.weather,
        publishedForecast: world.seasonal?.forecast ?? [],
        waterPolicy: world.seasonal?.operations.waterPolicy,
      },
    );
    if (!preview.affordable) {
      setPaintError(t("error.insufficientFunds", {
        amount: formatCurrency(Math.ceil(preview.net)),
      }));
      return false;
    }
    if (
      preview.changedCount === 0
      && preview.elevationDeltas.length === 0
      && preview.removedObstacles.length === 0
    ) {
      if (preview.excluded.protected > 0 && !opts?.silent) {
        setPaintError(t("terrainStroke.protectedIsland"));
      }
      return preview.excludedCount === 0;
    }

    // Dispatch PAINT_TILES action
    dispatch({
      type: "PAINT_TILES",
      tiles: preview.acceptedTiles,
    });

    // Track capital spending since last simulate (separate from game state)
    setCapital((c) => ({
      spent: c.spent + preview.charged,
      refunded: c.refunded + preview.refunded,
      byTerrainSpent: {
        ...c.byTerrainSpent,
        [next]: (c.byTerrainSpent[next] ?? 0) + preview.charged,
      },
      byTerrainTiles: {
        ...c.byTerrainTiles,
        [next]: (c.byTerrainTiles[next] ?? 0) + preview.changedCount,
      },
    }));
    setPaintError(null);
    if (!opts?.silent) void audio.playSfx("brush");
    return true;
  }

  function applyTerrainAt(x: number, y: number, next: Terrain, opts?: { silent?: boolean }) {
    const idx = y * course.width + x;
    applyTileChange(idx, next, opts);
  }

  const buildTerrainSurfaceFeature = useCallback((points: Point[]) => {
    const maxKnots = 128;
    const stride = Math.max(1, Math.ceil(points.length / maxKnots));
    const sampled = points
      .filter((_, index) => index % stride === 0 || index === points.length - 1)
      .map((point) => ({ ...point }));
    if (sampled.length === 1) {
      sampled[0] = {
        x: Math.floor(sampled[0].x) + 0.5,
        y: Math.floor(sampled[0].y) + 0.5,
      };
    }
    let knots = terrainTool === "spline"
      ? sampled
      : simplifySurfacePoints(sampled, terrainTool === "area" ? 0.28 : 0.42);
    if (terrainTool === "area" && knots.length >= 3) {
      const first = knots[0];
      const last = knots[knots.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) <= 1) {
        knots = [...knots.slice(0, -1), { ...first }];
      }
    }
    const feature = terrainTool === "area" && knots.length >= 3
      ? regionFeature(course, selected, knots)
      : corridorFeature(course, selected, knots, Math.max(0.9, terrainBrushWidth));
    const raster = rasterizeSurfaceFeatureDetailed(feature, course.width, course.height);
    const coveragePoints = raster.tiles;
    feature.coverage = coveragePoints.map((point) => point.y * course.width + point.x);
    feature.renderRings = raster.rings;
    return { feature, coveragePoints };
  }, [course, selected, terrainBrushWidth, terrainTool]);

  const getTerrainStrokePreview = useCallback((points: Point[]): TerrainStrokePreview => {
    const { coveragePoints } = buildTerrainSurfaceFeature(points);
    return previewTerrainStroke(
      course,
      coveragePoints,
      selected,
      world.cash,
      costMult,
      world.reputation,
      world.constraints?.protectedTrees,
      {
        season: seasonalPresentation.climate.calendar.season,
        currentWeather: seasonalPresentation.weather,
        publishedForecast: world.seasonal?.forecast ?? [],
        waterPolicy: world.seasonal?.operations.waterPolicy,
      },
    );
  }, [
    buildTerrainSurfaceFeature,
    course,
    selected,
    world.cash,
    costMult,
    world.reputation,
    world.constraints?.protectedTrees,
    world.seasonal?.forecast,
    world.seasonal?.operations.waterPolicy,
    seasonalPresentation.climate.calendar.season,
    seasonalPresentation.weather,
  ]);

  const commitTerrainStroke = useCallback((points: Point[]) => {
    if (world.isBankrupt) return;
    const preview = getTerrainStrokePreview(points);
    if (!preview.affordable) {
      setPaintError(
        `Terrain stroke needs ${formatCurrency(Math.ceil(preview.net))}; ` +
        `${formatCurrency(Math.floor(preview.cash))} available (${formatCurrency(Math.ceil(preview.shortfall))} short).`
      );
      return;
    }
    if (
      preview.changedCount === 0
      && preview.elevationDeltas.length === 0
      && preview.removedObstacles.length === 0
    ) {
      if (preview.excluded.locked > 0) {
        setPaintError(t("progression.locked", { reputation: terrainMinReputation(selected) }));
      } else if (preview.excluded.protected > 0) {
        setPaintError(t("terrainStroke.protectedIsland"));
      } else if (preview.excluded.unowned > 0) {
        setPaintError(t("land.buildBlocked"));
      } else {
        setPaintError(null);
      }
      return;
    }

    const { feature } = buildTerrainSurfaceFeature(points);
    const acceptedIndices = new Set(
      preview.acceptedTiles.map((point) => point.y * course.width + point.x),
    );
    const acceptedRaster = rasterizeSurfaceFeatureDetailed(
      feature,
      course.width,
      course.height,
      acceptedIndices,
    );
    feature.coverage = acceptedRaster.tiles.map((point) => point.y * course.width + point.x);
    feature.renderRings = acceptedRaster.rings;
    dispatch({ type: "PAINT_TILES", tiles: preview.acceptedTiles, surfaceFeature: feature });
    setCapital((capital) => ({
      spent: capital.spent + preview.charged,
      refunded: capital.refunded + preview.refunded,
      byTerrainSpent: {
        ...capital.byTerrainSpent,
        [selected]: (capital.byTerrainSpent[selected] ?? 0) + preview.charged,
      },
      byTerrainTiles: {
        ...capital.byTerrainTiles,
        [selected]: (capital.byTerrainTiles[selected] ?? 0) + preview.changedCount,
      },
    }));
    if (preview.excludedCount > 0) {
      setPaintError(
        `Painted ${preview.changedCount} tiles; skipped ${preview.excludedCount} invalid ` +
        `(${preview.excluded.unowned} unowned, ${preview.excluded.outOfBounds} outside, ` +
        `${preview.excluded.locked} locked, ${preview.excluded.protected} protected-tree islands).`
      );
    } else {
      setPaintError(null);
    }
    void audio.playSfx("brush");
  }, [world.isBankrupt, getTerrainStrokePreview, buildTerrainSurfaceFeature, selected, course.width, course.height, dispatch, audio, t]);

  const getFineGreenStrokePreview = useCallback((points: Point[]): FineGreenSculptPreview => (
    computeFineGreenSculptPreview({
      course,
      points,
      brush: fineGreenBrush,
      radius: fineGreenRadius,
      costMult,
    })
  ), [course, costMult, fineGreenBrush, fineGreenRadius]);

  const commitFineGreenStroke = useCallback((points: Point[]) => {
    if (world.isBankrupt) return;
    const preview = getFineGreenStrokePreview(points);
    if (preview.changedSamples === 0) {
      setPaintError(preview.clippedPoints > 0
        ? "Fine contour brushes apply only to existing green terrain."
        : null);
      return;
    }
    if (preview.netCost > world.cash) {
      setPaintError(t("error.earthworksFunds", {
        amount: formatCurrency(Math.ceil(preview.netCost)),
      }));
      return;
    }
    dispatch({ type: "SCULPT_GREEN", surface: preview.surface });
    setCapital((capital) => ({
      ...capital,
      spent: capital.spent + preview.netCost,
    }));
    setPaintError(preview.clippedPoints > 0
      ? `Shaped ${preview.changedSamples} fine samples; clipped ${preview.clippedPoints} off-green points.`
      : null);
    setA11yMessage(`Green contour ${fineGreenBrush} applied to ${preview.changedSamples} samples.`);
    void audio.playSfx("sculpt");
  }, [audio, dispatch, fineGreenBrush, getFineGreenStrokePreview, t, world.cash, world.isBankrupt]);

  const getSurfaceFeatureEditPreview = useCallback((feature: SurfaceFeature): TerrainStrokePreview | null => {
    const startedAt = performance.now();
    const preview = prepareSurfaceFeatureEdit(
      course,
      feature,
      world.cash,
      costMult,
      world.reputation,
      world.constraints?.protectedTrees,
      {
        season: seasonalPresentation.climate.calendar.season,
        currentWeather: seasonalPresentation.weather,
        publishedForecast: world.seasonal?.forecast ?? [],
        waterPolicy: world.seasonal?.operations.waterPolicy,
      },
    )?.preview ?? null;
    recordM35Metric("surfacePreview", performance.now() - startedAt);
    return preview;
  }, [course, world.cash, world.reputation, world.constraints?.protectedTrees, world.seasonal?.forecast, world.seasonal?.operations.waterPolicy, costMult, seasonalPresentation.climate.calendar.season, seasonalPresentation.weather]);

  const commitSurfaceFeatureEdit = useCallback((feature: SurfaceFeature) => {
    const startedAt = performance.now();
    if (world.isBankrupt) return;
    const prepared = prepareSurfaceFeatureEdit(
      course,
      feature,
      world.cash,
      costMult,
      world.reputation,
      world.constraints?.protectedTrees,
      {
        season: seasonalPresentation.climate.calendar.season,
        currentWeather: seasonalPresentation.weather,
        publishedForecast: world.seasonal?.forecast ?? [],
        waterPolicy: world.seasonal?.operations.waterPolicy,
      },
    );
    if (!prepared?.commitAllowed) {
      setPaintError(t("progression.locked", { reputation: terrainMinReputation(feature.terrain) }));
      return;
    }
    if (!prepared.preview.affordable) {
      setPaintError(
        `Terrain edit needs ${formatCurrency(Math.ceil(prepared.preview.net))}; ` +
        `${formatCurrency(Math.floor(prepared.preview.cash))} available ` +
        `(${formatCurrency(Math.ceil(prepared.preview.shortfall))} short).`,
      );
      return;
    }
    dispatch({ type: "EDIT_SURFACE_FEATURE", feature });
    setCapital((capital) => ({
      spent: capital.spent + prepared.preview.charged,
      refunded: capital.refunded + prepared.preview.refunded,
      byTerrainSpent: {
        ...capital.byTerrainSpent,
        [feature.terrain]: (capital.byTerrainSpent[feature.terrain] ?? 0) + prepared.preview.charged,
      },
      byTerrainTiles: {
        ...capital.byTerrainTiles,
        [feature.terrain]: (capital.byTerrainTiles[feature.terrain] ?? 0) + prepared.preview.changedCount,
      },
    }));
    setPaintError(prepared.preview.excludedCount > 0
      ? `Updated surface; skipped ${prepared.preview.excludedCount} unowned tiles.`
      : null);
    recordM35Metric("surfaceCommit", performance.now() - startedAt);
    void audio.playSfx("brush");
  }, [
    audio,
    costMult,
    course,
    dispatch,
    t,
    world.cash,
    world.constraints?.protectedTrees,
    world.isBankrupt,
    world.reputation,
    world.seasonal?.forecast,
    world.seasonal?.operations.waterPolicy,
    seasonalPresentation.climate.calendar.season,
    seasonalPresentation.weather,
  ]);

  // Smart fairway painting: paint fairway along centerline with specified width in yards
  function smartPaintFairway(widthYards: number) {
    if (world.isBankrupt) return;
    const hole = course.holes[activeHoleIndex];
    if (!hole.tee || !hole.green) return;

    // Use the active path if available, otherwise use straight line from tee to green
    const centerline = activePath.length >= 2 ? activePath : [hole.tee, hole.green];
    
    // Convert width from yards to tiles (half-width for radius)
    const radiusTiles = (widthYards / 2) / course.yardsPerTile;
    
    // Collect all tiles to paint (avoid duplicates)
    const tilesToPaint = new Set<string>();
    const tilesToPaintData: Array<{ x: number; y: number; prev: Terrain }> = [];

    // Sample points along centerline and paint in circles
    for (let i = 0; i < centerline.length; i++) {
      const center = centerline[i];
      const r2 = radiusTiles * radiusTiles;
      
      // Iterate over a square grid and check if point is within circle
      for (let dy = -Math.ceil(radiusTiles); dy <= Math.ceil(radiusTiles); dy++) {
        for (let dx = -Math.ceil(radiusTiles); dx <= Math.ceil(radiusTiles); dx++) {
          if (dx * dx + dy * dy > r2) continue;
          
          const x = center.x + dx;
          const y = center.y + dy;
          
          // Skip out of bounds
          if (x < 0 || y < 0 || x >= course.width || y >= course.height) continue;
          
          // Skip if already collected
          const key = `${x},${y}`;
          if (tilesToPaint.has(key)) continue;
          
          const idx = y * course.width + x;
          const prev = course.tiles[idx];
          
          // Don't overwrite green, tee, or water (preserve important features)
          if (prev === "green" || prev === "tee" || prev === "water") continue;
          
          tilesToPaint.add(key);
          tilesToPaintData.push({ x, y, prev });
        }
      }
    }

    // Calculate total cost
    let totalNet = 0;
    for (const tile of tilesToPaintData) {
      const cost = computeTerrainChangeCost(tile.prev, "fairway", costMult, course.theme);
      totalNet += cost.net;
    }

    // Check affordability
    if (totalNet > 0 && world.cash < totalNet) {
      setPaintError(t("error.insufficientFairway", { amount: formatCurrency(Math.ceil(totalNet)) }));
      return;
    }

    // Apply all changes (use silent for all but the last one to avoid sound spam)
    for (let i = 0; i < tilesToPaintData.length; i++) {
      const tile = tilesToPaintData[i];
      applyTerrainAt(tile.x, tile.y, "fairway", { silent: i < tilesToPaintData.length - 1 });
    }
  }

  function startWizard() {
    setEditorMode("HOLE_WIZARD");
    const hole = course.holes[activeHoleIndex];
    // If tee exists, start in MOVE_TEE mode; otherwise TEE mode
    if (hole.tee) {
      setWizardStep("MOVE_TEE");
      setDraftTee(hole.tee);
      setDraftGreen(hole.green);
    } else {
      setWizardStep("TEE");
      setDraftTee(null);
      setDraftGreen(null);
    }
  }
  
  function startPlaceTee() {
    setEditorMode("HOLE_WIZARD");
    const hole = course.holes[activeHoleIndex];
    if (hole.tee) {
      setWizardStep("MOVE_TEE");
      setDraftTee(hole.tee);
      setDraftGreen(hole.green);
    } else {
      setWizardStep("TEE");
      setDraftTee(null);
      setDraftGreen(hole.green);
    }
  }
  
  function startPlaceGreen() {
    setEditorMode("HOLE_WIZARD");
    const hole = course.holes[activeHoleIndex];
    if (hole.green) {
      setWizardStep("MOVE_GREEN");
      setDraftTee(hole.tee);
      setDraftGreen(hole.green);
    } else {
      setWizardStep("GREEN");
      setDraftTee(hole.tee);
      setDraftGreen(null);
    }
  }

  function redoWizard() {
    const hole = course.holes[activeHoleIndex];
    if (hole.tee) {
      setWizardStep("MOVE_TEE");
      setDraftTee(hole.tee);
      setDraftGreen(hole.green);
    } else {
      setWizardStep("TEE");
      setDraftTee(null);
      setDraftGreen(null);
    }
  }

  function nextHoleWizard() {
    setActiveHoleIndex((i) => Math.min(8, i + 1));
    redoWizard();
  }

  function moveMarker(markerType: "tee" | "green", newPos: Point) {
    if (world.isBankrupt) return;
    
    const hole = course.holes[activeHoleIndex];
    if (!hole) return;
    
    // Get old position
    const oldPos = markerType === "tee" ? hole.tee : hole.green;
    if (!oldPos) return; // Can't move if it doesn't exist
    
    // Check if position changed
    if (oldPos.x === newPos.x && oldPos.y === newPos.y) return; // No change
    
    // Calculate cost: remove old marker, place new marker
    const oldIdx = oldPos.y * course.width + oldPos.x;
    const newIdx = newPos.y * course.width + newPos.x;
    const oldTerrain = course.tiles[oldIdx];
    const newTerrain = course.tiles[newIdx];
    
    // Cost to remove old marker (revert to rough, get salvage)
    const removeCost = computeTerrainChangeCost(oldTerrain, "rough", costMult, course.theme); // Reverting to rough
    // Cost to place new marker
    const placeCost = computeTerrainChangeCost(newTerrain, markerType, costMult, course.theme);
    const totalNet = placeCost.net + removeCost.net; // removeCost.net is negative (refund), so this is correct
    
    if (totalNet > 0 && world.cash < totalNet) {
      setPaintError(t("error.insufficientMove", { marker: markerType, amount: formatCurrency(Math.ceil(totalNet)) }));
      return;
    }
    
    // Dispatch MOVE_TEE or MOVE_GREEN action
    if (markerType === "tee") {
      dispatch({ type: "MOVE_TEE", holeIndex: activeHoleIndex, position: newPos, oldPosition: oldPos });
    } else {
      dispatch({ type: "MOVE_GREEN", holeIndex: activeHoleIndex, position: newPos, oldPosition: oldPos });
    }
    
    void audio.playSfx("confirm");
  }

  function confirmWizardWithValues(tee: Point, green: Point) {
    if (world.isBankrupt) return;

    // Elevation check (ZKU-146): tee and green sites must be near-flat
    // (max 1 step across their 3x3 footprint). Sculpt with Level first.
    const teeSlope = maxSlopeInRect(course, tee.x - 1, tee.y - 1, tee.x + 1, tee.y + 1);
    const greenSlope = maxSlopeInRect(course, green.x - 1, green.y - 1, green.x + 1, green.y + 1);
    if (teeSlope > 1 || greenSlope > 1) {
      setPaintError(
        t("error.siteSteep", { marker: teeSlope > 1 ? t("terrain.tee") : t("terrain.green") })
      );
      return;
    }

    // Two tile changes: tee + green. Check combined affordability.
    const teeIdx = tee.y * course.width + tee.x;
    const greenIdx = green.y * course.width + green.x;
    const teePrev = course.tiles[teeIdx];
    const greenPrev = course.tiles[greenIdx];
    const teeCost = computeTerrainChangeCost(teePrev, "tee", costMult, course.theme);
    const greenCost = computeTerrainChangeCost(greenPrev, "green", costMult, course.theme);
    const totalNet = teeCost.net + greenCost.net;
    if (totalNet > 0 && world.cash < totalNet) {
      setPaintError(t("error.insufficientConfirm", { amount: formatCurrency(Math.ceil(totalNet)) }));
      return;
    }

    // Dispatch PLACE_TEE and PLACE_GREEN actions
    dispatch({ type: "PLACE_TEE", holeIndex: activeHoleIndex, position: tee });
    dispatch({ type: "PLACE_GREEN", holeIndex: activeHoleIndex, position: green });
    void audio.playSfx("confirm");

    if (!tutorialProgress) setTeeSetupPrompt({ holeIndex: activeHoleIndex });
    setSelectedTeeSet("member");
    setActiveHoleIndex((i) => Math.min(8, i + 1));
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function confirmWizard() {
    const tee = draftTeeRef.current;
    const green = draftGreenRef.current;
    if (!tee || !green) return;
    confirmWizardWithValues(tee, green);
  }

  function teePlacementCost(holeIndex: number, teeSet: TeeSet, point: Point): number {
    const hole = course.holes[holeIndex];
    if (!hole || point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) return Infinity;
    const old = getTeeBox(hole, teeSet);
    const place = computeTerrainChangeCost(course.tiles[point.y * course.width + point.x], "tee", costMult, course.theme).net;
    if (!old || (old.x === point.x && old.y === point.y)) return place;
    const remove = computeTerrainChangeCost(course.tiles[old.y * course.width + old.x], "rough", costMult, course.theme).net;
    return remove + place;
  }

  function previewTeeBox(teeSet: TeeSet, point: Point): boolean {
    const hole = course.holes[activeHoleIndex];
    if (!hole) return false;
    const prospective = withNormalizedHoleSetup({ ...hole, teeBoxes: { ...hole.teeBoxes, [teeSet]: point }, ...(teeSet === "member" ? { tee: point } : {}) });
    const issue = validateHoleCourseSetup(course, prospective).find((entry) => entry.code === "OUT_OF_BOUNDS" || entry.code === "DUPLICATE" || entry.code === "TEE_ORDER");
    if (issue) { setPaintError(issue.message); return false; }
    const netCost = teePlacementCost(activeHoleIndex, teeSet, point);
    if (!Number.isFinite(netCost)) { setPaintError("Tee location is out of bounds."); return false; }
    setPendingTeePlacement({ holeIndex: activeHoleIndex, teeSet, point, netCost });
    setPaintError(null);
    return true;
  }

  function commitTeeBox(holeIndex: number, teeSet: TeeSet, point: Point, netCost: number) {
    if (netCost > world.cash) { setPaintError(t("error.insufficientFunds", { amount: formatCurrency(Math.ceil(netCost)) })); return; }
    dispatch({ type: "SET_TEE_BOX", holeIndex, teeSet, position: point });
    setSelectedTeeSet(teeSet);
    setPendingTeePlacement(null);
    setPaintError(null);
  }

  useEffect(() => {
    if (!setupPlacement && !pendingTeePlacement) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSetupPlacement(null);
      setPendingTeePlacement(null);
      setPaintError(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [setupPlacement, pendingTeePlacement]);

  function removeTeeBox(teeSet: TeeSet) {
    const hole = course.holes[activeHoleIndex];
    if (!hole || !getTeeBox(hole, teeSet)) return;
    const remaining = TEE_SETS.filter((set) => set !== teeSet && getTeeBox(hole, set)).length;
    if (remaining === 0 && !window.confirm("Remove the final tee? This hole will be incomplete and unavailable for new rounds.")) return;
    dispatch({ type: "REMOVE_TEE_BOX", holeIndex: activeHoleIndex, teeSet });
  }

  function setTeePar(teeSet: TeeSet, setting: ParSetting) {
    setCourse((current) => {
      const holes = current.holes.slice();
      const hole = holes[activeHoleIndex];
      if (!hole) return current;
      holes[activeHoleIndex] = withNormalizedHoleSetup({
        ...hole,
        parByTee: { ...hole.parByTee, [teeSet]: setting },
        ...(teeSet === "member" ? { parMode: setting.mode, parManual: setting.mode === "MANUAL" ? setting.par : undefined } : {}),
      });
      return { ...current, holes };
    });
  }

  function setPinPosition(pinRotation: PinRotation, point: Point): boolean {
    if (point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) { setPaintError("Pin position is out of bounds."); return false; }
    if (course.tiles[point.y * course.width + point.x] !== "green") { setPaintError(`Pin ${pinRotation} must sit on existing green terrain.`); return false; }
    const hole = course.holes[activeHoleIndex];
    if (!hole) return false;
    const prospective = withNormalizedHoleSetup({ ...hole, pinPositions: { ...hole.pinPositions, [pinRotation]: point }, ...(pinRotation === "A" ? { green: point } : {}) });
    const issue = validateHoleCourseSetup(course, prospective).find((entry) => entry.code === "DUPLICATE");
    if (issue) { setPaintError(issue.message); return false; }
    dispatch({ type: "SET_PIN_POSITION", holeIndex: activeHoleIndex, pinRotation, position: point });
    setPaintError(null);
    return true;
  }

  function handleCanvasClick(x: number, y: number) {
    if (world.isBankrupt) return;
    // Unlock audio on first canvas interaction
    void audio.unlock();
    if (x >= 0 && y >= 0 && x < course.width && y < course.height && !isOwnedTile(course, x, y)) {
      setPaintError(t("land.buildBlocked"));
      return;
    }
    
    // Check bounds (only for marker placement, not for painting which supports infinite canvas)
    if (editorMode === "HOLE_WIZARD" && (x < 0 || y < 0 || x >= course.width || y >= course.height)) {
      setPaintError(t("error.markersBounds"));
      return;
    }
    if (setupPlacement) {
      const accepted = setupPlacement.kind === "tee"
        ? previewTeeBox(setupPlacement.key, { x, y })
        : setPinPosition(setupPlacement.key, { x, y });
      if (accepted) {
        setSetupPlacement(null);
        if (setupPlacement.kind === "pin") void audio.playSfx("confirm");
      }
      return;
    }
    
    // Check if clicking on existing tee/green marker (direct interaction)
    // Only check if not already in HOLE_WIZARD mode (to avoid conflicts)
    if (editorMode !== "HOLE_WIZARD") {
      // Check for tee markers (within course bounds)
      if (x >= 0 && y >= 0 && x < course.width && y < course.height) {
        for (let i = 0; i < course.holes.length; i++) {
          const hole = course.holes[i];
          for (const teeSet of TEE_SETS) {
            const tee = getTeeBox(hole, teeSet);
            if (!tee || tee.x !== x || tee.y !== y) continue;
            setSelectedTeeSet(teeSet);
            activateTerrainEditing();
            enterHoleEditMode(i, teeSet);
            return;
          }
          if (hole.green && hole.green.x === x && hole.green.y === y) {
            setActiveHoleIndex(i);
            setEditorMode("HOLE_WIZARD");
            setWizardStep("MOVE_GREEN");
            setDraftTee(hole.tee);
            setDraftGreen({ x, y });
            return;
          }
        }
      }
    }
    
    if (editorMode === "SCULPT") {
      if (x < 0 || y < 0 || x >= course.width || y >= course.height) return;
      // Native captured pointer strokes own fine-green sculpting so mouse and
      // touch share continuous previews and one atomic undo entry.
      if (course.tiles[y * course.width + x] === "green") return;
      const deltas = computeSculptDeltas(course, x, y, sculptBrush, sculptRadius);
      if (deltas.length === 0) return;
      const cost = computeElevationChangeCost(
        sculptSteps(deltas),
        costMult,
        course.theme,
      ).net;
      if (cost > world.cash) {
        setPaintError(t("error.earthworksFunds", { amount: formatCurrency(cost) }));
        return;
      }
      setPaintError(null);
      dispatch({ type: "SCULPT_TILES", deltas });
      if (soundEnabled) void audio.playSfx(editorMode === "SCULPT" ? "sculpt" : "brush");
      return;
    }

    if (editorMode === "PAINT") {
      applyTerrainAt(x, y, selected);
      return;
    }
    if (editorMode === "OBSTACLE") {
      const existingIdx = course.obstacles.findIndex((o) => o.x === x && o.y === y);
      if (existingIdx >= 0) {
        if (appProfile.gameplay.confirmBulldoze && !window.confirm(t("confirm.bulldoze"))) return;
        const removal = naturalFeatureRemovalQuote({
          theme: course.theme,
          obstacle: course.obstacles[existingIdx],
          costMult,
        });
        if (removal.net > world.cash) {
          setPaintError(t("error.insufficientFunds", { amount: formatCurrency(removal.net) }));
          return;
        }
        dispatch({ type: "REMOVE_OBSTACLE", x, y });
        setPaintError(null);
      } else {
        if (!isObstacleUnlocked(obstacleType, world.reputation)) {
          setPaintError(t("progression.locked", { reputation: obstacleMinReputation(obstacleType) }));
          return;
        }
        if (isWaterHazard(course.tiles[y * course.width + x])) {
          setPaintError(t("error.obstacleWater"));
          return;
        }
        const selectedPlant = selectedPlantId
          ? plantDefinition(selectedPlantId)
          : undefined;
        const plantId = obstacleType === "rock"
          ? undefined
          : selectedPlant?.semantics.kind === "obstacle"
            && selectedPlant.semantics.obstacleType === obstacleType
            ? selectedPlant.id
            : defaultObstaclePlantId(course.theme, obstacleType);
        const installation = naturalFeatureInstallationQuote({
          theme: course.theme,
          obstacleType,
          plantId,
          costMult,
        });
        if (installation.net > world.cash) {
          setPaintError(t("error.insufficientFunds", { amount: formatCurrency(installation.net) }));
          return;
        }
        setPaintError(null);
        dispatch({ type: "PLACE_OBSTACLE", x, y, obstacleType, plantId });
      }
      return;
    }
    if (editorMode === "BUILDING") {
      const existing = buildingAtTile(course, x, y);
      if (existing) {
        if (existing.type === "clubhouse") {
          setPaintError(t("error.clubhouseRemove"));
          return;
        }
        if (appProfile.gameplay.confirmSalvage && !window.confirm(t("confirm.salvage", { building: BUILDING_SPECS[existing.type].name.toLowerCase() }))) return;
        dispatch({ type: "REMOVE_BUILDING", x, y });
        setPaintError(null);
        return;
      }
      if (!isConcessionUnlocked(buildingType, world.reputation)) {
        setPaintError(t("progression.locked", { reputation: concessionMinReputation(buildingType) }));
        return;
      }
      const validation = canPlaceBuilding(course, buildingType, x, y);
      if (!validation.ok) {
        setPaintError(t("error.buildingPlacement", { building: BUILDING_SPECS[buildingType].name.toLowerCase(), reason: validation.reason ?? "unknown restriction" }));
        return;
      }
      const cost = BUILDING_SPECS[buildingType].buildCost;
      if (world.cash < cost) {
        setPaintError(t("error.insufficientFunds", { amount: formatCurrency(cost) }));
        return;
      }
      dispatch({ type: "PLACE_BUILDING", buildingType, x, y });
      setPaintError(null);
      void audio.playSfx("confirm");
      return;
    }
    if (editorMode === "DECOR") {
      const existing = decorationAtTile(course, x, y);
      if (decorationAction === "remove") {
        if (!existing) { setPaintError(t("decor.noneHere")); return; }
        dispatch({ type: "REMOVE_DECORATION", x, y });
        setPaintError(null);
        return;
      }
      if (decorationAction === "rotate") {
        if (!existing) { setPaintError(t("decor.noneHere")); return; }
        const next = { ...existing, rotation: ((existing.rotation + 1) % 4) as DecorationRotation };
        const withoutExisting = { ...course, decorations: (course.decorations ?? []).filter((entry) => entry !== existing) };
        const validation = canPlaceDecoration(withoutExisting, next);
        if (!validation.ok) { setPaintError(t("decor.invalid", { reason: validation.reason ?? "invalid placement" })); return; }
        dispatch({ type: "ROTATE_DECORATION", x, y });
        setPaintError(null);
        return;
      }
      const selectedPlant = selectedPlantId
        ? plantDefinition(selectedPlantId)
        : undefined;
      const semanticPlantId = (
        decorationKind === "flower_bed"
        || decorationKind === "planter"
        || decorationKind === "ornamental_feature"
      )
        ? selectedPlant?.semantics.kind === "decoration"
          && selectedPlant.semantics.decorationKind === decorationKind
          ? selectedPlant.id
          : defaultDecorationPlantId(course.theme, decorationKind)
        : undefined;
      const decoration = normalizedDecoration({
        kind: decorationKind,
        x,
        y,
        rotation: decorationRotation,
        ...(semanticPlantId
          ? { plantId: semanticPlantId, origin: "player" as const }
          : {}),
        ...((decorationKind === "bridge" || decorationKind === "boardwalk") ? { span: decorationSpan } : {}),
      });
      const validation = canPlaceDecoration(course, decoration);
      if (!validation.ok) { setPaintError(t("decor.invalid", { reason: validation.reason ?? "invalid placement" })); return; }
      const cost = decorationCost(decoration, course.theme, costMult);
      if (world.cash < cost) { setPaintError(t("error.insufficientFunds", { amount: formatCurrency(cost) })); return; }
      dispatch({ type: "PLACE_DECORATION", decoration });
      setPaintError(null);
      void audio.playSfx("confirm");
      return;
    }
    // HOLE_WIZARD
    const currentWizardStep = wizardStepRef.current;
    if (currentWizardStep === "TEE" || currentWizardStep === "MOVE_TEE") {
      // Validate: cannot place on water and must be in bounds
      if (x < 0 || y < 0 || x >= course.width || y >= course.height) {
        setPaintError(t("error.teeBounds"));
        return;
      }
      const terrain = course.tiles[y * course.width + x];
      if (terrain === "water" || terrain === "wetland") {
        setPaintError(t("error.teeWater"));
        return;
      }
      
      const newTee = { x, y };
      setDraftTee(newTee);
      
      // If moving tee, keep existing green and update immediately
      if (currentWizardStep === "MOVE_TEE") {
        const hole = course.holes[activeHoleIndex];
        const existingGreen = hole.green;
        if (existingGreen) {
          // Update tee position immediately, keep green
          moveMarker("tee", newTee);
          // If green exists, move to GREEN step for potential green move
          setWizardStep("GREEN");
          setDraftGreen(existingGreen);
        } else {
          // No green yet, move to GREEN step to place it
          setWizardStep("GREEN");
          setDraftGreen(null);
        }
      } else {
        // Placing new tee, clear green
        setDraftGreen(null);
        setWizardStep("GREEN");
      }
      return;
    }
    if (currentWizardStep === "GREEN" || currentWizardStep === "MOVE_GREEN") {
      // Validate: cannot place on water and must be in bounds
      if (x < 0 || y < 0 || x >= course.width || y >= course.height) {
        setPaintError(t("error.greenBounds"));
        return;
      }
      const terrain = course.tiles[y * course.width + x];
      if (terrain === "water" || terrain === "wetland") {
        setPaintError(t("error.greenWater"));
        return;
      }
      
      const newDraftGreen = { x, y };
      setDraftGreen(newDraftGreen);
      
      // If moving green, update immediately and stay on same hole
      if (currentWizardStep === "MOVE_GREEN") {
        moveMarker("green", newDraftGreen);
        // Reset wizard state, stay on same hole
        setWizardStep("TEE");
        setDraftTee(null);
        setDraftGreen(null);
      } else {
        // Placing new green, auto-confirm and move to next hole
        const tee = draftTeeRef.current;
        if (tee) {
          confirmWizardWithValues(tee, newDraftGreen);
        }
      }
      return;
    }
    // CONFIRM step: ignore clicks (shouldn't reach here with auto-advance, but keep for safety)
  }

  function setActiveHoleParMode(mode: "AUTO" | "MANUAL") {
    const current = course.holes[activeHoleIndex];
    setTeePar("member", mode === "AUTO" ? { mode: "AUTO" } : { mode: "MANUAL", par: current?.parManual ?? 4 });
  }

  function setActiveHoleParManual(par: 3 | 4 | 5) {
    setTeePar("member", { mode: "MANUAL", par });
  }

  const staffUpgradeCost = useMemo(() => {
    if (world.staffLevel >= reputationTier(world.reputation).staffCap) return null;
    return 2500 * (world.staffLevel + 1);
  }, [world.reputation, world.staffLevel]);

  const marketingUpgradeCost = useMemo(() => {
    if (world.marketingLevel >= 5) return null;
    return 2000 * (world.marketingLevel + 1);
  }, [world.marketingLevel]);

  const canUpgradeStaff = staffUpgradeCost != null && world.cash >= staffUpgradeCost;
  const canUpgradeMarketing =
    marketingUpgradeCost != null && world.cash >= marketingUpgradeCost;

  function onUpgradeStaff() {
    if (staffUpgradeCost == null) return;
    setWorld((w) => {
      if (w.isBankrupt) return w;
      if (w.staffLevel >= reputationTier(w.reputation).staffCap) return w;
      if (w.cash < staffUpgradeCost) return w;
      const nextCash = w.cash - staffUpgradeCost;
      return {
        ...w,
        cash: nextCash,
        staffLevel: w.staffLevel + 1,
        staffRoster: staffFromLevel(w.staffLevel + 1, activeLayout.id),
        isBankrupt: w.isBankrupt || nextCash < -10_000,
      };
    });
  }

  function onUpgradeMarketing() {
    if (marketingUpgradeCost == null) return;
    setWorld((w) => {
      if (w.isBankrupt) return w;
      if (w.marketingLevel >= 5) return w;
      if (w.cash < marketingUpgradeCost) return w;
      const nextCash = w.cash - marketingUpgradeCost;
      return {
        ...w,
        cash: nextCash,
        marketingLevel: w.marketingLevel + 1,
        isBankrupt: w.isBankrupt || nextCash < -10_000,
      };
    });
  }

  function onSave() {
    setSaveModalCanSave(true);
    flowDispatch({ type: "OPEN_MODAL", modal: "save-load" });
  }

  function onLoad() {
    setSaveModalCanSave(true);
    flowDispatch({ type: "OPEN_MODAL", modal: "save-load" });
  }

  function onResetSave() {
    resetSave();
    // Fresh land, same run framing (mode/theme/difficulty), new seed.
    restartRun(currentRunSetup((Date.now() % 1_000_000) | 0));
  }

  const rating = useMemo(() => computeCourseRatingAndSlope(course), [course]);
  const weeksSurvived = Math.max(0, world.week - 1);
  const photoRestoreRef = useRef<{ speed: SpeedName; center: Point; camera: CameraState | null } | null>(null);

  function photoCanvas(): HTMLCanvasElement | null {
    return canvasPaneRef.current?.querySelector("canvas") ?? null;
  }

  function enterPhotoMode(autoCapture = false) {
    if (photoMode) return;
    photoRestoreRef.current = { speed: live.speed, center: { ...audioCameraCenter }, camera: holeEditCamera ? { ...holeEditCamera, center: { ...holeEditCamera.center } } : null };
    live.setSpeed("paused");
    setPhotoMode(true);
    if (autoCapture) window.setTimeout(() => void capturePhoto(), 100);
  }

  function exitPhotoMode() {
    const restore = photoRestoreRef.current;
    setPhotoMode(false);
    if (!restore) return;
    setHoleEditCamera(restore.camera);
    setMinimapJump((current) => ({ center: restore.center, nonce: (current?.nonce ?? 0) + 1 }));
    live.setSpeed(restore.speed);
    photoRestoreRef.current = null;
  }

  async function capturePhoto() {
    const canvas = photoCanvas();
    if (!canvas) return;
    const blob = await captureCourseCanvas(canvas, 2);
    const name = `${course.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-course.png`;
    downloadBlob(blob, name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Screenshot encoding failed"));
        reader.onerror = () => reject(reader.error ?? new Error("Screenshot encoding failed"));
        reader.readAsDataURL(blob);
      });
      await platformServices.screenshots.save(dataUrl, name);
    } catch {
      // The browser download above remains the local fallback when native or
      // Steam screenshot capture is unavailable.
    }
    setA11yMessage(t("photo.saved"));
    void audio.playSfx("confirm", { force: true });
  }

  async function captureCard(download = true): Promise<Blob | null> {
    const canvas = photoCanvas();
    if (!canvas) return null;
    const blob = await createCourseCard(canvas, course, world, recordsRef.current, rating.courseRating);
    lastCourseCardRef.current = blob;
    if (download) downloadBlob(blob, `${course.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-card.png`);
    setA11yMessage(t("photo.cardSaved"));
    return blob;
  }

  async function shareCard() {
    const blob = lastCourseCardRef.current ?? await captureCard(false);
    if (!blob) return;
    await shareBlob(blob, "coursecraft-course-card.png", course.name);
    setA11yMessage(t("photo.shared"));
  }

  useEffect(() => {
    const onPhotoKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,select,[contenteditable='true']") || event.key.toLowerCase() !== "p" || flow.base !== "in-game" || flow.modal) return;
      event.preventDefault();
      if (photoMode) exitPhotoMode();
      else enterPhotoMode(true);
    };
    window.addEventListener("keydown", onPhotoKey);
    return () => window.removeEventListener("keydown", onPhotoKey);
  });

  useEffect(() => {
    if (!achievementQueue.length) return;
    const timer = window.setTimeout(() => setAchievementQueue((queue) => queue.slice(1)), 4200);
    return () => window.clearTimeout(timer);
  }, [achievementQueue]);

  const achievementCheckKey = `${gameState.terrainVersion}:${gameState.obstaclesVersion}:${gameState.markersVersion}:${course.holes.filter((hole) => hole.tee && hole.green).length}:${course.obstacles.filter((obstacle) => obstacle.type === "tree").length}:${world.cash}:${world.reputation}:${world.loans.map((loan) => loan.status).join(",")}:${world.objectives?.outcome}`;
  useEffect(() => {
    if (screen === "game") checkAchievements(recordsRef.current);
  }, [achievementCheckKey, screen, checkAchievements]);

  const liveDayIndex = live.status.dayIndex;
  const liveGolfersRef = live.golfersRef;
  const selectLiveGolfer = live.selectGolfer;
  const jumpToEvent = useCallback((event: RetentionEvent) => {
    if (event.courseId) setCourse((current) => selectLayout(current, event.courseId!));
    const stableHole = event.holeId ? course.holes.find((hole) => hole.id === event.holeId) : undefined;
    const point = event.point ?? stableHole?.green ?? stableHole?.tee ?? (event.holeIndex != null ? course.holes[event.holeIndex]?.green ?? course.holes[event.holeIndex]?.tee : null);
    if (event.week === world.week && event.day === liveDayIndex && event.golferId != null && liveGolfersRef.current.some((golfer) => golfer.id === event.golferId)) selectLiveGolfer(event.golferId);
    if (point) setMinimapJump((current) => ({ center: point, nonce: (current?.nonce ?? 0) + 1 }));
  }, [course.holes, liveDayIndex, liveGolfersRef, selectLiveGolfer, setCourse, world.week]);

  useEffect(() => subscribeRetentionEvents((event) => {
    if (!appProfile.gameplay.momentCamera || event.severity !== "major" || photoMode) return;
    const previous = { ...audioCameraCenterRef.current };
    jumpToEvent(event);
    window.setTimeout(() => setMinimapJump((current) => ({ center: previous, nonce: (current?.nonce ?? 0) + 1 })), 2000);
  }), [appProfile.gameplay.momentCamera, jumpToEvent, photoMode]);

  useEffect(() => {
    if (!world.isBankrupt) return;
    if (legacyAwardedRef.current) return;
    legacyAwardedRef.current = true;
    const awardId = `${world.runSeed}:${weeksSurvived}:${peakRep}`;
    const earned = legacyAwardForRun({ weeksSurvived, peakRep });
    if (earned <= 0) return;
    // One-shot award on the bankruptcy transition; pairs a localStorage write
    // with the state update, so it belongs in an effect (runs once per run,
    // guarded by legacyAwardedRef — no cascade risk).
    setLegacy((s) => {
      if (s.lastAwardId === awardId) return s; // prevent double-award across reloads
      const next = { ...s, legacyPoints: s.legacyPoints + earned, lastAwardId: awardId };
      saveLegacy(next);
      return next;
    });
  }, [world.isBankrupt, weeksSurvived, peakRep]);

  const saveLoadModal = flow.modal === "save-load" ? (
    <DeferredSurface label={t("deferredSurface.savedGames")}>
    <SaveLoadModal
      open={flow.modal === "save-load"}
      onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
      canSave={saveModalCanSave}
      getPayload={() => {
        payloadSequenceRef.current = changeSequenceRef.current;
        return { course, world, history, records, live: live.getSnapshot(), tutorial: tutorialProgress };
      }}
      onSaved={() => markClean(payloadSequenceRef.current)}
      onLoaded={(payload) => {
        setPendingLoadingContext(savedLoadingBiomeContext(payload));
        flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreCourse") });
        window.requestAnimationFrame(() => {
          window.setTimeout(() => {
            const applied = applyLoadedGame(payload);
            setPendingLoadingContext(null);
            flowDispatch({ type: applied ? "ENTER_GAME" : "BACK_TO_TITLE" });
            if (applied) setPaintError(t("save.loaded"));
          }, 0);
        });
        window.setTimeout(() => setPaintError(null), 2000);
      }}
    />
    </DeferredSurface>
  ) : null;

  function advanceTutorial() {
    if (!tutorialProgress) return;
    const step = TUTORIAL_STEPS[tutorialProgress.stepIndex];
    const context = { course, world, last, onCourse: live.status.onCourse };
    if (!step.canAdvance(context, tutorialProgress.baseline)) return;
    if (tutorialProgress.stepIndex >= TUTORIAL_STEPS.length - 1) {
      finishTutorial(true);
      return;
    }
    const next = { ...tutorialProgress, stepIndex: tutorialProgress.stepIndex + 1 };
    const nextStep = TUTORIAL_STEPS[next.stepIndex];
    if (nextStep.id === "paint-corridor") prepareTutorialPaintCorridor();
    if (["shot-plan", "weekly-report", "green-fee", "maintenance", "first-profit"].includes(nextStep.id)) {
      setViewMode("ARCHITECT");
    }
    if (nextStep.id === "shot-plan") {
      setActiveHoleIndex(Math.max(0, activeHoleIndex - 1));
      activateTerrainEditing();
    }
    if (nextStep.id === "fix-corridor") enterHoleEditMode(activeHoleIndex);
    if (step.id === "fix-corridor") {
      exitHoleEditMode();
      const nextHole = course.holes.findIndex((hole) => !hole.tee || !hole.green);
      setActiveHoleIndex(nextHole >= 0 ? nextHole : 0);
      setEditorMode("HOLE_WIZARD");
      setWizardStep("TEE");
      setDraftTee(null);
      setDraftGreen(null);
    }
    setTutorialProgress(next);
    saveTutorialProgress(next);
  }

  if (
    import.meta.env.MODE === "e2e" &&
    new URLSearchParams(window.location.search).get("crash-test") === "react"
  ) {
    throw new Error("M45 controlled React crash");
  }

  // Context is intentionally computed at the edge of the UI only. It never
  // enters simulation/save state and cannot alter shell commands or focus.
  const contextualUiTheme = biomeUiTheme(
    screen === "loading" && pendingLoadingContext
      ? pendingLoadingContext.theme
      : course.theme,
    {
      season: screen === "loading" && pendingLoadingContext
        ? pendingLoadingContext.season
        : seasonalPresentation.climate.calendar.season,
      weather: screen === "loading" && pendingLoadingContext
        ? pendingLoadingContext.weather
        : seasonalPresentation.weather.kind,
      colorVision: appProfile.accessibility.colorVision,
      reducedMotion: appProfile.accessibility.reducedMotion,
    },
  );
  const designCatalog = buildDesignCatalog({
    theme: course.theme,
    season: seasonalPresentation.climate.calendar.season,
    weatherKind: seasonalPresentation.weather.kind,
    costMult,
    colorVision: appProfile.accessibility.colorVision,
    graphicsQuality: resolvedGraphicsQuality,
    reducedMotion: appProfile.accessibility.reducedMotion,
    seasonalVisualState: seasonalPresentation,
    decorationSpan,
    t,
  });

  function selectDesignItem(item: DesignCatalogItem) {
    if (item.terrain) {
      activateTerrainEditing(terrainTool, item.terrain);
      return;
    }
    if (item.obstacleType) {
      activateObstacleEditing(
        item.obstacleType,
        item.plantId ?? null,
        item.id,
      );
      return;
    }
    if (item.decorationKind) {
      activateDecorationEditing(
        item.decorationKind,
        item.plantId ?? null,
        item.id,
      );
    }
  }

  if (screen === "setup") {
    return (
      <DeferredSurface label={t("deferredSurface.newGameSetup")}>
        <NewGameWizard
          onCancel={() => {
            setPendingLoadingContext(null);
            flowDispatch({ type: "BACK_TO_TITLE" });
          }}
          onStart={startNewGame}
          onStartScenario={startScenario}
        />
      </DeferredSurface>
    );
  }

  if (screen === "loading") {
    return <LoadingCard label={flow.loadingLabel ?? "Loading CourseCraft…"} context={contextualUiTheme} />;
  }

  if (screen === "menu" && showVision) {
    return (
      <Suspense fallback={<LoadingCard label={t("loading.vision")} context={contextualUiTheme} />}>
        <VisionPage onClose={closeVision} />
      </Suspense>
    );
  }

  if (screen === "menu") {
    return (
      <>
      <DeferredSurface label={t("deferredSurface.mainMenu")}><StartMenu
        canLoad={canLoadFromMenu}
        onNewGame={newGameFromMenu}
        onQuickStart={() => IS_DEMO ? startScenario(SCENARIOS[0]) : startNewGame(quickStartSetup())}
        onLoadGame={loadFromMenu}
        onContinue={() => void continueFromMenu()}
        onOptions={() => flowDispatch({ type: "OPEN_MODAL", modal: "options" })}
        onAchievements={() => setShowRetention(true)}
        onVision={openVision}
        canInstall={pwa.canInstall}
        onInstall={() => void pwa.install()}
        onButtonClick={() => {
          void audio.unlock();
          if (soundEnabled) void audio.playSfx("button");
        }}
      /></DeferredSurface>
      {saveLoadModal}
      {flow.modal === "options" && <DeferredSurface label={t("deferredSurface.settings")}><SettingsModal
        open={flow.modal === "options"}
        onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
        profile={appProfile}
        onProfileChange={handleProfileChange}
      /></DeferredSurface>}
      {showRetention && <DeferredSurface label={t("deferredSurface.achievements")}><RetentionHub records={records} profile={appProfile} context={achievementContext(records)} onClose={() => setShowRetention(false)} /></DeferredSurface>}
      {pwa.updateAvailable && <PwaUpdateToast onReload={() => { void gameSession.save(autosave, { history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress }).finally(pwa.applyUpdate); }} />}
      </>
    );
  }

  return (
    <div
      className={`cc-app${photoMode ? " cc-photo-mode" : ""}`}
      data-biome={contextualUiTheme.biome}
      data-biome-character={contextualUiTheme.character}
      data-biome-motif={contextualUiTheme.motif}
      data-biome-illustration={contextualUiTheme.illustration}
      data-biome-fallback={contextualUiTheme.fallback || undefined}
      data-season={contextualUiTheme.season}
      data-weather={contextualUiTheme.weather}
      style={biomeUiStyle(contextualUiTheme) as CSSProperties}
    >
      <TooltipSurface>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{a11yMessage}</div>
        <GameBackground />
        {saveLoadModal}
      {showRetention && <DeferredSurface label={t("deferredSurface.achievements")}><RetentionHub records={records} profile={appProfile} context={achievementContext(records)} onClose={() => setShowRetention(false)} /></DeferredSurface>}
      {!photoMode && <AchievementToasts queue={achievementQueue} biomeContext={contextualUiTheme} onDismiss={() => setAchievementQueue((queue) => queue.slice(1))} />}
      {photoMode && <PhotoModeOverlay showGolfers={photoGolfers} showMarkers={photoMarkers} onToggleGolfers={() => setPhotoGolfers((value) => !value)} onToggleMarkers={() => setPhotoMarkers((value) => !value)} onCapture={() => void capturePhoto()} onCard={() => void captureCard()} onShare={() => void shareCard()} onExit={exitPhotoMode} />}
      {pwa.updateAvailable && <PwaUpdateToast onReload={() => { void gameSession.save(autosave, { history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress }).finally(pwa.applyUpdate); }} />}
      {flow.modal === "save-load" && pwa.storagePersistent === false && <div role="status" className="cc-storage-warning">{t("pwa.storageWarning")}</div>}
      {flow.modal === "golfopedia" && (
        <DeferredSurface label={t("deferredSurface.golfopedia")}><GolfopediaModal
          open
          initialEntry={golfopediaEntry}
          theme={course.theme}
          difficulty={world.difficulty}
          onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
        /></DeferredSurface>
      )}
      {tutorialProgress && (
        <TutorialOverlay
          step={TUTORIAL_STEPS[tutorialProgress.stepIndex]}
          canAdvance={TUTORIAL_STEPS[tutorialProgress.stepIndex].canAdvance(
            { course, world, last, onCourse: live.status.onCourse },
            tutorialProgress.baseline
          )}
          onAdvance={advanceTutorial}
          onSkip={() => finishTutorial(false)}
          saveStatus={tutorialSaveStatus}
        />
      )}
      {showTutorialOffer && !flow.paused && (
        <TutorialOffer
          onAccept={() => beginTutorial()}
          onSkip={() => {
            updateAppProfile({ tutorialOffered: true });
            setShowTutorialOffer(false);
          }}
        />
      )}
      {!tutorialProgress && !showTutorialOffer && !flow.modal && !flow.paused && !showVictory && !showBridgePrompt && advisorMessage && (
        <AdvisorCard
          message={advisorMessage}
          biomeContext={contextualUiTheme}
          onDismiss={dismissAdvisor}
          onShowHole={(holeIndex) => {
            const holeId = activeOperatingCourse.holes[holeIndex]?.id;
            const estateIndex = holeId ? course.holes.findIndex((hole) => hole.id === holeId) : holeIndex;
            enterHoleEditMode(estateIndex >= 0 ? estateIndex : holeIndex);
            dismissAdvisor();
          }}
        />
      )}
      <div className="cc-main">
        {(world.isBankrupt || world.objectives?.outcome === "LOST") && (
        <DefeatModal
          reason={world.isBankrupt ? "BANKRUPT" : world.objectives?.lostReason ?? "DEADLINE"}
          objectives={world.objectives}
          weeksSurvived={weeksSurvived}
          peakCash={peakCash}
          peakRep={peakRep}
          courseRating={rating.courseRating}
          slope={rating.slope}
          seed={world.runSeed}
          onRetrySeed={(seed) => {
            const scenario = getScenario(world.scenarioId);
            if (scenario) startScenario(scenario);
            else restartRun(currentRunSetup(seed), world.objectives?.goals ?? null);
          }}
          onNewGame={() => {
            setPendingLoadingContext(null);
            flowDispatch({ type: "BACK_TO_TITLE" });
          }}
          onLoad={() => { setSaveModalCanSave(false); flowDispatch({ type: "OPEN_MODAL", modal: "save-load" }); }}
        />
      )}
        {showVictory && world.objectives && !world.isBankrupt && (
        <VictoryModal
          objectives={world.objectives}
          courseName={course.name}
          week={world.week}
          cash={world.cash}
          reputation={world.reputation}
          courseRating={rating.courseRating}
          careerNote={
            world.mode === "career" && world.scenarioId
              ? world.campaign?.medal
                ? t("campaign.victory.note", {
                    medal: t(world.campaign.medal === "gold"
                      ? "campaign.medal.gold"
                      : world.campaign.medal === "silver"
                        ? "campaign.medal.silver"
                        : "campaign.medal.bronze"),
                  })
                : t("campaign.victory.legacyNote")
              : undefined
          }
          onContinue={() => setShowVictory(false)}
        />
      )}
        {showBridgePrompt && (
        <BridgeLoanPrompt
          onAccept={takeBridgeLoan}
          onDecline={() => setShowBridgePrompt(false)}
        />
      )}
        <div
          className="cc-course-frame"
          {...biomeContextAttributes(contextualUiTheme, "course-frame")}
        >
          <div ref={canvasPaneRef} className="cc-course-pane" data-tutorial-target="course">
            <PixiStage
                course={course}
                holes={course.holes}
                obstacles={course.obstacles}
                activeHoleIndex={activeHoleIndex}
                activePath={activePath}
                activeShotPlan={activeShotPlan}
                selectedTeeSet={selectedTeeSet}
                tileSize={tileSize}
                showGridOverlays={viewMode === "ARCHITECT"}
                surveyMode={showLandOffice}
                selectedParcelId={selectedParcelId}
                architectureWarnings={architectureReport?.warnings}
                architectureOverlay={showArchitectureReview ? architectureReview.overlay : null}
                paceBottlenecks={live.status.pace.bottlenecks}
                animationsEnabled={effectiveAnimations && resolvedGraphicsQuality !== "low"}
                graphicsQuality={resolvedGraphicsQuality}
                season={contextualUiTheme.season}
                seasonalVisualState={seasonalPresentation}
                reducedMotion={appProfile.accessibility.reducedMotion}
                onFrameTime={handleGraphicsFrame}
                ambienceFx={appProfile.graphics.ambienceFx && resolvedGraphicsQuality !== "low"}
                waterAnimation={appProfile.graphics.waterAnimation && resolvedGraphicsQuality !== "low"}
                treeSway={appProfile.graphics.treeSway && resolvedGraphicsQuality === "high"}
                resolutionScale={effectiveResolutionScale}
                worldSeed={world.runSeed}
                cameraSmoothing={appProfile.gameplay.cameraSmoothing && !appProfile.accessibility.reducedMotion}
                edgeScroll={appProfile.gameplay.edgeScroll}
                edgeScrollSpeed={appProfile.gameplay.edgeScrollSpeed}
                flyoverNonce={flyoverNonce}
                showShotPlan={showShotPlan}
                editorMode={editorMode}
                selectedDecorationKind={decorationKind}
                decorationRotation={decorationRotation}
                decorationSpan={decorationSpan}
                colorVision={appProfile.accessibility.colorVision}
                terrainPatterns={appProfile.accessibility.terrainPatterns}
                keybindings={appProfile.accessibility.keybindings}
                wizardStep={wizardStep}
                draftTee={draftTee}
                draftGreen={draftGreen}
                onClickTile={(x, y) => {
                  if (playerRoundLocksEditing) {
                    if (activePlayerRound?.phase === "awaiting_shot") setPlayerShotAim({ x, y });
                    return;
                  }
                  handleCanvasClick(x, y);
                }}
                onPreviewTerrainStroke={getTerrainStrokePreview}
                onCommitTerrainStroke={commitTerrainStroke}
                terrainTool={terrainTool}
                onPreviewSurfaceFeatureEdit={getSurfaceFeatureEditPreview}
                onCommitSurfaceFeatureEdit={commitSurfaceFeatureEdit}
                onPreviewFineGreenStroke={getFineGreenStrokePreview}
                onCommitFineGreenStroke={commitFineGreenStroke}
                selectedTerrain={selected}
                worldCash={world.cash}
                flagColor={legacy.selected.flagColor}
                cameraState={holeEditCamera}
                showFixOverlay={showFixOverlay}
                failingCorridorSegments={failingCorridorSegments}
                showObstacles={showObstacles}
                golfersRef={live.golfersRef}
                liveActive={live.liveActive}
                onPickGolfer={live.selectGolfer}
                selectedGolferId={live.selectedId}
                followSelected={followSelected}
                showGolfers={!photoMode || photoGolfers}
                showMarkers={!photoMode || photoMarkers}
                dayMinute={live.status.dayMinute}
                resortOperations={world.enterprise?.resort}
                playerRound={activePlayerRound}
                playerShotAim={playerShotAim}
                playableShotMode={activePlayerRound?.phase === "awaiting_shot"}
                sculptRadius={sculptRadius}
                fineGreenBrush={fineGreenBrush}
                fineGreenRadius={fineGreenRadius}
                onCameraUpdate={(camera) => {
                  holeEditCameraManualRef.current = true;
                  setHoleEditCamera(camera);
                }}
                onCameraCenter={setAudioCameraCenter}
                onViewChange={setMinimapView}
                cameraJump={minimapJump}
                referenceCamera={m52ReferenceCamera}
            />
            {!tutorialProgress && (
              <WorkspaceNav
                workspace={workspace}
                onWorkspace={selectWorkspace}
                onInspect={() => setShowContextualInspector((open) => !open)}
                inspectorOpen={showContextualInspector}
                onAction={runWorkspaceAction}
                active={{
                  architecture: showArchitectureReview,
                  courses: showCourseManager,
                  land: showLandOffice,
                  player: showPlayerPro,
                  tournaments: showTournaments,
                  property: showPropertyManagement,
                  people: showLivingClub,
                  seasons: showSeasonsLegacy,
                  campaign: showCampaign,
                  progression: showProgression,
                  records: showRetention,
                  content: showContentLibrary,
                  photo: photoMode,
                }}
                alerts={{
                  player: activePlayerRound != null,
                  tournaments: live.status.tournament != null,
                  people: normalizeLivingClub(world.livingClub).story.instances.some((instance) =>
                    ["pending", "presented", "deferred"].includes(instance.status)
                  ),
                  seasons: world.seasonal?.pendingYearbookId != null,
                  campaign: (world.campaign?.pendingSceneIds.length ?? 0) > 0,
                }}
                disabled={{ courses: playerRoundLocksEditing, land: playerRoundLocksEditing }}
              />
            )}
            {workspace === "design"
              && !photoMode
              && !playerRoundLocksEditing
              && (
                <DesignDock
                  theme={course.theme ?? BIOME_KEYS[0]}
                  quality={resolvedGraphicsQuality}
                  catalog={designCatalog}
                  selectedItemId={selectedDesignItemId}
                  cash={world.cash}
                  reputation={world.reputation}
                  terrainTool={terrainTool}
                  onTerrainTool={(tool) => activateTerrainEditing(tool)}
                  terrainBrushWidth={terrainBrushWidth}
                  onTerrainBrushWidth={setTerrainBrushWidth}
                  onUndo={undoTerrainEdit}
                  onRedo={redoTerrainEdit}
                  onSelect={selectDesignItem}
                  decorationAction={decorationAction}
                  onDecorationAction={setDecorationAction}
                  decorationRotation={decorationRotation}
                  onDecorationRotation={setDecorationRotation}
                  decorationSpan={decorationSpan}
                  onDecorationSpan={setDecorationSpan}
                  onOpenGolfopedia={(entry) => {
                    setGolfopediaEntry(entry);
                    flowDispatch({ type: "OPEN_MODAL", modal: "golfopedia" });
                  }}
                  biomeContext={contextualUiTheme}
                />
              )}
            {showContextualInspector && !tutorialProgress && (
              <ContextualInspectorPanel
                courseName={course.name}
                selectedTerrain={selected}
                validHoles={course.holes.filter((hole) => hole.tee && hole.green).length}
                condition={course.condition}
                cash={formatCurrency(world.cash)}
                reputation={world.reputation}
                week={world.week}
                golfers={live.status.onCourse}
                openComplaints={inspectorPropertySummary.openComplaints}
                playerRound={activePlayerRound?.phase ?? t("inspector.none")}
                onOpenCourses={() => { setShowContextualInspector(false); selectWorkspace("design"); setShowCourseManager(true); }}
                onOpenLive={() => { setShowContextualInspector(false); selectWorkspace("operate"); setShowLiveOverview(true); }}
                onOpenProperty={() => { setShowContextualInspector(false); selectWorkspace("operate"); setShowPropertyManagement(true); }}
                onOpenPeople={() => { setShowContextualInspector(false); selectWorkspace("legacy"); setShowLivingClub(true); }}
                onOpenLegacy={() => { setShowContextualInspector(false); selectWorkspace("legacy"); setShowSeasonsLegacy(true); }}
                onSetViewMode={setViewMode}
                onSetPacePreset={live.setPacePreset}
                onClose={() => setShowContextualInspector(false)}
                biomeContext={contextualUiTheme}
              />
            )}
            {contentTestSnapshotRef.current && !tutorialProgress && (
              <button
                data-testid="exit-content-test"
                onClick={exitContentTestPlay}
                style={{ position: "absolute", left: 12, bottom: 120, zIndex: 191, padding: "9px 12px", borderRadius: 8, fontWeight: 800 }}
              >
                {t("content.exitTest")}
              </button>
            )}
            {showContentLibrary && !tutorialProgress && (
              <ContentLibraryPanel
                course={course}
                world={world}
                onTestPlay={startContentTestPlay}
                onClose={() => setShowContentLibrary(false)}
              />
            )}
            <Suspense fallback={null}>
            {showPlayerPro && !tutorialProgress && <PlayerProPanel
              career={playerPro}
              course={course}
              world={world}
              day={live.status.dayIndex}
              onUpdateIdentity={(identity) => updatePlayerPro((career) => ({ ...career, identity }))}
              onStartRound={beginPlayerRound}
              onTrain={trainPlayerPro}
              onChallenge={challengePlayerPro}
              onTournament={enterPlayerTournament}
              onResume={() => enterPlayerRoundView(playerPro)}
              onClose={() => setShowPlayerPro(false)}
            />}
            {activePlayerRound && !showPlayerPro && !tutorialProgress && playerShotAim && <PlayerShotHud
              career={playerPro}
              round={activePlayerRound}
              aim={playerShotAim}
              onAim={setPlayerShotAim}
              onCommit={commitControlledShot}
              onAdvance={advanceControlledRound}
              onAutoFinish={autoFinishControlledRound}
              onConcede={concedeControlledRound}
              onReturnToDesign={returnPlayerToDesign}
            />}
            </Suspense>
            {playerRoundLocksEditing && <div role="status" style={{ position: "absolute", left: "50%", top: 54, transform: "translateX(-50%)", zIndex: 112, padding: "6px 10px", borderRadius: 8, background: "rgba(54,69,48,.92)", color: "white", fontSize: 12 }}>{t("playerPro.round.editLocked")}</div>}
            {showProgression && !tutorialProgress && <ProgressionPanel reputation={world.reputation} onClose={() => setShowProgression(false)} />}
            {showTournaments && !tutorialProgress && <TournamentPanel course={activeOperatingCourse} world={world} currentDay={live.status.dayIndex} liveTournament={live.status.tournament} onSchedule={bookTournament} onClose={() => setShowTournaments(false)} />}
            {showLandOffice && !tutorialProgress && <LandOfficePanel course={course} world={world} selectedParcelId={selectedParcelId} onSelect={(parcelId) => setSelectedParcelId(parcelId)} onCenter={(center) => setMinimapJump((current) => ({ center, nonce: (current?.nonce ?? 0) + 1 }))} onPurchase={purchaseParcel} onClose={() => setShowLandOffice(false)} />}
            {showCourseManager && !tutorialProgress && <CourseManagerPanel course={normalizeCourseLayouts(course)} world={world} onChange={(next) => { setCourse(() => next); setWorld((current) => revalidateScheduledTournaments(next, current)); }} onSelectHole={(holeId) => { const index = course.holes.findIndex((hole) => hole.id === holeId); if (index >= 0) { setActiveHoleIndex(index); setHoleEditMode("hole"); } }} onCenter={(center) => setMinimapJump((current) => ({ center, nonce: (current?.nonce ?? 0) + 1 }))} onOpenGolfopedia={(entry) => { setGolfopediaEntry(entry); flowDispatch({ type: "OPEN_MODAL", modal: "golfopedia" }); }} onOpenArchitectureReview={() => { setShowArchitectureReview(true); setShowCourseManager(false); }} onClose={() => setShowCourseManager(false)} />}
            {showArchitectureReview && !tutorialProgress && <ArchitectureReviewPanel
              course={course}
              review={architectureReview}
              onFilters={setArchitectureFilters}
              onJump={(point, holeId) => {
                if (holeId) {
                  const index = course.holes.findIndex((hole) => hole.id === holeId);
                  if (index >= 0) {
                    setActiveHoleIndex(index);
                    setHoleEditMode("hole");
                  }
                }
                setMinimapJump((current) => ({ center: point, nonce: (current?.nonce ?? 0) + 1 }));
              }}
              onPracticeRound={(courseId) => {
                const reason = beginArchitectureTestRound(courseId);
                if (!reason) setShowArchitectureReview(false);
                return reason;
              }}
              onClose={() => setShowArchitectureReview(false)}
            />}
            {showLivingClub && !tutorialProgress && <LivingClubPanel
              course={course}
              world={world}
              profile={appProfile}
              activeGolferPersonIds={live.golfersRef.current.map((golfer) => ({ id: golfer.id, personId: golfer.personId }))}
              onProfile={handleProfileChange}
              onFollow={(golferId) => {
                live.selectGolfer(golferId);
                setFollowSelected(true);
                closeLivingClub();
              }}
              onStaffCommand={runStaffCommand}
              onChooseStory={chooseStory}
              onDeferStory={deferStory}
              onClose={closeLivingClub}
            />}
            {showSeasonsLegacy && !tutorialProgress && <SeasonsLegacyPanel
              course={course}
              world={world}
              day={live.status.dayIndex}
              onCommand={runSeasonCommand}
              onSurfaceRepair={(key, kind, absoluteDay) => dispatch({
                type: "START_SURFACE_REPAIR",
                key,
                kind,
                absoluteDay,
              })}
              onClose={() => setShowSeasonsLegacy(false)}
              biomeContext={contextualUiTheme}
            />}
            {showCampaign && world.campaign && !tutorialProgress && <CampaignPanel
              course={course}
              world={world}
              onStartMatch={startCampaignMatch}
              onContinueSandbox={continueCampaign}
              onClose={() => setShowCampaign(false)}
            />}
            {activeCampaignScene && world.campaign && !tutorialProgress && <CampaignSceneModal
              campaign={world.campaign}
              scene={activeCampaignScene}
              course={course}
              world={world}
              onChoose={chooseCampaign}
            />}
            {showPropertyManagement && !tutorialProgress && <PropertyManagementPanel course={course} world={world} onCommand={runPropertyCommand} onClose={() => setShowPropertyManagement(false)} />}
            {showLiveOverview && !tutorialProgress && <LiveOverview status={live.status} reputation={world.reputation} staffLevel={world.staffLevel} staffRoster={normalizedStaff(world, course)} courses={normalizeCourseLayouts(course).layouts!.map((layout) => ({ id: layout.id, name: layout.name }))} onAssignStaff={(staffId, courseId) => setWorld((current) => ({ ...current, staffRoster: normalizedStaff(current, course).map((member) => member.id === staffId ? { ...member, courseId } : member) }))} onSetPacePreset={live.setPacePreset} onUpdatePaceOperations={live.updatePaceOperations} onFocusHole={(holeId) => { const index = course.holes.findIndex((hole) => hole.id === holeId); const point = course.holes[index]?.green ?? course.holes[index]?.tee; if (index >= 0) setActiveHoleIndex(index); if (point) setMinimapJump((current) => ({ center: point, nonce: (current?.nonce ?? 0) + 1 })); setShowLiveOverview(false); }} onSelectGolfer={(id) => { live.selectGolfer(id); setFollowSelected(true); setShowLiveOverview(false); }} onClose={() => setShowLiveOverview(false)} />}
            {teeSetupPrompt && !tutorialProgress && (
              <div data-testid="tee-setup-offer" role="dialog" aria-label={t("courseSetup.offerAria")} className="cc-tycoon-panel" style={{ position: "absolute", zIndex: 145, top: 64, right: 16, width: 280, padding: 14 }}>
                <strong>{t("courseSetup.offerTitle")}</strong>
                <p style={{ margin: "6px 0 10px", fontSize: 12 }}>{t("courseSetup.offerHelp")}</p>
                <div style={{ display: "grid", gap: 6 }}>
                  {(["forward", "championship"] as const).map((teeSet) => {
                    const hole = course.holes[teeSetupPrompt.holeIndex];
                    if (getTeeBox(hole, teeSet)) return null;
                    const estimate = computeTerrainChangeCost("rough", "tee", costMult, course.theme).net;
                    return <button key={teeSet} data-testid={`offer-${teeSet}-tee`} onClick={() => {
                      setSelectedTeeSet(teeSet);
                      setActiveHoleIndex(teeSetupPrompt.holeIndex);
                      enterHoleEditMode(teeSetupPrompt.holeIndex, teeSet);
                      setSetupPlacement({ kind: "tee", key: teeSet });
                      setEditorMode("HOLE_WIZARD");
                      setPaintError(null);
                      setTeeSetupPrompt(null);
                    }}>{t("courseSetup.offerBuild", { tee: teeSet[0].toUpperCase() + teeSet.slice(1), cost: formatCurrency(Math.max(0, estimate)) })}</button>;
                  })}
                  <button onClick={() => setTeeSetupPrompt(null)}>{t("courseSetup.notNow")}</button>
                </div>
              </div>
            )}
            {setupPlacement && !pendingTeePlacement && !tutorialProgress && (() => {
              const hole = course.holes[activeHoleIndex];
              const existing = setupPlacement.kind === "tee"
                ? getTeeBox(hole, setupPlacement.key)
                : getPinPosition(hole, setupPlacement.key);
              const marker = setupPlacement.kind === "tee"
                ? `${setupPlacement.key[0].toUpperCase()}${setupPlacement.key.slice(1)} ${t("courseSetup.tee")}`
                : t("courseSetup.pin", { rotation: setupPlacement.key });
              const action = t(existing ? "courseSetup.move" : "courseSetup.place");
              return (
                <div data-testid="setup-placement-prompt" role="dialog" aria-label={t("courseSetup.placementAria")} className="cc-tycoon-panel" style={{ position: "absolute", zIndex: 150, bottom: 88, left: "50%", transform: "translateX(-50%)", width: 320, padding: 14 }}>
                  <strong>{t("courseSetup.placementTitle", { action, marker })}</strong>
                  <p style={{ margin: "6px 0 10px", fontSize: 12 }}>{t("courseSetup.placementHelp")}</p>
                  {paintError && <div role="alert" style={{ color: "#8b2e1b", fontSize: 12, marginBottom: 8 }}>{paintError}</div>}
                  <button onClick={() => { setSetupPlacement(null); setPaintError(null); }}>{t("courseSetup.cancelPlacement")}</button>
                </div>
              );
            })()}
            {pendingTeePlacement && !tutorialProgress && (
              <div data-testid="tee-placement-confirm" role="dialog" aria-label={t("courseSetup.confirmAria")} className="cc-tycoon-panel" style={{ position: "absolute", zIndex: 150, bottom: 88, left: "50%", transform: "translateX(-50%)", width: 300, padding: 14 }}>
                <strong>{t("courseSetup.confirmTitle", { action: t(getTeeBox(course.holes[pendingTeePlacement.holeIndex], pendingTeePlacement.teeSet) ? "courseSetup.actionMove" : "courseSetup.actionErect"), tee: pendingTeePlacement.teeSet })}</strong>
                <div style={{ margin: "7px 0", fontSize: 12 }}>{pendingTeePlacement.netCost >= 0 ? t("courseSetup.placementCost", { cost: formatCurrency(pendingTeePlacement.netCost) }) : t("courseSetup.placementSalvage", { value: formatCurrency(-pendingTeePlacement.netCost) })}</div>
                {pendingTeePlacement.netCost > world.cash && <div role="alert" style={{ color: "#8b2e1b", fontSize: 12, marginBottom: 7 }}>{t("courseSetup.shortfall", { amount: formatCurrency(pendingTeePlacement.netCost - world.cash) })}</div>}
                <div style={{ display: "flex", gap: 6 }}>
                  <button disabled={pendingTeePlacement.netCost > world.cash} onClick={() => commitTeeBox(pendingTeePlacement.holeIndex, pendingTeePlacement.teeSet, pendingTeePlacement.point, pendingTeePlacement.netCost)}>{t("courseSetup.confirm")}</button>
                  <button onClick={() => { setSetupPlacement({ kind: "tee", key: pendingTeePlacement.teeSet }); setPendingTeePlacement(null); setPaintError(null); }}>{t("courseSetup.chooseAnother")}</button>
                  <button onClick={() => { setPendingTeePlacement(null); setPaintError(null); }}>{t("courseSetup.cancel")}</button>
                </div>
              </div>
            )}
            {/* HoverTooltip now rendered on canvas to avoid React re-renders */}
            {!tutorialProgress && <HoleMinimap
              course={activeOperatingCourse}
              view={minimapView}
              golfersRef={live.golfersRef}
              onCenter={(center: Point) => {
                if (holeEditCamera) setHoleEditCamera({ ...holeEditCamera, center });
                else setMinimapJump((current) => ({ center, nonce: (current?.nonce ?? 0) + 1 }));
              }}
            />}
            <LiveControls
              status={live.status}
              speed={live.speed}
              onSetSpeed={(next) => {
                if (next === "paused") toggleClock();
                else {
                  resumeSpeedRef.current = next;
                  live.setSpeed(next);
                }
              }}
              cash={world.cash}
              reputation={world.reputation}
              week={world.week}
              onOpenPauseMenu={openPauseMenu}
              onOpenOverview={() => setShowLiveOverview((open) => !open)}
              overviewOpen={showLiveOverview}
              activePinRotation={course.activePinRotation ?? "A"}
              onSetActivePinRotation={(pinRotation) => dispatch({ type: "SET_ACTIVE_PIN_ROTATION", pinRotation })}
            />
            <GolferInspector
              selected={live.status.selected}
              setupDifficulty={live.status.selected ? computeRatingForSetup(course, live.status.selected.teeSet, live.status.selected.pinRotation).pinDifficultyDelta : undefined}
              following={followSelected}
              onToggleFollow={() => setFollowSelected((following) => !following)}
              onClose={() => { live.selectGolfer(null); setFollowSelected(false); }}
            />
          </div>
        </div>

        <div className="cc-sidebar-frame">
          {holeEditMode === "hole" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                backgroundColor: "rgba(255, 248, 235, 0.98)",
                borderRadius: 8,
                position: "relative",
              }}
            >
              <div
                data-tutorial-target="hole-editor-nav"
                style={{
                  padding: 12,
                  borderBottom: "1px solid rgba(0,0,0,0.1)",
                  display: "flex",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={exitHoleEditMode}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <T id="auto.app.exit" /></button>
                <button
                  onClick={() => navigateHole(-1)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <T id="auto.app.prev" /></button>
                <button
                  onClick={() => navigateHole(1)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <T id="auto.app.next" /></button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                <Suspense fallback={<div aria-live="polite" style={{ padding: 16 }}><T id="courseSetup.loadingInspector" /></div>}>
                <HoleInspector
                  holeIndex={activeHoleIndex}
                  evaluation={activeHoleEvaluation}
                  showFixOverlay={showFixOverlay}
                  setShowFixOverlay={setShowFixOverlay}
                  onFitHole={fitHole}
                  onFlyover={startFlyover}
                  course={course}
                  hole={course.holes[activeHoleIndex]}
                  thumbnail={<HoleMinimap course={course} hole={course.holes[activeHoleIndex]} holeIndex={activeHoleIndex} thumbnail />}
                  onSetHoleIndex={(newIndex: number) => {
                    // Update hole.holeIndex in course
                    setCourse((c) => {
                      const holes = c.holes.slice();
                      holes[activeHoleIndex] = {
                        ...holes[activeHoleIndex],
                        holeIndex: newIndex,
                      };
                      return { ...c, holes };
                    });
                  }}
                  onSmartPaintFairway={smartPaintFairway}
                  onBeginTeePlacement={(teeSet) => { setSetupPlacement({ kind: "tee", key: teeSet }); setEditorMode("HOLE_WIZARD"); setPaintError(null); }}
                  onBeginPinPlacement={(pinRotation) => { setSetupPlacement({ kind: "pin", key: pinRotation }); setEditorMode("HOLE_WIZARD"); setPaintError(null); }}
                  selectedTeeSet={selectedTeeSet}
                  onSelectTeeSet={setSelectedTeeSet}
                  onSetTeePar={setTeePar}
                  onRemoveTeeBox={removeTeeBox}
                  onRemovePinPosition={(pinRotation) => dispatch({ type: "REMOVE_PIN_POSITION", holeIndex: activeHoleIndex, pinRotation })}
                  onSetActivePinRotation={(pinRotation) => dispatch({ type: "SET_ACTIVE_PIN_ROTATION", pinRotation })}
                />
                </Suspense>
              </div>
            </div>
          ) : (
            <HUD
        course={course}
        world={world}
        last={last}
        prev={history.length >= 2 ? history[history.length - 2] : undefined}
        terrainBrushWidth={terrainBrushWidth}
        setTerrainBrushWidth={setTerrainBrushWidth}
        onUndoTerrain={undoTerrainEdit}
        onRedoTerrain={redoTerrainEdit}
        setGreenFee={(n) => {
          // Scenario constraint (ZKU-164): committee sets the fee, not you.
          if (world.constraints?.fixedGreenFee != null) return;
          setCourse((c) => updateLayout(c, activeCourseLayout(c).id, { greenFee: n }));
        }}
        setMaintenance={(n) => setWorld((w) => ({ ...w, maintenanceBudget: n }))}
        setGreenProgram={(program) => setCourse((current) => ({
          ...current,
          greenProgram: normalizeGreenProgram(program),
        }))}
        editorMode={editorMode}
        setEditorMode={setEditorMode}
        onEnterDesignMode={() => activateTerrainEditing()}
        startWizard={startWizard}
        startPlaceTee={startPlaceTee}
        startPlaceGreen={startPlaceGreen}
        buildingType={buildingType}
        setBuildingType={setBuildingType}
        concessionTypes={CONCESSION_TYPES}
        decorationKind={decorationKind}
        setDecorationKind={setDecorationKind}
        decorationRotation={decorationRotation}
        setDecorationRotation={setDecorationRotation}
        decorationSpan={decorationSpan}
        setDecorationSpan={setDecorationSpan}
        decorationAction={decorationAction}
        setDecorationAction={setDecorationAction}
        onConfigureBuilding={(x: number, y: number, tier: BuildingTier, price: number) => {
          const cap = reputationTier(world.reputation).buildingTierCap;
          if (tier > cap) {
            setPaintError(t("progression.locked", { reputation: tier === 2 ? 65 : 85 }));
            return;
          }
          dispatch({ type: "CONFIGURE_BUILDING", x, y, tier, price });
        }}
        activeHoleIndex={activeHoleIndex}
        setActiveHoleIndex={setActiveHoleIndex}
        onEnterHoleEditMode={enterHoleEditMode}
        wizardStep={wizardStep}
        draftTee={draftTee}
        draftGreen={draftGreen}
        onWizardConfirm={confirmWizard}
        onWizardRedo={redoWizard}
        onWizardNextHole={nextHoleWizard}
        setActiveHoleParMode={setActiveHoleParMode}
        setActiveHoleParManual={setActiveHoleParManual}
        onUpgradeStaff={onUpgradeStaff}
        onUpgradeMarketing={onUpgradeMarketing}
        staffUpgradeCost={staffUpgradeCost}
        marketingUpgradeCost={marketingUpgradeCost}
        canUpgradeStaff={canUpgradeStaff}
        canUpgradeMarketing={canUpgradeMarketing}
        onSave={onSave}
        onLoad={onLoad}
        onResetSave={onResetSave}
        paintError={paintError}
        sculptBrush={sculptBrush}
        setSculptBrush={setSculptBrush}
        sculptRadius={sculptRadius}
        setSculptRadius={setSculptRadius}
        fineGreenBrush={fineGreenBrush}
        setFineGreenBrush={setFineGreenBrush}
        fineGreenRadius={fineGreenRadius}
        setFineGreenRadius={setFineGreenRadius}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onFlyover={startFlyover}
        showObstacles={showObstacles}
        setShowObstacles={setShowObstacles}
        isBankrupt={world.isBankrupt}
        onTakeBridgeLoan={takeBridgeLoan}
        onTakeExpansionLoan={takeExpansionLoan}
        legacy={legacy}
        onUnlockFlagColor={(color, cost) => {
          setLegacy((s) => {
            if (s.legacyPoints < cost) return s;
            const next = {
              ...s,
              legacyPoints: s.legacyPoints - cost,
              unlocked: {
                ...s.unlocked,
                [color === "BLUE" ? "FLAG_BLUE" : "FLAG_GOLD"]: true,
              },
            };
            saveLegacy(next);
            return next;
          });
        }}
        onSelectFlagColor={(rgba) => {
          setLegacy((s) => {
            const next = { ...s, selected: { ...s.selected, flagColor: rgba } };
            saveLegacy(next);
            return next;
          });
        }}
        showShotPlan={showShotPlan}
        setShowShotPlan={setShowShotPlan}
        onOpenGolfopedia={(entry) => {
          setGolfopediaEntry(entry ?? null);
          flowDispatch({ type: "OPEN_MODAL", modal: "golfopedia" });
        }}
        onStartTutorial={() => beginTutorial()}
        tutorialTarget={tutorialProgress ? TUTORIAL_STEPS[tutorialProgress.stepIndex].target : undefined}
        biomeContext={contextualUiTheme}
      />
          )}
        </div>
        </div>
        <NewsTicker visible={!tutorialProgress && !photoMode && appProfile.gameplay.tickerVisible} onJump={jumpToEvent} onHide={() => handleProfileChange({ ...appProfile, gameplay: { ...appProfile.gameplay, tickerVisible: false } })} />
        {pendingWeekReport && <WeekCloseReport week={pendingWeekReport.week} result={pendingWeekReport.result} course={course} world={world} biomeContext={contextualUiTheme} resumeSpeed={pendingWeekReport.resumeSpeed} onContinue={() => {
          const resumeSpeed = pendingWeekReport.resumeSpeed;
          setPendingWeekReport(null);
          live.setSpeed(resumeSpeed);
        }} />}
        {flow.paused && (
          <PauseOverlay
            career={world.mode === "career"}
            dirty={dirty}
            onResume={resumeFromPause}
            onSave={onSave}
            onLoad={onLoad}
            onOptions={() => flowDispatch({ type: "OPEN_MODAL", modal: "options" })}
            onRestart={restartCurrentScenario}
            onQuit={quitToTitle}
          />
        )}
        {flow.modal === "options" && <DeferredSurface label={t("deferredSurface.settings")}><SettingsModal
          open={flow.modal === "options"}
          onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
          profile={appProfile}
          onProfileChange={handleProfileChange}
        /></DeferredSurface>}
      </TooltipSurface>
    </div>
  );
}

function PwaUpdateToast(props: { onReload: () => void }) {
  const { t } = useI18n();
  return <aside role="status" style={{ position: "fixed", right: 18, bottom: 72, zIndex: 100060, background: "#263b2d", color: "white", border: "2px solid #c99a32", borderRadius: 12, padding: 14, boxShadow: "0 10px 30px rgba(0,0,0,.3)" }}><div style={{ marginBottom: 8 }}>{t("pwa.update")}</div><button onClick={props.onReload}>{t("pwa.reload")}</button></aside>;
}

function BridgeLoanPrompt(props: { onAccept: () => void; onDecline: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99998,
        padding: 16,
      }}
    >
      <div style={{ width: "min(520px, 100%)", background: "#fff", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 6 }}><T id="auto.app.distress.take.a.bridge.loan" /></div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          <T id="auto.app.25.000.18.apr.26.weeks.amortized.weekly.payments.missi" /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={props.onAccept}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #000",
              background: "#000",
              color: "#fff",
              fontWeight: 800,
            }}
          >
            <T id="auto.app.take.loan" /></button>
          <button
            onClick={props.onDecline}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "#fff",
              fontWeight: 800,
            }}
          >
            <T id="auto.app.decline" /></button>
        </div>
      </div>
    </div>
  );
}

// HoverTooltip removed - now rendered on canvas for performance
