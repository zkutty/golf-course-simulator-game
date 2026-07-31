import { LogoCourseCraft } from "../../assets/icons";
import { StartMenuBackground } from "../StartMenuBackground";
import {
  biomeContextAttributes,
  biomeUiStyle,
  type BiomeUiTheme,
} from "../biomeUiTheme";
import type { CSSProperties } from "react";

export function LoadingCard({ label, context }: { label: string; context?: BiomeUiTheme }) {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      {...(context ? biomeContextAttributes(context, "loading") : {})}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        ...(context ? biomeUiStyle(context) : {}),
      } as CSSProperties}
    >
      <StartMenuBackground />
      <section data-biome-context-card style={{ position: "relative", zIndex: 2, width: "min(420px, calc(100% - 32px))", padding: 28, textAlign: "center", borderRadius: 20, background: "rgba(255,250,240,.96)", border: "2px solid #c4b5a0", boxShadow: "0 24px 64px rgba(20,35,24,.35)" }}>
        <LogoCourseCraft style={{ width: 190, maxWidth: "80%" }} />
        <div className="cc-loading-dot" style={{ width: 34, height: 34, margin: "22px auto 14px", border: "4px solid #c8d5c4", borderTopColor: "#3d6b3d", borderRadius: "50%" }} />
        <div style={{ fontFamily: "var(--font-heading)", color: "#344338", fontWeight: 900, fontSize: 18 }}>{label}</div>
      </section>
    </main>
  );
}
