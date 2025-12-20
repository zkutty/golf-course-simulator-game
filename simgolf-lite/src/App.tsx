import { useState } from "react";
import { CanvasCourse } from "./ui/CanvasCourse";
import { HUD } from "./ui/HUD";
import { DEFAULT_STATE } from "./game/gameState";
import type { Terrain, WeekResult } from "./game/models/types";
import { tickWeek } from "./game/sim/tickWeek";

export default function App() {
  const [course, setCourse] = useState(DEFAULT_STATE.course);
  const [world, setWorld] = useState(DEFAULT_STATE.world);
  const [selected, setSelected] = useState<Terrain>("fairway");
  const [last, setLast] = useState<WeekResult | undefined>(undefined);

  function onPaint(idx: number, t: Terrain) {
    setCourse((c) => {
      const tiles = c.tiles.slice();
      tiles[idx] = t;
      return { ...c, tiles };
    });
  }

  function simulate() {
    const { course: c2, world: w2, result } = tickWeek(course, world, 1337);
    setCourse(c2);
    setWorld(w2);
    setLast(result);
  }

  return (
    <div style={{ display: "flex", gap: 16, padding: 16 }}>
      <div style={{ flex: 1 }}>
        <CanvasCourse course={course} selected={selected} onPaint={onPaint} />
      </div>
      <HUD
        course={course}
        world={world}
        last={last}
        selected={selected}
        setSelected={setSelected}
        setGreenFee={(n) => setCourse((c) => ({ ...c, baseGreenFee: n }))}
        setMaintenance={(n) => setWorld((w) => ({ ...w, maintenanceBudget: n }))}
        simulate={simulate}
      />
    </div>
  );
}
