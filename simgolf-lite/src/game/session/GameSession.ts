import type { Action } from "../../core/actions";
import { applyAction } from "../../core/reducer";
import type { PlatformServices } from "../../platform/types";
import type { SavePayload } from "../../utils/save";
import type { GameState } from "../gameState";

export type GameStateSelector<Selection> = (state: GameState) => Selection;
export type GameStateEquality<Selection> = (left: Selection, right: Selection) => boolean;
export type GameStateUpdater = (state: GameState) => GameState;
export type SaveAttachments = Omit<SavePayload, "course" | "world">;

export interface GameSessionOptions {
  initialState: GameState;
  platform: PlatformServices;
  reducer?: (state: GameState, action: Action) => GameState;
}

export interface PlatformQuitBoundary {
  shouldSave(): boolean;
  attachments(): SaveAttachments;
  persist(payload: SavePayload): Promise<unknown>;
  onPersisted?(): void;
  onError?(error: unknown): void | Promise<void>;
}

type Listener = () => void;

/**
 * Application boundary for the authoritative serializable game state.
 *
 * React, Pixi, browser automation, and native-platform lifecycle code all use
 * this same synchronous store. The reducer and persistence functions remain
 * injected/existing authorities; GameSession only coordinates access to them.
 */
export class GameSession {
  readonly platform: PlatformServices;

  private state: GameState;
  private readonly reducer: (state: GameState, action: Action) => GameState;
  private readonly listeners = new Set<Listener>();
  private readonly teardownCallbacks = new Set<() => void>();
  private changeSequence = 0;
  private cleanSequence = 0;
  private disposed = false;

  constructor(options: GameSessionOptions) {
    this.state = options.initialState;
    this.platform = options.platform;
    this.reducer = options.reducer ?? applyAction;
  }

  getState = (): GameState => this.state;

  get isDirty(): boolean {
    return this.changeSequence !== this.cleanSequence;
  }

  /** Monotonic revision for asynchronous, non-authoritative analysis work. */
  get revision(): number {
    return this.changeSequence;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Owns the lifetime of non-authoritative integrations (for example a
   * benchmark Worker). App close tears those integrations down before the
   * session drops its state and subscriptions.
   */
  registerTeardown(callback: () => void): () => void {
    this.assertActive();
    this.teardownCallbacks.add(callback);
    return () => this.teardownCallbacks.delete(callback);
  }

  subscribeSelector<Selection>(
    selector: GameStateSelector<Selection>,
    listener: (selection: Selection, previous: Selection) => void,
    isEqual: GameStateEquality<Selection> = Object.is,
  ): () => void {
    let selected = selector(this.state);
    return this.subscribe(() => {
      const next = selector(this.state);
      if (isEqual(selected, next)) return;
      const previous = selected;
      selected = next;
      listener(next, previous);
    });
  }

  dispatch(action: Action): GameState {
    return this.update((state) => this.reducer(state, action));
  }

  update(updater: GameStateUpdater): GameState {
    this.assertActive();
    const next = updater(this.state);
    if (next === this.state) return this.state;
    this.state = next;
    this.changeSequence += 1;
    this.emit();
    return next;
  }

  replaceState(state: GameState, options: { clean?: boolean } = {}): GameState {
    this.assertActive();
    const changed = state !== this.state;
    this.state = state;
    if (changed) this.changeSequence += 1;
    if (options.clean === true) this.cleanSequence = this.changeSequence;
    if (changed) this.emit();
    return state;
  }

  updateCourse(updater: (course: GameState["course"]) => GameState["course"]): GameState {
    return this.update((state) => {
      const course = updater(state.course);
      if (course === state.course) return state;
      return {
        ...state,
        course,
        terrainVersion: state.terrainVersion + 1,
        markersVersion: state.markersVersion + 1,
        economyVersion: state.economyVersion + 1,
      };
    });
  }

  updateWorld(updater: (world: GameState["world"]) => GameState["world"]): GameState {
    return this.update((state) => {
      const world = updater(state.world);
      if (world === state.world) return state;
      return { ...state, world, economyVersion: state.economyVersion + 1 };
    });
  }

  createSavePayload(attachments: SaveAttachments = {}): SavePayload {
    return {
      ...attachments,
      course: this.state.course,
      world: this.state.world,
    };
  }

  async save<Result>(
    persist: (payload: SavePayload) => Promise<Result>,
    attachments: SaveAttachments = {},
  ): Promise<Result> {
    this.assertActive();
    const sequence = this.changeSequence;
    const result = await persist(this.createSavePayload(attachments));
    this.markClean(sequence);
    return result;
  }

  restore(payload: SavePayload): GameState {
    const next = this.reducer(this.state, {
      type: "LOAD_GAME",
      course: payload.course,
      world: payload.world,
    });
    return this.replaceState(next, { clean: true });
  }

  async load(read: () => Promise<SavePayload | null>): Promise<SavePayload | null> {
    this.assertActive();
    const payload = await read();
    if (payload) this.restore(payload);
    return payload;
  }

  markClean(sequence = this.changeSequence): void {
    if (sequence === this.changeSequence) this.cleanSequence = sequence;
  }

  bindPlatformQuitBoundary(boundary: PlatformQuitBoundary): () => void {
    this.assertActive();
    return this.platform.app.onQuitRequested(async () => {
      try {
        if (boundary.shouldSave()) {
          await this.save(boundary.persist, boundary.attachments());
          boundary.onPersisted?.();
        }
        await this.platform.app.requestQuit({ dirty: false, resumableBoundary: true });
      } catch (error) {
        await boundary.onError?.(error);
        await this.platform.app.requestQuit({ dirty: true, resumableBoundary: false }).catch(() => undefined);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const callback of [...this.teardownCallbacks]) callback();
    this.teardownCallbacks.clear();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("GameSession has been disposed.");
  }
}
