import { Container, Graphics, Text } from "pixi.js";
import { takeOwnedSceneMeshGeometry } from "./ownedSceneMeshGeometry";

/** Release scene-owned display trees without destroying borrowed contexts/textures. */
export function destroySceneSubtree(display: Container): void {
  if (display.destroyed) return;
  const geometry = takeOwnedSceneMeshGeometry(display);
  const children = display.removeChildren();
  if (display instanceof Graphics) {
    // Pixi's default destroy releases only _ownedContext. Shared contexts stay
    // alive, so detach this instance's update subscription before destroying it.
    for (const callback of new Set(display.context.listeners("update"))) {
      display.context.off("update", callback, display);
    }
  }
  if (display instanceof Text) {
    // Measurement caches can retain the style after its Text is destroyed.
    // Detach only this display; shared styles and sibling listeners survive.
    const style = display.style;
    for (const callback of new Set(style.listeners("update"))) {
      style.off("update", callback, display);
    }
  }
  // Passing { children: true } suppresses Graphics' owned-context cleanup.
  // Dispose descendants before their parent render group releases its resources.
  for (const child of children) destroySceneSubtree(child);
  display.destroy();
  geometry?.destroy(true);
}
