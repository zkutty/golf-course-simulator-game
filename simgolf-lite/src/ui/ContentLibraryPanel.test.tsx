import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { I18nContext } from "../i18n/context";
import { translate } from "../i18n/core";
import type { MessageKey } from "../i18n/catalog";
import { ContentLibraryPanelContent } from "./ContentLibraryPanelContent";
import { holeTemplateLibrarySummary } from "./contentLibraryProvenance";
import { captureHoleTemplateWithWarnings } from "../game/contentPackages/holeTemplatePackage";
import { saveAuthoredHoleTemplatePackage } from "../game/contentPackages/library";
import type { HoleTemplateV1 } from "../game/holeTemplates/types";

describe("ZK-652 library provenance copy", () => {
  it("retains bounded provenance and fidelity without any blueprint geometry or confidence arrays", () => {
    const template: HoleTemplateV1 = {
      format: "coursecraft-hole-template", version: 1, id: "template-01", title: "Hole", description: "", width: 2, height: 1, yardsPerTile: 5,
      cells: [{ x: 0, y: 0, terrain: "tee", elevationOffset: 0 }, { x: 1, y: 0, terrain: "green", elevationOffset: 0 }],
      hole: { tee: { x: 0, y: 0 }, green: { x: 1, y: 0 }, parMode: "AUTO" }, obstacles: [], decorations: [], confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] },
      provenance: { sourceKind: "manual", sourceLabel: "Player hole", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false }, fidelity: { tier: "sketch" },
    };
    const summary = holeTemplateLibrarySummary(template);
    expect(Object.keys(summary).sort()).toEqual(["fidelity", "provenance"]);
    expect(summary.provenance).toEqual(template.provenance);
    expect(summary.provenance).not.toBe(template.provenance);
    expect(summary.fidelity).toEqual(template.fidelity);
    expect(summary.fidelity).not.toBe(template.fidelity);
    for (const key of ["cells", "hole", "obstacles", "decorations", "confidence", "width", "height"]) expect(summary).not.toHaveProperty(key);
  });
  it("renders localized policy guidance and an unchecked attestation with capture disabled", () => {
    const html = renderToStaticMarkup(createElement(I18nContext.Provider, {
      value: { locale: "en", setLocale: () => {}, t: (key, params) => translate("en", key, params) },
    }, createElement(ContentLibraryPanelContent, { course: DEFAULT_COURSE, world: DEFAULT_WORLD, onTestPlay: () => {}, onClose: () => {} })));
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button disabled="" type="button">Save hole template<\/button>/);
    for (const key of ["content.holeRightsAttestation", "content.holePrivacyGuidance", "content.holeFidelityGuidance", "content.holeSourceGuidance"] as const) expect(html).toContain(translate("en", key).replaceAll("'", "&#x27;"));
    expect(html).not.toContain("content.hole");
  });

  it("routes every provenance label through the typed localization catalog", () => {
    const keys: MessageKey[] = ["content.chooseCompletedHole", "content.holeRightsRequired", "content.holeRightsAttestation", "content.playerBuiltSource", "content.playerBuiltCaptureNote", "content.holePrivateCopyExport", "content.holePrivateCopyExported", "content.holePrivacyGuidance", "content.holeFidelityGuidance", "content.holeSourceGuidance", "content.holeProvenanceSummary", "content.holeFidelitySketch", "content.holeFidelityCalibrated"];
    for (const key of keys) {
      expect(translate("en", key, { source: "Photo", importedAt: "2026-08-05", fidelity: "Sketch" })).not.toContain(key);
      expect(translate("pseudo", key, { source: "Photo", importedAt: "2026-08-05", fidelity: "Sketch" })).toContain("⟦");
    }
  });
});


const captureUI = vi.hoisted(() => ({ active: false, index: 0, values: [] as unknown[], locale: "en" as "en" | "pseudo" }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (!captureUI.active) return actual.useState(initial);
      const index = captureUI.index++;
      captureUI.values[index] = index === 8 ? true : typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [captureUI.values[index], (next: unknown) => { captureUI.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(captureUI.values[index]) : next; }];
    },
    useRef: (initial: unknown) => captureUI.active ? { current: initial } : actual.useRef(initial),
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => { if (!captureUI.active) actual.useEffect(effect, deps); },
    useCallback: (callback: (...args: never[]) => unknown, deps: readonly unknown[]) => captureUI.active ? callback : actual.useCallback(callback, deps),
  };
});
vi.mock("../i18n/useI18n", async importOriginal => {
  const actual = await importOriginal<typeof import("../i18n/useI18n")>();
  return { ...actual, useI18n: () => captureUI.active ? { t: (key: MessageKey, params?: Record<string, string | number>) => translate(captureUI.locale, key, params) } : actual.useI18n() };
});
vi.mock("../game/contentPackages/holeTemplatePackage", async importOriginal => {
  const actual = await importOriginal<typeof import("../game/contentPackages/holeTemplatePackage")>();
  return { ...actual, captureHoleTemplateWithWarnings: vi.fn(actual.captureHoleTemplateWithWarnings) };
});
vi.mock("../game/contentPackages/library", async importOriginal => {
  const actual = await importOriginal<typeof import("../game/contentPackages/library")>();
  return { ...actual, listContentLibrary: vi.fn(async () => []), readAuthoredHoleTemplatePackage: vi.fn(async () => null), saveAuthoredHoleTemplatePackage: vi.fn(async (value: unknown) => ({ entry: {}, validation: { status: "compatible", value, warnings: [] } })) };
});


function captureCourse(partialPath: boolean) {
  const course = structuredClone(DEFAULT_COURSE); course.width = 16; course.height = 16;
  course.tiles = Array(256).fill("rough"); course.elevations = Array(256).fill(0); course.obstacles = []; course.decorations = []; course.buildings = [];
  course.holes = [{ id: "ui-hole", tee: { x: 2, y: 2 }, green: { x: 9, y: 9 }, parMode: "AUTO" }]; course.tiles[34] = "tee"; course.tiles[153] = "green";
  course.tiles[4 * 16 + 4] = "path"; course.tiles[5 * 16 + 7] = "path";
  course.surfaceIntent = { version: 1, nextId: 3, features: [
    { id: "surface-path", terrain: "path", order: 1, coverage: [4 * 16 + 4, 5 * 16 + 7, ...(partialPath ? [5 * 16 + 12] : [])], geometry: { kind: "corridor", knots: [{ x: 4.5, y: 4.5 }, { x: partialPath ? 12.5 : 7.5, y: 5.5 }], width: 1.5 } },
    { id: "surface-fairway", terrain: "fairway", order: 2, coverage: [3 * 16 + 3, 15 * 16 + 15], geometry: { kind: "region", ring: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }] } },
  ] };
  return course;
}
function captureButton(node: unknown): (() => void) | undefined {
  if (!node || typeof node !== "object") return undefined;
  const element = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
  if (element.type === "button" && element.props?.children === translate(captureUI.locale, "content.saveHoleTemplate")) return element.props.onClick;
  for (const child of [element.props?.children].flat(Infinity)) { const found = captureButton(child); if (found) return found; }
  return undefined;
}

describe("TEMPLATE-C actual Library capture workflow", () => {
  afterEach(() => { captureUI.active = false; captureUI.index = 0; captureUI.values = []; captureUI.locale = "en"; vi.clearAllMocks(); });
  it.each(["en", "pseudo"] as const)("calls capture once and visibly reports a partial non-path warning in %s", async locale => {
    captureUI.active = true; captureUI.index = 0; captureUI.locale = locale;
    const course = captureCourse(false), before = structuredClone(course);
    const tree = ContentLibraryPanelContent({ course, world: DEFAULT_WORLD, onClose: () => {}, onTestPlay: () => {} });
    const click = captureButton(tree); expect(click).toBeTypeOf("function"); click!();
    await vi.waitFor(() => expect(captureUI.values[5]).toContain(translate(locale, "content.holePartialCurvesWarning")));
    expect(captureUI.values[4]).toBe(false);
    expect(captureHoleTemplateWithWarnings).toHaveBeenCalledOnce(); expect(saveAuthoredHoleTemplatePackage).toHaveBeenCalledOnce();
    const saved = vi.mocked(saveAuthoredHoleTemplatePackage).mock.calls[0][0];
    expect(saved.payload.template.surfaceIntent?.features.map(feature => feature.terrain)).toEqual(["path"]);
    expect(saved).not.toHaveProperty("warnings"); expect(saved.payload.template).not.toHaveProperty("warnings");
    expect(course).toEqual(before);
  });
  it("catches partial-path rejection, clears busy, and never writes a library entry", async () => {
    captureUI.active = true; captureUI.index = 0;
    const course = captureCourse(true), before = structuredClone(course);
    const click = captureButton(ContentLibraryPanelContent({ course, world: DEFAULT_WORLD, onClose: () => {}, onTestPlay: () => {} }));
    expect(click).toBeTypeOf("function"); click!();
    await vi.waitFor(() => expect(captureUI.values[5]).toBe(translate("en", "content.holePartialPath")));
    expect(captureUI.values[4]).toBe(false); expect(captureHoleTemplateWithWarnings).toHaveBeenCalledOnce();
    expect(saveAuthoredHoleTemplatePackage).not.toHaveBeenCalled(); expect(course).toEqual(before);
  });
});
