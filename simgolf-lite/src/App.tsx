import { useMemo, useState } from "react";
import { CanvasCourse } from "./ui/CanvasCourse";
import { HUD } from "./ui/HUD";
import { DEFAULT_STATE } from "./game/gameState";
import type { Terrain, WeekResult } from "./game/models/types";
import { tickWeek } from "./game/sim/tickWeek";
import { loadGame, resetSave, saveGame } from "./utils/save";

export default function App() {
  const [course, setCourse] = useState(DEFAULT_STATE.course);
  const [world, setWorld] = useState(DEFAULT_STATE.world);
  const [selected, setSelected] = useState<Terrain>("fairway");
  const [last, setLast] = useState<WeekResult | undefined>(undefined);
  const [history, setHistory] = useState<WeekResult[]>([]);
  const [mode, setMode] = useState<"paint" | "tee" | "green">("paint");
  const [activeHoleIndex, setActiveHoleIndex] = useState(0);

  function onPaint(idx: number, t: Terrain) {
    setCourse((c) => {
      const tiles = c.tiles.slice();
      tiles[idx] = t;
      return { ...c, tiles };
    });
  }

  function setTileAt(x: number, y: number, t: Terrain) {
    setCourse((c) => {
      const idx = y * c.width + x;
      const tiles = c.tiles.slice();
      tiles[idx] = t;
      return { ...c, tiles };
    });
  }

  function onPlaceTee(holeIndex: number, x: number, y: number) {
    setCourse((c) => {
      const holes = c.holes.slice();
      const h = holes[holeIndex] ?? { tee: null, green: null };
      holes[holeIndex] = { ...h, tee: { x, y } };
      return { ...c, holes };
    });
    setTileAt(x, y, "tee");
  }

  function onPlaceGreen(holeIndex: number, x: number, y: number) {
    setCourse((c) => {
      const holes = c.holes.slice();
      const h = holes[holeIndex] ?? { tee: null, green: null };
      holes[holeIndex] = { ...h, green: { x, y } };
      return { ...c, holes };
    });
    setTileAt(x, y, "green");
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
    setMode("paint");
    setActiveHoleIndex(0);
  }

  function simulate() {
    const { course: c2, world: w2, result } = tickWeek(course, world, 1337);
    setCourse(c2);
    setWorld(w2);
    setLast(result);
    setHistory((h) => [...h.slice(-19), result]);
  }

  return (
    <div style={{ display: "flex", gap: 16, padding: 16 }}>
      <div style={{ flex: 1 }}>
        <CanvasCourse
          course={course}
          holes={course.holes}
          selected={selected}
          mode={mode}
          activeHoleIndex={activeHoleIndex}
          onPaint={onPaint}
          onPlaceTee={onPlaceTee}
          onPlaceGreen={onPlaceGreen}
        />
      </div>
      <HUD
        course={course}
        world={world}
        last={last}
        selected={selected}
        setSelected={setSelected}
        setGreenFee={(n) => setCourse((c) => ({ ...c, baseGreenFee: n }))}
        setMaintenance={(n) => setWorld((w) => ({ ...w, maintenanceBudget: n }))}
        mode={mode}
        setMode={setMode}
        activeHoleIndex={activeHoleIndex}
        setActiveHoleIndex={setActiveHoleIndex}
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
      />
    </div>
  );
}
