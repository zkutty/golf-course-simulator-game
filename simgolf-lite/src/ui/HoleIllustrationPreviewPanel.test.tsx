import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COURSE } from "../game/models/defaults";
import type { CourseLayout } from "../game/models/types";
import type { Course } from "../game/models/types";
import { I18nContext } from "../i18n/context";
import { translate } from "../i18n/core";
import type { HoleIllustrationExportArtifact } from "../game/holeIllustration/export";
import type { HoleIllustrationDeliveryResult } from "../game/holeIllustration/exportRuntime";
import { HoleIllustrationExportControls, HoleIllustrationPreviewPanel, holeIllustrationDeliveryMessage, runHoleIllustrationExport, transitionIllustrationLayout, transitionIllustrationRouteSource } from "./HoleIllustrationPreviewPanel";
import { defaultHoleIllustrationPreviewSettings } from "../game/holeIllustration/preview";

describe("ZK-769 illustration preview panel", () => {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params);
  const provider = (child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(I18nContext.Provider, { value: { locale: "en", setLocale: () => {}, t } }, child));
  const exportArtifact = (): HoleIllustrationExportArtifact => ({
    complete: true,
    kind: "single",
    width: 3840,
    height: 2560,
    viewBox: "0 0 960 640",
    fileStem: "hole-one",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    metadata: { schema: "coursecraft-hole-illustration", version: 1, kind: "single", width: 3840, height: 2560, courseName: "Course", layoutId: "main", layoutName: "Main", holeId: "one", holeName: "One", tee: "member", pin: "A", frame: "north-up", biome: "parkland", season: "summer", contrast: "standard", snapshotHashes: [], planHashes: [], publishedHoleCount: 9 },
  });
  const dogleg = (): Course => {
    const width = 84, height = 32, tee = { x: 3, y: 5 }, pin = { x: 23, y: 28 }, tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
    tiles[tee.y * width + tee.x] = "tee";
    for (let y = pin.y - 2; y <= pin.y + 2; y++) for (let x = pin.x - 2; x <= pin.x + 2; x++) tiles[y * width + x] = "green";
    return { width, height, tiles, elevations: Array.from({ length: width * height }, (_, i) => i % 3), holes: [{ id: "dogleg", name: "Dogleg", tee, green: pin, teeBoxes: { forward: tee, member: tee, championship: tee }, pinPositions: { A: pin, B: pin, C: pin }, waypoints: Array.from({ length: 13 }, (_, i) => ({ x: i < 7 ? 5 + i * 3 : 23, y: i < 7 ? 5 : 5 + (i - 6) * 3 })), parMode: "MANUAL", parManual: 4 }], layouts: [{ id: "main", name: "Main", draftHoleIds: ["dogleg"], publishedHoleIds: ["dogleg"], roundLength: 9, state: "open", greenFee: 1 }], activeCourseId: "main", obstacles: [], buildings: [], yardsPerTile: 10, name: "Dogleg", baseGreenFee: 1, condition: 1 };
  };
  it("renders labelled native controls, read-only cancellation, and a responsive composition", () => {
    const course = dogleg(), settings = defaultHoleIllustrationPreviewSettings(course)!;
    const html = renderToStaticMarkup(createElement(I18nContext.Provider, { value: { locale: "en", setLocale: () => {}, t: (key, params) => translate("en", key, params) } }, createElement(HoleIllustrationPreviewPanel, { course, evidence: { status: "ready", layoutId: settings.layoutId, holeId: settings.holeId, teeSet: settings.teeSet, pinRotation: settings.pinRotation }, onClose: () => {} })));
    expect(html).toContain('aria-label="Route source"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('data-testid="hole-illustration-cancel"');
    expect(html).toContain('Read-only preview');
    expect(html).toContain('grid-template-columns:repeat(auto-fit,minmax(130px,1fr))');
    expect(html).toContain("Download single SVG");
    expect(html).toContain("Download single PNG");
    expect(html).toContain("Share single PNG");
    expect(html).toContain("Download course atlas SVG");
    expect(html).toContain("Download course atlas PNG");
    expect(html).toContain("Include simple course routing map in atlas");
    expect(html).toContain('data-testid="hole-illustration-export-status"');
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

  it.each([
    ["saved", "Saved hole-one.png at 3840 × 2560."],
    ["shared", "Shared hole-one.png at 3840 × 2560."],
    ["copied", "Copied hole-one.png to the clipboard at 3840 × 2560."],
    ["downloaded", "Downloaded hole-one.png at 3840 × 2560."],
  ] as const)("reports a truthful %s delivery result", async (status, expected) => {
    const statuses: string[] = [];
    await runHoleIllustrationExport({
      t,
      prepare: exportArtifact,
      deliver: async () => ({ status, fileName: "hole-one.png" }),
      setBusy: () => undefined,
      setStatus: (value) => statuses.push(value),
    });
    expect(statuses.at(-1)).toBe(expected);
    if (status === "copied") expect(statuses.at(-1)).not.toContain("Saved");
  });

  it("disables every export action while delivery is pending", async () => {
    let busy = false;
    let resolveDelivery!: (result: HoleIllustrationDeliveryResult) => void;
    const pending = runHoleIllustrationExport({
      t,
      prepare: exportArtifact,
      deliver: () => new Promise((resolve) => { resolveDelivery = resolve; }),
      setBusy: (value) => { busy = value; },
      setStatus: () => undefined,
    });
    expect(busy).toBe(true);
    const html = provider(createElement(HoleIllustrationExportControls, { busy, atlasAvailable: true, includeMap: true, status: "Preparing illustration export…", onIncludeMapChange: vi.fn(), onExport: vi.fn() }));
    expect(html.match(/<button disabled=""/g)).toHaveLength(5);
    expect(html).toContain('<input type="checkbox" disabled="" checked=""/>' );
    resolveDelivery({ status: "saved", fileName: "hole-one.png" });
    await pending;
    expect(busy).toBe(false);
  });

  it("disables and explains only invalid atlas actions when idle", () => {
    const html = provider(createElement(HoleIllustrationExportControls, { busy: false, atlasAvailable: false, includeMap: false, status: "", onIncludeMapChange: vi.fn(), onExport: vi.fn() }));
    expect(html.match(/<button disabled=""/g)).toHaveLength(2);
    expect(html.match(/aria-describedby="hole-illustration-atlas-unavailable"/g)).toHaveLength(2);
    expect(html).toContain("A course atlas requires exactly 9 or 18 unique, existing holes");
  });

  it("surfaces thrown preparation and delivery errors and always clears busy", async () => {
    for (const [prepare, deliver, message] of [
      [() => { throw new Error("preparation exploded"); }, async () => ({ status: "saved", fileName: "unused" } as const), "preparation exploded"],
      [exportArtifact, async () => { throw new Error("delivery exploded"); }, "delivery exploded"],
    ] as const) {
      const busy: boolean[] = [], statuses: string[] = [];
      await runHoleIllustrationExport({ t, prepare, deliver, setBusy: (value) => busy.push(value), setStatus: (value) => statuses.push(value) });
      expect(statuses.at(-1)).toBe(`Export failed: ${message}`);
      expect(busy).toEqual([true, false]);
    }
  });

  it("keeps copied status distinct when formatted directly for the panel", () => {
    expect(holeIllustrationDeliveryMessage(t, { status: "copied", fileName: "hole.png" }, exportArtifact())).toBe("Copied hole.png to the clipboard at 3840 × 2560.");
  });
});
