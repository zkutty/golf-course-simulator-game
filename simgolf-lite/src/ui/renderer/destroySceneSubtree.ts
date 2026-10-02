import { Container, Graphics } from "pixi.js";

/** Release scene-owned display trees without destroying borrowed contexts/textures. */
export function destroySceneSubtree(display: Container): void {
  if (display.destroyed) return;
  const children = display.removeChildren();
  if (display instanceof Graphics) {
    // Pixi's default destroy releases only _ownedContext. Shared contexts stay
    // alive, so detach this instance's update subscription before destroying it.
    for (const callback of new Set(display.context.listeners("update"))) {
      display.context.off("update", callback, display);
    }
  }
  // Passing { children: true } suppresses Graphics' owned-context cleanup.
  // Dispose descendants before their parent render group releases its resources.
  for (const child of children) destroySceneSubtree(child);
  display.destroy();
}
