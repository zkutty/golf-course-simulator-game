import { createRoot } from "react-dom/client";
import { setActiveLocale } from "../../src/i18n/core";
import { ContextualInspectorPanel } from "../../src/ui/ContextualInspectorPanel";
import "../../src/index.css";

setActiveLocale(window.localStorage.getItem("coursecraft_locale") === "pseudo" ? "pseudo" : "en");

const calls: string[] = [];
const note = (name: string) => {
  calls.push(name);
  document.querySelector<HTMLOutputElement>("[data-testid=callback-log]")!.value = calls.join(",");
};
const record = (name: string) => () => {
  note(name);
};
const root = createRoot(document.getElementById("root")!);

root.render(
  <>
    <output data-testid="callback-log" aria-live="polite" />
    <ContextualInspectorPanel
      courseName="Willow Creek Championship Course"
      selectedTerrain="Rolling woodland"
      validHoles={9}
      condition={0.87}
      cash="$12,450"
      reputation={82}
      week={14}
      golfers={37}
      openComplaints={2}
      playerRound="73 (+1)"
      onOpenCourses={record("open-courses")}
      onOpenLive={record("open-live")}
      onOpenProperty={record("open-property")}
      onOpenPeople={record("open-people")}
      onOpenLegacy={record("open-legacy")}
      onSetViewMode={(mode) => note(`view-${mode.toLowerCase()}`)}
      onSetPacePreset={(preset) => note(`pace-${preset}`)}
      onClose={record("close")}
    />
  </>,
);
