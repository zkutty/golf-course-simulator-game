import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary, resetSaveAndReload } from "./AppErrorBoundary";

describe("AppErrorBoundary", () => {
  it("renders a useful recovery screen after a child error", () => {
    const boundary = new AppErrorBoundary({ children: <div>game</div> });
    boundary.state = AppErrorBoundary.getDerivedStateFromError(new Error("renderer exploded"));
    const html = renderToStaticMarkup(boundary.render());

    expect(html).toContain('role="alert"');
    expect(html).toContain("CourseCraft hit an unexpected problem");
    expect(html).toContain("Reset save &amp; reload");
    expect(html).toContain("renderer exploded");
  });

  it("resets the save before reloading", () => {
    const reset = vi.fn();
    const reload = vi.fn();
    resetSaveAndReload(reset, reload);
    expect(reset).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it("logs errors with the React component stack", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    const boundary = new AppErrorBoundary({ children: null, onError });
    const error = new Error("boom");
    const info = { componentStack: "\n at BrokenWidget" };

    boundary.componentDidCatch(error, info);

    expect(errorSpy).toHaveBeenCalledWith(
      "CourseCraft crashed inside the React tree",
      error,
      info.componentStack
    );
    expect(onError).toHaveBeenCalledWith(error, info);
    errorSpy.mockRestore();
  });
});
