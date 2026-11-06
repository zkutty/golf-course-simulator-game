import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingCard } from "./LoadingCard";

describe("LoadingCard", () => {
  it("keeps the normal full-screen branded main and indeterminate indicator", () => {
    const html = renderToStaticMarkup(<LoadingCard label="Restoring your course…" />);
    expect(html).toContain('<main class="cc-loading-screen"');
    expect(html).toContain('aria-busy="true"'); expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="cc-loading-dot" aria-hidden="true"');
    expect(html).toContain("Restoring your course…");
    expect(html).not.toContain("course-renderer-loading");
  });

  it("embeds an accessible renderer status without another main landmark", () => {
    const html = renderToStaticMarkup(<LoadingCard embedded label="Preparing your course…" />);
    expect(html).toContain('data-testid="course-renderer-loading"');
    expect(html).toContain('role="status"'); expect(html).toContain('aria-busy="true"');
    expect(html).toContain('cc-loading-screen--embedded'); expect(html).toContain("Preparing your course…");
    expect(html).not.toContain("<main");
    expect(html).not.toContain('role="progressbar"');
  });
});
