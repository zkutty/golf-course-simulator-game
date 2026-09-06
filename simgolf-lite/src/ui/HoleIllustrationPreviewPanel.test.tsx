import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../game/models/defaults";
import type { CourseLayout } from "../game/models/types";
import type { Course } from "../game/models/types";
import { I18nContext } from "../i18n/context";
import { translate } from "../i18n/core";
import { HoleIllustrationPreviewPanel, transitionIllustrationLayout, transitionIllustrationRouteSource } from "./HoleIllustrationPreviewPanel";
import { defaultHoleIllustrationPreviewSettings } from "../game/holeIllustration/preview";

describe("ZK-769 illustration preview panel", () => {
  const dogleg = (): Course => {
    const width = 84, height = 32, tee = { x: 3, y: 5 }, pin = { x: 23, y: 28 }, tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
    tiles[tee.y * width + tee.x] = "tee";
    for (let y = pin.y - 2; y <= pin.y + 2; y++) for (let x = pin.x - 2; x <= pin.x + 2; x++) tiles[y * width + x] = "green";
    return { width, height, tiles, elevations: Array.from({ length: width * height }, (_, i) => i % 3), holes: [{ id: "dogleg", name: "Dogleg", tee, green: pin, teeBoxes: { forward: tee, member: tee, championship: tee }, pinPositions: { A: pin, B: pin, C: pin }, waypoints: Array.from({ length: 13 }, (_, i) => ({ x: i < 7 ? 5 + i * 3 : 23, y: i < 7 ? 5 : 5 + (i - 6) * 3 })), parMode: "MANUAL", parManual: 4 }], layouts: [{ id: "main", name: "Main", draftHoleIds: ["dogleg"], publishedHoleIds: ["dogleg"], roundLength: 9, state: "open", greenFee: 1 }], activeCourseId: "main", obstacles: [], buildings: [], yardsPerTile: 10, name: "Dogleg", baseGreenFee: 1, condition: 1 };
  };
  it("renders labelled native controls, read-only cancellation, and a responsive composition", () => {
    const settings = defaultHoleIllustrationPreviewSettings(DEFAULT_COURSE)!;
    const html = renderToStaticMarkup(createElement(I18nContext.Provider, { value: { locale: "en", setLocale: () => {}, t: (key, params) => translate("en", key, params) } }, createElement(HoleIllustrationPreviewPanel, { course: DEFAULT_COURSE, evidence: { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation }, onClose: () => {} })));
    expect(html).toContain('aria-label="Route source"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('data-testid="hole-illustration-cancel"');
    expect(html).toContain('Read-only preview');
    expect(html).toContain('grid-template-columns:repeat(auto-fit,minmax(130px,1fr))');
  });

  it("atomically selects a valid route hole or an explicit empty selection", () => {
    const settings = defaultHoleIllustrationPreviewSettings(DEFAULT_COURSE)!;
    const layouts: CourseLayout[] = [{ id: "a", name: "A", publishedHoleIds: ["p"], draftHoleIds: ["d"], roundLength: 9, state: "open", greenFee: 1 }];
    expect(transitionIllustrationLayout(settings, layouts, "a")).toMatchObject({ routeSource: "published", holeId: "p" });
    expect(transitionIllustrationRouteSource({ ...settings, layoutId: "a", holeId: "p" }, layouts, "draft")).toMatchObject({ routeSource: "draft", holeId: "d" });
    expect(transitionIllustrationRouteSource({ ...settings, layoutId: "a" }, [{ ...layouts[0], draftHoleIds: [] }], "draft").holeId).toBe("");
  });

  it("keeps landing shot text accessible without visual labels and renders a clamped figure caption when enabled", () => {
    const course = dogleg(), settings = defaultHoleIllustrationPreviewSettings(course)!;
    const provider = (initialSettings: typeof settings) => renderToStaticMarkup(createElement(I18nContext.Provider, { value: { locale: "en", setLocale: () => {}, t: (key, params) => translate("en", key, params) } }, createElement(HoleIllustrationPreviewPanel, { course, evidence: { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation }, initialSettings, onClose: () => {} })));
    const labelsOff = provider({ ...settings, showLandingDistances: true, showLabels: false });
    expect(labelsOff).toMatch(/Landing 1: \d+ yd shot/);
    expect(labelsOff).not.toContain("<figcaption");
    expect(labelsOff).toContain("<figure");
    expect(labelsOff).toContain("width:100%");
    expect(labelsOff).toContain("box-sizing:border-box");
    const labelsOn = provider({ ...settings, showLabels: true });
    expect(labelsOn).toContain("<figcaption");
    expect(labelsOn).toContain("position:absolute");
    expect(labelsOn).toContain("font-size:clamp(12px,3vw,16px)");
  });
});
