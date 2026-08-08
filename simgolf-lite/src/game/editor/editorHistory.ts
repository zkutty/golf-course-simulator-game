import type { Action } from "../../core/actions";
import type { GameState } from "../gameState";
import type { Terrain } from "../models/types";

export interface EditorCapitalSnapshot {
  spent: number;
  refunded: number;
  byTerrainSpent: Partial<Record<Terrain, number>>;
  byTerrainTiles: Partial<Record<Terrain, number>>;
}

export type EditorEditSnapshot = Pick<GameState, "course" | "world"> & {
  capital: EditorCapitalSnapshot;
};

export interface EditorEditHistory {
  undo: EditorEditSnapshot[];
  redo: EditorEditSnapshot[];
}

const MAX_EDITOR_HISTORY = 20;
const UNDOABLE_EDITOR_ACTIONS = new Set<Action["type"]>([
  "PAINT_TILES", "EDIT_SURFACE_FEATURE", "SCULPT_TILES", "SCULPT_GREEN",
  "PLACE_TEE", "MOVE_TEE", "PLACE_GREEN", "MOVE_GREEN",
  "SET_TEE_BOX", "REMOVE_TEE_BOX", "SET_PIN_POSITION", "REMOVE_PIN_POSITION",
  "SET_ACTIVE_PIN_ROTATION", "ADD_WAYPOINT", "UPDATE_WAYPOINT", "REMOVE_WAYPOINT",
  "PLACE_OBSTACLE", "REMOVE_OBSTACLE", "PLACE_BUILDING", "REMOVE_BUILDING",
  "PLACE_DECORATION", "REMOVE_DECORATION", "ROTATE_DECORATION", "SET_COURSE_LAYOUTS",
]);

const append = (values: EditorEditSnapshot[], snapshot: EditorEditSnapshot) =>
  [...values.slice(-(MAX_EDITOR_HISTORY - 1)), snapshot];

export const emptyEditorEditHistory = (): EditorEditHistory => ({ undo: [], redo: [] });

export function recordEditorEdit(
  history: EditorEditHistory,
  previous: GameState,
  next: GameState,
  capital: EditorCapitalSnapshot,
  action: Action,
): EditorEditHistory {
  if (next === previous || !UNDOABLE_EDITOR_ACTIONS.has(action.type)) return history;
  return {
    undo: append(history.undo, { course: previous.course, world: previous.world, capital }),
    redo: [],
  };
}

export function undoEditorEdit(
  history: EditorEditHistory,
  current: Pick<GameState, "course" | "world">,
  capital: EditorCapitalSnapshot,
): { history: EditorEditHistory; snapshot: EditorEditSnapshot } | null {
  const snapshot = history.undo.at(-1);
  if (!snapshot) return null;
  return {
    snapshot,
    history: {
      undo: history.undo.slice(0, -1),
      redo: append(history.redo, { course: current.course, world: current.world, capital }),
    },
  };
}

export function redoEditorEdit(
  history: EditorEditHistory,
  current: Pick<GameState, "course" | "world">,
  capital: EditorCapitalSnapshot,
): { history: EditorEditHistory; snapshot: EditorEditSnapshot } | null {
  const snapshot = history.redo.at(-1);
  if (!snapshot) return null;
  return {
    snapshot,
    history: {
      undo: append(history.undo, { course: current.course, world: current.world, capital }),
      redo: history.redo.slice(0, -1),
    },
  };
}
