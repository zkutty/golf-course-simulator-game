import type {
  RenderSceneId,
  RenderSnapshot,
} from "./RenderSnapshot";

export interface RenderSceneSystem {
  readonly id: RenderSceneId;
  /** Explicit lifecycle for systems that own Pixi display objects. */
  create?(snapshot: RenderSnapshot): void;
  update?(snapshot: RenderSnapshot): void;
  destroy?(): void;
  /** Compatibility lifecycle for the already-extracted stateless rebuilders. */
  render?(snapshot: RenderSnapshot): void;
  dispose?(): void;
}

/**
 * Owns scene-system invalidation independently of React effects. A failed
 * render does not consume its revision, allowing the same snapshot to retry.
 */
export class SceneSystemHost {
  private readonly renderedRevisions = new Map<RenderSceneId, number>();
  private readonly activeSystems = new Set<RenderSceneId>();
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
      if (revision === undefined) continue;
      if (this.renderedRevisions.get(system.id) === revision) continue;
      const alreadyCreated = this.activeSystems.has(system.id);
      try {
        if (!alreadyCreated && system.create) {
          this.activeSystems.add(system.id);
          system.create(snapshot);
        } else if (alreadyCreated && system.update) system.update(snapshot);
        else if (system.render) system.render(snapshot);
        else throw new Error(`Render scene system has no ${alreadyCreated ? "update" : "create"} lifecycle: ${system.id}`);
      } catch (error) {
        if (!alreadyCreated && this.activeSystems.has(system.id)) {
          if (system.destroy) system.destroy();
          else system.dispose?.();
          this.activeSystems.delete(system.id);
        }
        throw error;
      }
      this.activeSystems.add(system.id);
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
    for (const system of this.systems) {
      if (!this.activeSystems.has(system.id)) continue;
      if (system.destroy) system.destroy();
      else system.dispose?.();
    }
    this.renderedRevisions.clear();
    this.activeSystems.clear();
  }
}
