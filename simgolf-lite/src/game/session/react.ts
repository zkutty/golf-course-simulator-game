import { useCallback, useRef, useSyncExternalStore } from "react";
import type { GameState } from "../gameState";
import {
  type GameStateEquality,
  type GameStateSelector,
  GameSession,
} from "./GameSession";

interface SelectionCache<Selection> {
  state: GameState;
  selection: Selection;
}

/**
 * React bridge with selector-level equality. Equal projections retain their
 * previous identity, so an unrelated GameSession update does not re-render the
 * consuming panel even when a selector returns a small object or tuple.
 */
export function useGameSessionSelector<Selection>(
  session: GameSession,
  selector: GameStateSelector<Selection>,
  isEqual: GameStateEquality<Selection> = Object.is,
): Selection {
  const cache = useRef<SelectionCache<Selection> | null>(null);
  const getSnapshot = useCallback(() => {
    const state = session.getState();
    const current = cache.current;
    if (current?.state === state) return current.selection;
    const selection = selector(state);
    if (current && isEqual(current.selection, selection)) {
      cache.current = { state, selection: current.selection };
      return current.selection;
    }
    cache.current = { state, selection };
    return selection;
  }, [isEqual, selector, session]);

  return useSyncExternalStore(session.subscribe, getSnapshot, getSnapshot);
}

export function shallowEqual<Selection extends readonly unknown[] | Record<PropertyKey, unknown>>(
  left: Selection,
  right: Selection,
): boolean {
  if (Object.is(left, right)) return true;
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && Object.is(left[key as keyof Selection], right[key as keyof Selection]));
}
