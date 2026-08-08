import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nContext } from "../i18n/context";
import { translate } from "../i18n/core";
import { DeferredHudErrorBoundary, DeferredHudLoading } from "./DeferredHudSurface";

const i18n = {
  locale: "en" as const,
  setLocale: () => undefined,
  t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params),
};

function renderWithI18n(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nContext.Provider value={i18n}>{node}</I18nContext.Provider>);
}

describe("DeferredHudSurface", () => {
  it("uses a contained, layout-stable loading fallback", () => {
    const html = renderWithI18n(<DeferredHudLoading />);
    expect(html).toContain('data-testid="hud-loading"');
    expect(html).toContain('width:100%');
    expect(html).toContain('height:100%');
    expect(html).not.toContain("min-height:100vh");
  });

  it("isolates a rejected HUD chunk and offers reload without save-reset UI", () => {
    const boundary = new DeferredHudErrorBoundary({ children: <span>HUD</span> });
    boundary.state = DeferredHudErrorBoundary.getDerivedStateFromError(new Error("stale HUD chunk"));
    const html = renderWithI18n(boundary.render());
    expect(html).toContain('data-testid="hud-load-error"');
    expect(html).toContain("Course controls are temporarily unavailable");
    expect(html).toContain("Reload course controls");
    expect(html).not.toContain("Reset save");
  });
});
