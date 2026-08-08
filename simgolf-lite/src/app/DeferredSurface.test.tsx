import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nContext } from "../i18n/context";
import { translate } from "../i18n/core";
import { DeferredSurfaceErrorBoundary, DeferredSurfaceLoading } from "./DeferredSurface";

const i18n = {
  locale: "en" as const,
  setLocale: () => undefined,
  t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params),
};

function renderWithI18n(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nContext.Provider value={i18n}>{node}</I18nContext.Provider>);
}

describe("DeferredSurface", () => {
  it("announces the requested lazy surface while its chunk loads", () => {
    const html = renderWithI18n(<DeferredSurfaceLoading label="new game setup" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading new game setup…");
  });

  it("isolates a rejected chunk and offers the deterministic reload recovery", () => {
    const boundary = new DeferredSurfaceErrorBoundary({ label: "new game setup", children: <span>setup</span> });
    boundary.state = DeferredSurfaceErrorBoundary.getDerivedStateFromError(new Error("chunk unavailable"));
    const html = renderWithI18n(boundary.render());
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn’t open new game setup");
    expect(html).toContain("Reload CourseCraft");
  });
});
