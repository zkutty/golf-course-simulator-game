import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import { perfProfiler } from "./utils/performanceProfiler";
import { CanvasCourse } from "./ui/CanvasCourse";
import "./ui/cozyLayout.css";
import { PixiStage } from "./ui/PixiStage";
import { HUD } from "./ui/HUD";
import { DEFAULT_STATE, type GameState } from "./game/gameState";
import type { BuildingTier, ConcessionType, Point, Terrain, WeekResult } from "./game/models/types";
import { tickWeek } from "./game/sim/tickWeek";
import { hasSavedGame, parseSaveText, resetSave, type SavePayload } from "./utils/save";
import { autosave, loadSlot, mostRecentSlot, saveToSlot } from "./utils/saveStore";
import { SaveLoadModal } from "./ui/SaveLoadModal";
import { computeTerrainChangeCost, ELEVATION_COST_PER_STEP } from "./game/models/terrainEconomics";
import { computeSculptDeltas, sculptSteps, type SculptBrush, type SculptRadius } from "./game/models/sculpt";
import { maxSlopeInRect } from "./game/models/elevation";
import type { ObstacleType } from "./game/models/types";
import { scoreCourseHoles } from "./game/sim/holes";
import { createSoundPlayer } from "./utils/sound";
import { computeCourseRatingAndSlope } from "./game/sim/courseRating";
import { createLoan } from "./game/sim/loans";
import { isCoursePlayable } from "./game/sim/isCoursePlayable";
import { legacyAwardForRun, loadLegacy, saveLegacy } from "./utils/legacy";
import { getEffectiveBalance, terrainCostMult } from "./game/balance/difficulty";
import { GameBackground } from "./ui/gameui";
import { StartMenu } from "./ui/StartMenu";
import { useAudio } from "./audio/audioContext";
import { HoleInspector } from "./ui/HoleInspector";
import { evaluateHole } from "./game/eval/evaluateHole";
import type { CameraState } from "./game/render/camera";
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
import { DefeatModal } from "./ui/DefeatModal";
import { VictoryModal } from "./ui/VictoryModal";
import type { GoalDefinition, RunOutcome } from "./game/models/objectives";
import { createReferenceCourse } from "./game/testing/referenceCourse";
import { runLiveDaysHeadless } from "./game/live/headless";
import { snapshotLiveSimulation } from "./game/live/persistence";
import { hashGameState } from "./utils/stateHash";
import {
  BUILDING_SPECS,
  CONCESSION_TYPES,
  buildingAtTile,
  canPlaceBuilding,
} from "./game/models/buildings";
import { GolfopediaModal } from "./ui/help/GolfopediaModal";
import { TooltipSurface } from "./ui/help/TooltipSurface";
import { AdvisorCard } from "./ui/onboarding/AdvisorCard";
import { TutorialOverlay } from "./ui/onboarding/TutorialOverlay";
import {
  TUTORIAL_STEPS,
  createTutorialProgress,
  loadTutorialProgress,
  saveTutorialProgress,
  type TutorialProgress,
} from "./game/onboarding/tutorial";
import { loadAppProfile, saveAppProfile, updateAppProfile, type AppProfile } from "./game/onboarding/profile";
import { advisorMessages, allowsMessage, type AdvisorMessage } from "./game/advisor/advisor";
import { INITIAL_SCREEN_FLOW, reduceScreenFlow } from "./app/screenFlow";
import { PauseOverlay } from "./ui/appShell/PauseOverlay";
import { LoadingCard } from "./ui/appShell/LoadingCard";
import { SettingsModal } from "./ui/SettingsModal";
import type { SpeedName } from "./game/live/liveConfig";
import { eventMatchesBinding } from "./accessibility/keybindings";

type EditorMode = "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING";
type WizardStep = "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
type ViewMode = "global" | "hole";

const STRIKE_SFX = "/audio/ball-strike.mp3";

export default function App() {
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
  const gameStateRef = useRef(gameState);
  const { course, world } = gameState;
  const [selected, setSelected] = useState<Terrain>("fairway");
  // Difficulty-resolved balance + terrain cost scaler (ZKU-165).
  const BALANCE = getEffectiveBalance(world.difficulty);
  const costMult = terrainCostMult(world.difficulty);

  // Dispatch function for actions
  const dispatch = useCallback((action: Action) => {
    // Log reducer dispatch count (only for mutations, not UI-only actions)
    if (DEBUG_PERF && (action.type !== "SET_MODE" && action.type !== "SET_ACTIVE_HOLE" && action.type !== "SET_BRUSH")) {
      logReducerDispatch();
    }
    setGameState((prevState) => applyAction(prevState, action));
    if (action.type !== "NEW_GAME" && action.type !== "LOAD_GAME" && !action.type.startsWith("SET_")) markDirty();
  }, [markDirty]);

  // Helper functions for non-core mutations (operations not in the action list)
  // These are used for mutations that don't affect terrain/markers/obstacles/core economy
  const setCourse = useCallback((updater: (c: typeof course) => typeof course) => {
    markDirty();
    setGameState((prevState) => ({
      ...prevState,
      course: updater(prevState.course),
    }));
  }, [markDirty]);
  
  const setWorld = useCallback((updater: (w: typeof world) => typeof world) => {
    markDirty();
    setGameState((prevState) => ({
      ...prevState,
      world: updater(prevState.world),
    }));
  }, [markDirty]);
  const [last, setLast] = useState<WeekResult | undefined>(undefined);
  const [history, setHistory] = useState<WeekResult[]>([]);
  const historyRef = useRef(history);

  useEffect(() => {
    gameStateRef.current = gameState;
    historyRef.current = history;
  }, [gameState, history]);

  const [editorMode, setEditorMode] = useState<EditorMode>("PAINT");
  const [activeHoleIndex, setActiveHoleIndex] = useState(0); // 0..8
  const [wizardStep, setWizardStep] = useState<WizardStep>("TEE");
  const [draftTee, setDraftTee] = useState<Point | null>(null);
  const [draftGreen, setDraftGreen] = useState<Point | null>(null);
  const [obstacleType, setObstacleType] = useState<ObstacleType>("tree");
  const [sculptBrush, setSculptBrush] = useState<SculptBrush>("raise");
  const [sculptRadius, setSculptRadius] = useState<SculptRadius>(1);
  const [buildingType, setBuildingType] = useState<ConcessionType>("snack_bar");

  const [capital, setCapital] = useState(() => ({
    spent: 0,
    refunded: 0,
    byTerrainSpent: {} as Partial<Record<Terrain, number>>,
    byTerrainTiles: {} as Partial<Record<Terrain, number>>,
  }));

  // Hover state moved to refs in canvas component to avoid React re-renders

  const [paintError, setPaintError] = useState<string | null>(null);
  const [saveModalCanSave, setSaveModalCanSave] = useState(false);
  const payloadSequenceRef = useRef(0);
  const [showObstacles, setShowObstacles] = useState(true);
  const [viewMode, setViewMode] = useState<"COZY" | "ARCHITECT">(() => appProfile.graphics.gridOverlays ? "ARCHITECT" : "COZY");
  const [holeEditMode, setHoleEditMode] = useState<ViewMode>("global"); // "global" or "hole"
  const [holeEditCamera, setHoleEditCamera] = useState<CameraState | null>(null);
  const holeEditCameraManualRef = useRef(false); // Track if camera was manually set
  const [showFixOverlay, setShowFixOverlay] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => appProfile.graphics.animations);
  const [flyoverNonce, setFlyoverNonce] = useState(0);
  const soundEnabled = appProfile.audio.masterVolume > 0 && appProfile.audio.sfxVolume > 0;
  const effectiveAnimations = animationsEnabled && !appProfile.accessibility.reducedMotion;
  const [showShotPlan, setShowShotPlan] = useState(true);
  const [peakCash, setPeakCash] = useState(DEFAULT_STATE.world.cash);
  const [renderer, setRenderer] = useState<"canvas" | "pixi">(() => appProfile.graphics.renderer);

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
  const [advisorMessage, setAdvisorMessage] = useState<AdvisorMessage | null>(null);
  const [advisorWake, setAdvisorWake] = useState(0);
  const seenAdvisorMessagesRef = useRef(new Set<string>());
  const advisorCooldownUntilRef = useRef(0);
  const [a11yMessage, setA11yMessage] = useState("");

  // Lazy singleton via useState initializer (render-pure, unlike a ref write).
  const [sound] = useState(() => createSoundPlayer());

  // Audio system
  const audio = useAudio();

  // Real-time "living course" simulation: golfers arrive, play, and pay live.
  const live = useLiveSimulation({
    enabled: screen === "game" && !world.isBankrupt,
    course,
    world,
    setWorld,
    setCourse,
    onDayCommitted: (result, liveSnapshot) => {
      const report: WeekResult = {
        visitors: result.rounds,
        revenue: result.revenue,
        revenueBreakdown: result.revenueBreakdown,
        costs: result.costs,
        profit: result.profit,
        avgSatisfaction: result.avgSatisfaction,
        reputationDelta: result.reputationDelta,
        visitorNoise: 0,
      };
      setLast(report);
      setHistory((h) => [
        ...h.slice(-19),
        report,
      ]);
      // Rotating autosave after every committed game day (ZKU-174). The
      // setState reader snapshots post-commit state without extra renders.
      if (appProfile.gameplay.autosaveCadence === "off") return;
      if (appProfile.gameplay.autosaveCadence === "weekly" && result.dayIndex !== 6) return;
      setGameState((current) => {
        const sequence = changeSequenceRef.current;
        void autosave({ course: current.course, world: current.world, live: liveSnapshot, tutorial: tutorialProgress })
          .then(() => markClean(sequence));
        return current;
      });
    },
    onCashTick: () => {
      if (soundEnabled) void sound?.playCashTick(soundEnabled);
    },
  });
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
    await saveToSlot("quick-save", "manual", "Quick Save", {
      course: current.course, world: current.world, history: historyRef.current,
      live: live.getSnapshot(), tutorial: tutorialProgress,
    });
    markClean(sequence);
    setA11yMessage("Quick save complete.");
  }, [flow.base, live, markClean, tutorialProgress]);


  const quitToTitle = useCallback(() => {
    if (dirty && !window.confirm("Quit to title and lose unsaved changes?")) return;
    live.setSpeed("paused");
    flowDispatch({ type: "BACK_TO_TITLE" });
  }, [dirty, live]);

  function restartCurrentScenario() {
    const scenario = getScenario(world.scenarioId);
    if (!scenario || !window.confirm("Restart this scenario from the beginning?")) return;
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
        event.preventDefault(); live.setSpeed("1x");
      } else if (eventMatchesBinding(event, bindings.speed2)) {
        event.preventDefault(); live.setSpeed("2x");
      } else if (eventMatchesBinding(event, bindings.speed3)) {
        event.preventDefault(); live.setSpeed("3x");
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
  }, [appProfile.accessibility.keybindings, flow.base, flow.modal, flow.paused, live, openPauseMenu, quickSave, resumeFromPause, toggleClock]);

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
      void autosave({ course: current.course, world: current.world, history: historyRef.current, live: live.getSnapshot(), tutorial: tutorialProgress })
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

  const holeSummary = useMemo(
    () => perfProfiler.measure('scoreCourseHoles', () => scoreCourseHoles(course)),
    [course]
  );
  const activePath = useMemo(() => holeSummary.holes[activeHoleIndex]?.path ?? [], [holeSummary, activeHoleIndex]);
  const activeShotPlan = useMemo(
    () => holeSummary.holes[activeHoleIndex]?.shotPlan ?? [],
    [holeSummary, activeHoleIndex]
  );

  // Extract failing corridor segments for overlay
  const activeHoleEvaluation = useMemo(
    () =>
      perfProfiler.measure('evaluateHole', () =>
        evaluateHole(course, course.holes[activeHoleIndex], activeHoleIndex)
      ),
    [course, activeHoleIndex]
  );
  const failingCorridorSegments = useMemo(() => {
    const fairwayIssue = activeHoleEvaluation.issues.find((i) => i.code === "FAIRWAY_CONTINUITY");
    return fairwayIssue?.metadata?.failingSegments ?? [];
  }, [activeHoleEvaluation]);

  const validHolesCount = useMemo(() => {
    return holeSummary.holes.filter((h) => h.isComplete && h.isValid).length;
  }, [holeSummary]);

  const eligibleBridge = useMemo(() => {
    if (world.constraints?.noLoans) return false;
    const repOk = world.reputation >= BALANCE.loans.bridge.repMin;
    const holesOk = isCoursePlayable(course) || validHolesCount >= BALANCE.loans.bridge.minValidHolesAlt;
    const cooldownOk = world.week - (world.lastBridgeLoanWeek ?? -999) >= BALANCE.loans.bridgeCooldownWeeks;
    const hasActiveBridge = (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "BRIDGE");
    return repOk && holesOk && cooldownOk && !hasActiveBridge && !world.isBankrupt;
  }, [world.constraints, world.reputation, world.week, world.lastBridgeLoanWeek, world.loans, world.isBankrupt, course, validHolesCount, BALANCE]);

  // Hole edit mode functions
  function enterHoleEditMode(holeIndex: number) {
    const hole = course.holes[holeIndex];
    if (!hole.tee || !hole.green) {
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
      hole.tee,
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
    const hole = course.holes[activeHoleIndex];
    if (!hole.tee || !hole.green) return;
    
    const camera = computeZoomPreset(preset, course, hole, activeHoleIndex, paneSize.width, paneSize.height, tileSize);
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
      setRenderer(next.graphics.renderer);
      audio.syncVolumes(next.audio);
      if (next.advisorFrequency === "off") setAdvisorMessage(null);
      setAdvisorWake((value) => value + 1);
    };
    window.addEventListener("coursecraft-profile-change", onProfileChange);
    return () => window.removeEventListener("coursecraft-profile-change", onProfileChange);
  }, [audio]);

  useEffect(() => {
    if (screen !== "game" || tutorialProgress || advisorMessage || flow.modal || flow.paused || showVictory || showBridgePrompt) return;
    if (Date.now() < advisorCooldownUntilRef.current) return;
    const frequency = loadAppProfile().advisorFrequency;
    const previous = history.length >= 2 ? history[history.length - 2] : undefined;
    const next = advisorMessages(course, world, last, previous).find(
      (message) => allowsMessage(frequency, message) && !seenAdvisorMessagesRef.current.has(message.id)
    );
    if (next) {
      setAdvisorMessage(next);
      setA11yMessage(`${next.title}. ${next.body}`);
    }
  }, [screen, tutorialProgress, advisorMessage, flow.modal, flow.paused, showVictory, showBridgePrompt, course, world, last, history, advisorWake]);

  function dismissAdvisor() {
    if (advisorMessage) seenAdvisorMessagesRef.current.add(advisorMessage.id);
    setAdvisorMessage(null);
    const frequency = loadAppProfile().advisorFrequency;
    const cooldown = frequency === "chatty" ? 8_000 : 18_000;
    advisorCooldownUntilRef.current = Date.now() + cooldown;
    window.setTimeout(() => setAdvisorWake((value) => value + 1), cooldown + 50);
  }

  function startFlyover() {
    if (appProfile.accessibility.reducedMotion) {
      setA11yMessage("Flyover is disabled while reduced motion is on.");
      return;
    }
    if (advisorMessage) dismissAdvisor();
    setFlyoverNonce((value) => value + 1);
  }

  // Course name propagates to the browser tab (ZKU-162).
  useEffect(() => {
    document.title = screen === "game" ? `${course.name} — CourseCraft` : "CourseCraft";
  }, [screen, course.name]);

  // Handle audio based on screen and view mode
  useEffect(() => {
    if (!soundEnabled) {
      audio.setMusic(null);
      audio.setAmbience(null);
      return;
    }

    if (screen === "menu") {
      audio.setMusic("/audio/menu-theme.mp3");
      audio.setAmbience(null);
    } else if (screen === "game") {
      if (viewMode === "COZY") {
        audio.setMusic(null);
        audio.setAmbience("/audio/course-ambiance.mp3");
      } else {
        audio.setMusic("/audio/design-loop-1.mp3");
        audio.setAmbience(null);
      }
    }
  }, [screen, viewMode, soundEnabled, audio]);

  // THE new-run path (ZKU-162): every fresh run goes through createNewGame
  // (or createScenarioGame for career runs) and then this shared reset.
  function beginTutorial(tutorialCourse = course, tutorialWorld = world) {
    const progress = createTutorialProgress(tutorialCourse, tutorialWorld);
    setTutorialProgress(progress);
    saveTutorialProgress(progress);
    updateAppProfile({ tutorialOffered: true });
    setGolfopediaEntry(undefined);
    setAdvisorMessage(null);
  }

  function finishTutorial(completed: boolean) {
    setTutorialProgress(null);
    saveTutorialProgress(null);
    updateAppProfile({ tutorialOffered: true, tutorialCompleted: completed || loadAppProfile().tutorialCompleted });
  }

  function startRun(newCourse: typeof course, newWorld: typeof world) {
    dispatch({ type: "NEW_GAME", course: newCourse, world: newWorld });
    markClean();
    setHistory([]);
    setLast(undefined);
    setEditorMode("PAINT");
    setActiveHoleIndex(0);
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
    setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
    setPaintError(null);
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
    if (!loadAppProfile().tutorialOffered) beginTutorial(newCourse, newWorld);
  }

  // `goals` overrides the mode's default goal set (defeat-retry keeps a
  // run's exact goals).
  function restartRun(setup: GameSetup, goals?: GoalDefinition[] | null) {
    console.log('[Performance] Starting new game...');
    const start = performance.now();
    const { course: newCourse, world: newWorld } = createNewGame(setup, goals);
    console.log('[Performance] Wild land generated in', performance.now() - start, 'ms');
    live.restoreSnapshot(undefined);
    startRun(newCourse, newWorld);
  }

  // Career (ZKU-164): scenarios build their run from the authored definition.
  function startScenario(scenario: ScenarioDefinition) {
    flowDispatch({ type: "BEGIN_LOADING", label: `Preparing ${scenario.name}…` });
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
      seed: (Date.now() % 1_000_000) | 0,
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
    // Loading a finished run must not replay the celebration or re-record
    // the medal (the store keeps best results anyway).
    setPrevOutcome(loaded.world.objectives?.outcome ?? "OPEN");
    setShowVictory(false);
    scenarioRecordedRef.current = loaded.world.objectives?.outcome === "WON";
    setTutorialProgress(loaded.tutorial ?? null);
    saveTutorialProgress(loaded.tutorial ?? null);
    markClean();
  }

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
          golferPositions: liveSnapshot?.state.golfers.map((golfer) => [golfer.id, golfer.pos.x, golfer.pos.y]) ?? [],
          week: current.world.week,
          cash: current.world.cash,
          courseHash: hashGameState({ course: current.course, world: current.world, live: liveSnapshot }),
        };
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
          speed: "3x",
          selectedGolferId: null,
        });
        const payload: SavePayload = {
          course: run.course,
          world: run.world,
          history: historyRef.current,
          live: liveSnapshot,
        };
        const beforeHash = hashGameState(payload);
        await saveToSlot("e2e-golden", "manual", "E2E golden path", payload);
        const loaded = await loadSlot("e2e-golden");
        if (!loaded) throw new Error("Golden-path slot failed to reload");
        const afterHash = hashGameState(loaded);
        dispatch({ type: "LOAD_GAME", course: loaded.course, world: loaded.world });
        live.restoreSnapshot(loaded.live);
        setHistory(loaded.history ?? []);
        setLast(loaded.history?.[loaded.history.length - 1]);
        setPrevOutcome(loaded.world.objectives?.outcome ?? "OPEN");
        setShowVictory(false);
        scenarioRecordedRef.current = loaded.world.objectives?.outcome === "WON";
        flowDispatch({ type: "BACK_TO_TITLE" });
        flowDispatch({ type: "BEGIN_LOADING", label: "Restoring your course…" });
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
      validateFixture: (text: string) => {
        const result = parseSaveText(text);
        return result.ok
          ? { ok: true as const, migratedFrom: result.migratedFrom ?? null }
          : { ok: false as const, error: result.error.message };
      },
    };
    return () => {
      delete window.__coursecraftTest;
    };
  }, [dispatch, dirty, flow.base, flow.modal, flow.paused, live, screen]);

  function newGameFromMenu() {
    void audio.unlock();
    flowDispatch({ type: "OPEN_SETUP" });
  }

  function startNewGame(setup: GameSetup) {
    void audio.unlock();
    void audio.playSfx(STRIKE_SFX);
    flowDispatch({ type: "BEGIN_LOADING", label: "Growing your new course…" });
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
    flowDispatch({ type: "BEGIN_LOADING", label: "Restoring your latest course…" });
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
    setWorld((w) => {
      if (w.isBankrupt) return w;
      const loan = createLoan({
        kind: "BRIDGE",
        principal: BALANCE.loans.bridge.maxPrincipal,
        apr: BALANCE.loans.bridge.apr,
        termWeeks: BALANCE.loans.bridge.termWeeks,
        idSeed: w.week,
      });
      return {
        ...w,
        cash: w.cash + loan.principal,
        loans: [...(w.loans ?? []), loan],
        lastBridgeLoanWeek: w.week,
      };
    });
    setShowBridgePrompt(false);
  }

  function takeExpansionLoan() {
    if (world.constraints?.noLoans) return;
    const repOk = world.reputation >= BALANCE.loans.expansion.repMin;
    const holesOk = validHolesCount >= BALANCE.loans.expansion.minValidHoles;
    const cashflowOk = (world.lastWeekProfit ?? 0) > 0;
    const hasActiveExpansion = (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "EXPANSION");
    if (world.isBankrupt || !repOk || !holesOk || !cashflowOk || hasActiveExpansion) return;
    setWorld((w) => {
      if (w.isBankrupt) return w;
      const loan = createLoan({
        kind: "EXPANSION",
        principal: BALANCE.loans.expansion.maxPrincipal,
        apr: BALANCE.loans.expansion.apr,
        termWeeks: BALANCE.loans.expansion.termWeeks,
        idSeed: w.week,
      });
      return { ...w, cash: w.cash + loan.principal, loans: [...(w.loans ?? []), loan] };
    });
  }

  function applyTileChange(idx: number, next: Terrain, opts?: { silent?: boolean }): boolean {
    if (world.isBankrupt) return false;
    const prev = course.tiles[idx];
    const { net, charged, refunded } = computeTerrainChangeCost(prev, next, costMult, course.theme);
    if (net > 0 && world.cash < net) {
      setPaintError(`Insufficient funds: need $${Math.ceil(net).toLocaleString()}`);
      return false;
    }
    if (prev === next) return true;

    const x = idx % course.width;
    const y = Math.floor(idx / course.width);
    
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
    if (!opts?.silent) void sound?.playBrush(soundEnabled);
    return true;
  }

  function applyTerrainAt(x: number, y: number, next: Terrain, opts?: { silent?: boolean }) {
    const idx = y * course.width + x;
    applyTileChange(idx, next, opts);
  }

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
      setPaintError(`Insufficient funds: need $${Math.ceil(totalNet).toLocaleString()} to paint fairway`);
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
      setPaintError(`Insufficient funds to move ${markerType}: need $${Math.ceil(totalNet).toLocaleString()}`);
      return;
    }
    
    // Dispatch MOVE_TEE or MOVE_GREEN action
    if (markerType === "tee") {
      dispatch({ type: "MOVE_TEE", holeIndex: activeHoleIndex, position: newPos, oldPosition: oldPos });
    } else {
      dispatch({ type: "MOVE_GREEN", holeIndex: activeHoleIndex, position: newPos, oldPosition: oldPos });
    }
    
    void sound?.playConfirm(soundEnabled);
  }

  function confirmWizardWithValues(tee: Point, green: Point) {
    if (world.isBankrupt) return;

    // Elevation check (ZKU-146): tee and green sites must be near-flat
    // (max 1 step across their 3x3 footprint). Sculpt with Level first.
    const teeSlope = maxSlopeInRect(course, tee.x - 1, tee.y - 1, tee.x + 1, tee.y + 1);
    const greenSlope = maxSlopeInRect(course, green.x - 1, green.y - 1, green.x + 1, green.y + 1);
    if (teeSlope > 1 || greenSlope > 1) {
      setPaintError(
        `${teeSlope > 1 ? "Tee" : "Green"} site is too steep — level the ground with the Sculpt tool first.`
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
      setPaintError(`Insufficient funds to confirm: need $${Math.ceil(totalNet).toLocaleString()}`);
      return;
    }

    // Dispatch PLACE_TEE and PLACE_GREEN actions
    dispatch({ type: "PLACE_TEE", holeIndex: activeHoleIndex, position: tee });
    dispatch({ type: "PLACE_GREEN", holeIndex: activeHoleIndex, position: green });
    void sound?.playConfirm(soundEnabled);
    setFlyoverNonce((n) => n + 1); // cinematic hole flyover (ZKU-157)

    setActiveHoleIndex((i) => Math.min(8, i + 1));
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function confirmWizard() {
    if (!draftTee || !draftGreen) return;
    confirmWizardWithValues(draftTee, draftGreen);
  }

  function handleCanvasClick(x: number, y: number) {
    if (world.isBankrupt) return;
    // Unlock audio on first canvas interaction
    void audio.unlock();
    
    // Check bounds (only for marker placement, not for painting which supports infinite canvas)
    if (editorMode === "HOLE_WIZARD" && (x < 0 || y < 0 || x >= course.width || y >= course.height)) {
      setPaintError("Cannot place markers outside course bounds");
      return;
    }
    
    // Check if clicking on existing tee/green marker (direct interaction)
    // Only check if not already in HOLE_WIZARD mode (to avoid conflicts)
    if (editorMode !== "HOLE_WIZARD") {
      // Check for tee markers (within course bounds)
      if (x >= 0 && y >= 0 && x < course.width && y < course.height) {
        for (let i = 0; i < course.holes.length; i++) {
          const hole = course.holes[i];
          if (hole.tee && hole.tee.x === x && hole.tee.y === y) {
            setActiveHoleIndex(i);
            setEditorMode("HOLE_WIZARD");
            setWizardStep("MOVE_TEE");
            setDraftTee({ x, y });
            setDraftGreen(hole.green);
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
        setPaintError(`Not enough cash for earthworks ($${cost.toLocaleString()} needed).`);
        return;
      }
      setPaintError(null);
      dispatch({ type: "SCULPT_TILES", deltas });
      if (soundEnabled) void sound?.playBrush(soundEnabled);
      return;
    }

    if (editorMode === "PAINT") {
      applyTerrainAt(x, y, selected);
      return;
    }
    if (editorMode === "OBSTACLE") {
      const existingIdx = course.obstacles.findIndex((o) => o.x === x && o.y === y);
      if (existingIdx >= 0) {
        if (appProfile.gameplay.confirmBulldoze && !window.confirm("Bulldoze this obstacle?")) return;
        dispatch({ type: "REMOVE_OBSTACLE", x, y });
      } else {
        dispatch({ type: "PLACE_OBSTACLE", x, y, obstacleType });
      }
      return;
    }
    if (editorMode === "BUILDING") {
      const existing = buildingAtTile(course, x, y);
      if (existing) {
        if (existing.type === "clubhouse") {
          setPaintError("The starter clubhouse cannot be removed.");
          return;
        }
        if (appProfile.gameplay.confirmSalvage && !window.confirm(`Salvage this ${BUILDING_SPECS[existing.type].name.toLowerCase()}?`)) return;
        dispatch({ type: "REMOVE_BUILDING", x, y });
        setPaintError(null);
        return;
      }
      const validation = canPlaceBuilding(course, buildingType, x, y);
      if (!validation.ok) {
        setPaintError(`Cannot place ${BUILDING_SPECS[buildingType].name.toLowerCase()}: ${validation.reason}.`);
        return;
      }
      const cost = BUILDING_SPECS[buildingType].buildCost;
      if (world.cash < cost) {
        setPaintError(`Insufficient funds: need $${cost.toLocaleString()}.`);
        return;
      }
      dispatch({ type: "PLACE_BUILDING", buildingType, x, y });
      setPaintError(null);
      void sound?.playConfirm(soundEnabled);
      return;
    }
    // HOLE_WIZARD
    if (wizardStep === "TEE" || wizardStep === "MOVE_TEE") {
      // Validate: cannot place on water and must be in bounds
      if (x < 0 || y < 0 || x >= course.width || y >= course.height) {
        setPaintError("Cannot place tee outside course bounds");
        return;
      }
      const terrain = course.tiles[y * course.width + x];
      if (terrain === "water") {
        setPaintError("Cannot place tee on water");
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
        setPaintError("Cannot place green outside course bounds");
        return;
      }
      const terrain = course.tiles[y * course.width + x];
      if (terrain === "water") {
        setPaintError("Cannot place green on water");
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
    setCourse((c) => {
      const holes = c.holes.slice();
      const prev = holes[activeHoleIndex] ?? { tee: null, green: null, parMode: "AUTO" as const };
      holes[activeHoleIndex] = {
        ...prev,
        parMode: mode,
        parManual: mode === "MANUAL" ? (prev.parManual ?? 4) : undefined,
      };
      return { ...c, holes };
    });
  }

  function setActiveHoleParManual(par: 3 | 4 | 5) {
    setCourse((c) => {
      const holes = c.holes.slice();
      const prev = holes[activeHoleIndex] ?? { tee: null, green: null, parMode: "AUTO" as const };
      holes[activeHoleIndex] = { ...prev, parMode: "MANUAL", parManual: par };
      return { ...c, holes };
    });
  }

  const staffUpgradeCost = useMemo(() => {
    if (world.staffLevel >= 5) return null;
    return 2500 * (world.staffLevel + 1);
  }, [world.staffLevel]);

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
      if (w.staffLevel >= 5) return w;
      if (w.cash < staffUpgradeCost) return w;
      const nextCash = w.cash - staffUpgradeCost;
      return {
        ...w,
        cash: nextCash,
        staffLevel: w.staffLevel + 1,
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

  function simulate() {
    if (world.isBankrupt) return;
    void audio.unlock();
    if (soundEnabled) void audio.playSfx(STRIKE_SFX);
    const { course: c2, world: w2, result } = tickWeek(course, world, world.runSeed);
    const cap = {
      spent: capital.spent,
      refunded: capital.refunded,
      net: capital.spent - capital.refunded,
      byTerrainSpent: capital.byTerrainSpent,
      byTerrainTiles: capital.byTerrainTiles,
    };
    dispatch({ type: "SIMULATE_WEEK", course: c2, world: w2 });
    const withCap: WeekResult = { ...result, capitalSpending: cap };
    setLast(withCap);
    setHistory((h) => [...h.slice(-19), withCap]);
    setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
    if (result.profit > 0) void sound?.playCashTick(soundEnabled);
  }

  const rating = useMemo(() => computeCourseRatingAndSlope(course), [course]);
  const weeksSurvived = Math.max(0, world.week - 1);

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
        return { course, world, history, live: live.getSnapshot(), tutorial: tutorialProgress };
      }}
      onSaved={() => markClean(payloadSequenceRef.current)}
      onLoaded={(payload) => {
        flowDispatch({ type: "BEGIN_LOADING", label: "Restoring your course…" });
        window.setTimeout(() => {
          applyLoadedGame(payload);
          flowDispatch({ type: "ENTER_GAME" });
          setPaintError("Game loaded.");
          setTimeout(() => setPaintError(null), 2000);
        }, 0);
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
        onButtonClick={() => {
          void audio.unlock();
          if (soundEnabled) void audio.playSfx(STRIKE_SFX);
        }}
      />
      {saveLoadModal}
      <SettingsModal
        open={flow.modal === "options"}
        onClose={() => flowDispatch({ type: "CLOSE_TOP_LAYER" })}
        profile={appProfile}
        onProfileChange={handleProfileChange}
      />
      </>
    );
  }

  return (
    <div className="cc-app">
      <TooltipSurface>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{a11yMessage}</div>
        <GameBackground />
        {saveLoadModal}
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
        />
      )}
      {!tutorialProgress && advisorMessage && (
        <AdvisorCard
          message={advisorMessage}
          onDismiss={dismissAdvisor}
          onShowHole={(holeIndex) => {
            enterHoleEditMode(holeIndex);
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
            {renderer === "canvas" ? (
              <CanvasCourse
                course={course}
                holes={course.holes}
                obstacles={course.obstacles}
                activeHoleIndex={activeHoleIndex}
                activePath={activePath}
                activeShotPlan={activeShotPlan}
                tileSize={tileSize}
                showGridOverlays={viewMode === "ARCHITECT"}
                animationsEnabled={effectiveAnimations}
                flyoverNonce={flyoverNonce}
                colorVision={appProfile.accessibility.colorVision}
                terrainPatterns={appProfile.accessibility.terrainPatterns}
                reducedMotion={appProfile.accessibility.reducedMotion}
                showShotPlan={showShotPlan}
                editorMode={editorMode}
                wizardStep={wizardStep}
                draftTee={draftTee}
                draftGreen={draftGreen}
                onClickTile={handleCanvasClick}
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
                onCameraUpdate={(camera) => {
                  holeEditCameraManualRef.current = true;
                  setHoleEditCamera(camera);
                }}
              />
            ) : (
              <PixiStage
                course={course}
                holes={course.holes}
                obstacles={course.obstacles}
                activeHoleIndex={activeHoleIndex}
                activePath={activePath}
                activeShotPlan={activeShotPlan}
                tileSize={tileSize}
                showGridOverlays={viewMode === "ARCHITECT"}
                animationsEnabled={effectiveAnimations}
                ambienceFx={appProfile.graphics.ambienceFx}
                waterAnimation={appProfile.graphics.waterAnimation}
                treeSway={appProfile.graphics.treeSway}
                resolutionScale={appProfile.graphics.resolutionScale}
                cameraSmoothing={appProfile.gameplay.cameraSmoothing && !appProfile.accessibility.reducedMotion}
                edgeScroll={appProfile.gameplay.edgeScroll}
                edgeScrollSpeed={appProfile.gameplay.edgeScrollSpeed}
                flyoverNonce={flyoverNonce}
                showShotPlan={showShotPlan}
                editorMode={editorMode}
                colorVision={appProfile.accessibility.colorVision}
                terrainPatterns={appProfile.accessibility.terrainPatterns}
                keybindings={appProfile.accessibility.keybindings}
                wizardStep={wizardStep}
                draftTee={draftTee}
                draftGreen={draftGreen}
                onClickTile={handleCanvasClick}
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
                dayMinute={live.status.dayMinute}
                sculptRadius={sculptRadius}
                onCameraUpdate={(camera) => {
                  holeEditCameraManualRef.current = true;
                  setHoleEditCamera(camera);
                }}
              />
            )}
            {/* HoverTooltip now rendered on canvas to avoid React re-renders */}
            {holeEditMode === "hole" && course.holes[activeHoleIndex]?.tee && course.holes[activeHoleIndex]?.green && (
              <HoleMinimap
                course={course}
                hole={course.holes[activeHoleIndex]}
                cameraState={holeEditCamera}
                tileSize={tileSize}
                onCenter={(center: Point) => {
                  if (holeEditCamera) {
                    const newCamera: CameraState = {
                      ...holeEditCamera,
                      center,
                    };
                    setHoleEditCamera(newCamera);
                  }
                }}
              />
            )}
            <LiveControls
              status={live.status}
              speed={live.speed}
              onSetSpeed={live.setSpeed}
              cash={world.cash}
              reputation={world.reputation}
              onOpenPauseMenu={openPauseMenu}
            />
            <GolferInspector
              selected={live.status.selected}
              onClose={() => live.selectGolfer(null)}
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
                  Exit
                </button>
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
                  ← Prev
                </button>
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
                  Next →
                </button>
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
          setCourse((c) => ({ ...c, baseGreenFee: n }));
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
        onConfigureBuilding={(x: number, y: number, tier: BuildingTier, price: number) =>
          dispatch({ type: "CONFIGURE_BUILDING", x, y, tier, price })
        }
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
        simulate={simulate}
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
      />
          )}
        </div>
        </div>
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
        <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 6 }}>Distress: take a Bridge Loan?</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          $25,000 • 18% APR • 26 weeks • amortized weekly payments. Missing payments hurts reputation and worsens terms.
        </div>
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
            Take loan
          </button>
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
            Decline
        </button>
        </div>
      </div>
    </div>
  );
}

// HoverTooltip removed - now rendered on canvas for performance
