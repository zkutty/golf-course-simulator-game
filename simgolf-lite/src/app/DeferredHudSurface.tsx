import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";

type DeferredHudSurfaceProps = { children: ReactNode };
type DeferredHudSurfaceState = { error: Error | null };

/** Keeps a rejected/stale HUD chunk local to the permanent sidebar. */
export class DeferredHudErrorBoundary extends Component<DeferredHudSurfaceProps, DeferredHudSurfaceState> {
  state: DeferredHudSurfaceState = { error: null };

  static getDerivedStateFromError(error: Error): DeferredHudSurfaceState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("CourseCraft could not load the course HUD", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.error ? <DeferredHudError /> : this.props.children;
  }
}

export function DeferredHudError() {
  const { t } = useI18n();
  return (
    <div data-testid="hud-load-error" role="alert" aria-live="assertive" aria-atomic="true" style={shellStyle}>
      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t("hud.deferred.error.title")}</h2>
        <p style={{ margin: "8px 0 14px", lineHeight: 1.45 }}>{t("hud.deferred.error.body")}</p>
        <button type="button" onClick={() => window.location.reload()} style={buttonStyle}>
          {t("hud.deferred.reload")}
        </button>
      </section>
    </div>
  );
}

export function DeferredHudLoading() {
  const { t } = useI18n();
  return (
    <div data-testid="hud-loading" role="status" aria-live="polite" aria-atomic="true" style={shellStyle}>
      <section style={cardStyle}>{t("hud.deferred.loading")}</section>
    </div>
  );
}

export function DeferredHudSurface({ children }: DeferredHudSurfaceProps) {
  return (
    <DeferredHudErrorBoundary>
      <Suspense fallback={<DeferredHudLoading />}>{children}</Suspense>
    </DeferredHudErrorBoundary>
  );
}

const shellStyle = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  padding: 18,
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.58)",
  color: "#243126",
} as const;

const cardStyle = {
  width: "100%",
  padding: 18,
  boxSizing: "border-box",
  borderRadius: 14,
  background: "rgba(255,255,255,0.94)",
  border: "1px solid rgba(36,49,38,0.2)",
  boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
} as const;

const buttonStyle = {
  appearance: "none",
  border: 0,
  borderRadius: 9,
  padding: "9px 12px",
  background: "#3d6442",
  color: "white",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} as const;
