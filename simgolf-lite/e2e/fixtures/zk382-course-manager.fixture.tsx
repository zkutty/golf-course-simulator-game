import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { CourseManagerPanel } from "../../src/ui/CourseManagerPanel";
import type { Course } from "../../src/game/models/types";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createM26MultiCourseReferenceCourse } from "../../src/game/testing/referenceCourse";
import { addEstateHole, assignHoleToLayout, courseForLayout, courseLayouts, createLayout, normalizeCourseLayouts, publishLayout, selectLayout, updateLayout, validateDraftRouting } from "../../src/game/models/courseLayouts";
import { analyzeArchitecture } from "../../src/game/architecture/architecture";
import { courseOperationalMetrics } from "../../src/game/sim/courseOperations";
import "../../src/index.css";

export type CourseManagerCall = { type: string; course?: Course; holeId?: string; point?: { x: number; y: number }; entry?: string };
export type CourseManagerAction = { type: "create" | "add" | "publish" } | { type: "select"; id: string } | { type: "rename"; name: string } | { type: "fee"; value: number } | { type: "operating"; value: "open" | "closed" } | { type: "reorder"; index: number; delta: number } | { type: "remove" | "assign"; holeId: string };
export interface CourseManagerFixture {
  state: () => Course;
  calls: () => CourseManagerCall[];
  reset: (mode?: "normal" | "invalid" | "limit") => void;
  expected: (action: CourseManagerAction) => Course;
  report: () => { architecture: ReturnType<typeof analyzeArchitecture>; metrics: ReturnType<typeof courseOperationalMetrics>; validation: ReturnType<typeof validateDraftRouting> };
}
declare global { interface Window { __courseManagerFixture: CourseManagerFixture } }

function createFixture(mode: "normal" | "invalid" | "limit" = "normal"): Course {
  const base = createM26MultiCourseReferenceCourse();
  const holes = base.holes.map(hole => ({ ...hole, name: hole.id === "north-1" ? "The_Willow_Creek_Championship_First_Hole_With_A_Long_Editable_Name" : hole.name }));
  holes.push({ ...holes[0], id: "spare", name: "Unassigned championship hole" });
  if (mode === "limit") while (holes.length < 35) holes.push({ id: `spare-${holes.length}`, name: `Unassigned ${holes.length}`, tee: null, green: null, parMode: "AUTO" });
  return normalizeCourseLayouts({ ...base, holes, layouts: base.layouts!.map(layout => ({ ...layout, name: "Willow Creek Championship Course", draftHoleIds: mode === "invalid" && layout.id === "north" ? layout.draftHoleIds.slice(0, 8) : layout.draftHoleIds })), activeCourseId: "north" });
}

export function Fixture() {
  const [course, setCourse] = useState(createFixture);
  const [open, setOpen] = useState(true);
  const state = useRef(course);
  const calls = useRef<CourseManagerCall[]>([]);
  const note = (call: CourseManagerCall) => { calls.current.push(structuredClone(call)); };
  useEffect(() => {
    state.current = course;
    window.__courseManagerFixture = {
    state: () => structuredClone(state.current), calls: () => structuredClone(calls.current),
    reset: (mode = "normal") => { calls.current = []; setCourse(createFixture(mode)); setOpen(true); },
    expected: (action) => {
      const current = state.current; const active = courseLayouts(current).find(layout => layout.id === current.activeCourseId)!;
      switch (action.type) {
        case "create": return createLayout(current);
        case "add": return addEstateHole(current, active.id);
        case "select": return selectLayout(current, action.id);
        case "rename": return updateLayout(current, active.id, { name: action.name });
        case "fee": return updateLayout(current, active.id, { greenFee: action.value });
        case "operating": return updateLayout(current, active.id, { state: action.value });
        case "publish": return publishLayout(current, active.id).course;
        case "assign": return assignHoleToLayout(current, active.id, action.holeId);
        case "remove": return updateLayout(current, active.id, { draftHoleIds: active.draftHoleIds.filter(id => id !== action.holeId) });
        case "reorder": {
          const ids = [...active.draftHoleIds]; const next = action.index + action.delta;
          if (next < 0 || next >= ids.length) return current;
          [ids[action.index], ids[next]] = [ids[next], ids[action.index]];
          return updateLayout(current, active.id, { draftHoleIds: ids });
        }
      }
    },
    report: () => ({ architecture: analyzeArchitecture(courseForLayout(state.current, state.current.activeCourseId)), metrics: courseOperationalMetrics(state.current, DEFAULT_WORLD, state.current.activeCourseId), validation: validateDraftRouting(state.current, state.current.activeCourseId!) }),
    };
  }, [course]);
  return <>
    <button data-testid="outside-before">Outside before</button>
    {open && <CourseManagerPanel course={course} world={DEFAULT_WORLD}
      onChange={(next) => { note({ type: "change", course: next }); setCourse(next); }}
      onSelectHole={(holeId) => note({ type: "select-hole", holeId })}
      onCenter={(point) => note({ type: "center", point })}
      onOpenGolfopedia={(entry) => note({ type: "help", entry })}
      onOpenArchitectureReview={() => note({ type: "review" })}
      onClose={() => { note({ type: "close" }); setOpen(false); }} />}
    <button data-testid="outside-after" style={{ position: "fixed", left: 8, bottom: 8 }}>Outside after</button>
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
