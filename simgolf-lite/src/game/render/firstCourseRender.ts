import type { Application } from "pixi.js";

export interface FirstCourseRender {
  /** Only call after the current scene host synchronously finishes its work. */
  prepare(snapshot: object | null): void;
  dispose(): void;
}

/** One app owner, one completed normal populated root; never schedules a render. */
export function observeFirstCourseRender(
  application: Application,
  readCurrent: () => object | null,
  onPresented: () => void,
): FirstCourseRender {
  let app: Application | null = application;
  let renderer: Application["renderer"] | null = application.renderer;
  let stage: Application["stage"] | null = application.stage;
  let pre: Application["renderer"]["runners"]["prerender"] | null = application.renderer.runners.prerender;
  let post: Application["renderer"]["runners"]["postrender"] | null = application.renderer.runners.postrender;
  let postCleanupQueued = false;
  let target: unknown = application.renderer.view.renderTarget;
  let current: (() => object | null) | null = readCurrent;
  let complete: (() => void) | null = onPresented;
  let prepared: object | null = null;
  let depth = 0;
  let pending: object | null = null;
  function detachPost(): void {
    if (post && Array.isArray(post.items)) post.remove(listener);
    post = null;
  }
  function stop(afterRoot: boolean): void {
    if (pre && Array.isArray(pre.items)) pre.remove(listener);
    pre = null;
    if (afterRoot && !postCleanupQueued) {
      postCleanupQueued = true;
      // SystemRunner walks a live array: do not splice its current dispatch.
      queueMicrotask(detachPost);
    } else if (!postCleanupQueued) detachPost();
    app = null; renderer = null; stage = null; target = null; current = null; complete = null; prepared = null;
    depth = 0; pending = null;
  }
  const listener = {
    prerender(options: { container: unknown; target?: unknown }): void {
      if (!app) return;
      const root = app.renderer === renderer && app.stage === stage && options.container === stage && options.target === target;
      pending = root && depth === 0 && prepared === current?.() ? prepared : null;
      // A missing postrender must not retain one token per failed render.
      depth = Number.isSafeInteger(depth + 1) ? depth + 1 : Number.NaN;
    },
    postrender(): void {
      if (!app || !Number.isSafeInteger(depth) || depth <= 0) return;
      depth -= 1;
      if (depth) return;
      const snapshot = pending;
      pending = null;
      const size = stage?.renderGroup?.instructionSet.instructionSize ?? 0;
      if (app.renderer !== renderer || app.stage !== stage || stage?.destroyed || renderer?.view.renderTarget !== target
        || !snapshot || snapshot !== prepared || snapshot !== current?.()
        || !Number.isSafeInteger(size) || size <= 0) return;
      const notify = complete;
      stop(true); // Clear scene/callback refs now; detach postrender after its live dispatch.
      notify?.();
    },
  };
  renderer.runners.prerender.add(listener);
  renderer.runners.postrender.add(listener);
  return {
    prepare(snapshot) { if (app) prepared = snapshot; },
    dispose() { stop(false); },
  };
}
