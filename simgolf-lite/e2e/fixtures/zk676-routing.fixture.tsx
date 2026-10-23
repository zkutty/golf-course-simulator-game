import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PixiStage } from "../../src/ui/PixiStage";
import { ArchitectureReviewPanel } from "../../src/ui/ArchitectureReviewPanel";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { DEFAULT_KEYBINDINGS } from "../../src/accessibility/keybindings";
import { buildArchitectureReview, defaultArchitectureFilters } from "../../src/game/architecture/review";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { routingLabelFixture, type RoutingFixtureKind } from "../../src/game/architecture/routingLabelFixtures";
import { hashCanonicalValue } from "../../src/utils/canonical";
import type { Course, Point } from "../../src/game/models/types";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
const course = routingLabelFixture((params.get("fixture") ?? "four") as RoutingFixtureKind, (params.get("biome") ?? "parkland") as Course["theme"]);
const calls: Array<{ point: Point; holeId: string }> = [];
export function Fixture() {
  const [filters, setFilters] = useState({ ...defaultArchitectureFilters(course), kind: "routing" as const, pinRotation: "all" as const });
  const [camera, setCamera] = useState({ id: "routing-initial", center: { x: 32, y: 24 }, zoom: .25, rotation: 0 as 0 | 1 | 2 | 3 });
  const [open, setOpen] = useState(true);
  const [generation, setGeneration] = useState(0);
  const review = useMemo(() => buildArchitectureReview(course, DEFAULT_WORLD, filters), [filters]);
  const select = (point: Point, holeId: string) => { calls.push({ point, holeId }); setFilters(current => ({ ...current, holeId })); };
  Object.assign(window, { __routingFixture: {
    course: () => structuredClone(course), state: () => ({ filters, routing: review.overlay.routing, calls: structuredClone(calls), courseHash: hashCanonicalValue(course) }),
    camera: (zoom: number, rotation: 0 | 1 | 2 | 3) => setCamera(current => ({ ...current, id: `routing-${Date.now()}`, zoom, rotation })),
    toggle: () => setFilters(current => ({ ...current, kind: current.kind === "routing" ? "traces" as "routing" : "routing" })),
    unmount: () => setOpen(false), remount: () => { setGeneration(g => g + 1); setOpen(true); },
  } });
  return <>{open && <><div style={{ position: "absolute", left: 0, top: 0, width: "calc(100% - 460px)", height: "100%" }}><PixiStage key={generation} course={course} holes={course.holes} obstacles={course.obstacles} activeHoleIndex={Math.max(0, course.holes.findIndex(h => h.id === filters.holeId))} tileSize={16} showGridOverlays={false} architectureOverlay={review.overlay} onArchitectureHoleSelect={select} animationsEnabled={false} graphicsQuality="high" reducedMotion={true} ambienceFx={false} waterAnimation={false} treeSway={false} resolutionScale={1} worldSeed={676} cameraSmoothing={false} edgeScroll={false} edgeScrollSpeed={0} colorVision="deuteranopia" terrainPatterns={true} keybindings={DEFAULT_KEYBINDINGS} flyoverNonce={0} showShotPlan={false} editorMode="PAINT" wizardStep="TEE" draftTee={null} draftGreen={null} onClickTile={() => { throw new Error("Routing control leaked into terrain edit"); }} referenceCamera={camera}/></div><ArchitectureReviewPanel course={course} review={review} onFilters={next => setFilters(next as typeof filters)} onJump={(point, holeId) => { if (holeId) select(point, holeId); }} onPracticeRound={async () => null} onClose={() => setOpen(false)}/></>}</>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture/></I18nProvider>);
