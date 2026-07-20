export type BaseScreen = "title" | "setup-wizard" | "loading" | "in-game";
export type ModalLayer = "options" | "save-load" | "golfopedia" | "scenario-select";

export interface ScreenFlowState {
  base: BaseScreen;
  paused: boolean;
  modal: ModalLayer | null;
  loadingLabel: string | null;
}

export type ScreenFlowEvent =
  | { type: "OPEN_SETUP" }
  | { type: "BACK_TO_TITLE" }
  | { type: "BEGIN_LOADING"; label: string }
  | { type: "ENTER_GAME" }
  | { type: "OPEN_PAUSE" }
  | { type: "CLOSE_PAUSE" }
  | { type: "TOGGLE_PAUSE" }
  | { type: "OPEN_MODAL"; modal: ModalLayer }
  | { type: "CLOSE_TOP_LAYER" };

export const INITIAL_SCREEN_FLOW: ScreenFlowState = {
  base: "title",
  paused: false,
  modal: null,
  loadingLabel: null,
};

export function reduceScreenFlow(state: ScreenFlowState, event: ScreenFlowEvent): ScreenFlowState {
  switch (event.type) {
    case "OPEN_SETUP":
      return state.base === "title"
        ? { base: "setup-wizard", paused: false, modal: null, loadingLabel: null }
        : state;
    case "BACK_TO_TITLE":
      return { base: "title", paused: false, modal: null, loadingLabel: null };
    case "BEGIN_LOADING":
      return state.base !== "loading"
        ? { base: "loading", paused: false, modal: null, loadingLabel: event.label }
        : state;
    case "ENTER_GAME":
      return state.base === "loading"
        ? { base: "in-game", paused: false, modal: null, loadingLabel: null }
        : state;
    case "OPEN_PAUSE":
      return state.base === "in-game" && state.modal == null
        ? { ...state, paused: true }
        : state;
    case "CLOSE_PAUSE":
      return state.base === "in-game" && state.modal == null
        ? { ...state, paused: false }
        : state;
    case "TOGGLE_PAUSE":
      return state.base === "in-game" && state.modal == null
        ? { ...state, paused: !state.paused }
        : state;
    case "OPEN_MODAL":
      if (state.base === "loading") return state;
      if (state.base === "setup-wizard" && event.modal !== "scenario-select") return state;
      if (state.base === "title" && event.modal !== "options" && event.modal !== "save-load") return state;
      return { ...state, modal: event.modal };
    case "CLOSE_TOP_LAYER":
      if (state.modal) return { ...state, modal: null };
      if (state.base === "in-game" && state.paused) return { ...state, paused: false };
      return state;
  }
}
