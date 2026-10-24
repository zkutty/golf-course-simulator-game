import { Graphics, type Container } from "pixi.js";

/**
 * Dispose owned display objects using each Pixi class's default ownership rules.
 * Passing { children: true } through Container.destroy skips Graphics' owned
 * context cleanup in Pixi 8.14.3. Detach descendants first so destroy() can
 * release owned contexts while borrowed contexts and textures stay alive.
 */
export function destroySceneSubtree(node: Container | null | undefined): void {
  if (!node || node.destroyed) return;
  for (const child of [...(node.children ?? [])]) {
    node.removeChild(child);
    destroySceneSubtree(child);
  }
  if (node instanceof Graphics) {
    const context = node.context;
    // Graphics.destroy() preserves borrowed contexts but leaves its update
    // subscription attached. Match this receiver only; peers keep theirs.
    for (const listener of context.listeners("update")) {
      context.off("update", listener, node);
    }
  }
  node.destroy();
}
