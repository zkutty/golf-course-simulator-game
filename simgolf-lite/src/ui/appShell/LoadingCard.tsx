import type { CSSProperties } from "react";
import { LogoCourseCraft } from "../../assets/icons";
import { StartMenuBackground } from "../StartMenuBackground";
import {
  biomeContextAttributes,
  biomeUiStyle,
  type BiomeUiTheme,
} from "../biomeUiTheme";

export function LoadingCard({ label, context, embedded = false }: { label: string; context?: BiomeUiTheme; embedded?: boolean }) {
  const Tag = embedded ? "div" : "main";
  return (
    <Tag
      className={`cc-loading-screen${embedded ? " cc-loading-screen--embedded" : ""}`}
      data-testid={embedded ? "course-renderer-loading" : undefined}
      role={embedded ? "status" : undefined}
      aria-busy="true"
      aria-live="polite"
      {...(context ? biomeContextAttributes(context, "loading") : {})}
      style={context ? biomeUiStyle(context) as CSSProperties : undefined}
    >
      {!embedded && <StartMenuBackground />}
      <section data-biome-context-card className="cc-loading-card">
        <LogoCourseCraft />
        <div className="cc-loading-dot" aria-hidden="true" />
        <div className="cc-loading-label">{label}</div>
      </section>
    </Tag>
  );
}
