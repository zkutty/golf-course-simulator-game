import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { AudioReactContext, type AudioContextValue } from "../audio/audioContext";
import { translate } from "../i18n/core";
import { I18nContext } from "../i18n/context";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { Course, Hole, Terrain } from "../game/models/types";
import { scoreCourseHoles } from "../game/sim/holes";
import { computeAutoPar, computeHoleDistanceTiles } from "../game/sim/holeMetrics";
import { DEFAULT_LEGACY } from "../utils/legacy";
import { HUD } from "./HUD";

const audio: AudioContextValue = {
  unlock: async () => undefined,
  setMusicContext: async () => undefined,
  setSurface: () => undefined,
  setMusicOverride: async () => undefined,
  playSfx: async () => undefined,
  playSting: async () => undefined,
  setAmbientMix: () => undefined,
  setPaused: () => undefined,
  testChannel: () => undefined,
  setVolumes: () => undefined,
  syncVolumes: () => undefined,
  getVolumes: () => ({
    masterVolume: 0,
    musicVolume: 0,
    ambienceVolume: 0,
    sfxVolume: 0,
    masterMuted: false,
    muteWhenHidden: false,
  }),
};

function courseWithFirstHole(hole: Hole): Course {
  return {
    ...DEFAULT_COURSE,
    tiles: Array.from({ length: DEFAULT_COURSE.width * DEFAULT_COURSE.height }, () => "fairway" as const),
    elevations: Array(DEFAULT_COURSE.width * DEFAULT_COURSE.height).fill(0),
    holes: [hole, ...DEFAULT_COURSE.holes.slice(1)],
  };
}

function firstHole(overrides: Partial<Hole> = {}): Hole {
  return {
    ...DEFAULT_COURSE.holes[0],
    tee: { x: 10, y: 10 },
    green: { x: 44, y: 14 },
    ...overrides,
  };
}

function compactWaterRingCourse(radius: number): Course {
  const width = 20;
  const height = 20;
  const hole = firstHole({ tee: { x: 1, y: 10 }, green: { x: 18, y: 10 } });
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway");
  for (let y = hole.green!.y - radius; y <= hole.green!.y + radius; y++) {
    for (let x = hole.green!.x - radius; x <= hole.green!.x + radius; x++) {
      if (x >= 0 && y >= 0 && x < width && y < height && (x !== hole.green!.x || y !== hole.green!.y)) tiles[y * width + x] = "water";
    }
  }
  tiles[hole.green!.y * width + hole.green!.x] = "green";
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles,
    elevations: Array(width * height).fill(0),
    holes: [hole, ...DEFAULT_COURSE.holes.slice(1)],
    yardsPerTile: 1,
  };
}

function renderParLabels(course: Course, activeHoleIndex = 0) {
  const props: ComponentProps<typeof HUD> = {
    course,
    world: DEFAULT_WORLD,
    terrainBrushWidth: 1,
    setTerrainBrushWidth: () => undefined,
    onUndoTerrain: () => undefined,
    onRedoTerrain: () => undefined,
    setGreenFee: () => undefined,
    setMaintenance: () => undefined,
    setGreenProgram: () => undefined,
    editorMode: "PAINT",
    setEditorMode: () => undefined,
    onEnterDesignMode: () => undefined,
    startWizard: () => undefined,
    buildingType: "pro_shop",
    setBuildingType: () => undefined,
    concessionTypes: [],
    decorationKind: "bench",
    setDecorationKind: () => undefined,
    decorationRotation: 0,
    setDecorationRotation: () => undefined,
    decorationSpan: 1,
    setDecorationSpan: () => undefined,
    decorationAction: "place",
    setDecorationAction: () => undefined,
    onConfigureBuilding: () => undefined,
    activeHoleIndex,
    setActiveHoleIndex: () => undefined,
    wizardStep: "TEE",
    draftTee: null,
    draftGreen: null,
    onWizardConfirm: () => undefined,
    onWizardRedo: () => undefined,
    onWizardNextHole: () => undefined,
    setActiveHoleParMode: () => undefined,
    setActiveHoleParManual: () => undefined,
    onUpgradeStaff: () => undefined,
    onUpgradeMarketing: () => undefined,
    staffUpgradeCost: null,
    marketingUpgradeCost: null,
    canUpgradeStaff: false,
    canUpgradeMarketing: false,
    onSave: () => undefined,
    onLoad: () => undefined,
    onResetSave: () => undefined,
    viewMode: "ARCHITECT",
    setViewMode: () => undefined,
    onFlyover: () => undefined,
    isBankrupt: false,
    onTakeBridgeLoan: () => undefined,
    onTakeExpansionLoan: () => undefined,
    legacy: DEFAULT_LEGACY,
    onUnlockFlagColor: () => undefined,
    onSelectFlagColor: () => undefined,
    showShotPlan: false,
    setShowShotPlan: () => undefined,
    onOpenGolfopedia: () => undefined,
    onStartTutorial: () => undefined,
  };
  return renderToStaticMarkup(
    <I18nContext.Provider value={{ locale: "en", setLocale: () => undefined, t: (key, params) => translate("en", key, params) }}>
      <AudioReactContext.Provider value={audio}>
        <HUD {...props} />
      </AudioReactContext.Provider>
    </I18nContext.Provider>,
  );
}

function parLabel(markup: string, testId: "active-hole-summary-par" | "active-hole-distance-par") {
  const match = markup.match(new RegExp(`<span data-testid="${testId}">([^<]*?)([345])</span>`));
  if (!match) throw new Error(`Missing ${testId} label in rendered HUD.`);
  return Number(match[2]);
}

function testIdText(markup: string, testId: string) {
  const match = markup.match(new RegExp(`<[^>]+data-testid="${testId}"[^>]*>([\\s\\S]*?)</(?:span|div)>`));
  if (!match) throw new Error(`Missing ${testId} in rendered HUD.`);
  return match[1].replace(/<[^>]+>/g, "");
}

function retiredStraightDistanceDetail(course: Course) {
  const hole = course.holes[0];
  const straightDistance = hole.tee && hole.green ? computeHoleDistanceTiles(hole.tee, hole.green) : null;
  return `${translate("en", "auto.ui.hud.par")}${straightDistance == null ? 4 : computeAutoPar(straightDistance)}`;
}

describe("ZK-1184 first-hole editor par authority", () => {
  it("keeps the 342-yard guided-hole regression fixture on the scored par, not the retired straight-distance threshold", () => {
    const course = courseWithFirstHole(firstHole());
    const straightDistance = computeHoleDistanceTiles(course.holes[0].tee!, course.holes[0].green!);
    const scoredPar = scoreCourseHoles(course).holes[0].par;

    expect(Math.round(straightDistance * course.yardsPerTile)).toBe(342);
    expect(computeAutoPar(straightDistance)).toBe(5);
    expect(scoredPar).toBe(3);

    const markup = renderParLabels(course);
    // This is the visible value produced by origin/develop's former distance
    // line. Assert it before test-only selectors so the regression remains
    // red against that baseline rather than merely missing a new attribute.
    expect(retiredStraightDistanceDetail(course)).toBe("• Par:5");
    expect(markup).not.toContain(retiredStraightDistanceDetail(course));
    expect(markup).toContain("• Par:3");
    expect(parLabel(markup, "active-hole-summary-par")).toBe(scoredPar);
    expect(parLabel(markup, "active-hole-distance-par")).toBe(scoredPar);
    expect(testIdText(markup, "active-hole-summary-auto-par")).toContain("Auto Par 3");
    expect(testIdText(markup, "active-hole-auto-par-explanation")).toContain("Auto Par 3");
    expect(testIdText(markup, "hole-list-par-0")).toBe("3");
  });

  it.each([
    { course: courseWithFirstHole(firstHole({ tee: { x: 10, y: 10 }, green: { x: 17, y: 10 } })), expectedPar: 3 },
    { course: compactWaterRingCourse(1), expectedPar: 4 },
    { course: compactWaterRingCourse(4), expectedPar: 5 },
  ])("renders each auto-derived scored par through summary, detail, list, and explanation", ({ course, expectedPar }) => {
    const scoredPar = scoreCourseHoles(course).holes[0].par;
    const markup = renderParLabels(course);

    expect(scoredPar).toBe(expectedPar);
    expect(parLabel(markup, "active-hole-summary-par")).toBe(scoredPar);
    expect(parLabel(markup, "active-hole-distance-par")).toBe(scoredPar);
    expect(testIdText(markup, "hole-list-par-0")).toBe(String(scoredPar));
    expect(testIdText(markup, "active-hole-summary-auto-par")).toContain(`Auto Par ${scoredPar}`);
    expect(testIdText(markup, "active-hole-auto-par-explanation")).toContain(`Auto Par ${scoredPar}`);
    expect(markup).toContain("(auto)");
  });

  it("keeps a manual selection while exposing the current Auto Par recommendation", () => {
    const manualCourse = courseWithFirstHole(firstHole({ parMode: "MANUAL", parManual: 5 }));
    const markup = renderParLabels(manualCourse);

    expect(parLabel(markup, "active-hole-summary-par")).toBe(5);
    expect(parLabel(markup, "active-hole-distance-par")).toBe(5);
    expect(testIdText(markup, "hole-list-par-0")).toBe("5");
    expect(testIdText(markup, "active-hole-summary-auto-par")).toContain("Auto Par 3");
    expect(testIdText(markup, "active-hole-auto-par-explanation")).toContain("Auto Par 3");
    expect(markup).toContain("(manual)");
    expect(markup).toContain("Manual");
  });

  it("keeps active-hole labels and recommendation scoped to the selected hole while retaining both scorecard values", () => {
    const firstHoleCourse = compactWaterRingCourse(1);
    const secondHole = firstHole({
      id: "hole-2",
      name: "Hole 2",
      tee: { x: 1, y: 2 },
      green: { x: 5, y: 2 },
      parMode: "MANUAL",
      parManual: 5,
    });
    const course = {
      ...firstHoleCourse,
      holes: [firstHoleCourse.holes[0], secondHole, ...DEFAULT_COURSE.holes.slice(2)],
    };
    const scored = scoreCourseHoles(course).holes;
    const firstSelected = renderParLabels(course, 0);
    const secondSelected = renderParLabels(course, 1);

    expect(scored[0]).toMatchObject({ par: 4, autoPar: 4 });
    expect(scored[1]).toMatchObject({ par: 5, autoPar: 3 });

    expect(parLabel(firstSelected, "active-hole-summary-par")).toBe(4);
    expect(parLabel(firstSelected, "active-hole-distance-par")).toBe(4);
    expect(testIdText(firstSelected, "active-hole-auto-par-explanation")).toContain("Auto Par 4");
    expect(firstSelected).toContain("(auto)");
    expect(testIdText(firstSelected, "hole-list-par-0")).toBe("4");
    expect(testIdText(firstSelected, "hole-list-par-1")).toBe("5");

    expect(parLabel(secondSelected, "active-hole-summary-par")).toBe(5);
    expect(parLabel(secondSelected, "active-hole-distance-par")).toBe(5);
    expect(testIdText(secondSelected, "active-hole-auto-par-explanation")).toContain("Auto Par 3");
    expect(secondSelected).toContain("(manual)");
    expect(testIdText(secondSelected, "hole-list-par-0")).toBe("4");
    expect(testIdText(secondSelected, "hole-list-par-1")).toBe("5");
  });

  it("re-reads the current scored par after a tee/pin change and keeps incomplete states explicit", () => {
    const course = compactWaterRingCourse(1);
    const movedCourse = {
      ...course,
      holes: [{ ...course.holes[0], green: { x: 5, y: 10 } }, ...course.holes.slice(1)],
    };
    const incompleteAutoCourse = courseWithFirstHole(firstHole({ tee: null, green: null }));
    const incompleteManualCourse = courseWithFirstHole(firstHole({ tee: null, green: null, parMode: "MANUAL", parManual: 3 }));

    expect(scoreCourseHoles(course).holes[0].par).toBe(4);
    expect(scoreCourseHoles(movedCourse).holes[0].par).toBe(3);
    expect(parLabel(renderParLabels(course), "active-hole-distance-par")).toBe(4);
    expect(parLabel(renderParLabels(movedCourse), "active-hole-distance-par")).toBe(3);

    const incompleteAuto = renderParLabels(incompleteAutoCourse);
    const incompleteManual = renderParLabels(incompleteManualCourse);
    expect(parLabel(incompleteAuto, "active-hole-distance-par")).toBe(4);
    expect(testIdText(incompleteAuto, "active-hole-auto-par-explanation")).toBe("Auto Par 4");
    expect(parLabel(incompleteManual, "active-hole-distance-par")).toBe(3);
    expect(testIdText(incompleteManual, "active-hole-auto-par-explanation")).toBe("Auto Par 4");
    expect(incompleteManual).toContain("(manual)");
  });
});
