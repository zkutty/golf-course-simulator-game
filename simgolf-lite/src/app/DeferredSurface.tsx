import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";

type DeferredSurfaceProps = {
  /** A concise noun phrase used in the deterministic accessible fallback. */
  label: string;
  children: ReactNode;
};

type DeferredSurfaceErrorBoundaryState = {
  error: Error | null;
};

/**
 * Isolates optional app-shell screens from the simulation shell. A failed
 * deferred import should never replace a running course with the global crash
 * screen, and the fallback remains useful when a browser is offline.
 */
class DeferredSurfaceErrorBoundary extends Component<DeferredSurfaceProps, DeferredSurfaceErrorBoundaryState> {
  state: DeferredSurfaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DeferredSurfaceErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`CourseCraft could not open deferred surface: ${this.props.label}`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return <DeferredSurfaceError label={this.props.label} />;
  }
}

function DeferredSurfaceError({ label }: Pick<DeferredSurfaceProps, "label">) {
  const { t } = useI18n();
  return (
    <main role="alert" aria-live="assertive" aria-atomic="true" style={shellStyle}>
      <section style={cardStyle}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{t("deferredSurface.error.title", { surface: label })}</h1>
        <p style={{ margin: "10px 0 16px", lineHeight: 1.45 }}>{t("deferredSurface.error.body")}</p>
        <button type="button" onClick={() => window.location.reload()} style={buttonStyle}>
          {t("deferredSurface.reload")}
        </button>
      </section>
    </main>
  );
}

function DeferredSurfaceLoading({ label }: Pick<DeferredSurfaceProps, "label">) {
  const { t } = useI18n();
  return (
    <main role="status" aria-live="polite" aria-atomic="true" aria-label={t("deferredSurface.loading", { surface: label })} style={shellStyle}>
      <section style={cardStyle}>{t("deferredSurface.loading", { surface: label })}</section>
    </main>
  );
}

/** A stable Suspense + error boundary for optional non-game application UI. */
export function DeferredSurface({ label, children }: DeferredSurfaceProps) {
  return (
    <DeferredSurfaceErrorBoundary label={label}>
      <Suspense fallback={<DeferredSurfaceLoading label={label} />}>
        {children}
      </Suspense>
    </DeferredSurfaceErrorBoundary>
  );
}

const shellStyle = {
  minHeight: "100%",
  display: "grid",
  placeItems: "center",
  padding: 24,
  boxSizing: "border-box",
  background: "linear-gradient(145deg, #dce8cf, #ebe3d5)",
  color: "#243126",
} as const;

const cardStyle = {
  width: "min(460px, 100%)",
  padding: 24,
  borderRadius: 18,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(36,49,38,0.2)",
  boxShadow: "0 22px 55px rgba(0,0,0,0.16)",
} as const;

const buttonStyle = {
  appearance: "none",
  border: 0,
  borderRadius: 9,
  padding: "10px 14px",
  background: "#3d6442",
  color: "white",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} as const;
