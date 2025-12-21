import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasCourse } from "./ui/CanvasCourse";
import { HUD } from "./ui/HUD";
import { DEFAULT_STATE } from "./game/gameState";
import type { Point, Terrain, WeekResult } from "./game/models/types";
import { tickWeek } from "./game/sim/tickWeek";
import { hasSavedGame, loadGame, resetSave, saveGame } from "./utils/save";
import { computeTerrainChangeCost } from "./game/models/terrainEconomics";
import type { ObstacleType } from "./game/models/types";
import { scoreCourseHoles } from "./game/sim/holes";
import { createSoundPlayer } from "./utils/sound";
import { computeCourseRatingAndSlope } from "./game/sim/courseRating";
import { createLoan } from "./game/sim/loans";
import { isCoursePlayable } from "./game/sim/isCoursePlayable";
import { legacyAwardForRun, loadLegacy, saveLegacy } from "./utils/legacy";
import { BALANCE } from "./game/balance/balanceConfig";
import { GameBackground } from "./ui/gameui";
import { StartMenu } from "./ui/StartMenu";
import { useAudio } from "./audio/AudioProvider";
import { HoleInspector } from "./ui/HoleInspector";
import { evaluateHole } from "./game/eval/evaluateHole";
import type { CameraState } from "./game/render/camera";
import { computeHoleCamera } from "./game/render/camera";

type EditorMode = "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
type WizardStep = "TEE" | "GREEN" | "CONFIRM";
type ViewMode = "global" | "hole";

const STRIKE_SFX = "/audio/ball-strike.mp3";

export default function App() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [course, setCourse] = useState(DEFAULT_STATE.course);
  const [world, setWorld] = useState(DEFAULT_STATE.world);
  const [selected, setSelected] = useState<Terrain>("fairway");
  const [last, setLast] = useState<WeekResult | undefined>(undefined);
  const [history, setHistory] = useState<WeekResult[]>([]);

  const [editorMode, setEditorMode] = useState<EditorMode>("PAINT");
  const [activeHoleIndex, setActiveHoleIndex] = useState(0); // 0..8
  const [wizardStep, setWizardStep] = useState<WizardStep>("TEE");
  const [draftTee, setDraftTee] = useState<Point | null>(null);
  const [draftGreen, setDraftGreen] = useState<Point | null>(null);
  const [obstacleType, setObstacleType] = useState<ObstacleType>("tree");

  const [capital, setCapital] = useState(() => ({
    spent: 0,
    refunded: 0,
    byTerrainSpent: {} as Partial<Record<Terrain, number>>,
    byTerrainTiles: {} as Partial<Record<Terrain, number>>,
  }));

  const [hover, setHover] = useState<{
    idx: number;
    x: number;
    y: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const [paintError, setPaintError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"COZY" | "ARCHITECT">("COZY");
  const [holeEditMode, setHoleEditMode] = useState<ViewMode>("global"); // "global" or "hole"
  const [holeEditCamera, setHoleEditCamera] = useState<CameraState | null>(null);
  const [showFixOverlay, setShowFixOverlay] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [flyoverNonce, setFlyoverNonce] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showShotPlan, setShowShotPlan] = useState(true);
  const [peakCash, setPeakCash] = useState(DEFAULT_STATE.world.cash);
  const [peakRep, setPeakRep] = useState(DEFAULT_STATE.world.reputation);
  const [showBridgePrompt, setShowBridgePrompt] = useState(false);
  const prevDistressRef = useRef(0);
  const [legacy, setLegacy] = useState(() => loadLegacy());
  const legacyAwardedRef = useRef(false);

  const soundRef = useRef<ReturnType<typeof createSoundPlayer> | null>(null);
  if (!soundRef.current) soundRef.current = createSoundPlayer();
  const sound = soundRef.current;

  // Audio system
  const audio = useAudio();

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

  const holeSummary = useMemo(() => scoreCourseHoles(course), [course]);
  const activePath = useMemo(() => holeSummary.holes[activeHoleIndex]?.path ?? [], [holeSummary, activeHoleIndex]);
  const activeShotPlan = useMemo(
    () => holeSummary.holes[activeHoleIndex]?.shotPlan ?? [],
    [holeSummary, activeHoleIndex]
  );

  const validHolesCount = useMemo(() => {
    const s = scoreCourseHoles(course);
    return s.holes.filter((h) => h.isComplete && h.isValid).length;
  }, [course]);

  const eligibleBridge = useMemo(() => {
    const repOk = world.reputation >= BALANCE.loans.bridge.repMin;
    const holesOk = isCoursePlayable(course) || validHolesCount >= BALANCE.loans.bridge.minValidHolesAlt;
    const cooldownOk = world.week - (world.lastBridgeLoanWeek ?? -999) >= BALANCE.loans.bridgeCooldownWeeks;
    const hasActiveBridge = (world.loans ?? []).some((l) => l.status === "ACTIVE" && l.kind === "BRIDGE");
    return repOk && holesOk && cooldownOk && !hasActiveBridge && !world.isBankrupt;
  }, [world.reputation, world.week, world.lastBridgeLoanWeek, world.loans, world.isBankrupt, course, validHolesCount]);

  // Hole edit mode functions
  function enterHoleEditMode(holeIndex: number) {
    const hole = course.holes[holeIndex];
    if (!hole.tee || !hole.green) {
      // Cannot enter hole edit mode without tee and green
      return;
    }
    setActiveHoleIndex(holeIndex);
    setHoleEditMode("hole");
    // Compute camera state
    const camera = computeHoleCamera(hole.tee, hole.green, 16, 3.0, paneSize.width, paneSize.height);
    setHoleEditCamera(camera);
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

  // Update camera when pane size changes in hole edit mode
  useEffect(() => {
    if (holeEditMode === "hole") {
      const hole = course.holes[activeHoleIndex];
      if (hole.tee && hole.green) {
        const camera = computeHoleCamera(hole.tee, hole.green, 16, 3.0, paneSize.width, paneSize.height);
        setHoleEditCamera(camera);
      }
    }
  }, [paneSize.width, paneSize.height, holeEditMode, activeHoleIndex]);

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
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [holeEditMode, activeHoleIndex]);

  useEffect(() => {
    if (world.isBankrupt) return;
    const prev = prevDistressRef.current;
    prevDistressRef.current = world.distressWeeks ?? 0;
    if (prev === 0 && (world.distressWeeks ?? 0) > 0) {
      // Entering distress: prompt for bridge loan (MVP)
      if (eligibleBridge) setShowBridgePrompt(true);
    }
    if ((world.distressWeeks ?? 0) === 0) setShowBridgePrompt(false);
  }, [world.distressWeeks, world.isBankrupt, eligibleBridge]);

  useEffect(() => {
    if (world.isBankrupt) return;
    setPeakCash((p) => Math.max(p, world.cash));
    setPeakRep((p) => Math.max(p, world.reputation));
  }, [world.cash, world.reputation, world.isBankrupt]);

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

  function restartRun(args: { seed: number }) {
    const seed = args.seed | 0;
    setCourse(DEFAULT_STATE.course);
    setWorld({
      ...DEFAULT_STATE.world,
      runSeed: seed,
      distressWeeks: 0,
      isBankrupt: false,
      loans: [],
      lastBridgeLoanWeek: -999,
      lastWeekProfit: 0,
    });
    setHistory([]);
    setLast(undefined);
    setEditorMode("PAINT");
    setActiveHoleIndex(0);
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
    setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
    setHover(null);
    setPaintError(null);
    setObstacleType("tree");
    setFlyoverNonce(0);
    setPeakCash(DEFAULT_STATE.world.cash);
    setPeakRep(DEFAULT_STATE.world.reputation);
    setShowBridgePrompt(false);
    prevDistressRef.current = 0;
    legacyAwardedRef.current = false;
  }

  const canLoadFromMenu = useMemo(() => {
    try {
      return hasSavedGame() && loadGame() != null;
    } catch {
      return false;
    }
  }, []);

  function applyLoadedGame(loaded: NonNullable<ReturnType<typeof loadGame>>) {
    setCourse(loaded.course);
    setWorld(loaded.world);
    setHistory(loaded.history ?? []);
    setLast(loaded.history?.[loaded.history.length - 1]);
  }

  function newGameFromMenu() {
    void audio.unlock();
    void audio.playSfx(STRIKE_SFX);
    restartRun({ seed: (Date.now() % 1_000_000) | 0 });
    setScreen("game");
  }

  function loadFromMenu() {
    void audio.unlock();
    void audio.playSfx(STRIKE_SFX);
    const loaded = loadGame();
    if (!loaded) return;
    applyLoadedGame(loaded);
    setScreen("game");
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
    const { net, charged, refunded } = computeTerrainChangeCost(prev, next);
    if (net > 0 && world.cash < net) {
      setPaintError(`Insufficient funds: need $${Math.ceil(net).toLocaleString()}`);
      return false;
    }
    if (prev === next) return true;

    // Apply tile + cash
    setCourse((c) => {
      const tiles = c.tiles.slice();
      tiles[idx] = next;
      return { ...c, tiles };
    });
    setWorld((w) => {
      const nextCash = w.cash - net;
      return { ...w, cash: nextCash, isBankrupt: w.isBankrupt || nextCash < -10_000 };
    });

    // Track capital spending since last simulate
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

  function startWizard() {
    setEditorMode("HOLE_WIZARD");
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function redoWizard() {
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function nextHoleWizard() {
    setActiveHoleIndex((i) => Math.min(8, i + 1));
    redoWizard();
  }

  function confirmWizard() {
    if (world.isBankrupt) return;
    if (!draftTee || !draftGreen) return;

    // Two tile changes: tee + green. Check combined affordability.
    const teeIdx = draftTee.y * course.width + draftTee.x;
    const greenIdx = draftGreen.y * course.width + draftGreen.x;
    const teePrev = course.tiles[teeIdx];
    const greenPrev = course.tiles[greenIdx];
    const teeCost = computeTerrainChangeCost(teePrev, "tee");
    const greenCost = computeTerrainChangeCost(greenPrev, "green");
    const totalNet = teeCost.net + greenCost.net;
    if (totalNet > 0 && world.cash < totalNet) {
      setPaintError(`Insufficient funds to confirm: need $${Math.ceil(totalNet).toLocaleString()}`);
      return;
    }

    setCourse((c) => {
      const holes = c.holes.slice();
      const prev = holes[activeHoleIndex] ?? { tee: null, green: null };
      holes[activeHoleIndex] = { ...prev, tee: draftTee, green: draftGreen };
      return { ...c, holes };
    });
    // Apply as silent terrain changes (avoid double brush clicks), then play confirm chime.
    applyTerrainAt(draftTee.x, draftTee.y, "tee", { silent: true });
    applyTerrainAt(draftGreen.x, draftGreen.y, "green", { silent: true });
    void sound?.playConfirm(soundEnabled);

    setActiveHoleIndex((i) => Math.min(8, i + 1));
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function handleCanvasClick(x: number, y: number) {
    if (world.isBankrupt) return;
    // Unlock audio on first canvas interaction
    void audio.unlock();
    if (editorMode === "PAINT") {
      applyTerrainAt(x, y, selected);
      return;
    }
    if (editorMode === "OBSTACLE") {
      setCourse((c) => {
        const existingIdx = c.obstacles.findIndex((o) => o.x === x && o.y === y);
        const obstacles =
          existingIdx >= 0
            ? c.obstacles.filter((_, i) => i !== existingIdx)
            : [...c.obstacles, { x, y, type: obstacleType }];
        return { ...c, obstacles };
      });
      return;
    }
    // HOLE_WIZARD
    if (wizardStep === "TEE") {
      setDraftTee({ x, y });
      setDraftGreen(null);
      setWizardStep("GREEN");
      return;
    }
    if (wizardStep === "GREEN") {
      setDraftGreen({ x, y });
      setWizardStep("CONFIRM");
      return;
    }
    // CONFIRM step: ignore clicks (use Redo/Confirm)
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
    console.log("[Save] Saving game...", { course: course.name, worldWeek: world.week, historyLength: history.length });
    saveGame({ course, world, history });
    console.log("[Save] Game saved successfully");
    // Show visual feedback
    setPaintError("Game saved!");
    setTimeout(() => setPaintError(null), 2000);
  }

  function onLoad() {
    console.log("[Load] Attempting to load game...");
    const loaded = loadGame();
    if (!loaded) {
      console.warn("[Load] No saved game found");
      setPaintError("No saved game found");
      setTimeout(() => setPaintError(null), 2000);
      return;
    }
    console.log("[Load] Game loaded successfully", { course: loaded.course.name, worldWeek: loaded.world.week });
    applyLoadedGame(loaded);
    setPaintError("Game loaded!");
    setTimeout(() => setPaintError(null), 2000);
  }

  function onResetSave() {
    resetSave();
    setCourse(DEFAULT_STATE.course);
    setWorld(DEFAULT_STATE.world);
    setHistory([]);
    setLast(undefined);
    setEditorMode("PAINT");
    setActiveHoleIndex(0);
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
    setCapital({ spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} });
    setHover(null);
    setPaintError(null);
    setObstacleType("tree");
    setPeakCash(DEFAULT_STATE.world.cash);
    setPeakRep(DEFAULT_STATE.world.reputation);
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
    setCourse(c2);
    setWorld(w2);
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
    setLegacy((s) => {
      if (s.lastAwardId === awardId) return s; // prevent double-award across reloads
      const next = { ...s, legacyPoints: s.legacyPoints + earned, lastAwardId: awardId };
      saveLegacy(next);
      return next;
    });
  }, [world.isBankrupt, weeksSurvived, peakRep]);

  if (screen === "menu") {
    return (
      <StartMenu
        canLoad={canLoadFromMenu}
        onNewGame={newGameFromMenu}
        onLoadGame={loadFromMenu}
        audioVolumes={{
          music: audio.getVolumes().musicVolume,
          ambience: audio.getVolumes().ambienceVolume,
        }}
        onAudioVolumesChange={(volumes) =>
          audio.setVolumes({
            musicVolume: volumes.music,
            ambienceVolume: volumes.ambience,
          })
        }
        onButtonClick={() => {
          void audio.unlock();
          if (soundEnabled) void audio.playSfx(STRIKE_SFX);
        }}
      />
    );
  }

  return (
    <div className="cc-app">
      <GameBackground />
      <div className="cc-main">
        {world.isBankrupt && (
        <RunEndModal
          weeksSurvived={weeksSurvived}
          peakCash={peakCash}
          peakRep={peakRep}
          courseRating={rating.courseRating}
          slope={rating.slope}
          seed={world.runSeed}
          onRestartNew={() => restartRun({ seed: (Date.now() % 1_000_000) | 0 })}
          onRestartSeed={(seed) => restartRun({ seed })}
        />
      )}
        {showBridgePrompt && (
        <BridgeLoanPrompt
          onAccept={takeBridgeLoan}
          onDecline={() => setShowBridgePrompt(false)}
        />
      )}
        <div className="cc-course-frame">
          <div ref={canvasPaneRef} className="cc-course-pane">
            <CanvasCourse
              course={course}
              holes={course.holes}
              obstacles={course.obstacles}
              activeHoleIndex={activeHoleIndex}
              activePath={activePath}
              activeShotPlan={activeShotPlan}
              tileSize={tileSize}
              showGridOverlays={viewMode === "ARCHITECT"}
              animationsEnabled={animationsEnabled}
              flyoverNonce={flyoverNonce}
              showShotPlan={showShotPlan}
              editorMode={editorMode}
              wizardStep={wizardStep}
              draftTee={draftTee}
              draftGreen={draftGreen}
              onClickTile={handleCanvasClick}
              onHoverTile={(h) => setHover(h)}
              onLeave={() => setHover(null)}
              cursor={
                hover && editorMode === "PAINT"
                  ? (() => {
                      const prev = course.tiles[hover.idx];
                      const cost = computeTerrainChangeCost(prev, selected);
                      return cost.net > 0 && world.cash < cost.net ? "not-allowed" : "crosshair";
                    })()
                  : "crosshair"
              }
              flagColor={legacy.selected.flagColor}
              cameraState={holeEditCamera}
              showFixOverlay={showFixOverlay}
            />
            {hover && editorMode === "PAINT" && (
              <HoverTooltip hover={hover} prev={course.tiles[hover.idx]} next={selected} cash={world.cash} />
            )}
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
                  evaluation={evaluateHole(course, course.holes[activeHoleIndex], activeHoleIndex)}
                  showFixOverlay={showFixOverlay}
                  setShowFixOverlay={setShowFixOverlay}
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
        setGreenFee={(n) => setCourse((c) => ({ ...c, baseGreenFee: n }))}
        setMaintenance={(n) => setWorld((w) => ({ ...w, maintenanceBudget: n }))}
        editorMode={editorMode}
        setEditorMode={setEditorMode}
        startWizard={startWizard}
        obstacleType={obstacleType}
        setObstacleType={setObstacleType}
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
        viewMode={viewMode}
        setViewMode={setViewMode}
        animationsEnabled={animationsEnabled}
        setAnimationsEnabled={setAnimationsEnabled}
        onFlyover={() => setFlyoverNonce((n) => n + 1)}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
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
      />
          )}
        </div>
      </div>
    </div>
  );
}

function RunEndModal(props: {
  weeksSurvived: number;
  peakCash: number;
  peakRep: number;
  courseRating: number;
  slope: number;
  seed: number;
  onRestartNew: () => void;
  onRestartSeed: (seed: number) => void;
}) {
  const [seed, setSeed] = useState(props.seed);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: 16,
      }}
    >
      <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Run ended: Bankruptcy</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          You can restart and try a new plan. Same seed gives a comparable “challenge run”.
        </div>

        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Weeks survived</span>
            <b>{props.weeksSurvived}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Peak reputation</span>
            <b>{props.peakRep}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Peak cash</span>
            <b>${Math.round(props.peakCash).toLocaleString()}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Course rating / slope</span>
            <b>
              {props.courseRating.toFixed(1)} / {Math.round(props.slope)}
            </b>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <button
            onClick={props.onRestartNew}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #000",
              background: "#000",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            Restart (new run)
          </button>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ flex: 1, fontSize: 12, color: "#374151" }}>
              Seed
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                }}
              />
            </label>
            <button
              onClick={() => props.onRestartSeed(seed | 0)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 700,
              }}
            >
              Restart (seeded)
            </button>
          </div>
        </div>
      </div>
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

function HoverTooltip(props: {
  hover: { idx: number; x: number; y: number; clientX: number; clientY: number };
  prev: Terrain;
  next: Terrain;
  cash: number;
}) {
  const { net } = computeTerrainChangeCost(props.prev, props.next);
  const label =
    net > 0
      ? `Build cost: $${Math.ceil(net).toLocaleString()}`
      : net < 0
        ? `Refund: +$${Math.ceil(-net).toLocaleString()}`
        : "No cost";
  const insufficient = net > 0 && props.cash < net;
  return (
    <div
      style={{
        position: "fixed",
        left: props.hover.clientX + 12,
        top: props.hover.clientY + 12,
        padding: "6px 8px",
        borderRadius: 8,
        background: insufficient ? "rgba(160,0,0,0.9)" : "rgba(0,0,0,0.85)",
        color: "#fff",
        fontSize: 12,
        pointerEvents: "none",
        zIndex: 9999,
        maxWidth: 220,
      }}
    >
      <div>
        <b>
          {props.prev} → {props.next}
        </b>
      </div>
      <div>{label}</div>
      <div style={{ marginTop: 4, opacity: 0.9 }}>Most construction cost is unrecoverable.</div>
      {insufficient && <div style={{ marginTop: 4 }}>Insufficient funds</div>}
    </div>
  );
}
