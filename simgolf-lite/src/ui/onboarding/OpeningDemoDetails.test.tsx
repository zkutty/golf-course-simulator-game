import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compareOpening, freezeOpeningContext, newOpeningDemo } from "../../game/onboarding/openingDemo";
import { createInvitedPreviewEvidence } from "../../game/onboarding/invitedPreview";
import { createTutorialProgress } from "../../game/onboarding/tutorial";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../game/models/defaults";
import { I18nContext } from "../../i18n/context";
import { translate } from "../../i18n/core";
import { OpeningDemoDetails } from "./OpeningDemoDetails";

function comparisonMarkup(legacy: boolean) {
  const course = structuredClone(DEFAULT_COURSE);
  for (let x = 12; x <= 30; x++) course.tiles[12 * course.width + x] = "fairway";
  course.tiles[12 * course.width + 12] = "tee";
  for (let y = 11; y <= 13; y++) for (let x = 29; x <= 31; x++) course.tiles[y * course.width + x] = "green";
  course.holes[0] = { ...course.holes[0], tee: { x: 12, y: 12 }, green: { x: 30, y: 12 }, parMode: "MANUAL", parManual: 3 };
  const baseline = createInvitedPreviewEvidence(course, DEFAULT_WORLD)!;
  const candidate = { ...baseline, id: `${baseline.id}:candidate`, holeFingerprint: "1234abcd", group: baseline.group.map((golfer, index) => index ? golfer : { ...golfer, strokes: golfer.strokes - 1 }) };
  const comparison = compareOpening(baseline, candidate, freezeOpeningContext(baseline), 125);
  if (legacy) delete comparison.measures[0].riskAfter;
  const progress = {
    ...createTutorialProgress(course, DEFAULT_WORLD),
    stage: "compare-preview" as const,
    receipts: { preview: { status: "observed" as const, evidence: baseline, rewardReceipt: null }, milestones: [] },
    opening: { ...newOpeningDemo(), candidate, comparison },
  };
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: { locale: "en", setLocale: () => {}, t: (key, params) => translate("en", key, params) } }, createElement(OpeningDemoDetails, {
    progress, width: course.width, playback: null, playing: false, playbackSpeed: 1, following: false, reducedMotion: false,
    onCursor: () => {}, onRetry: () => {}, onFocus: () => {}, onTogglePlaying: () => {}, onSpeed: () => {}, onToggleFollow: () => {},
  })));
}

describe("OpeningDemoDetails retained comparison truth", () => {
  it("labels complete current measures as equal weight and explains retained risk", () => {
    const html = comparisonMarkup(false);
    expect(html).toContain("Equal weight: 1 improved, 0 worsened.");
    expect(html).toContain('data-testid="opening-comparison-risk"');
    expect(html).toContain('data-testid="opening-comparison-risk-note"');
  });

  it("preserves a legacy verdict but withholds incomplete risk claims", () => {
    const html = comparisonMarkup(true);
    expect(html).toContain('data-testid="opening-comparison-state" data-state="positive"');
    expect(html).toContain("Older save: risk summary unavailable; counts use recorded fields only: 1 improved, 0 worsened.");
    expect(html).not.toContain('data-testid="opening-comparison-risk"');
    expect(html).not.toContain('data-testid="opening-comparison-risk-note"');
  });
});
