import type { RenderSnapshot } from "./renderSnapshot";

/**
 * The narrow terrain/water lifecycle seam used while PixiStage is split into
 * scene systems. The host owns Pixi details; this class owns invalidation and
 * teardown decisions so unrelated application state cannot rebuild terrain.
 */
export class TerrainSceneSystem<Context> {
  private snapshot: RenderSnapshot | null = null;
  private course: RenderSnapshot["course"] | null = null;
  private active = false;

  private readonly lifecycle: {
    create(context: Context, snapshot: RenderSnapshot): void;
    update(context: Context, snapshot: RenderSnapshot): void;
    destroy(context: Context): void;
  };

  constructor(lifecycle: {
    create(context: Context, snapshot: RenderSnapshot): void;
    update(context: Context, snapshot: RenderSnapshot): void;
    destroy(context: Context): void;
  }) {
    this.lifecycle = lifecycle;
  }

  sync(context: Context, next: RenderSnapshot): "created" | "updated" | "unchanged" {
    if (!this.active) {
      this.lifecycle.create(context, next);
      this.active = true;
      this.snapshot = next;
      this.course = next.course;
      return "created";
    }
    if (this.course !== next.course) {
      this.lifecycle.destroy(context);
      this.lifecycle.create(context, next);
      this.snapshot = next;
      this.course = next.course;
      return "created";
    }
    if (this.snapshot?.revisions["terrain-materials"] === next.revisions["terrain-materials"]) {
      this.snapshot = next;
      return "unchanged";
    }
    this.lifecycle.update(context, next);
    this.snapshot = next;
    return "updated";
  }

  destroy(context: Context): void {
    if (!this.active) return;
    this.lifecycle.destroy(context);
    this.active = false;
    this.snapshot = null;
    this.course = null;
  }
}
