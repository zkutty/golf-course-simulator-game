import {
  type GameStateEquality,
  type GameStateSelector,
  GameSession,
} from "./GameSession";

/**
 * Representative panel selectors used to prove that the session bridge limits
 * invalidations to the state each surface actually consumes. A selector
 * invalidation maps one-to-one to a `useGameSessionSelector` rerender for a
 * mounted React consumer.
 */
export const GAME_SESSION_PANEL_SURFACES = [
  "live-hud",
  "editor-inspector",
  "management-report",
] as const;

export type GameSessionPanelSurface = (typeof GAME_SESSION_PANEL_SURFACES)[number];
type PanelSelection = readonly unknown[];

const panelSelectors: Record<GameSessionPanelSurface, GameStateSelector<PanelSelection>> = {
  "live-hud": (state) => [
    state.world.week,
    state.world.cash,
    state.world.reputation,
    state.world.playerPro?.activeRound?.id ?? null,
    state.world.playerPro?.activeRound?.phase ?? null,
  ],
  "editor-inspector": (state) => [
    state.selectedTerrain,
    state.terrainVersion,
    state.markersVersion,
    state.course.activeCourseId ?? null,
    state.course.holes.length,
    state.course.condition,
  ],
  "management-report": (state) => [
    state.world.week,
    state.world.cash,
    state.world.lastWeekProfit,
    state.world.reputation,
    state.world.loans.map((loan) => `${loan.id}:${loan.status}:${loan.balance}`).join("|"),
  ],
};

const equalPanelSelection: GameStateEquality<PanelSelection> = (left, right) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

/**
 * Lightweight instrumentation for the three representative panel families.
 * It deliberately counts selector invalidations instead of rendering work, so
 * it is safe to use in headless tests and non-React host integrations.
 */
export class GameSessionRenderInstrumentation {
  private readonly updateCounts: Record<GameSessionPanelSurface, number> = {
    "live-hud": 0,
    "editor-inspector": 0,
    "management-report": 0,
  };

  private readonly unsubscribe: Array<() => void>;

  constructor(session: GameSession) {
    this.unsubscribe = GAME_SESSION_PANEL_SURFACES.map((surface) => session.subscribeSelector(
      panelSelectors[surface],
      () => { this.updateCounts[surface] += 1; },
      equalPanelSelection,
    ));
  }

  snapshot(): Readonly<Record<GameSessionPanelSurface, number>> {
    return Object.freeze({ ...this.updateCounts });
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
  }
}
