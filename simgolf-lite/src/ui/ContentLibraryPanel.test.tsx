import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { I18nContext } from "../i18n/context";
import { translate } from "../i18n/core";
import type { MessageKey } from "../i18n/catalog";
import { ContentLibraryPanel } from "./ContentLibraryPanel";
import { holeTemplateLibrarySummary } from "./contentLibraryProvenance";
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
    }, createElement(ContentLibraryPanel, { course: DEFAULT_COURSE, world: DEFAULT_WORLD, onTestPlay: () => {}, onClose: () => {} })));
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
