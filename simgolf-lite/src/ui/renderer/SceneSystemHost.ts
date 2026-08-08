import type {
  RenderSceneId,
  RenderSnapshot,
} from "./RenderSnapshot";

export interface RenderSceneSystem {
  readonly id: RenderSceneId;
  render(snapshot: RenderSnapshot): void;
  dispose?(): void;
}

/**
 * Owns scene-system invalidation independently of React effects. A failed
 * render does not consume its revision, allowing the same snapshot to retry.
 */
export class SceneSystemHost {
  private readonly renderedRevisions = new Map<RenderSceneId, number>();
  private readonly systems: readonly RenderSceneSystem[];

  constructor(systems: readonly RenderSceneSystem[]) {
    this.systems = systems;
    const ids = new Set<RenderSceneId>();
    for (const system of systems) {
      if (ids.has(system.id)) {
        throw new Error(`Duplicate render scene system: ${system.id}`);
      }
      ids.add(system.id);
    }
  }

  sync(snapshot: RenderSnapshot): readonly RenderSceneId[] {
    const rendered: RenderSceneId[] = [];
    for (const system of this.systems) {
      const revision = snapshot.revisions[system.id];
      if (this.renderedRevisions.get(system.id) === revision) continue;
      system.render(snapshot);
      this.renderedRevisions.set(system.id, revision);
      rendered.push(system.id);
    }
    return rendered;
  }

  invalidate(scene?: RenderSceneId): void {
    if (scene) this.renderedRevisions.delete(scene);
    else this.renderedRevisions.clear();
  }

  dispose(): void {
    for (const system of this.systems) system.dispose?.();
    this.renderedRevisions.clear();
  }
}
