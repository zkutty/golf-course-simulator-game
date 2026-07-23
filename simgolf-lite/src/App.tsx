import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import { formatCurrency } from "./i18n/format";
import { useI18n } from "./i18n/useI18n";
import { perfProfiler } from "./utils/performanceProfiler";
import "./ui/cozyLayout.css";
import "./App.css";
import { PixiStage } from "./ui/PixiStage";
import { HUD } from "./ui/HUD";
import { DEFAULT_STATE, type GameState } from "./game/gameState";
import type { BuildingTier, ConcessionType, Course, DecorationKind, DecorationRotation, ParSetting, PinRotation, Point, TeeSet, Terrain, WeekResult, World } from "./game/models/types";
import { hasSavedGame, parseSaveText, resetSave, type SavePayload } from "./utils/save";
import { autosave, loadSlot, mostRecentSlot, saveToSlot } from "./utils/saveStore";
import { SaveLoadModal } from "./ui/SaveLoadModal";
import { computeTerrainChangeCost, ELEVATION_COST_PER_STEP } from "./game/models/terrainEconomics";
import { previewTerrainStroke, type TerrainStrokePreview } from "./game/models/terrainStroke";
import { computeSculptDeltas, sculptSteps, type SculptBrush, type SculptRadius } from "./game/models/sculpt";
import { maxSlopeInRect } from "./game/models/elevation";
import type { ObstacleType } from "./game/models/types";
import { scoreCourseHoles } from "./game/sim/holes";
import { computeCourseRatingAndSlope, computeRatingForSetup, computeRatingsByTee } from "./game/sim/courseRating";
import { canTakeBridgeLoan, canTakeExpansionLoan } from "./game/sim/loanEligibility";
import { legacyAwardForRun, loadLegacy, saveLegacy } from "./utils/legacy";
import { getEffectiveBalance, terrainCostMult } from "./game/balance/difficulty";
import { GameBackground } from "./ui/gameui";
import { StartMenu } from "./ui/StartMenu";
import { useAudio } from "./audio/audioContext";
import { HoleInspector } from "./ui/HoleInspector";
import { evaluateHole } from "./game/eval/evaluateHole";
import type { CameraState, IsoCameraSnapshot } from "./game/render/camera";
import { computeHoleCamera, computeZoomPreset } from "./game/render/camera";
import { HoleMinimap } from "./ui/HoleMinimap";
import { createNewGame } from "./game/gen/newGame";
import type { GameSetup } from "./game/models/setup";
import { createScenarioGame, getScenario } from "./game/scenarios/scenarios";
import type { ScenarioDefinition } from "./game/scenarios/types";
import { recordScenarioAttempt, recordScenarioCompleted } from "./utils/careerStore";
import { NewGameWizard } from "./ui/NewGameWizard";
import { generateCourseName } from "./utils/courseNames";
import { applyAction } from "./core/reducer";
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
import { createM20TerrainReferenceCourse, createM21BiomeReferenceCourse, createM22VisualReferenceCourse, createM23CourseSetupReferenceCourse, createM26MultiCourseReferenceCourse, createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse, createReferenceCourse, createRenderPerfCourse, createTournamentStandardsCourse } from "./game/testing/referenceCourse";
import { createLiveState, createRenderPerfLiveState } from "./game/live/simulation";
import { runLiveDaysHeadless } from "./game/live/headless";
import { snapshotLiveSimulation } from "./game/live/persistence";
import { hashGameState } from "./utils/stateHash";
import {
  BUILDING_SPECS,
  CONCESSION_TYPES,
  buildingAtTile,
  canPlaceBuilding,
} from "./game/models/buildings";
import { canPlaceDecoration, decorationAtTile, decorationCost } from "./game/models/decorations";
import { GolfopediaModal } from "./ui/help/GolfopediaModal";
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
import { SettingsModal } from "./ui/SettingsModal";
import { LIVE, type SpeedName } from "./game/live/liveConfig";
import { courseForCourseSetup, getParSetting, getTeeBox, TEE_SETS, validateHoleCourseSetup, withNormalizedHoleSetup } from "./game/models/courseSetup";
import { eventMatchesBinding } from "./accessibility/keybindings";
import { T } from "./i18n/T";
import { ambientMixFor, distanceVolume, musicContextFor } from "./audio/environment";
import { emptyCourseRecords, recordCompletedRound, recordWeek } from "./game/retention/records";
import type { CourseRecords, RetentionEvent } from "./game/retention/types";
import { publishRetentionEvent, subscribeRetentionEvents } from "./game/retention/eventBus";
import { evaluateAchievements, type AchievementContext, type AchievementDefinition } from "./game/retention/achievements";
import { RetentionHub } from "./ui/retention/RetentionHub";
import { AchievementToasts } from "./ui/retention/AchievementToasts";
import { NewsTicker } from "./ui/retention/NewsTicker";
import { PhotoModeOverlay } from "./ui/retention/PhotoModeOverlay";
import { captureCourseCanvas, createCourseCard, downloadBlob, shareBlob } from "./utils/photoCapture";
import { usePwa } from "./hooks/usePwa";
import { TournamentPanel } from "./ui/TournamentPanel";
import { LandOfficePanel } from "./ui/LandOfficePanel";
import { isOwnedTile } from "./game/estate/estate";
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
import { activeCourseLayout, courseForLayout, normalizeCourseLayouts, selectLayout, updateLayout } from "./game/models/courseLayouts";
import { analyzeArchitecture } from "./game/architecture/architecture";
import { normalizedStaff, staffFromLevel } from "./game/live/pace";
import { WeekCloseReport } from "./ui/WeekCloseReport";
import { appendDayToLedger, createWeekLedger } from "./game/live/weeklyLedger";
import { PropertyManagementPanel } from "./ui/PropertyManagementPanel";
import { applyPropertyCommand, emptyPropertyEnterprise, propertySummary, settlePropertyDay, starterPropertyCourse, type PropertyCommand } from "./game/property/property";

type EditorMode = "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
type WizardStep = "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
type ViewMode = "global" | "hole";

export default function App() {
  const { t } = useI18n();
  const [flow, flowDispatch] = useReducer(reduceScreenFlow, INITIAL_SCREEN_FLOW);
  const [appProfile, setAppProfile] = useState<AppProfile>(() => loadAppProfile());
  const screen = flow.base === "title" ? "menu" : flow.base === "setup-wizard" ? "setup" : flow.base === "in-game" ? "game" : "loading";
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
  const [gameState, setGameState] = useState<GameState>(DEFAULT_STATE);
  const [records, setRecords] = useState<CourseRecords>(() => emptyCourseRecords(DEFAULT_STATE.course.holes.length));
  const recordsRef = useRef(records);
  const sculptedRef = useRef(false);
  const gameStateRef = useRef(gameState);
  const { course, world } = gameState;
  const activeLayout = useMemo(() => activeCourseLayout(course), [course]);
  const activeOperatingCourse = useMemo(() => courseForLayout(course, activeLayout.id), [course, activeLayout.id]);
  const [selected, setSelected] = useState<Terrain>("fairway");
  // Difficulty-resolved balance + terrain cost scaler (ZKU-165).
  const BALANCE = getEffectiveBalance(world.difficulty);
  const costMult = terrainCostMult(world.difficulty);

  // Dispatch function for actions
  const dispatch = useCallback((action: Action) => {
    if (action.type === "SCULPT_TILES") sculptedRef.current = true;
    // Log reducer dispatch count (only for mutations, not UI-only actions)
    if (DEBUG_PERF && (action.type !== "SET_MODE" && action.type !== "SET_ACTIVE_HOLE" && action.type !== "SET_BRUSH")) {
      logReducerDispatch();
    }
    setGameState((prevState) => applyAction(prevState, action));
    if (action.type !== "NEW_GAME" && action.type !== "LOAD_GAME" && !action.type.startsWith("SET_")) markDirty();
  }, [markDirty]);

  // Versioned integration setters for live-simulation and UI configuration
  // commits that are intentionally outside the serializable core action list.
  const setCourse = useCallback((updater: (c: typeof course) => typeof course) => {
    markDirty();
    setGameState((prevState) => {
      const nextCourse = updater(prevState.course);
      if (nextCourse === prevState.course) return prevState;
      return {
        ...prevState,
        course: nextCourse,
        terrainVersion: prevState.terrainVersion + 1,
        markersVersion: prevState.markersVersion + 1,
        economyVersion: prevState.economyVersion + 1,
      };
    });
  }, [markDirty]);
  
  const setWorld = useCallback((updater: (w: typeof world) => typeof world) => {
    markDirty();
    setGameState((prevState) => {
      const nextWorld = updater(prevState.world);
      if (nextWorld === prevState.world) return prevState;
      return {
        ...prevState,
        world: nextWorld,
        economyVersion: prevState.economyVersion + 1,
      };
    });
  }, [markDirty]);
  const [last, setLast] = useState<WeekResult | undefined>(undefined);
  const [history, setHistory] = useState<WeekResult[]>([]);
  const historyRef = useRef(history);

  useEffect(() => {
    gameStateRef.current = gameState;
    historyRef.current = history;
    recordsRef.current = records;
  }, [gameState, history, records]);

  const [editorMode, setEditorMode] = useState<EditorMode>("PAINT");
  const [activeHoleIndex, setActiveHoleIndex] = useState(0); // 0..8
  const [selectedTeeSet, setSelectedTeeSet] = useState<TeeSet>("member");
  const [wizardStep, setWizardStep] = useState<WizardStep>("TEE");
  const [draftTee, setDraftTee] = useState<Point | null>(null);
  const [draftGreen, setDraftGreen] = useState<Point | null>(null);
  const [setupPlacement, setSetupPlacement] = useState<{ kind: "tee"; key: TeeSet } | { kind: "pin"; key: PinRotation } | null>(null);
  const [teeSetupPrompt, setTeeSetupPrompt] = useState<{ holeIndex: number } | null>(null);
  const [pendingTeePlacement, setPendingTeePlacement] = useState<{ holeIndex: number; teeSet: TeeSet; point: Point; netCost: number } | null>(null);
  const [obstacleType, setObstacleType] = useState<ObstacleType>("tree");
  const [sculptBrush, setSculptBrush] = useState<SculptBrush>("raise");
  const [sculptRadius, setSculptRadius] = useState<SculptRadius>(1);
  const [buildingType, setBuildingType] = useState<ConcessionType>("snack_bar");
  const [decorationKind, setDecorationKind] = useState<DecorationKind>("bench");
  const [decorationRotation, setDecorationRotation] = useState<DecorationRotation>(0);
  const [decorationSpan, setDecorationSpan] = useState(3);
  const [decorationAction, setDecorationAction] = useState<"place" | "rotate" | "remove">("place");

  const [capital, setCapital] = useState(() => ({
    spent: 0,
    refunded: 0,
    byTerrainSpent: {} as Partial<Record<Terrain, number>>,
    byTerrainTiles: {} as Partial<Record<Terrain, number>>,
  }));
  const [pendingWeekReport, setPendingWeekReport] = useState<{
    week: number;
    result: WeekResult;
    resumeSpeed: Exclude<SpeedName, "paused">;
  } | null>(null);

  // Hover state moved to refs in canvas component to avoid React re-renders

  const [paintError, setPaintError] = useState<string | null>(null);
  const [saveModalCanSave, setSaveModalCanSave] = useState(false);
  const payloadSequenceRef = useRef(0);
  const [showObstacles, setShowObstacles] = useState(true);
  const [viewMode, setViewMode] = useState<"COZY" | "ARCHITECT">(() => appProfile.graphics.gridOverlays ? "ARCHITECT" : "COZY");
  const [holeEditMode, setHoleEditMode] = useState<ViewMode>("global"); // "global" or "hole"
  const [holeEditCamera, setHoleEditCamera] = useState<CameraState | null>(null);
  const [minimapView, setMinimapView] = useState<IsoCameraSnapshot | null>(null);
  const [minimapJump, setMinimapJump] = useState<{ center: Point; nonce: number } | null>(null);
  const [audioCameraCenter, setAudioCameraCenter] = useState<Point>(() => ({ x: course.width / 2, y: course.height / 2 }));
  const audioCameraCenterRef = useRef(audioCameraCenter);
  const holeEditCameraManualRef = useRef(false); // Track if camera was manually set
  const [showFixOverlay, setShowFixOverlay] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => appProfile.graphics.animations);
  const [flyoverNonce, setFlyoverNonce] = useState(0);
  const soundEnabled = !appProfile.audio.masterMuted && appProfile.audio.masterVolume > 0 && appProfile.audio.sfxVolume > 0;
  const effectiveAnimations = animationsEnabled && !appProfile.accessibility.reducedMotion;
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
  const architectureReport = useMemo(() => showCourseManager ? analyzeArchitecture(activeOperatingCourse) : null, [activeOperatingCourse, showCourseManager]);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [showProgression, setShowProgression] = useState(false);
  const [showLiveOverview, setShowLiveOverview] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<AchievementDefinition[]>([]);
  const [photoMode, setPhotoMode] = useState(false);
  const [photoGolfers, setPhotoGolfers] = useState(true);
  const [photoMarkers, setPhotoMarkers] = useState(false);
  const lastCourseCardRef = useRef<Blob | null>(null);
  const pwa = usePwa();

  const runPropertyCommand = useCallback((command: PropertyCommand) => {
    const current = gameStateRef.current;
    const result = applyPropertyCommand(current.course, current.world, command);
    if (result.ok) {
      dispatch({ type: "PROPERTY_COMMAND", command });
    }
    return result;
  }, [dispatch]);

  const achievementContext = useCallback((nextRecords = recordsRef.current, perfectMood = false): AchievementContext => ({
    course: gameStateRef.current.course,
    world: gameStateRef.current.world,
    records: nextRecords,
    rating: computeCourseRatingAndSlope(gameStateRef.current.course).courseRating,
    tutorialCompleted: loadAppProfile().tutorialCompleted,
    profitStreak: nextRecords.currentProfitStreak,
    sculpted: sculptedRef.current,
    recoveredDistress: prevDistress > 0 && gameStateRef.current.world.distressWeeks === 0,
    perfectMood,
  }), [prevDistress]);

  const checkAchievements = useCallback((nextRecords = recordsRef.current, perfectMood = false) => {
    const current = loadAppProfile();
    const evaluated = evaluateAchievements(current, achievementContext(nextRecords, perfectMood), gameStateRef.current.course.name);
    if (!evaluated.earned.length) return;
    saveAppProfile(evaluated.profile);
    setAppProfile(evaluated.profile);
    setAchievementQueue((queue) => [...queue, ...evaluated.earned]);
    void audio.playSting("celebration");
  }, [achievementContext, audio]);

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
          rating: computeCourseRatingAndSlope(gameStateRef.current.course).courseRating,
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
      setGameState((current) => {
        const sequence = changeSequenceRef.current;
        void autosave({ course: current.course, world: current.world, history: historyRef.current, records: recordsRef.current, live: liveSnapshot, tutorial: tutorialProgress })
          .then(() => markClean(sequence));
        return current;
      });
    },
    onRoundCompleted: (round, dayIndex) => {
      const captured = recordCompletedRound(recordsRef.current, round, gameStateRef.current.world.week);
      recordsRef.current = captured.records;
      setRecords(captured.records);
      for (const holeIndex of captured.aceHoles) {
        const holeId = round.holeIds?.[holeIndex];
        const globalIndex = holeId ? gameStateRef.current.course.holes.findIndex((hole) => hole.id === holeId) : holeIndex;
        const point = gameStateRef.current.course.holes[globalIndex]?.green ?? undefined;
        publishRetentionEvent({ type: "hole-in-one", category: "play", severity: "major", message: t("retention.holeInOne", { golfer: round.golferName, hole: holeIndex + 1 }), week: gameStateRef.current.world.week, day: dayIndex, golferId: round.golferId, golferName: round.golferName, holeIndex: globalIndex, holeId, courseId: round.courseId, point });
      }
      if (captured.courseRecord) {
        const lastHoleId = round.holeIds?.at(-1);
        const lastHole = lastHoleId ? gameStateRef.current.course.holes.find((hole) => hole.id === lastHoleId) : gameStateRef.current.course.holes.at(-1);
        publishRetentionEvent({ type: "course-record", category: "play", severity: "major", message: t("retention.courseRecord", { golfer: round.golferName, score: round.scoreToPar > 0 ? `+${round.scoreToPar}` : round.scoreToPar }), week: gameStateRef.current.world.week, day: dayIndex, golferId: round.golferId, golferName: round.golferName, courseId: round.courseId, holeId: lastHoleId, point: lastHole?.green ?? undefined });
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
  const getLiveSnapshot = live.getSnapshot;

  const bookTournament = useCallback((tier: TournamentTier, daysAhead: number): string | null => {
    const current = gameStateRef.current;
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
  }, [audio, live.status.dayIndex, setWorld, soundEnabled, t]);

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
    const isPropertyFixture = fixtureParams.get("propertyFixture") === "1";
    const isPerfMeasurement = fixtureParams.get("perfMeasure") === "1";
    if (!isPerfFixture && !isM19Fixture && !isM20Fixture && !isM21Fixture && !isM22Fixture && !isM23Fixture && !isM24Fixture && !isM25Fixture && !isM26Fixture && !isM27Fixture && !isPropertyFixture) return;
    perfFixtureLoadedRef.current = true;
    const fixtureRepParam = fixtureParams.get("m7Rep");
    const fixtureRep = fixtureRepParam == null ? Number.NaN : Number(fixtureRepParam);
    const requestedTheme = fixtureParams.get("m22Theme") ?? fixtureParams.get("m21Theme") ?? fixtureParams.get("m20Theme") ?? fixtureParams.get("perfTheme");
    const fixtureTheme = requestedTheme === "links" || requestedTheme === "desert" ? requestedTheme : "parkland";
    let fixtureCourse = isPropertyFixture
      ? { ...createReferenceCourse(), property: starterPropertyCourse() }
      : isM27Fixture
      ? createM27ReleaseReferenceCourse(fixtureTheme)
      : isM26Fixture
      ? createM26MultiCourseReferenceCourse()
      : isM25Fixture
      ? createNewGame({ mode: "sandbox", courseName: "M25 Survey Estate", seed: 250025, theme: fixtureTheme, difficulty: "normal", sandboxOverrides: { startingCash: 500_000 } }).course
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
    const fixtureWorld = {
      ...gameStateRef.current.world,
      week: 1,
      cash: isPropertyFixture ? 1_000_000 : isM25Fixture ? 500_000 : 250_000,
      reputation: Number.isFinite(fixtureRep) ? Math.max(0, Math.min(100, fixtureRep)) : 95,
      runSeed: 12160,
      isBankrupt: false,
      distressWeeks: 0,
      mode: "sandbox" as const,
      ...(isPropertyFixture ? { enterprise: emptyPropertyEnterprise() } : {}),
    };
    dispatch({ type: "LOAD_GAME", course: fixtureCourse, world: fixtureWorld });
    if (isM23Fixture) {
      setActiveHoleIndex(0);
      setHoleEditMode("hole");
      setViewMode("ARCHITECT");
      if (showTeeOfferFixture) setTeeSetupPrompt({ holeIndex: 0 });
    }
    if (isPerfFixture || isM27Fixture) {
      live.restoreSnapshot(snapshotLiveSimulation({
        state: createRenderPerfLiveState(fixtureCourse, fixtureWorld),
        pendingCash: 0,
        speed: isPerfMeasurement ? "paused" : "4x",
        selectedGolferId: null,
      }));
    }
    setAppProfile((current) => ({ ...current, tutorialOffered: true, tutorialCompleted: true }));
    setTutorialProgress(null);
    setShowTutorialOffer(false);
    if (isM27Fixture && !isPerfMeasurement) setShowCourseManager(true);
    flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreCourse") });
    flowDispatch({ type: "ENTER_GAME" });
    live.setSpeed((isPerfFixture || isM27Fixture) && !isPerfMeasurement ? "4x" : "paused");
  }, [dispatch, live, t]);

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
    const current = gameStateRef.current;
    await saveToSlot("quick-save", "manual", t("save.quick"), {
      course: current.course, world: current.world, history: historyRef.current,
      records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress,
    });
    markClean(sequence);
    setA11yMessage(t("save.quickComplete"));
  }, [flow.base, live, markClean, t, tutorialProgress]);


  const quitToTitle = useCallback(() => {
    if (dirty && !window.confirm(t("quit.confirm"))) return;
    live.setSpeed("paused");
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
        event.preventDefault(); setEditorMode("PAINT");
      } else if (eventMatchesBinding(event, bindings.obstacleTool)) {
        event.preventDefault(); setEditorMode("OBSTACLE");
      } else if (eventMatchesBinding(event, bindings.buildingTool)) {
        event.preventDefault(); setEditorMode("BUILDING");
      } else if (eventMatchesBinding(event, bindings.quicksave)) {
        event.preventDefault(); void quickSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appProfile.accessibility.keybindings, flow.base, flow.modal, flow.paused, live, openPauseMenu, quickSave, resumeFromPause, toggleClock, tutorialProgress]);

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
      const current = gameStateRef.current;
      void autosave({ course: current.course, world: current.world, history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress })
        .then(() => markClean(sequence));
    }, cadence === "5m" ? 300_000 : 900_000);
    return () => window.clearInterval(interval);
  }, [appProfile.gameplay.autosaveCadence, flow.base, live, markClean, tutorialProgress]);

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
        evaluateHole(activeSetupCourse, activeSetupCourse.holes[activeHoleIndex], activeHoleIndex)
      ),
    [activeSetupCourse, activeHoleIndex]
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
  const objectiveOutcome: RunOutcome = world.objectives?.outcome ?? "OPEN";
  if (objectiveOutcome !== prevOutcome) {
    setPrevOutcome(objectiveOutcome);
    if (objectiveOutcome === "WON" && prevOutcome === "OPEN") setShowVictory(true);
  }

  // Career medal (ZKU-164): record the win once per run; replays keep the
  // best (earliest) week via the store.
  const objectivesOutcomeForRecord = world.objectives?.outcome;
  useEffect(() => {
    if (showVictory) void audio.playSting("celebration");
  }, [audio, showVictory]);

  useEffect(() => {
    if (objectivesOutcomeForRecord !== "WON") return;
    if (scenarioRecordedRef.current) return;
    if (world.mode !== "career" || !world.scenarioId) return;
    scenarioRecordedRef.current = true;
    recordScenarioCompleted(world.scenarioId, {
      week: world.objectives?.wonWeek ?? world.week,
      cash: world.cash,
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

  // One app-state mapping owns music selection. Track files remain preload=none
  // until the first user gesture unlocks the manager.
  useEffect(() => {
    void audio.setMusicContext(musicContextFor({
      screen,
      viewMode,
      cash: world.cash,
      liveRunning: live.speed !== "paused",
      won: world.objectives?.outcome === "WON",
    }));
  }, [screen, viewMode, world.cash, world.objectives?.outcome, live.speed, audio]);

  useEffect(() => {
    audio.setPaused(flow.paused || live.speed === "paused");
    audio.setAmbientMix(ambientMixFor({
      course,
      center: audioCameraCenter,
      dayMinute: live.status.dayMinute,
      visibleGolfers: live.status.onCourse,
      paused: flow.paused || live.speed === "paused",
    }));
  }, [audio, audioCameraCenter, course, flow.paused, live.speed, live.status.dayMinute, live.status.onCourse]);

  // THE new-run path (ZKU-162): every fresh run goes through createNewGame
  // (or createScenarioGame for career runs) and then this shared reset.
  function beginTutorial(tutorialCourse = course, tutorialWorld = world) {
    const progress = createTutorialProgress(tutorialCourse, tutorialWorld);
    setTutorialProgress(progress);
    saveTutorialProgress(progress);
    updateAppProfile({ tutorialOffered: true });
    setGolfopediaEntry(undefined);
    setAdvisorMessage(null);
    setShowTutorialOffer(false);
  }

  function finishTutorial(completed: boolean) {
    setTutorialProgress(null);
    saveTutorialProgress(null);
    updateAppProfile({ tutorialOffered: true, tutorialCompleted: completed || loadAppProfile().tutorialCompleted });
    setShowTutorialOffer(false);
    void autosave({ course, world, history, records, live: live.getSnapshot(), tutorial: null });
    checkAchievements(records);
  }

  function startRun(newCourse: typeof course, newWorld: typeof world) {
    dispatch({ type: "NEW_GAME", course: newCourse, world: newWorld });
    markClean();
    setHistory([]);
    sculptedRef.current = false;
    const freshRecords = emptyCourseRecords(newCourse.holes.length);
    recordsRef.current = freshRecords;
    setRecords(freshRecords);
    setLast(undefined);
    setPendingWeekReport(null);
    setEditorMode("PAINT");
    setActiveHoleIndex(0);
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
    setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
    setPaintError(null);
    setShowLandOffice(false);
    setSelectedParcelId(newCourse.estate?.starterParcelId ?? null);
    setObstacleType("tree");
    setFlyoverNonce(0);
    setPeakCash(newWorld.cash);
    setPeakRep(newWorld.reputation);
    setShowBridgePrompt(false);
    setPrevDistress(0);
    legacyAwardedRef.current = false;
    scenarioRecordedRef.current = false;
    setPrevOutcome("OPEN");
    setShowVictory(false);
    if (!loadAppProfile().tutorialOffered) setShowTutorialOffer(true);
  }

  useEffect(() => {
    if (screen !== "game" || !tutorialProgress) return;
    const sequence = ++tutorialSaveSequenceRef.current;
    queueMicrotask(() => {
      if (tutorialSaveSequenceRef.current === sequence) setTutorialSaveStatus("saving");
    });
    void autosave({ course, world, history, records, live: getLiveSnapshot(), tutorial: tutorialProgress }).then(() => {
      if (tutorialSaveSequenceRef.current === sequence) setTutorialSaveStatus("saved");
    });
  }, [screen, course, world, history, records, tutorialProgress, getLiveSnapshot]);

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
    flowDispatch({ type: "BEGIN_LOADING", label: t("scenario.preparing", { name: t(scenario.nameKey) }) });
    window.setTimeout(() => {
      recordScenarioAttempt(scenario.id);
      const { course: newCourse, world: newWorld } = createScenarioGame(scenario);
      live.restoreSnapshot(undefined);
      startRun(newCourse, newWorld);
      live.setSpeed(appProfile.gameplay.defaultGameSpeed);
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

  function applyLoadedGame(loaded: SavePayload) {
    dispatch({ type: "LOAD_GAME", course: loaded.course, world: loaded.world });
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
    scenarioRecordedRef.current = loaded.world.objectives?.outcome === "WON";
    setTutorialProgress(loaded.tutorial ?? null);
    saveTutorialProgress(loaded.tutorial ?? null);
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
    const renderText = () => JSON.stringify({
      coordinateSystem: "tile coordinates; origin top-left, +x right, +y down",
      screen,
      screenBase: flow.base,
      modal: flow.modal,
      paused: flow.paused,
      tutorialStep: tutorialProgress?.stepIndex ?? null,
      course: {
        name: course.name,
        theme: course.theme ?? "parkland",
        width: course.width,
        height: course.height,
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
            recentRevenue: summary.recentRevenue,
            recentCosts: summary.recentCosts,
            incidents: summary.enterprise.incidents.slice(-5),
          };
        })(),
      },
      camera: {
        center: audioCameraCenter,
        zoom: minimapView?.zoom ?? null,
        rotation: minimapView?.rotation ?? 0,
        visibleEstateBounds: minimapView?.bounds ?? null,
        viewMode,
        renderer: "pixi",
        regionalSurround: true,
      },
      simulation: { speed: live.speed, dayMinute: live.status.dayMinute, clock: live.status.clockLabel, onCourse: live.status.onCourse, roundsToday: live.status.roundsToday, arrivalsRemaining: live.status.arrivalsRemaining, weekReport: pendingWeekReport ? { week: pendingWeekReport.week, profit: pendingWeekReport.result.profit } : null, overviewOpen: showLiveOverview, following: followSelected ? live.selectedId : null, pace: live.status.pace, golfers: live.status.golfers.map((golfer) => ({ id: golfer.id, courseId: golfer.courseId, currentHoleId: golfer.currentHoleId, scoreToPar: golfer.scoreToPar })) },
      economy: { cash: world.cash, reputation: world.reputation, condition: world.isBankrupt ? "bankrupt" : course.condition },
      progression: { panelOpen: showProgression, tier: reputationTier(world.reputation).id, staffCap: reputationTier(world.reputation).staffCap, buildingTierCap: reputationTier(world.reputation).buildingTierCap },
      editor: { mode: editorMode, selectedTerrain: selected, selectedDecoration: decorationKind, decorationRotation, decorationSpan, decorationAction, activeHole: activeHoleIndex + 1, selectedTeeSet, teePlacementPending: pendingTeePlacement ? { teeSet: pendingTeePlacement.teeSet, point: pendingTeePlacement.point, netCost: pendingTeePlacement.netCost } : null },
      graphics: { animations: effectiveAnimations, waterAnimation: effectiveAnimations && appProfile.graphics.waterAnimation, treeSway: effectiveAnimations && appProfile.graphics.treeSway },
      retention: { photoMode, recordsOpen: showRetention, achievementsEarned: appProfile.achievements.earned.length, totalRounds: records.totalRounds, aces: records.aces.length, tickerVisible: appProfile.gameplay.tickerVisible },
      tournament: {
        panelOpen: showTournaments,
        scheduled: tournamentCalendar(world).events.filter((event) => event.status === "scheduled").length,
        cancelled: tournamentCalendar(world).events.filter((event) => event.status === "cancelled").length,
        warnings: tournamentCalendar(world).events.filter((event) => event.status === "scheduled" && event.warning).map((event) => ({ name: event.name, warning: event.warning })),
        readiness: tournamentReadiness,
        active: live.status.tournament ? { name: live.status.tournament.name, teeSet: live.status.tournament.teeSet, pinRotation: live.status.tournament.pinRotation, standings: live.status.tournament.standings.slice(0, 5) } : null,
      },
      golfers: live.golfersRef.current.slice(0, 24).map((golfer) => ({ id: golfer.id, x: Number(golfer.x.toFixed(2)), y: Number(golfer.y.toFixed(2)), segment: golfer.segKind, shot: golfer.shot, mood: Number(golfer.mood.toFixed(2)), teeSet: golfer.teeSet, pinRotation: golfer.pinRotation })),
    });
    window.render_game_to_text = renderText;
    window.advanceTime = live.advanceTime;
    return () => {
      if (window.render_game_to_text === renderText) delete window.render_game_to_text;
      if (window.advanceTime === live.advanceTime) delete window.advanceTime;
    };
  }, [activeHoleIndex, activeLayout.id, activeOperatingCourse, architectureReport, appProfile.achievements.earned.length, appProfile.gameplay.tickerVisible, appProfile.graphics.treeSway, appProfile.graphics.waterAnimation, audioCameraCenter, course, decorationAction, decorationKind, decorationRotation, decorationSpan, editorMode, effectiveAnimations, flow.base, flow.modal, flow.paused, followSelected, live, minimapView, pendingTeePlacement, pendingWeekReport, photoMode, records, screen, selected, selectedParcelId, selectedTeeSet, showCourseManager, showLandOffice, showLiveOverview, showProgression, showPropertyManagement, showRetention, showTournaments, tutorialProgress?.stepIndex, viewMode, world]);

  useEffect(() => {
    if (import.meta.env.MODE !== "e2e") return;
    window.__coursecraftTest = {
      state: () => {
        const current = gameStateRef.current;
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
          terrainCounts: current.course.tiles.reduce((counts, terrain) => ({
            ...counts,
            [terrain]: (counts[terrain] ?? 0) + 1,
          }), {} as Partial<Record<Terrain, number>>),
          courseHash: hashGameState({ course: current.course, world: current.world, live: liveSnapshot }),
        };
      },
      setPaintCash: (cash: number) => {
        setGameState((current) => ({ ...current, world: { ...current.world, cash } }));
      },
      setPropertyFixture: () => {
        const fixtureCourse = { ...createReferenceCourse(), property: starterPropertyCourse() };
        const fixtureWorld = { ...gameStateRef.current.world, cash: 1_000_000, reputation: 82, enterprise: emptyPropertyEnterprise(), isBankrupt: false, distressWeeks: 0 };
        dispatch({ type: "LOAD_GAME", course: fixtureCourse, world: fixtureWorld });
        live.restoreSnapshot(snapshotLiveSimulation({ state: createLiveState(fixtureCourse, fixtureWorld, 0), pendingCash: 0, speed: "paused", selectedGolferId: null }));
      },
      startWeekCloseFixture: async (weekOverride?: number) => {
        const course = gameStateRef.current.course;
        const world = { ...gameStateRef.current.world, week: weekOverride ?? gameStateRef.current.world.week, cash: Math.max(100_000, gameStateRef.current.world.cash), runSeed: 424242, isBankrupt: false, distressWeeks: 0 };
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
        const current = gameStateRef.current;
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
        scenarioRecordedRef.current = loaded.world.objectives?.outcome === "WON";
        flowDispatch({ type: "BACK_TO_TITLE" });
        flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreCourse") });
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
        let fixtureWorld: World = { ...gameStateRef.current.world, cash: 1_000_000, reputation: 82, enterprise: emptyPropertyEnterprise(), isBankrupt: false, distressWeeks: 0 };
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
      validateFixture: (text: string) => {
        const result = parseSaveText(text);
        return result.ok
          ? { ok: true as const, migratedFrom: result.migratedFrom ?? null }
          : { ok: false as const, error: result.error.message };
      },
      startTournamentFixture: () => {
        const current = gameStateRef.current;
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
        const current = gameStateRef.current;
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
  }, [dispatch, dirty, flow.base, flow.modal, flow.paused, live, pendingWeekReport, screen, t, tutorialProgress]);

  function newGameFromMenu() {
    void audio.unlock();
    flowDispatch({ type: "OPEN_SETUP" });
  }

  function startNewGame(setup: GameSetup) {
    void audio.unlock();
    void audio.playSfx("confirm");
    flowDispatch({ type: "BEGIN_LOADING", label: t("loading.growCourse") });
    window.setTimeout(() => {
      restartRun(setup);
      live.setSpeed(appProfile.gameplay.defaultGameSpeed);
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
    if (!recent) return;
    flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreLatest") });
    const loaded = await loadSlot(recent.id);
    if (!loaded) {
      flowDispatch({ type: "BACK_TO_TITLE" });
      return;
    }
    applyLoadedGame(loaded);
    flowDispatch({ type: "ENTER_GAME" });
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
    const prev = course.tiles[idx];
    const { net, charged, refunded } = computeTerrainChangeCost(prev, next, costMult, course.theme);
    if (net > 0 && world.cash < net) {
      setPaintError(t("error.insufficientFunds", { amount: formatCurrency(Math.ceil(net)) }));
      return false;
    }
    if (prev === next) return true;

    // Dispatch PAINT_TILES action
    dispatch({
      type: "PAINT_TILES",
      tiles: [{ x, y, terrain: next }],
    });

    // Track capital spending since last simulate (separate from game state)
    setCapital((c) => ({
      spent: c.spent + charged,
      refunded: c.refunded + refunded,
      byTerrainSpent: {
        ...c.byTerrainSpent,
        [next]: (c.byTerrainSpent[next] ?? 0) + charged,
      },
      byTerrainTiles: {
        ...c.byTerrainTiles,
        [next]: (c.byTerrainTiles[next] ?? 0) + (prev !== next ? 1 : 0),
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

  const getTerrainStrokePreview = useCallback((points: Point[]): TerrainStrokePreview => {
    return previewTerrainStroke(course, points, selected, world.cash, costMult, world.reputation);
  }, [course, selected, world.cash, costMult, world.reputation]);

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
    if (preview.changedCount === 0) {
      if (preview.excluded.locked > 0) {
        setPaintError(t("progression.locked", { reputation: terrainMinReputation(selected) }));
      } else if (preview.excluded.unowned > 0) {
        setPaintError(t("land.buildBlocked"));
      } else {
        setPaintError(null);
      }
      return;
    }

    dispatch({ type: "PAINT_TILES", tiles: preview.tiles });
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
        `(${preview.excluded.unowned} unowned, ${preview.excluded.outOfBounds} outside, ${preview.excluded.locked} locked).`
      );
    } else {
      setPaintError(null);
    }
    void audio.playSfx("brush");
  }, [world.isBankrupt, getTerrainStrokePreview, selected, dispatch, audio, t]);

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
    setFlyoverNonce((n) => n + 1); // cinematic hole flyover (ZKU-157)

    setTeeSetupPrompt({ holeIndex: activeHoleIndex });
    setSelectedTeeSet("member");
    setActiveHoleIndex((i) => Math.min(8, i + 1));
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function confirmWizard() {
    if (!draftTee || !draftGreen) return;
    confirmWizardWithValues(draftTee, draftGreen);
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

  function previewTeeBox(teeSet: TeeSet, point: Point) {
    const hole = course.holes[activeHoleIndex];
    if (!hole) return;
    const prospective = withNormalizedHoleSetup({ ...hole, teeBoxes: { ...hole.teeBoxes, [teeSet]: point }, ...(teeSet === "member" ? { tee: point } : {}) });
    const issue = validateHoleCourseSetup(course, prospective).find((entry) => entry.code === "OUT_OF_BOUNDS" || entry.code === "DUPLICATE" || entry.code === "TEE_ORDER");
    if (issue) { setPaintError(issue.message); return; }
    const netCost = teePlacementCost(activeHoleIndex, teeSet, point);
    if (!Number.isFinite(netCost)) { setPaintError("Tee location is out of bounds."); return; }
    setPendingTeePlacement({ holeIndex: activeHoleIndex, teeSet, point, netCost });
    setPaintError(null);
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

  function setPinPosition(pinRotation: PinRotation, point: Point) {
    if (point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) { setPaintError("Pin position is out of bounds."); return; }
    if (course.tiles[point.y * course.width + point.x] !== "green") { setPaintError(`Pin ${pinRotation} must sit on existing green terrain.`); return; }
    const hole = course.holes[activeHoleIndex];
    if (!hole) return;
    const prospective = withNormalizedHoleSetup({ ...hole, pinPositions: { ...hole.pinPositions, [pinRotation]: point }, ...(pinRotation === "A" ? { green: point } : {}) });
    const issue = validateHoleCourseSetup(course, prospective).find((entry) => entry.code === "DUPLICATE");
    if (issue) { setPaintError(issue.message); return; }
    dispatch({ type: "SET_PIN_POSITION", holeIndex: activeHoleIndex, pinRotation, position: point });
    setPaintError(null);
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
      if (setupPlacement.kind === "tee") previewTeeBox(setupPlacement.key, { x, y });
      else setPinPosition(setupPlacement.key, { x, y });
      setSetupPlacement(null);
      if (setupPlacement.kind === "pin") void audio.playSfx("confirm");
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
            setEditorMode("PAINT");
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
      const deltas = computeSculptDeltas(course, x, y, sculptBrush, sculptRadius);
      if (deltas.length === 0) return;
      const cost = sculptSteps(deltas) * ELEVATION_COST_PER_STEP * costMult;
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
        dispatch({ type: "REMOVE_OBSTACLE", x, y });
      } else {
        if (!isObstacleUnlocked(obstacleType, world.reputation)) {
          setPaintError(t("progression.locked", { reputation: obstacleMinReputation(obstacleType) }));
          return;
        }
        dispatch({ type: "PLACE_OBSTACLE", x, y, obstacleType });
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
      const decoration = {
        kind: decorationKind,
        x,
        y,
        rotation: decorationRotation,
        ...((decorationKind === "bridge" || decorationKind === "boardwalk") ? { span: decorationSpan } : {}),
      };
      const validation = canPlaceDecoration(course, decoration);
      if (!validation.ok) { setPaintError(t("decor.invalid", { reason: validation.reason ?? "invalid placement" })); return; }
      const cost = decorationCost(decoration);
      if (world.cash < cost) { setPaintError(t("error.insufficientFunds", { amount: formatCurrency(cost) })); return; }
      dispatch({ type: "PLACE_DECORATION", decoration });
      setPaintError(null);
      void audio.playSfx("confirm");
      return;
    }
    // HOLE_WIZARD
    if (wizardStep === "TEE" || wizardStep === "MOVE_TEE") {
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
      if (wizardStep === "MOVE_TEE") {
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
    if (wizardStep === "GREEN" || wizardStep === "MOVE_GREEN") {
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
      if (wizardStep === "MOVE_GREEN") {
        moveMarker("green", newDraftGreen);
        // Reset wizard state, stay on same hole
        setWizardStep("TEE");
        setDraftTee(null);
        setDraftGreen(null);
      } else {
        // Placing new green, auto-confirm and move to next hole
        if (draftTee) {
          confirmWizardWithValues(draftTee, newDraftGreen);
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
    downloadBlob(blob, `${course.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-course.png`);
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

  const saveLoadModal = (
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
        flowDispatch({ type: "BEGIN_LOADING", label: t("loading.restoreCourse") });
        applyLoadedGame(payload);
        flowDispatch({ type: "ENTER_GAME" });
        setPaintError(t("save.loaded"));
        window.setTimeout(() => setPaintError(null), 2000);
      }}
    />
  );

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
    if (["shot-plan", "weekly-report", "green-fee", "maintenance", "first-profit"].includes(nextStep.id)) {
      setViewMode("ARCHITECT");
    }
    if (nextStep.id === "shot-plan") {
      setActiveHoleIndex(Math.max(0, activeHoleIndex - 1));
      setEditorMode("PAINT");
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

  if (screen === "setup") {
    return (
      <NewGameWizard
        onCancel={() => flowDispatch({ type: "BACK_TO_TITLE" })}
        onStart={startNewGame}
        onStartScenario={startScenario}
      />
    );
  }

  if (screen === "loading") {
    return <LoadingCard label={flow.loadingLabel ?? "Loading CourseCraft…"} />;
  }

  if (screen === "menu") {
    return (
      <>
      <StartMenu
        canLoad={canLoadFromMenu}
        onNewGame={newGameFromMenu}
        onQuickStart={() => startNewGame(quickStartSetup())}
        onLoadGame={loadFromMenu}
        onContinue={() => void continueFromMenu()}
        onOptions={() => flowDispatch({ type: "OPEN_MODAL", modal: "options" })}
        onAchievements={() => setShowRetention(true)}
        canInstall={pwa.canInstall}
        onInstall={() => void pwa.install()}
        onButtonClick={() => {
          void audio.unlock();
          if (soundEnabled) void audio.playSfx("button");
        }}
      />
      {saveLoadModal}
      <SettingsModal
        open={flow.modal === "options"}
        onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
        profile={appProfile}
        onProfileChange={handleProfileChange}
      />
      {showRetention && <RetentionHub records={records} profile={appProfile} context={achievementContext(records)} onClose={() => setShowRetention(false)} />}
      {pwa.updateAvailable && <PwaUpdateToast onReload={() => { const current = gameStateRef.current; void autosave({ course: current.course, world: current.world, history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress }).finally(pwa.applyUpdate); }} />}
      </>
    );
  }

  return (
    <div className={`cc-app${photoMode ? " cc-photo-mode" : ""}`}>
      <TooltipSurface>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{a11yMessage}</div>
        <GameBackground />
        {saveLoadModal}
      {showRetention && <RetentionHub records={records} profile={appProfile} context={achievementContext(records)} onClose={() => setShowRetention(false)} />}
      {!photoMode && <AchievementToasts queue={achievementQueue} onDismiss={() => setAchievementQueue((queue) => queue.slice(1))} />}
      {photoMode && <PhotoModeOverlay showGolfers={photoGolfers} showMarkers={photoMarkers} onToggleGolfers={() => setPhotoGolfers((value) => !value)} onToggleMarkers={() => setPhotoMarkers((value) => !value)} onCapture={() => void capturePhoto()} onCard={() => void captureCard()} onShare={() => void shareCard()} onExit={exitPhotoMode} />}
      {pwa.updateAvailable && <PwaUpdateToast onReload={() => { const current = gameStateRef.current; void autosave({ course: current.course, world: current.world, history: historyRef.current, records: recordsRef.current, live: live.getSnapshot(), tutorial: tutorialProgress }).finally(pwa.applyUpdate); }} />}
      {flow.modal === "save-load" && pwa.storagePersistent === false && <div role="status" className="cc-storage-warning">{t("pwa.storageWarning")}</div>}
      {flow.modal === "golfopedia" && (
        <GolfopediaModal
          open
          initialEntry={golfopediaEntry}
          onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
        />
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
          onNewGame={() => flowDispatch({ type: "BACK_TO_TITLE" })}
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
              ? "Medal earned — the next scenario is unlocked."
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
        <div className="cc-course-frame">
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
                animationsEnabled={effectiveAnimations}
                ambienceFx={appProfile.graphics.ambienceFx}
                waterAnimation={appProfile.graphics.waterAnimation}
                treeSway={appProfile.graphics.treeSway}
                resolutionScale={appProfile.graphics.resolutionScale}
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
                onClickTile={handleCanvasClick}
                onPreviewTerrainStroke={getTerrainStrokePreview}
                onCommitTerrainStroke={commitTerrainStroke}
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
                sculptRadius={sculptRadius}
                onCameraUpdate={(camera) => {
                  holeEditCameraManualRef.current = true;
                  setHoleEditCamera(camera);
                }}
                onCameraCenter={setAudioCameraCenter}
                onViewChange={setMinimapView}
                cameraJump={minimapJump}
            />
            {!tutorialProgress && <div className="cc-retention-toolbar" style={{ position: "absolute", top: 10, left: 10, zIndex: 110, display: "flex", gap: 6 }}>
              <button onClick={() => setShowRetention(true)}>🏆 {t("retention.open")}</button>
              <button data-testid="open-progression" aria-pressed={showProgression} onClick={() => setShowProgression((open) => !open)}>⭐ {t("progression.open")} · {reputationTier(world.reputation).name}</button>
              <button data-testid="open-tournaments" aria-pressed={showTournaments} onClick={() => setShowTournaments((open) => !open)}>⛳ {t("tournament.open")}{live.status.tournament ? " •" : ""}</button>
              <button data-testid="open-land-office" aria-pressed={showLandOffice} onClick={() => { setShowLandOffice((open) => !open); setSelectedParcelId((current) => current ?? course.estate?.starterParcelId ?? null); }}>🗺️ {t("land.open")}</button>
              <button data-testid="open-course-manager" aria-pressed={showCourseManager} onClick={() => setShowCourseManager((open) => !open)}>⛳ {t("courses.open")}</button>
              <button data-testid="open-property-management" aria-pressed={showPropertyManagement} onClick={() => setShowPropertyManagement((open) => !open)}>🏨 {t("property.open")}</button>
              <button aria-pressed={appProfile.gameplay.tickerVisible} onClick={() => handleProfileChange({ ...appProfile, gameplay: { ...appProfile.gameplay, tickerVisible: !appProfile.gameplay.tickerVisible } })}>📰 {t("retention.ticker")}</button>
              <button onClick={() => enterPhotoMode(false)}>📷 {t("retention.photo")}</button>
            </div>}
            {showProgression && !tutorialProgress && <ProgressionPanel reputation={world.reputation} onClose={() => setShowProgression(false)} />}
            {showTournaments && !tutorialProgress && <TournamentPanel course={activeOperatingCourse} world={world} currentDay={live.status.dayIndex} liveTournament={live.status.tournament} onSchedule={bookTournament} onClose={() => setShowTournaments(false)} />}
            {showLandOffice && !tutorialProgress && <LandOfficePanel course={course} world={world} selectedParcelId={selectedParcelId} onSelect={(parcelId) => setSelectedParcelId(parcelId)} onCenter={(center) => setMinimapJump((current) => ({ center, nonce: (current?.nonce ?? 0) + 1 }))} onPurchase={purchaseParcel} onClose={() => setShowLandOffice(false)} />}
            {showCourseManager && !tutorialProgress && <CourseManagerPanel course={normalizeCourseLayouts(course)} world={world} onChange={(next) => { setCourse(() => next); setWorld((current) => revalidateScheduledTournaments(next, current)); }} onSelectHole={(holeId) => { const index = course.holes.findIndex((hole) => hole.id === holeId); if (index >= 0) { setActiveHoleIndex(index); setHoleEditMode("hole"); } }} onCenter={(center) => setMinimapJump((current) => ({ center, nonce: (current?.nonce ?? 0) + 1 }))} onOpenGolfopedia={(entry) => { setGolfopediaEntry(entry); flowDispatch({ type: "OPEN_MODAL", modal: "golfopedia" }); }} onClose={() => setShowCourseManager(false)} />}
            {showPropertyManagement && !tutorialProgress && <PropertyManagementPanel course={course} world={world} onCommand={runPropertyCommand} onClose={() => setShowPropertyManagement(false)} />}
            {showLiveOverview && !tutorialProgress && <LiveOverview status={live.status} reputation={world.reputation} staffLevel={world.staffLevel} staffRoster={normalizedStaff(world, course)} courses={normalizeCourseLayouts(course).layouts!.map((layout) => ({ id: layout.id, name: layout.name }))} onAssignStaff={(staffId, courseId) => setWorld((current) => ({ ...current, staffRoster: normalizedStaff(current, course).map((member) => member.id === staffId ? { ...member, courseId } : member) }))} onSetPacePreset={live.setPacePreset} onUpdatePaceOperations={live.updatePaceOperations} onSelectGolfer={(id) => { live.selectGolfer(id); setFollowSelected(true); setShowLiveOverview(false); }} onClose={() => setShowLiveOverview(false)} />}
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
                      setPaintError(`Select the ${teeSet} tee location on the course.`);
                      setTeeSetupPrompt(null);
                    }}>{t("courseSetup.offerBuild", { tee: teeSet[0].toUpperCase() + teeSet.slice(1), cost: formatCurrency(Math.max(0, estimate)) })}</button>;
                  })}
                  <button onClick={() => setTeeSetupPrompt(null)}>{t("courseSetup.notNow")}</button>
                </div>
              </div>
            )}
            {pendingTeePlacement && !tutorialProgress && (
              <div data-testid="tee-placement-confirm" role="dialog" aria-label={t("courseSetup.confirmAria")} className="cc-tycoon-panel" style={{ position: "absolute", zIndex: 150, bottom: 88, left: "50%", transform: "translateX(-50%)", width: 300, padding: 14 }}>
                <strong>{t("courseSetup.confirmTitle", { action: t(getTeeBox(course.holes[pendingTeePlacement.holeIndex], pendingTeePlacement.teeSet) ? "courseSetup.actionMove" : "courseSetup.actionErect"), tee: pendingTeePlacement.teeSet })}</strong>
                <div style={{ margin: "7px 0", fontSize: 12 }}>{pendingTeePlacement.netCost >= 0 ? t("courseSetup.tileCost", { x: pendingTeePlacement.point.x, y: pendingTeePlacement.point.y, cost: formatCurrency(pendingTeePlacement.netCost) }) : t("courseSetup.tileSalvage", { x: pendingTeePlacement.point.x, y: pendingTeePlacement.point.y, value: formatCurrency(-pendingTeePlacement.netCost) })}</div>
                {pendingTeePlacement.netCost > world.cash && <div role="alert" style={{ color: "#8b2e1b", fontSize: 12, marginBottom: 7 }}>{t("courseSetup.shortfall", { amount: formatCurrency(pendingTeePlacement.netCost - world.cash) })}</div>}
                <div style={{ display: "flex", gap: 6 }}>
                  <button disabled={pendingTeePlacement.netCost > world.cash} onClick={() => commitTeeBox(pendingTeePlacement.holeIndex, pendingTeePlacement.teeSet, pendingTeePlacement.point, pendingTeePlacement.netCost)}>{t("courseSetup.confirm")}</button>
                  <button onClick={() => { setSetupPlacement({ kind: "tee", key: pendingTeePlacement.teeSet }); setPendingTeePlacement(null); setPaintError("Select another tee location on the course."); }}>{t("courseSetup.chooseAnother")}</button>
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
                  editorMode={editorMode}
                  setEditorMode={setEditorMode}
                  selectedTerrain={selected}
                  setSelected={setSelected}
                  obstacleType={obstacleType}
                  setObstacleType={setObstacleType}
                  onBeginTeePlacement={(teeSet) => { setSetupPlacement({ kind: "tee", key: teeSet }); setEditorMode("HOLE_WIZARD"); setPaintError(`Select the ${teeSet} tee location on the course.`); }}
                  onBeginPinPlacement={(pinRotation) => { setSetupPlacement({ kind: "pin", key: pinRotation }); setEditorMode("HOLE_WIZARD"); setPaintError(`Select Pin ${pinRotation} on existing green terrain.`); }}
                  selectedTeeSet={selectedTeeSet}
                  onSelectTeeSet={setSelectedTeeSet}
                  onSetTeeBox={previewTeeBox}
                  onSetTeePar={setTeePar}
                  onSetPinPosition={setPinPosition}
                  onRemoveTeeBox={removeTeeBox}
                  onRemovePinPosition={(pinRotation) => dispatch({ type: "REMOVE_PIN_POSITION", holeIndex: activeHoleIndex, pinRotation })}
                  onSetActivePinRotation={(pinRotation) => dispatch({ type: "SET_ACTIVE_PIN_ROTATION", pinRotation })}
                />
              </div>
            </div>
          ) : (
            <HUD
        course={course}
        world={world}
        last={last}
        prev={history.length >= 2 ? history[history.length - 2] : undefined}
        selected={selected}
        setSelected={setSelected}
        setGreenFee={(n) => {
          // Scenario constraint (ZKU-164): committee sets the fee, not you.
          if (world.constraints?.fixedGreenFee != null) return;
          setCourse((c) => updateLayout(c, activeCourseLayout(c).id, { greenFee: n }));
        }}
        setMaintenance={(n) => setWorld((w) => ({ ...w, maintenanceBudget: n }))}
        editorMode={editorMode}
        setEditorMode={setEditorMode}
        startWizard={startWizard}
        startPlaceTee={startPlaceTee}
        startPlaceGreen={startPlaceGreen}
        obstacleType={obstacleType}
        setObstacleType={setObstacleType}
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
      />
          )}
        </div>
        </div>
        <NewsTicker visible={!tutorialProgress && !photoMode && appProfile.gameplay.tickerVisible} onJump={jumpToEvent} onHide={() => handleProfileChange({ ...appProfile, gameplay: { ...appProfile.gameplay, tickerVisible: false } })} />
        {pendingWeekReport && <WeekCloseReport week={pendingWeekReport.week} result={pendingWeekReport.result} resumeSpeed={pendingWeekReport.resumeSpeed} onContinue={() => {
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
        <SettingsModal
          open={flow.modal === "options"}
          onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
          profile={appProfile}
          onProfileChange={handleProfileChange}
        />
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
