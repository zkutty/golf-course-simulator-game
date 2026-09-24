import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceNav } from "./WorkspaceNav";

vi.mock("../i18n/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => ({ "workspace.more": "More", "workspace.moreNavigation": "More navigation" })[key] ?? key }),
}));

describe("WorkspaceNav compact affordance", () => {
  it("keeps the scroll strip and an explicit keyboard-accessible more control in the navigation", () => {
    const html = renderToStaticMarkup(<WorkspaceNav
      workspace="operate"
      onWorkspace={vi.fn()}
      onInspect={vi.fn()}
      onAction={vi.fn()}
      active={{}}
    />);

    expect(html).toContain('class="cc-workspace-nav-strip"');
    expect(html).toContain('class="cc-workspace-scroll-cue"');
    expect(html).toContain('aria-label="More navigation"');
    expect(html).toContain('type="button"');
  });
});
