import { Component, type ErrorInfo, type ReactNode } from "react";
import { resetSave } from "../utils/save";

interface AppErrorBoundaryProps {
  children: ReactNode;
  resetSaveFn?: () => void;
  reloadFn?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function reloadPage(): void {
  window.location.reload();
}

export function resetSaveAndReload(
  reset: () => void = resetSave,
  reload: () => void = reloadPage
): void {
  reset();
  reload();
}

/** Last-resort recovery UI for render/lifecycle failures anywhere in the app. */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("CourseCraft crashed inside the React tree", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private reload = (): void => {
    (this.props.reloadFn ?? reloadPage)();
  };

  private resetAndReload = (): void => {
    resetSaveAndReload(this.props.resetSaveFn ?? resetSave, this.props.reloadFn ?? reloadPage);
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: "100%",
          display: "grid",
          placeItems: "center",
          padding: 24,
          boxSizing: "border-box",
          background: "linear-gradient(145deg, #dce8cf, #ebe3d5)",
          color: "#243126",
        }}
      >
        <section
          style={{
            width: "min(560px, 100%)",
            padding: 28,
            borderRadius: 18,
            background: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(36,49,38,0.2)",
            boxShadow: "0 22px 55px rgba(0,0,0,0.16)",
          }}
        >
          <h1 style={{ margin: "0 0 10px", fontSize: 28 }}>CourseCraft hit an unexpected problem</h1>
          <p style={{ margin: "0 0 18px", lineHeight: 1.5 }}>
            Your course is still stored locally. Try reloading first. If the same crash returns,
            reset the legacy save and start clean.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button type="button" onClick={this.reload} style={buttonStyle}>
              Reload
            </button>
            <button
              type="button"
              onClick={this.resetAndReload}
              style={{ ...buttonStyle, background: "#8b2f2f" }}
            >
              Reset save &amp; reload
            </button>
          </div>
          <details style={{ marginTop: 18, color: "#566057", fontSize: 12 }}>
            <summary>Technical details</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {this.state.error.message || this.state.error.name}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}

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
