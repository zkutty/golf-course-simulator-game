import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasCourse } from "./ui/CanvasCourse";
import { HUD } from "./ui/HUD";
import { DEFAULT_STATE } from "./game/gameState";
import type { Point, Terrain, WeekResult } from "./game/models/types";
import { tickWeek } from "./game/sim/tickWeek";
import { loadGame, resetSave, saveGame } from "./utils/save";
import { computeTerrainChangeCost } from "./game/models/terrainEconomics";
import type { ObstacleType } from "./game/models/types";
import { scoreCourseHoles } from "./game/sim/holes";

type EditorMode = "PAINT" | "HOLE_WIZARD" | "OBSTACLE";
type WizardStep = "TEE" | "GREEN" | "CONFIRM";

export default function App() {
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

  const canvasPaneRef = useRef<HTMLDivElement | null>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
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
  }, []);

  const tileSize = useMemo(() => {
    // Fit the entire course without scroll, maintain aspect ratio.
    const w = Math.max(0, paneSize.width);
    const h = Math.max(0, paneSize.height);
    if (w === 0 || h === 0) return 16;
    const size = Math.floor(Math.min(w / course.width, h / course.height));
    return Math.max(4, Math.min(40, size));
  }, [paneSize.width, paneSize.height, course.width, course.height]);

  const activePath = useMemo(() => {
    const summary = scoreCourseHoles(course);
    return summary.holes[activeHoleIndex]?.path ?? [];
  }, [course, activeHoleIndex]);

  function applyTileChange(idx: number, next: Terrain): boolean {
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
    setWorld((w) => ({ ...w, cash: w.cash - net }));

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
    return true;
  }

  function applyTerrainAt(x: number, y: number, next: Terrain) {
    const idx = y * course.width + x;
    applyTileChange(idx, next);
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
    applyTerrainAt(draftTee.x, draftTee.y, "tee");
    applyTerrainAt(draftGreen.x, draftGreen.y, "green");

    setActiveHoleIndex((i) => Math.min(8, i + 1));
    setWizardStep("TEE");
    setDraftTee(null);
    setDraftGreen(null);
  }

  function handleCanvasClick(x: number, y: number) {
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
      if (w.staffLevel >= 5) return w;
      if (w.cash < staffUpgradeCost) return w;
      return { ...w, cash: w.cash - staffUpgradeCost, staffLevel: w.staffLevel + 1 };
    });
  }

  function onUpgradeMarketing() {
    if (marketingUpgradeCost == null) return;
    setWorld((w) => {
      if (w.marketingLevel >= 5) return w;
      if (w.cash < marketingUpgradeCost) return w;
      return {
        ...w,
        cash: w.cash - marketingUpgradeCost,
        marketingLevel: w.marketingLevel + 1,
      };
    });
  }

  function onSave() {
    saveGame({ course, world, history });
  }

  function onLoad() {
    const loaded = loadGame();
    if (!loaded) return;
    setCourse(loaded.course);
    setWorld(loaded.world);
    setHistory(loaded.history ?? []);
    const lastResult = loaded.history?.[loaded.history.length - 1];
    setLast(lastResult);
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
  }

  function simulate() {
    const { course: c2, world: w2, result } = tickWeek(course, world, 1337);
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
  }

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "7fr 3fr",
        overflow: "hidden",
      }}
    >
      <div
        ref={canvasPaneRef}
        style={{
          position: "relative",
          overflow: "hidden",
          background: "#0b1220",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CanvasCourse
          course={course}
          holes={course.holes}
          obstacles={course.obstacles}
          activeHoleIndex={activeHoleIndex}
          activePath={activePath}
          tileSize={tileSize}
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
        />
        {hover && editorMode === "PAINT" && (
          <HoverTooltip
            hover={hover}
            prev={course.tiles[hover.idx]}
            next={selected}
            cash={world.cash}
          />
        )}
      </div>
      <div style={{ overflow: "hidden", borderLeft: "1px solid rgba(17,24,39,0.12)" }}>
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
      />
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
      {insufficient && <div style={{ marginTop: 4 }}>Insufficient funds</div>}
    </div>
  );
}
