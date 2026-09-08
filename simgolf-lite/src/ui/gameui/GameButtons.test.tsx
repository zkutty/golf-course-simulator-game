import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameButton, IconButton } from "./GameButtons";

describe("ZK-1107 shared button state contract", () => {
  it.each(["primary", "secondary", "success", "danger"] as const)("retains %s meaning and native disabled semantics", (variant) => {
    const enabled = renderToStaticMarkup(<GameButton variant={variant}>Action</GameButton>);
    expect(enabled).toContain(`data-variant="${variant}"`);
    expect(enabled).toContain("var(--ui-");
    expect(enabled).not.toContain("disabled=");
    const disabled = renderToStaticMarkup(<GameButton variant={variant} disabled aria-label="Unavailable action">Action</GameButton>);
    expect(disabled).toContain('disabled=""');
    expect(disabled).toContain('aria-label="Unavailable action"');
  });

  it("retains accessible icon labels and selected brand colors", () => {
    const markup = renderToStaticMarkup(<IconButton icon={<span aria-hidden>+</span>} label="Design" variant="primary" />);
    expect(markup).toContain("Design");
    expect(markup).toContain("var(--ui-action-selected-text)");
    expect(markup).toContain("color:inherit");
  });
});
