import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import type { Course } from "../models/types";
import { GREEN_SURFACE_FIXED_POINT_SCALE, GREEN_SURFACE_SAMPLES_PER_AXIS, GREEN_SURFACE_VERSION } from "../greens/greenSurface";
import { createReferenceCourse } from "../testing/referenceCourse";
import { buildHoleIllustrationPreview, defaultHoleIllustrationPreviewSettings } from "./preview";

function fixture(): Course {
  const width = 24;
  const tee = { x: 3, y: 12 };
  const pin = { x: 20, y: 12 };
  const tiles: Course["tiles"] = Array.from({ length: width * width }, () => "rough");
  tiles[tee.y * width + tee.x] = "tee";
  tiles[pin.y * width + pin.x] = "green";
  tiles[12 * width + 10] = "water";
  return {
    width, height: width, tiles, elevations: Array.from({ length: width * width }, () => 0),
    holes: [{ id: "one", name: "First", tee, green: pin, teeBoxes: { forward: tee, member: tee, championship: tee }, pinPositions: { A: pin, B: pin, C: pin }, waypoints: [{ x: 9, y: 9 }, { x: 15, y: 14 }], parMode: "AUTO" }],
    layouts: [{ id: "main", name: "Main", draftHoleIds: ["one"], publishedHoleIds: ["one"], roundLength: 9, state: "open", greenFee: 50 }], activeCourseId: "main",
    obstacles: [], buildings: [], yardsPerTile: 10, name: "Preview fixture", baseGreenFee: 50, condition: 1,
  };
}

function doglegFixture(): Course {
  const width = 84, height = 32, tee = { x: 3, y: 5 }, pin = { x: 23, y: 28 };
  const waypoints = Array.from({ length: 13 }, (_, index) => ({ x: index < 7 ? 5 + index * 3 : 23, y: index < 7 ? 5 : 5 + (index - 6) * 3 }));
  const tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = pin.y - 2; y <= pin.y + 2; y++) for (let x = pin.x - 2; x <= pin.x + 2; x++) tiles[y * width + x] = "green";
  return { width, height, tiles, elevations: Array.from({ length: width * height }, (_, index) => index % 3), holes: [{ id: "dogleg", name: "Dogleg", tee, green: pin, teeBoxes: { forward: tee, member: tee, championship: tee }, pinPositions: { A: pin, B: pin, C: pin }, waypoints, parMode: "MANUAL", parManual: 4 }], layouts: [{ id: "main", name: "Main", draftHoleIds: ["dogleg"], publishedHoleIds: ["dogleg"], roundLength: 9, state: "open", greenFee: 1 }], activeCourseId: "main", obstacles: [], buildings: [], yardsPerTile: 10, name: "Dogleg", baseGreenFee: 1, condition: 1 };
}

describe("ZK-769 hole illustration preview presenter", () => {
  it("is deterministic, read-only, and uses the released snapshot and plan hashes", () => {
    const course = fixture();
    const before = structuredClone(course);
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const evidence = { status: "ready" as const, layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation };
    const first = buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true }, evidence);
    expect(buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true }, evidence)).toEqual(first);
    expect(course).toEqual(before);
    expect(first).toMatchObject({ complete: true, metadata: { holeNumber: 1, holeName: "First", routeSource: "published" } });
    expect(first.metadata?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.metadata?.planHash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("uses only the exact M69 plan rather than authored waypoints", () => {
    const course = fixture();
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const preview = buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true }, { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(preview.landings).toEqual([]);
    expect(preview.annotationsAvailable).toBe(true);
    expect(preview.svg).toContain('data-m69-segment="true"');
  });

  it("retains a safe base illustration but removes route annotations for stale or sparse evidence", () => {
    const course = fixture();
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const preview = buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true }, { status: "stale-only", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(preview).toMatchObject({ complete: true, annotationsAvailable: false });
    expect(preview.landings).toEqual([]);
    expect(preview.svg).toContain('[data-layer="route"]{display:none}');
    expect(preview.svg).toContain('data-layer="terrain"');
  });

  it("requires an exact evidence tuple and hides renderer waypoint geometry even when M69 is admitted", () => {
    const course = fixture();
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const mismatch = buildHoleIllustrationPreview(course, { ...settings, showContours: false }, { status: "ready", layoutId: settings.layoutId, holeId: "other", teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(mismatch.annotationsAvailable).toBe(false);
    expect(mismatch.svg).toContain('[data-layer="route"]{display:none}');
    expect(mismatch.svg).toContain('[data-layer="elevation-contours"],[data-layer="route"]{display:none}');
    expect(mismatch.svg).not.toContain('data-m69-segment="true"');
  });

  it("normalizes a legacy course with no explicit layouts into a renderable default", () => {
    const course = fixture();
    delete course.layouts;
    delete course.activeCourseId;
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const preview = buildHoleIllustrationPreview(course, settings, { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(settings).toMatchObject({ layoutId: "course-primary", holeId: "one", routeSource: "published" });
    expect(preview.complete).toBe(true);
  });

  it("keeps M69 landing shot semantics deterministic across north-up and tee-to-green frames", () => {
    const course = doglegFixture();
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const evidence = { status: "ready" as const, layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation };
    const north = buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true, frame: "north-up" }, evidence);
    const aligned = buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true, frame: "tee-to-green" }, evidence);
    expect(aligned.landings).toEqual(north.landings);
    expect(north.landings).toHaveLength(1);
    expect((north.svg!.match(/data-m69-segment="true"/g) ?? [])).toHaveLength(2);
    expect((aligned.svg!.match(/data-m69-segment="true"/g) ?? [])).toHaveLength(2);
    expect((north.svg!.match(/data-m69-landing=/g) ?? [])).toHaveLength(1);
    expect((aligned.svg!.match(/data-m69-landing=/g) ?? [])).toHaveLength(1);
    expect(north.svg).toContain('[data-layer="route"]{display:none}');
    expect(north.svg).toContain(`${north.landings[0].yards} yd shot`);
    expect(aligned.svg).toContain(`${aligned.landings[0].yards} yd shot`);
    expect((course.holes[0].waypoints ?? []).length).toBeGreaterThan(north.landings.length + 1);
    expect(buildHoleIllustrationPreview(course, { ...settings, showLandingDistances: true, frame: "tee-to-green" }, evidence)).toEqual(aligned);
  });

  it("hides both authored and M69 shot lines when shot-line presentation is disabled", () => {
    const course = doglegFixture(), settings = defaultHoleIllustrationPreviewSettings(course)!;
    const preview = buildHoleIllustrationPreview(course, { ...settings, showShotLine: false }, { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(preview.svg).toContain('[data-layer="route"]{display:none}');
    expect(preview.svg).not.toContain('data-m69-segment="true"');
  });

  it("keeps contours-off SVG structurally parseable while hiding nested contour output", () => {
    const course = doglegFixture();
    course.greenSurface = { version: GREEN_SURFACE_VERSION, samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS, fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE, interpolation: "bilinear", tiles: [{ x: 23, y: 28, offsets: [32, 16, 0, -16, 16, 0, -16, -32, 0, -16, -32, -16, -16, -32, -16, 0] }] };
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const withContours = buildHoleIllustrationPreview(course, settings, { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(withContours.svg).toContain('data-kind="sample-grid"');
    const preview = buildHoleIllustrationPreview(course, { ...settings, showContours: false }, { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    const document = new DOMParser().parseFromString(preview.svg!, "image/svg+xml");
    expect(document.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(preview.svg).toContain('[data-layer="elevation-contours"]');
  });

  it("fails closed when a complete snapshot has an implausible M69 plan", () => {
    const course = createReferenceCourse();
    const settings = defaultHoleIllustrationPreviewSettings(course)!;
    const preview = buildHoleIllustrationPreview(course, settings, { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation });
    expect(preview).toMatchObject({ complete: true, annotationsAvailable: false });
    expect(preview.landings).toEqual([]);
    expect(preview.warning).toBeTruthy();
    expect(preview.svg).toContain('data-layer="terrain"');
    expect(preview.svg).toContain('[data-layer="route"]{display:none}');
    expect(preview.svg).not.toContain('data-m69-segment="true"');
  });
});
